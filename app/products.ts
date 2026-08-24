import type { SliderOptions } from "./slider-options";

/**
 * Product shapes and the pure helpers that operate on them. Kept free of Prisma
 * and the Admin API so route components can import it — the server-only parts
 * live in `./products.server`.
 */

export const SLIDER_MEDIA_TYPES = ["image", "video", "external_video"] as const;
export type SliderMediaType = (typeof SLIDER_MEDIA_TYPES)[number];

/** One transcoded rendition of a Shopify-hosted video. */
export type SliderVideoSource = { url: string; mimeType: string };

export const SLIDER_MEDIA_STATUSES = ["ready", "processing", "failed"] as const;
/**
 * How far Shopify has got with a piece of media. Only meaningful for video: an image is
 * either usable or it never reaches the gallery at all.
 */
export type SliderMediaStatus = (typeof SLIDER_MEDIA_STATUSES)[number];

/**
 * One gallery entry. Still called `SliderImage` — and still stored under `images` —
 * because both names are baked into the persisted `products` JSON blob and into every
 * `variantImageMap` / `imageCaptions` key. Videos are entries whose `type` says so.
 */
export type SliderImage = {
  id: string;
  /**
   * For a video this is the poster still. The inline slider only ever renders stills,
   * so every existing consumer of `url` keeps working unchanged.
   *
   * **Can be empty for a video** that Shopify has not made a poster for yet. Such an entry
   * still holds a real position in the gallery, so callers render a placeholder rather
   * than an `<img>` with no source.
   */
  url: string;
  alt?: string | null;
  /** Absent means `"image"`, so products saved before video support read back correctly. */
  type?: SliderMediaType;
  /** `video` only, and empty until Shopify finishes transcoding. */
  sources?: SliderVideoSource[];
  /** `external_video` only: the embeddable player URL Shopify returns. */
  embedUrl?: string;
  /** Video only. Absent means ready — that is how entries saved before this field read. */
  status?: SliderMediaStatus;
  /**
   * The media's own GID, used only to delete it.
   *
   * Deliberately **not** normalized, unlike `id`. `productDeleteMedia` needs the full
   * `gid://shopify/MediaImage/123`, and the prefix differs per type. It is a separate
   * field because for an image `id` holds the *ProductImage* id — a different record with
   * a different number — which the mutation would reject.
   */
  mediaId?: string;
  /** Shopify's `MediaErrorCode`, when processing failed. Drives the translated message. */
  errorCode?: string;
  /** Shopify's own error text — the fallback for codes we have no translation for. */
  errorMessage?: string;
};

export const isVideoMedia = (media: Pick<SliderImage, "type">) =>
  media.type === "video" || media.type === "external_video";

/**
 * Whether this entry can actually be played, as opposed to merely being a video.
 *
 * The distinction matters wherever a play affordance is drawn: a video still transcoding
 * has a poster but nothing behind it, and offering a play button there promises something
 * the click cannot deliver. Mirrors `isPlayable` in the storefront slider.
 */
export const isPlayableMedia = (media: SliderImage) =>
  (media.type === "video" && (media.sources?.length ?? 0) > 0) ||
  (media.type === "external_video" && Boolean(media.embedUrl));

/**
 * The container formats Shopify accepts for product video.
 *
 * Here rather than in `media.server` because the upload form needs it for the file
 * input's `accept`, and importing a runtime value from a server module into a component
 * pulls the Admin API client into the browser bundle.
 */
export const VIDEO_MIME_TYPES = ["video/mp4", "video/quicktime", "video/webm"] as const;

/**
 * Shopify's ceilings for a product video: 1 GB and 10 minutes.
 *
 * Here rather than in `media.server` for the same reason as `VIDEO_MIME_TYPES` above — the
 * upload form screens files in the browser before sending them, and importing a runtime
 * value from a server module into a component drags the Admin API client into the client
 * bundle. `media.server` imports these back for the authoritative server-side check.
 */
export const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;
export const MAX_VIDEO_DURATION_SECONDS = 600;

export type SliderVariant = {
  id: string;
  title: string;
  sku?: string | null;
  image?: string | null;
  imageId?: string | null;
};

