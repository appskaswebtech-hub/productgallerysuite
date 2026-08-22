import type { SliderOptions } from "./slider-options";

/**
 * Product shapes and the pure helpers that operate on them. Kept free of Prisma
 * and the Admin API so route components can import it — the server-only parts
 * live in `./products.server`.
 */

export type SliderImage = {
  id: string;
  url: string;
  alt?: string | null;
};

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

export const normalizeProduct = (product: SliderProduct): SliderProduct => {
  const images = Array.isArray(product.images)
    ? product.images
        .filter((image) => image.id && image.url)
        .map((image) => ({
          id: normalizeShopifyId(image.id),
          url: image.url,
          alt: image.alt ?? null,
        }))
    : [];
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
    // Carried through deliberately: this rebuild is the one place a per-product
    // override could silently be dropped on every save. The same goes for an
    // unpublished draft — omitting it here would destroy it on the next mapping save.
    ...(product.overrides ? { overrides: product.overrides } : {}),
    ...(product.draft ? { draft: product.draft } : {}),
  };
};

export const normalizeProducts = (products: SliderProduct[]) =>
  products.filter((product) => product.id && product.title).map(normalizeProduct);
