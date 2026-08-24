import type { authenticate } from "./shopify.server";
import prisma from "./db.server";
import { normalizeProduct, normalizeProducts, parseJsonArray } from "./products";
import type { SliderImage, SliderMediaStatus, SliderProduct } from "./products";

type AdminClient = Awaited<ReturnType<typeof authenticate.admin>>["admin"];

/**
 * One `media` node, narrowed by `__typename`. Only the three types the gallery renders
 * are selected on; anything else (a 3D model, say) arrives with no matching fields and
 * is dropped by `fromMedia`.
 */
type GraphqlMedia = {
  __typename?: string;
  id: string;
  alt?: string | null;
  /** MediaImage. `image.id` is the ProductImage id — see `fromMedia`. */
  image?: { id: string; url: string } | null;
  /** Video and ExternalVideo: the poster still. */
  preview?: { image?: { url: string } | null } | null;
  /** Video. */
  sources?: Array<{ url: string; mimeType: string; format?: string | null; height?: number | null }>;
  /** ExternalVideo. */
  embedUrl?: string | null;
  /** `MediaStatus` — UPLOADED, PROCESSING, READY or FAILED. */
  status?: string | null;
  mediaErrors?: Array<{ code?: string | null; message?: string | null }> | null;
};
type GraphqlVariant = {
  id: string;
  title: string;
  sku?: string | null;
  image?: { id: string; url: string } | null;
};
type GraphqlProduct = {
  id: string;
  title: string;
  handle?: string;
  featuredImage?: { url: string } | null;
  media?: { nodes: GraphqlMedia[] };
  variants?: { nodes: GraphqlVariant[] };
};

const PRODUCT_FIELDS = `#graphql
  fragment SliderProductFields on Product {
    id
    title
    handle
    featuredImage {
      id
      url
    }
    media(first: 100) {
      nodes {
        __typename
        ... on MediaImage {
          id
          alt
          status
          mediaErrors {
            code
            message
          }
          image {
            id
            url
          }
        }
        ... on Video {
          id
          alt
          status
          mediaErrors {
            code
            message
          }
          preview {
            image {
              url
            }
          }
          sources {
            url
            mimeType
            format
            height
          }
        }
        ... on ExternalVideo {
          id
          alt
          status
          mediaErrors {
            code
            message
          }
          embedUrl
          preview {
            image {
              url
            }
          }
        }
      }
    }
    variants(first: 100) {
      nodes {
        id
        title
        sku
        image {
          id
          url
        }
      }
    }
  }
`;

/**
 * Shopify's `MediaStatus`, narrowed to the three states the gallery cares about. Anything
 * that is neither ready nor failed is still in flight.
 */
const toMediaStatus = (status: string | null | undefined): SliderMediaStatus => {
  if (status === "READY") return "ready";
  if (status === "FAILED") return "failed";
  return "processing";
};

/**
 * Maps one media node to a gallery entry, or `null` only when it has no id at all.
 *
 * Two rules matter here:
 *
 * 1. **Images keep their ProductImage id** (`image.id`), not the MediaImage id this node
 *    carries. `variantImageMap` and `imageCaptions` are keyed by the normalized
 *    ProductImage id, and `normalizeProduct` discards map entries that no longer match a
 *    gallery entry — so using `node.id` here would silently wipe every merchant's saved
 *    mapping and captions the first time their product hydrated.
 * 2. **Media that is not ready is still a gallery entry.** Shopify returns an empty
 *    `sources` list until a video's status is READY, and no poster at all for the first
 *    moments after upload. This used to drop such videos, which meant a merchant could not
 *    see, arrange or caption a video while it transcoded — and never at all if it failed.
 *    They now come through carrying their real status, and the UI renders a placeholder.
 */
const fromMedia = (node: GraphqlMedia): SliderImage | null => {
  const alt = node.alt ?? null;
  const failure = node.mediaErrors?.[0];
  /**
   * Every type carries its own GID for deletion. For a video this is the same value as
   * `id`; for an image the two diverge — `id` is the ProductImage id, and only this one is
   * accepted by `productDeleteMedia`.
   */
  const error = {
    ...(node.id ? { mediaId: node.id } : {}),
    ...(failure?.code ? { errorCode: failure.code } : {}),
    ...(failure?.message ? { errorMessage: failure.message } : {}),
  };

  if (node.__typename === "MediaImage") {
    // Images keep the old rule: with no URL there is nothing to show and no second state
    // worth explaining, unlike a video that is merely still encoding.
    if (!node.image?.id || !node.image.url) return null;
    return { id: node.image.id, url: node.image.url, alt, type: "image", ...error };
  }

  if (!node.id) return null;

  const poster = node.preview?.image?.url ?? "";
  const status = toMediaStatus(node.status);

  if (node.__typename === "Video") {
    // Progressive MP4 only: `<source>` picks the first playable entry rather than the
    // best one, so HLS manifests ahead of the MP4s would strand browsers that cannot
    // play them. Highest resolution first, since that is now the one that gets used.
    const sources = (node.sources ?? [])
      .filter((source) => source.url && source.mimeType === "video/mp4")
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))
      .map((source) => ({ url: source.url, mimeType: source.mimeType }));

    return { id: node.id, url: poster, alt, type: "video", sources, status, ...error };
  }

  if (node.__typename === "ExternalVideo") {
    return {
      id: node.id,
      url: poster,
      alt,
      type: "external_video",
      ...(node.embedUrl ? { embedUrl: node.embedUrl } : {}),
      // No embed URL means Shopify could not resolve the link; that is a dead entry, not
      // one still being worked on, so say so rather than spinning forever.
      status: node.embedUrl ? status : "failed",
      ...error,
    };
  }

  return null;
};

