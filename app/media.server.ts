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
import { MAX_VIDEO_BYTES, VIDEO_MIME_TYPES } from "./products";

type AdminClient = Awaited<ReturnType<typeof authenticate.admin>>["admin"];

/** Shopify rejects product images above 20 MB. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * Re-exported so server code keeps importing its limits from one place.
 *
 * Defined in `./products` because the upload form screens files in the browser first, and a
 * component cannot import a runtime value from a `.server` module. Reachable at all only
 * because the browser uploads the bytes itself — see `createStagedVideoTargets`.
 */
export { MAX_VIDEO_BYTES };

/** Bounds how much this action buffers in memory and how long it runs. */
export const MAX_IMAGES_PER_UPLOAD = 10;

/** Videos are staged one batch at a time and are far larger, so the batch is smaller. */
export const MAX_VIDEOS_PER_UPLOAD = 5;

/** The media kinds the gallery knows how to attach and render. */
export type MediaContentType = "IMAGE" | "VIDEO" | "EXTERNAL_VIDEO";

export type StagedTarget = {
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

/**
 * Detaches media from a product.
 *
 * `fileUpdate` rather than `productDeleteMedia`: the latter is deprecated and Shopify
 * names this as its replacement. Removing the product from a file's references "deletes
 * the file from the product's media gallery and clears the image from any product variants
 * that were using it" — which is exactly what the tile's × means — while leaving the file
 * itself in Content → Files, so a mistaken click is recoverable. Permanently destroying
 * the file would be `fileDelete`, which is deliberately not what this does.
 *
 * **This is why the app requests `write_files`.** That scope exists solely for this call;
 * `productDeleteMedia` would run on `write_products` alone, but swapping to it to avoid the
 * scope would mean shipping a mutation Shopify has already deprecated.
 */
const REMOVE_PRODUCT_MEDIA = `#graphql
  mutation GalleryNestRemoveProductMedia($files: [FileUpdateInput!]!) {
    fileUpdate(files: $files) {
      files {
        id
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

/** What `partitionUploadableFiles` is currently vetting, and the caps that go with it. */
export type UploadKind = "image" | "video";

const isVideoMimeType = (mimeType: string) =>
  (VIDEO_MIME_TYPES as readonly string[]).includes(mimeType);

/**
 * Splits the incoming files into those worth sending and those that fail a local
 * guard. Checking here means an oversized or wrong-typed file never costs an API call —
 * which matters far more for video, where the alternative is discovering it after the
 * shopper's browser has already pushed a gigabyte at Google Cloud Storage.
 *
 * `kind` decides both the accepted MIME types and the size cap, so the caller words its
 * own rejection messages ("not an image" vs "not a supported video format").
 */
export const partitionUploadableFiles = <T extends StagedFileDescriptor>(
  files: T[],
  describe: (reason: "type" | "size", filename: string) => string,
  kind: UploadKind = "image",
) => {
  const accepted: T[] = [];
  const rejected: string[] = [];
  const maxBytes = kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  const typeMatches = (file: T) =>
    kind === "video" ? isVideoMimeType(file.type) : file.type.startsWith("image/");

  for (const file of files) {
    if (!typeMatches(file)) {
      rejected.push(describe("type", file.name));
    } else if (file.size > maxBytes) {
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
 * Attaches already-hosted media to a product by URL.
 *
 * Shared by every path: the image upload flow and the video upload flow pass a staged
 * `resourceUrl`, the library picker passes a Shopify CDN URL, and external video passes
 * a YouTube or Vimeo watch URL. In the first three cases Shopify fetches the URL and
 * creates a **new** media record owned by this product — media is not shared between
 * products, so picking a library image copies it rather than referencing it.
 *
 * Every source in one call shares `mediaContentType`, which is how the call sites are
 * shaped anyway: each one attaches a single kind.
 */
export const attachMediaToProduct = async (
  admin: AdminClient,
  productGid: string,
  sources: Array<{ originalSource: string; alt: string }>,
  mediaContentType: MediaContentType = "IMAGE",
): Promise<UploadResult> => {
  if (!sources.length) return { uploaded: 0, errors: [] };

  const response = await admin.graphql(ADD_PRODUCT_MEDIA, {
    variables: {
      product: { id: productGid },
      media: sources.map((source) => ({
        originalSource: source.originalSource,
        alt: source.alt,
        mediaContentType,
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
 * Removes one piece of media from a product's gallery.
 *
 * `mediaId` must be the media's own full GID — `gid://shopify/MediaImage/…`,
 * `…/Video/…` or `…/ExternalVideo/…`. For an image that is **not** the id the gallery
 * stores as `SliderImage.id`, which is the ProductImage id; passing that one addresses a
 * different record. `SliderImage.mediaId` exists to carry the right one.
 */
export const removeProductMedia = async (
  admin: AdminClient,
  productGid: string,
  mediaId: string,
): Promise<{ ok: boolean; error?: string }> => {
  // `admin.graphql` throws on an HTTP-level failure — a denied scope, a network blip — so
  // without this the throw escapes past a signature that promises to report errors, and
  // lands in the route's ErrorBoundary. That is how the missing `write_files` scope became
  // a full-page "Application Error" with a stack trace instead of a toast.
  try {
    const response = await admin.graphql(REMOVE_PRODUCT_MEDIA, {
      variables: { files: [{ id: mediaId, referencesToRemove: [productGid] }] },
    });
    const payload = await response.json();

    const transportError = graphqlErrorMessage(payload);
    if (transportError) return { ok: false, error: transportError };

    const userError = userErrorMessage(payload.data?.fileUpdate?.userErrors);
    if (userError) return { ok: false, error: userError };

    return { ok: true };
  } catch (error) {
    // Detail to the server log; the caller turns `error` into a translated toast rather
    // than showing raw API text to a merchant.
    console.error("[media] productDeleteMedia failed", error);

    return { ok: false, error: error instanceof Error ? error.message : "request failed" };
  }
};

/** Just enough of a file to ask Shopify for an upload slot — the bytes are not needed. */
export type StagedFileDescriptor = { name: string; type: string; size: number };

/**
 * Asks Shopify for one signed upload slot per file.
 *
 * `resource` is what separates the two upload flows. `IMAGE` targets are POSTed to by
 * this server in `uploadProductImages`; `VIDEO` targets are handed to the browser, which
 * POSTs to them directly — a video can be a gigabyte, and routing that through a React
 * Router action would buffer the whole thing in the Node process.
 */
const createStagedTargets = async (
  admin: AdminClient,
  files: StagedFileDescriptor[],
  resource: "IMAGE" | "VIDEO",
): Promise<{ targets: StagedTarget[]; error?: string }> => {
  const response = await admin.graphql(STAGED_UPLOADS, {
    variables: {
      input: files.map((file) => ({
        filename: file.name,
        mimeType: file.type,
        resource,
        httpMethod: "POST",
        fileSize: String(file.size),
      })),
    },
  });
  const payload = await response.json();

  const transportError = graphqlErrorMessage(payload);
  if (transportError) return { targets: [], error: transportError };

  const staged = payload.data?.stagedUploadsCreate;
  const userError = userErrorMessage(staged?.userErrors);
  if (userError) return { targets: [], error: userError };

  return { targets: (staged?.stagedTargets ?? []) as StagedTarget[] };
};

/**
 * Mints upload slots for videos and hands them back for the browser to POST to.
 *
 * Deliberately does **not** attach anything: the caller returns these to the client,
 * which uploads the bytes and then comes back through `attachMediaToProduct` with the
 * resulting `resourceUrl`s. Those URLs must be re-validated on the way in —
 * see `isStagedUploadUrl`.
 */
export const createStagedVideoTargets = async (
  admin: AdminClient,
  files: StagedFileDescriptor[],
) => createStagedTargets(admin, files, "VIDEO");

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

  const { targets, error: stagedError } = await createStagedTargets(admin, files, "IMAGE");
  if (stagedError) return { uploaded: 0, errors: [stagedError] };

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

/** Where `stagedUploadsCreate` parks bytes before Shopify ingests them. */
const STAGED_UPLOAD_HOSTS = ["storage.googleapis.com", "shopify-staged-uploads.s3.amazonaws.com"];

/** The two external video hosts Shopify's `EXTERNAL_VIDEO` media supports. */
const EMBEDDABLE_VIDEO_HOSTS = ["youtube.com", "youtu.be", "vimeo.com"];

/** Shared by all three guards below: HTTPS, parseable, and on the allowlist. */
const hasAllowedHost = (value: string, hosts: string[]) => {
  let host: string;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return false;
    host = parsed.hostname.toLowerCase();
  } catch {
    return false;
  }

  return hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
};