export type SliderProduct = {
  id: string;
  title: string;
  handle?: string;
  image?: string | null;
  images?: SliderImage[];
  variants?: SliderVariant[];
  variantImageMap?: Record<string, string[]>;
  /**
   * Image id → caption, shown by the polaroid, card and caption-overlay thumbnail
   * styles. Deliberately a top-level map rather than a field on each `SliderImage`:
   * `hydrateProducts` rebuilds the images array wholesale from the Admin API, so
   * anything stored inside an image object is dropped on every refresh.
   */
  imageCaptions?: Record<string, string>;
  /**
   * Media ids in the order the merchant arranged them, applied to `images` by
   * `normalizeProduct`. Absent or empty means "use Shopify's own order".
   *
   * Top-level for the same reason `imageCaptions` is: `hydrateProducts` rebuilds the
   * images array wholesale from the Admin API, so a `position` field living inside each
   * image object would be dropped on every refresh.
   */
  mediaOrder?: string[];
  /** Absent or null means "use the shop defaults". */
  overrides?: SliderOptions | null;
  /**
   * Unpublished edits to `overrides`. The storefront resolves galleries through
   * `overrides` alone, so a draft is invisible to shoppers until it is published.
   *
   * Wrapped in an object on purpose: `null` already means "use the shop defaults" for
   * `overrides`, so a bare `draftOverrides` field could not tell a draft that reverts to
   * shop defaults apart from having no draft at all. Here `draft.overrides === null` is
   * the former and `draft` being absent is the latter.
   */
  draft?: { overrides: SliderOptions | null } | null;
};

/** One runaway caption should not be able to bloat the shop's products blob. */
export const MAX_CAPTION_LENGTH = 240;

