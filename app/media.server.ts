/**
 * Uploading merchant-supplied images onto a Shopify product.
 *
 * Three steps per file, per Shopify's staged upload flow:
 *   1. `stagedUploadsCreate` hands back a signed URL plus the form fields it expects.
 *   2. The bytes are POSTed to that URL as multipart — parameters first, `file` last.
 *   3. `productUpdate` attaches the resulting `resourceUrl` to the product as media.
 *
 * Unlike `products.server.ts` — which reads, and degrades to stale data when a query
 * fails — every step here is a write, so GraphQL errors and `userErrors` are checked
 * and reported rather than swallowed.
 */

import type { authenticate } from "./shopify.server";

type AdminClient = Awaited<ReturnType<typeof authenticate.admin>>["admin"];

/** Shopify rejects product images above 20 MB. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** Bounds how much this action buffers in memory and how long it runs. */
export const MAX_IMAGES_PER_UPLOAD = 10;

type StagedTarget = {
  url: string | null;
  resourceUrl: string | null;
  parameters: Array<{ name: string; value: string }>;
};

const STAGED_UPLOADS = `#graphql
  mutation GalleryNestStagedUploads($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters {
          name
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const ADD_PRODUCT_MEDIA = `#graphql
  mutation GalleryNestAddProductMedia($product: ProductUpdateInput!, $media: [CreateMediaInput!]) {
    productUpdate(product: $product, media: $media) {
      product {
        id
        media(first: 100) {
          nodes {
            id
            mediaContentType
            preview {
              status
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export type UploadResult = {
  /** How many images were attached to the product. */
  uploaded: number;
  /** Human-readable reasons, one per rejected or failed file. */
  errors: string[];
};

/**
 * Splits the incoming files into those worth sending and those that fail a local
 * guard. Checking here means an oversized or non-image file never costs an API call.
 */
export const partitionUploadableFiles = (
  files: File[],
  describe: (reason: "type" | "size", filename: string) => string,
) => {
  const accepted: File[] = [];
  const rejected: string[] = [];

  for (const file of files) {
    if (!file.type.startsWith("image/")) {
      rejected.push(describe("type", file.name));
    } else if (file.size > MAX_IMAGE_BYTES) {
      rejected.push(describe("size", file.name));
    } else {
      accepted.push(file);
    }
  }

  return { accepted, rejected };
};

/**
 * Reads `errors` the way the Admin API reports transport and permission failures —
 * a missing `write_products` grant surfaces here, not in `userErrors`. The payload is
 * typed loosely by the client, so it is narrowed rather than asserted.
 */
const graphqlErrorMessage = (payload: unknown) => {
  const errors = (payload as { errors?: unknown })?.errors;
  if (!errors) return null;

  const messages = (Array.isArray(errors) ? errors : [errors])
    .map((error) => (error as { message?: string })?.message)
    .filter(Boolean);

  return messages.length ? messages.join("; ") : "Admin API request failed";
};

const userErrorMessage = (userErrors?: Array<{ message?: string }> | null) =>
  userErrors?.length
    ? userErrors.map((error) => error?.message).filter(Boolean).join("; ")
    : null;

/**
 * Attaches already-hosted images to a product by URL.
 *
 * Shared by both paths: the upload flow passes a staged `resourceUrl`, the library
 * picker passes a Shopify CDN URL. Either way Shopify fetches the URL and creates a
 * **new** MediaImage owned by this product — media records are not shared between
 * products, so picking a library image copies it rather than referencing it.
 */
export const attachMediaToProduct = async (
  admin: AdminClient,
  productGid: string,
  sources: Array<{ originalSource: string; alt: string }>,
): Promise<UploadResult> => {
  if (!sources.length) return { uploaded: 0, errors: [] };

  const response = await admin.graphql(ADD_PRODUCT_MEDIA, {
    variables: {
      product: { id: productGid },
      media: sources.map((source) => ({
        originalSource: source.originalSource,
        alt: source.alt,
        mediaContentType: "IMAGE",
      })),
    },
  });
  const payload = await response.json();

  const transportError = graphqlErrorMessage(payload);
  if (transportError) return { uploaded: 0, errors: [transportError] };

  const userError = userErrorMessage(payload.data?.productUpdate?.userErrors);
  if (userError) return { uploaded: 0, errors: [userError] };

  return { uploaded: sources.length, errors: [] };
};

/**
 * Uploads `files` and attaches them to `productGid`.
 *
 * `files` is expected to have already passed `partitionUploadableFiles`. A failure
 * partway through is reported but does not discard the files that did succeed —
 * `productUpdate` runs for whatever reached the staged targets.
 */
export const uploadProductImages = async (
  admin: AdminClient,
  productGid: string,
  files: File[],
): Promise<UploadResult> => {
  if (!files.length) return { uploaded: 0, errors: [] };

  const stagedResponse = await admin.graphql(STAGED_UPLOADS, {
    variables: {
      input: files.map((file) => ({
        filename: file.name,
        mimeType: file.type,
        resource: "IMAGE",
        httpMethod: "POST",
        fileSize: String(file.size),
      })),
    },
  });
  const stagedPayload = await stagedResponse.json();

  const stagedTransportError = graphqlErrorMessage(stagedPayload);
  if (stagedTransportError) {
    return { uploaded: 0, errors: [stagedTransportError] };
  }

  const staged = stagedPayload.data?.stagedUploadsCreate;
  const stagedUserError = userErrorMessage(staged?.userErrors);
  if (stagedUserError) {
    return { uploaded: 0, errors: [stagedUserError] };
  }

  const targets: StagedTarget[] = staged?.stagedTargets ?? [];
  const errors: string[] = [];
  const sources: Array<{ originalSource: string; alt: string }> = [];

  // Targets come back positionally, so index ties each one to the file it was made for.
  for (const [index, file] of files.entries()) {
    const target = targets[index];
    if (!target?.url || !target.resourceUrl) {
      errors.push(`${file.name}: no upload target returned`);
      continue;
    }

    const body = new FormData();
    // The storage backend requires its own parameters ahead of the file field.
    for (const parameter of target.parameters) {
      body.append(parameter.name, parameter.value);
    }
    body.append("file", file, file.name);

    const upload = await fetch(target.url, { method: "POST", body });
    if (!upload.ok) {
      errors.push(`${file.name}: upload failed (${upload.status})`);
      continue;
    }

    sources.push({
      originalSource: target.resourceUrl,
      // Falling back to the filename keeps alt text non-empty for accessibility.
      alt: file.name.replace(/\.[^.]+$/, ""),
    });
  }

  if (!sources.length) return { uploaded: 0, errors };

  const attached = await attachMediaToProduct(admin, productGid, sources);
  return { uploaded: attached.uploaded, errors: [...errors, ...attached.errors] };
};

/* -------------------------------------------------------------------------- */
/* Browsing images that already live in Shopify                                */
/* -------------------------------------------------------------------------- */

/** One thumbnail in the picker. `source` names the owning product, or "" for library files. */
export type PickerImage = {
  id: string;
  url: string;
  alt: string;
  source: string;
};

export type PickerPage = {
  images: PickerImage[];
  nextCursor: string | null;
  error?: string;
};

/** How many images one picker page requests. */
export const PICKER_PAGE_SIZE = 24;

const SHOPIFY_CDN_HOSTS = ["cdn.shopify.com", "shopifycdn.com", "shopifycdn.net"];

/**
 * The attach action takes image URLs from the client, and `originalSource` makes
 * Shopify fetch whatever URL it is handed. Restricting it to Shopify's own CDN keeps
 * a tampered request from turning the app into a fetch-arbitrary-URL primitive.
 */
export const isShopifyCdnUrl = (value: string) => {
  let host: string;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return false;
    host = parsed.hostname.toLowerCase();
  } catch {
    return false;
  }

  return SHOPIFY_CDN_HOSTS.some((cdn) => host === cdn || host.endsWith(`.${cdn}`));
};

const LIBRARY_FILES = `#graphql
  query GalleryNestFiles($first: Int!, $after: String, $query: String) {
    files(first: $first, after: $after, query: $query) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        ... on MediaImage {
          id
          alt
          image {
            url
          }
        }
      }
    }
  }
`;

const PRODUCT_LIBRARY = `#graphql
  query GalleryNestProductImages($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        media(first: 10) {
          nodes {
            ... on MediaImage {
              id
              alt
              image {
                url
              }
            }
          }
        }
      }
    }
  }
`;

type LibraryNode = {
  id?: string;
  alt?: string | null;
  image?: { url?: string | null } | null;
};

/** Media still being processed has no URL yet, so it is skipped rather than shown broken. */
const toPickerImage = (node: LibraryNode, source: string): PickerImage | null =>
  node?.id && node.image?.url
    ? { id: node.id, url: node.image.url, alt: node.alt ?? "", source }
    : null;

const emptyPage = (error: string): PickerPage => ({
  images: [],
  nextCursor: null,
  error,
});

/** Images from the store's Files library (Content → Files). Needs `read_files`. */
export const listLibraryFiles = async (
  admin: AdminClient,
  { search, cursor }: { search?: string; cursor?: string | null },
): Promise<PickerPage> => {
  // The media-type filter is always applied; a search term narrows within it.
  const query = ["media_type:IMAGE", search?.trim()].filter(Boolean).join(" ");

  const response = await admin.graphql(LIBRARY_FILES, {
    variables: { first: PICKER_PAGE_SIZE, after: cursor || null, query },
  });
  const payload = await response.json();

  const transportError = graphqlErrorMessage(payload);
  if (transportError) return emptyPage(transportError);

  const files = payload.data?.files;
  const images = ((files?.nodes ?? []) as LibraryNode[])
    .map((node) => toPickerImage(node, ""))
    .filter((image): image is PickerImage => image !== null);

  return {
    images,
    nextCursor: files?.pageInfo?.hasNextPage ? files.pageInfo.endCursor ?? null : null,
  };
};

/** Images attached to the store's other products, labelled with the product they came from. */
export const listProductLibrary = async (
  admin: AdminClient,
  { search, cursor }: { search?: string; cursor?: string | null },
): Promise<PickerPage> => {
  const response = await admin.graphql(PRODUCT_LIBRARY, {
    variables: {
      first: PICKER_PAGE_SIZE,
      after: cursor || null,
      query: search?.trim() || null,
    },
  });
  const payload = await response.json();

  const transportError = graphqlErrorMessage(payload);
  if (transportError) return emptyPage(transportError);

  const products = payload.data?.products;
  const images = (
    (products?.nodes ?? []) as Array<{
      title?: string;
      media?: { nodes?: LibraryNode[] };
    }>
  ).flatMap((product) =>
    (product.media?.nodes ?? [])
      .map((node) => toPickerImage(node, product.title ?? ""))
      .filter((image): image is PickerImage => image !== null),
  );

  return {
    images,
    nextCursor: products?.pageInfo?.hasNextPage
      ? products.pageInfo.endCursor ?? null
      : null,
  };
};