/**
 * The attach action takes image URLs from the client, and `originalSource` makes
 * Shopify fetch whatever URL it is handed. Restricting it to Shopify's own CDN keeps
 * a tampered request from turning the app into a fetch-arbitrary-URL primitive.
 */
export const isShopifyCdnUrl = (value: string) => hasAllowedHost(value, SHOPIFY_CDN_HOSTS);

/**
 * Same concern as `isShopifyCdnUrl`, for the video flow: the browser uploads the bytes
 * and then hands the `resourceUrl` back, so the client controls what this server passes
 * to `originalSource`.
 *
 * A stricter design would persist every target this app mints and check membership, but
 * that needs a table and a sweeper to expire them. The host allowlist bounds the damage
 * to "ingest some other object out of Shopify's own staging bucket", which is not a
 * fetch-arbitrary-URL primitive — and Shopify's signed-URL policy is what actually
 * governs who can put bytes there in the first place.
 */
export const isStagedUploadUrl = (value: string) =>
  hasAllowedHost(value, STAGED_UPLOAD_HOSTS);

/**
 * Vets the URL a merchant pastes for an external video. Shopify only accepts YouTube and
 * Vimeo for `EXTERNAL_VIDEO`, so anything else is rejected here with a message the
 * merchant can act on rather than surfacing as an opaque `userErrors` entry.
 */
export const isEmbeddableVideoUrl = (value: string) =>
  hasAllowedHost(value, EMBEDDABLE_VIDEO_HOSTS);

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