/**
 * Names every media node the gallery cannot render, and why.
 *
 * Media used to disappear from the grid with no trace, which made "my video is missing"
 * impossible to tell apart from "my video was never uploaded". The remaining drops are
 * narrow — an image with no URL, or a type this app does not support such as a 3D model —
 * but they are exactly the cases worth seeing in the log.
 */
const warnAboutDroppedMedia = (nodes: GraphqlMedia[]) => {
  for (const node of nodes) {
    if (fromMedia(node)) continue;

    const reason =
      node.__typename === "MediaImage"
        ? "image has no URL yet"
        : node.id
          ? `unsupported media type ${node.__typename ?? "unknown"}`
          : "node has no id";

    console.warn(
      `[products] skipped media ${node.__typename ?? "unknown"} ${node.id ?? "(no id)"}` +
        ` status=${node.status ?? "n/a"}: ${reason}`,
    );
  }
};

/**
 * Prints what Shopify returned for a product's media, in development only.
 *
 * Exists because "my video is missing from the grid" and "my video never uploaded" look
 * identical from the outside. This makes the difference readable in the dev terminal: a
 * `Video` node listed here but absent from the editor is a display bug, whereas no `Video`
 * node at all means the media never reached the product.
 */
const logMediaCensus = (node: GraphqlProduct) => {
  if (process.env.NODE_ENV === "production") return;

  const nodes = node.media?.nodes ?? [];
  const census = nodes
    .map((media) => {
      const kind = media.__typename ?? "unknown";
      const errors = media.mediaErrors?.length
        ? ` errors=${media.mediaErrors.map((error) => error?.code ?? "?").join("/")}`
        : "";
      return `${kind}:${media.status ?? "n/a"}${errors}`;
    })
    .join(", ");

  console.log(`[products] ${node.title} media(${nodes.length}): ${census || "none"}`);
};

const fromGraphql = (node: GraphqlProduct): SliderProduct => {
  logMediaCensus(node);
  warnAboutDroppedMedia(node.media?.nodes ?? []);

  return {
    id: node.id,
    title: node.title,
    handle: node.handle,
    image: node.featuredImage?.url ?? null,
    images: (node.media?.nodes ?? [])
      .map(fromMedia)
      .filter((media): media is SliderImage => media !== null),
    variants: (node.variants?.nodes ?? []).map((variant) => ({
      id: variant.id,
      title: variant.title,
      sku: variant.sku ?? null,
      image: variant.image?.url ?? null,
      imageId: variant.image?.id ?? null,
    })),
  };
};

/** Refreshes saved products against the Admin API, keeping their saved state. */
export const hydrateProducts = async (
  admin: AdminClient,
  products: SliderProduct[],
): Promise<SliderProduct[]> => {
  if (products.length === 0) return [];

  let data;
  try {
    const response = await admin.graphql(
      `${PRODUCT_FIELDS}
        query SelectedProducts($ids: [ID!]!) {
          nodes(ids: $ids) {
            ...SliderProductFields
          }
        }
      `,
      { variables: { ids: products.map((product) => product.id) } },
    );
    data = await response.json();
  } catch (error) {
    // A dropped connection is no reason to fail the whole page. Every product's
    // last-known state was passed in, and the merge below already falls back to it
    // per product — a transport failure is just the case where none of them hydrate.
    console.error("[products] hydrate failed, using saved copies:", error);
    return normalizeProducts(products);
  }

  const nodes: GraphqlProduct[] = (data.data?.nodes ?? []).filter(Boolean);
  const productsById = new Map(
    nodes.map((node) => [node.id, fromGraphql(node)] as const),
  );

  return normalizeProducts(
    products.map((savedProduct) => {
      const hydrated = productsById.get(savedProduct.id);
      if (!hydrated) return savedProduct;

      // Order is load-bearing. The saved product is the base so every app-owned field —
      // overrides, draft, imageCaptions, variantImageMap — survives by default, and
      // `hydrated` (which only ever carries Shopify-owned fields) refreshes those on
      // top. Re-attaching app-owned fields by name instead is how `imageCaptions` came
      // to be silently dropped here, and the loader's copy is written straight back by
      // the Products page, so anything missing was destroyed rather than just hidden.
      return {
        ...savedProduct,
        ...hydrated,
      };
    }),
  );
};

export const hydrateProduct = async (
  admin: AdminClient,
  product: SliderProduct,
): Promise<SliderProduct> => {
  const [hydrated] = await hydrateProducts(admin, [product]);
  return hydrated ?? normalizeProduct(product);
};

export const getSavedProducts = async (shop: string) => {
  const setting = await prisma.productSliderSetting.findUnique({ where: { shop } });
  return {
    setting,
    products: parseJsonArray<SliderProduct>(setting?.products),
  };
};

/**
 * Writes only the product list. The slider/zoom option columns are left alone so
 * a save from the Products page can never clobber the shop defaults, and vice versa.
 */
export const saveProducts = async (shop: string, products: SliderProduct[]) => {
  const productIds = JSON.stringify(products.map((product) => product.id));
  const payload = JSON.stringify(products);

  await prisma.productSliderSetting.upsert({
    where: { shop },
    create: { shop, productIds, products: payload },
    update: { productIds, products: payload },
  });

  return products;
};
