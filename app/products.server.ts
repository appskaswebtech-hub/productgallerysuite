import type { authenticate } from "./shopify.server";
import prisma from "./db.server";
import { normalizeProduct, normalizeProducts, parseJsonArray } from "./products";
import type { SliderProduct } from "./products";

type AdminClient = Awaited<ReturnType<typeof authenticate.admin>>["admin"];

type GraphqlImage = { id: string; url: string; altText?: string | null };
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
  images?: { nodes: GraphqlImage[] };
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
    images(first: 100) {
      nodes {
        id
        url
        altText
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

const fromGraphql = (node: GraphqlProduct): SliderProduct => ({
  id: node.id,
  title: node.title,
  handle: node.handle,
  image: node.featuredImage?.url ?? null,
  images: (node.images?.nodes ?? []).map((image) => ({
    id: image.id,
    url: image.url,
    alt: image.altText ?? null,
  })),
  variants: (node.variants?.nodes ?? []).map((variant) => ({
    id: variant.id,
    title: variant.title,
    sku: variant.sku ?? null,
    image: variant.image?.url ?? null,
    imageId: variant.image?.id ?? null,
  })),
});

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