export const parseJsonArray = <T,>(value: string | null | undefined): T[] => {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const normalizeShopifyId = (id: string | number | null | undefined) => {
  if (id === null || id === undefined) return "";
  return String(id).split("/").pop() ?? String(id);
};

/**
 * Rebuilds one gallery entry field by field.
 *
 * Every field a caller needs has to be named here: anything omitted is destroyed on the
 * next save, because the Products page writes the loader's copy straight back. That is
 * exactly how `imageCaptions` was once silently dropped, so the video fields are spelled
 * out rather than spread.
 */
const normalizeMedia = (image: SliderImage): SliderImage => {
  const type: SliderMediaType = SLIDER_MEDIA_TYPES.includes(image.type as SliderMediaType)
    ? (image.type as SliderMediaType)
    : "image";

  const status: SliderMediaStatus = SLIDER_MEDIA_STATUSES.includes(
    image.status as SliderMediaStatus,
  )
    ? (image.status as SliderMediaStatus)
    : "ready";

  return {
    id: normalizeShopifyId(image.id),
    // Verbatim, unlike `id` directly above. Normalizing this would strip the GID down to a
    // bare number and make every delete fail — the two lines look alike on purpose, so the
    // difference is called out here rather than left to be noticed.
    ...(image.mediaId ? { mediaId: image.mediaId } : {}),
    url: image.url ?? "",
    alt: image.alt ?? null,
    type,
    ...(image.errorCode ? { errorCode: image.errorCode } : {}),
    ...(image.errorMessage ? { errorMessage: image.errorMessage } : {}),
    ...(type === "video" && Array.isArray(image.sources)
      ? {
          sources: image.sources.filter(
            (source) => source?.url && typeof source.mimeType === "string",
          ),
        }
      : {}),
    ...(type === "external_video" && image.embedUrl ? { embedUrl: image.embedUrl } : {}),
    ...(type === "image" ? {} : { status }),
  };
};

/**
 * Whether an entry has enough to be worth a tile.
 *
 * An image with no URL is nothing at all. A video with no URL is a real gallery entry
 * whose poster has not been generated yet — dropping it is what previously made a
 * just-uploaded video vanish from the editor with no explanation.
 */
const isRenderableMedia = (image: SliderImage) =>
  Boolean(image.id) && (Boolean(image.url) || isVideoMedia(image));

/**
 * Applies a saved order to the gallery, returning both the sorted media and the cleaned
 * order that produced it.
 *
 * Ids that no longer match an image are dropped, the same stale-key cleanup
 * `imageCaptions` gets below. An empty result means "no custom order" and leaves Shopify's
 * own ordering in place.
 *
 * The sort is stable and unranked media sorts last, so anything the order does not
 * mention — a freshly uploaded image, or a video that finished transcoding after the last
 * save — keeps its Shopify-relative position at the end of the gallery, which is where a
 * merchant expects a new upload to appear. `MAX_SAFE_INTEGER` rather than `Infinity`
 * because `Infinity - Infinity` is `NaN`, which would make the comparator undefined for
 * any two unranked entries.
 */
const applyMediaOrder = (images: SliderImage[], rawOrder: SliderProduct["mediaOrder"]) => {
  if (!Array.isArray(rawOrder) || !rawOrder.length) return { images, mediaOrder: [] };

  const imageIds = new Set(images.map((image) => image.id));
  const mediaOrder: string[] = [];
  for (const raw of rawOrder) {
    const id = normalizeShopifyId(raw);
    if (imageIds.has(id) && !mediaOrder.includes(id)) mediaOrder.push(id);
  }

  const rank = new Map(mediaOrder.map((id, index) => [id, index] as const));
  const rankOf = (image: SliderImage) => rank.get(image.id) ?? Number.MAX_SAFE_INTEGER;

  return { images: [...images].sort((a, b) => rankOf(a) - rankOf(b)), mediaOrder };
};

export const normalizeProduct = (product: SliderProduct): SliderProduct => {
  const { images, mediaOrder } = applyMediaOrder(
    Array.isArray(product.images)
      ? product.images.map(normalizeMedia).filter(isRenderableMedia)
      : [],
    product.mediaOrder,
  );
  const imageIds = new Set(images.map((image) => image.id));
  const variants = Array.isArray(product.variants)
    ? product.variants
        .filter((variant) => variant.id && variant.title)
        .map((variant) => ({
          id: normalizeShopifyId(variant.id),
          title: variant.title,
          sku: variant.sku ?? null,
          image: variant.image ?? null,
          imageId: variant.imageId ? normalizeShopifyId(variant.imageId) : null,
        }))
    : [];
  const existingMap =
    product.variantImageMap && typeof product.variantImageMap === "object"
      ? product.variantImageMap
      : {};
  const variantImageMap = variants.reduce<Record<string, string[]>>((map, variant) => {
    const savedMapEntry =
      existingMap[variant.id] ??
      Object.entries(existingMap).find(
        ([variantId]) => normalizeShopifyId(variantId) === variant.id,
      )?.[1];
    const savedImageIds = Array.isArray(savedMapEntry)
      ? savedMapEntry.map(normalizeShopifyId).filter((imageId) => imageIds.has(imageId))
      : [];
    const fallbackImageIds =
      variant.imageId && imageIds.has(variant.imageId) ? [variant.imageId] : [];

    map[variant.id] = savedImageIds.length ? savedImageIds : fallbackImageIds;
    return map;
  }, {});

  // Keyed by image id, so a caption follows its image across a re-hydrate. Captions for
  // images that have since been removed from the product are dropped here.
  const rawCaptions =
    product.imageCaptions && typeof product.imageCaptions === "object"
      ? product.imageCaptions
      : {};
  const imageCaptions = Object.entries(rawCaptions).reduce<Record<string, string>>(
    (map, [imageId, caption]) => {
      const id = normalizeShopifyId(imageId);
      const text = typeof caption === "string" ? caption.trim() : "";
      if (imageIds.has(id) && text) map[id] = text.slice(0, MAX_CAPTION_LENGTH);
      return map;
    },
    {},
  );

  return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    image: product.image ?? null,
    images,
    variants,
    variantImageMap,
    imageCaptions,
    mediaOrder,
    // Carried through deliberately: this rebuild is the one place a per-product
    // override could silently be dropped on every save. The same goes for an
    // unpublished draft — omitting it here would destroy it on the next mapping save.
    ...(product.overrides ? { overrides: product.overrides } : {}),
    ...(product.draft ? { draft: product.draft } : {}),
  };
};

export const normalizeProducts = (products: SliderProduct[]) =>
  products.filter((product) => product.id && product.title).map(normalizeProduct);
