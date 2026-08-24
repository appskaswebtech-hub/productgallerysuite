import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Form,
  isRouteErrorResponse,
  redirect,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
  useParams,
  useRevalidator,
  useRouteError,
  useSubmit,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getCachedBillingPlan, limitProductsForPlan } from "../billing.server";
import {
  MAX_CAPTION_LENGTH,
  // From the pure module, not `media.server` — these are read in the browser to screen
  // files before upload, and a server import here would pull in the Admin API client.
  MAX_VIDEO_BYTES,
  MAX_VIDEO_DURATION_SECONDS,
  VIDEO_MIME_TYPES,
  isPlayableMedia,
  isVideoMedia,
  normalizeShopifyId,
  type SliderImage,
  type SliderProduct,
} from "../products";
import { getSavedProducts, hydrateProduct, saveProducts } from "../products.server";
import {
  MAX_IMAGES_PER_UPLOAD,
  MAX_VIDEOS_PER_UPLOAD,
  attachMediaToProduct,
  isEmbeddableVideoUrl,
  isShopifyCdnUrl,
  isStagedUploadUrl,
  partitionUploadableFiles,
  removeProductMedia,
  uploadProductImages,
  type PickerImage,
} from "../media.server";
import type { loader as libraryLoader } from "./app.image-library";
import type { StageVideosResult, StagedVideoSlot } from "./app.video-upload";
import {
  resolveSliderOptions,
  sliderOptionsFromFormData,
  sliderOptionsFromRow,
  type SliderOptions,
} from "../slider-options";
import {
  SliderOptionsFields,
  SliderOptionsInputs,
} from "../components/SliderOptionsFields";
import { SliderPreview } from "../components/SliderPreview";
import { useLanguage } from "../i18n/LanguageContext";
import { resolveLocale } from "../settings.server";
import { translate } from "../i18n/translations";
import type { TranslationKey } from "../i18n/translations";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const productId = normalizeShopifyId(params.productId);
  const { setting, products } = await getSavedProducts(session.shop);
  const plan = await getCachedBillingPlan(session.shop);
  const savedProduct = limitProductsForPlan(products, plan).find(
    (product) => normalizeShopifyId(product.id) === productId,
  );

  if (!savedProduct) {
    throw new Response("Product not found", { status: 404 });
  }

  const shopDefaults = sliderOptionsFromRow(setting);
  // A draft is what the merchant was last working on, so that is what the editor should
  // open with — the published `overrides` keep serving the storefront meanwhile.
  const draft = savedProduct.draft ?? null;
  const effectiveOverrides = draft ? draft.overrides : savedProduct.overrides ?? null;

  const hydrated = await hydrateProduct(admin, savedProduct);
  const allMedia = hydrated.images ?? [];

  /**
   * Media Shopify has not finished with is split off rather than shown.
   *
   * A tile for a not-ready video is a trap: its × calls `fileUpdate`, and Shopify refuses to
   * touch a file that is not READY ("Non-ready files cannot be updated"), so a failed upload
   * became permanent furniture offering an action that could never succeed. The upload flow
   * still needs this information — it drives the processing banner, the poll and the failure
   * toast — it just does not belong in the gallery.
   *
   * A sibling of `product`, deliberately not a field on it: `SliderProduct` is persisted and
   * rebuilt field-by-field by `normalizeProduct`, so this per-request upload state would
   * either be dropped on save or saved stale.
   */
  const isReady = (media: SliderImage) =>
    !isVideoMedia(media) || (media.status ?? "ready") === "ready";

  return {
    product: { ...hydrated, images: allMedia.filter(isReady) },
    pendingMedia: allMedia.filter((media) => !isReady(media)),
    shopDefaults,
    options: resolveSliderOptions(shopDefaults, { overrides: effectiveOverrides }),
    usesShopDefaults: !effectiveOverrides,
    hasDraft: Boolean(draft),
  };
};

const parseVariantImageMap = (raw: string | undefined) => {
  try {
    const parsed = JSON.parse(raw ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed).map(([variantId, imageIds]) => [
        normalizeShopifyId(variantId),
        Array.isArray(imageIds) ? imageIds.map(normalizeShopifyId) : [],
      ]),
    ) as Record<string, string[]>;
  } catch {
    return {} as Record<string, string[]>;
  }
};

/**
 * Image id → caption. `normalizeProduct` re-checks these against the product's current
 * images and caps their length; this only has to survive the round trip through the form.
 */
const parseImageCaptions = (raw: string | undefined) => {
  try {
    const parsed = JSON.parse(raw ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed).flatMap(([imageId, caption]) =>
        typeof caption === "string" && caption.trim()
          ? [[normalizeShopifyId(imageId), caption.trim()]]
          : [],
      ),
    ) as Record<string, string>;
  } catch {
    return {} as Record<string, string>;
  }
};

/**
 * Media ids in display order. `normalizeProduct` drops ids that no longer match an image
 * and de-duplicates, so this only has to survive the round trip through the form.
 *
 * An empty array is meaningful: it means "no custom order", which puts the gallery back on
 * Shopify's own ordering.
 */
const parseMediaOrder = (raw: string | undefined) => {
  try {
    const parsed = JSON.parse(raw ?? "[]");
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((id): id is string | number => typeof id === "string" || typeof id === "number")
      .map(normalizeShopifyId)
      .filter(Boolean);
  } catch {
    return [];
  }
};

type ActionResult = {
  ok: boolean;
  message: string;
  /** Set when Shopify is still processing newly uploaded media. */
  processing?: boolean;
};

/**
 * Backoff for the "is it ready yet" poll, in milliseconds — about two minutes in total.
 * An image is usually ready on the first tick; a video may need most of the sequence.
 */
const PROCESSING_POLL_DELAYS = [4000, 6000, 10000, 15000, 20000, 30000, 40000];

/** Reads the picker's selection, discarding anything that is not a usable {url, alt} pair. */
const parsePickedImages = (raw: string | undefined) => {
  try {
    const parsed = JSON.parse(raw ?? "[]");
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap((entry) => {
      const url = typeof entry?.url === "string" ? entry.url : "";
      if (!url) return [];
      return [{ originalSource: url, alt: typeof entry?.alt === "string" ? entry.alt : "" }];
    });
  } catch {
    return [];
  }
};

export const action = async ({
  request,
  params,
}: ActionFunctionArgs): Promise<ActionResult> => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await resolveLocale(request, session.shop);
  const productId = normalizeShopifyId(params.productId);
  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

  const { products } = await getSavedProducts(session.shop);
  const plan = await getCachedBillingPlan(session.shop);
  const allowedProduct = limitProductsForPlan(products, plan).find(
    (product) => normalizeShopifyId(product.id) === productId,
  );
  if (!allowedProduct) {
    return { ok: false, message: translate(locale, "mapping.toastUpgrade") };
  }

  const patch = (apply: (product: SliderProduct) => SliderProduct) =>
    products.map((product) =>
      normalizeShopifyId(product.id) === productId ? apply(product) : product,
    );

  if (intent === "attach-images") {
    const picked = parsePickedImages(formData.get("images")?.toString());

    const attachFailed = (reason: string) => ({
      ok: false,
      message: translate(locale, "mapping.toastUploadFailed", { reason }),
    });

    if (!picked.length) {
      return { ok: false, message: translate(locale, "mapping.toastUploadNoFiles") };
    }
    if (picked.length > MAX_IMAGES_PER_UPLOAD) {
      return { ok: false, message: translate(locale, "mapping.uploadTooMany") };
    }

    // The client supplies these URLs, and `originalSource` makes Shopify fetch them.
    const sources = picked.filter((image) => isShopifyCdnUrl(image.originalSource));
    const rejected =
      sources.length === picked.length ? [] : [translate(locale, "mapping.pickerBadUrl")];

    if (!sources.length) return attachFailed(rejected.join(" "));

    const { uploaded, errors } = await attachMediaToProduct(
      admin,
      allowedProduct.id,
      sources,
    );
    const failures = [...rejected, ...errors];

    if (!uploaded) return attachFailed(failures.join(" ") || "unknown error");

    return {
      ok: true,
      message: [
        translate(locale, "mapping.toastAttached", { count: uploaded }),
        translate(locale, "mapping.toastUploadProcessing"),
        ...failures,
      ].join(" "),
      processing: true,
    };
  }

  if (intent === "delete-media") {
    const mediaId = formData.get("mediaId")?.toString().trim() ?? "";

    if (!mediaId) {
      return { ok: false, message: translate(locale, "mapping.toastMediaDeleteFailed", { reason: "" }) };
    }

    // No ownership check beyond the product id: `referencesToRemove` only detaches this
    // media from *this* product, so a tampered id is rejected by Shopify rather than
    // reaching another shop's media.
    const { ok, error } = await removeProductMedia(admin, allowedProduct.id, mediaId);

    if (!ok) {
      return {
        ok: false,
        message: translate(locale, "mapping.toastMediaDeleteFailed", {
          reason: error ?? "unknown error",
        }),
      };
    }

    // Stale `mediaOrder`, `imageCaptions` and `variantImageMap` keys need no cleanup here:
    // `normalizeProduct` drops any key with no matching gallery entry on the next hydrate.
    return { ok: true, message: translate(locale, "mapping.toastMediaDeleted") };
  }

  if (intent === "attach-videos") {
    const picked = parsePickedImages(formData.get("videos")?.toString());

    const attachFailed = (reason: string) => ({
      ok: false,
      message: translate(locale, "mapping.toastUploadFailed", { reason }),
    });

    if (!picked.length) {
      return { ok: false, message: translate(locale, "mapping.toastUploadNoFiles") };
    }
    if (picked.length > MAX_VIDEOS_PER_UPLOAD) {
      return { ok: false, message: translate(locale, "mapping.videoTooMany") };
    }

    // The browser uploaded these itself and is handing back where it put them, so the
    // URLs are client-controlled in exactly the way `attach-images` guards against.
    const sources = picked.filter((video) => isStagedUploadUrl(video.originalSource));
    const rejected =
      sources.length === picked.length ? [] : [translate(locale, "mapping.videoBadUrl")];

    if (!sources.length) return attachFailed(rejected.join(" "));

    const { uploaded, errors } = await attachMediaToProduct(
      admin,
      allowedProduct.id,
      sources,
      "VIDEO",
    );
    const failures = [...rejected, ...errors];

    if (!uploaded) return attachFailed(failures.join(" ") || "unknown error");

    return {
      ok: true,
      message: [
        translate(locale, "mapping.toastVideosAttached", { count: uploaded }),
        translate(locale, "mapping.videoProcessing"),
        ...failures,
      ].join(" "),
      processing: true,
    };
  }

  if (intent === "attach-external-video") {
    const videoUrl = formData.get("videoUrl")?.toString().trim() ?? "";

    if (!isEmbeddableVideoUrl(videoUrl)) {
      return { ok: false, message: translate(locale, "mapping.externalVideoInvalid") };
    }

    const { uploaded, errors } = await attachMediaToProduct(
      admin,
      allowedProduct.id,
      [{ originalSource: videoUrl, alt: "" }],
      "EXTERNAL_VIDEO",
    );

    if (!uploaded) {
      return {
        ok: false,
        message: translate(locale, "mapping.toastUploadFailed", {
          reason: errors.join(" ") || "unknown error",
        }),
      };
    }

    return {
      ok: true,
      message: [
        translate(locale, "mapping.toastVideosAttached", { count: uploaded }),
        translate(locale, "mapping.videoProcessing"),
      ].join(" "),
      processing: true,
    };
  }

  if (intent === "upload-images") {
    // Empty file inputs still submit an entry, so zero-byte files are dropped here.
    const files = formData
      .getAll("images")
      .filter((entry): entry is File => entry instanceof File && entry.size > 0);

    if (!files.length) {
      return { ok: false, message: translate(locale, "mapping.toastUploadNoFiles") };
    }
    if (files.length > MAX_IMAGES_PER_UPLOAD) {
      return { ok: false, message: translate(locale, "mapping.uploadTooMany") };
    }

    const { accepted, rejected } = partitionUploadableFiles(
      files,
      (reason, filename) =>
        translate(
          locale,
          reason === "size" ? "mapping.uploadTooLarge" : "mapping.uploadBadType",
          { filename },
        ),
    );

    const uploadFailed = (reason: string) => ({
      ok: false,
      message: translate(locale, "mapping.toastUploadFailed", { reason }),
    });

    if (!accepted.length) return uploadFailed(rejected.join(" "));

    const { uploaded, errors } = await uploadProductImages(
      admin,
      // Product ids are kept as full GIDs; only image and variant ids are normalized.
      allowedProduct.id,
      accepted,
    );
    const failures = [...rejected, ...errors];

    if (!uploaded) return uploadFailed(failures.join(" ") || "unknown error");

    return {
      ok: true,
      message: [
        translate(locale, "mapping.toastUploaded", { count: uploaded }),
        translate(locale, "mapping.toastUploadProcessing"),
        ...failures,
      ].join(" "),
      processing: true,
    };
  }

  if (intent === "options-discard") {
    await saveProducts(
      session.shop,
      patch((product) => ({ ...product, draft: null })),
    );

    return { ok: true, message: translate(locale, "products.toastDraftDiscarded") };
  }

  if (intent === "options" || intent === "options-draft") {
    // Ticking "use shop defaults" drops the key entirely, so the product tracks
    // the shop values again rather than freezing today's copy of them.
    const useShopDefaults = formData.get("useShopDefaults") === "on";
    const overrides = useShopDefaults ? null : sliderOptionsFromFormData(formData);

    if (intent === "options-draft") {
      await saveProducts(
        session.shop,
        patch((product) => ({ ...product, draft: { overrides } })),
      );

      // Thrown rather than returned: this action is typed `Promise<ActionResult>`, and
      // returning a Response would widen that signature until `actionData?.message`
      // stopped type-checking. The redirect carries a token, not text, so the toast on
      // the other side stays translated.
      throw redirect("/app/products?toast=draft-saved");
    }

    // Publishing clears the draft as well as writing the live values — leaving it behind
    // would keep the editor claiming unpublished changes forever after a successful save.
    await saveProducts(
      session.shop,
      patch((product) => ({ ...product, overrides, draft: null })),
    );

    return { ok: true, message: translate(locale, "products.toastOptionsSaved") };
  }

  const nextMap = parseVariantImageMap(formData.get("variantImageMap")?.toString());
  const nextCaptions = parseImageCaptions(formData.get("imageCaptions")?.toString());
  const nextOrder = parseMediaOrder(formData.get("mediaOrder")?.toString());
  await saveProducts(
    session.shop,
    patch((product) => ({
      ...product,
      variantImageMap: nextMap,
      imageCaptions: nextCaptions,
      mediaOrder: nextOrder,
    })),
  );

  return { ok: true, message: translate(locale, "mapping.toastSaved") };
};

/**
 * Uploads new images onto the product in Shopify. Rendered both beside the images
 * heading and inside the empty state, so a product with no images is not a dead end.
 */
function UploadImagesForm({ busy }: { busy: boolean }) {
  const { t } = useLanguage();

  return (
    <Form method="post" encType="multipart/form-data">
      <input type="hidden" name="intent" value="upload-images" />
      <s-stack direction="block" gap="small">
        <input
          type="file"
          name="images"
          multiple
          accept="image/*"
          disabled={busy}
          aria-label={t("mapping.addImages")}
        />
        <s-button type="submit" variant="secondary" loading={busy || undefined}>
          {t("mapping.addImages")}
        </s-button>
        <s-text>{t("mapping.addImagesHelp")}</s-text>
      </s-stack>
    </Form>
  );
}

/**
 * Reads a video's duration in the browser, without uploading a byte.
 *
 * Resolves `null` whenever the answer cannot be trusted — unreadable metadata, a container
 * this browser cannot parse, or a load that never completes. **Callers must treat `null` as
 * "allow"**: this check exists to save a merchant a ten-minute upload that was always going
 * to fail, not to become a second gate stricter than Shopify's own.
 */
const readVideoDuration = (file: File): Promise<number | null> =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;

    // Every exit revokes the URL — without this, picking files repeatedly holds a full copy
    // of each video in memory until the page is reloaded.
    const finish = (duration: number | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(duration);
    };

    // A file that never fires `loadedmetadata` would otherwise hang the picker silently.
    const timer = window.setTimeout(() => finish(null), 5000);

    video.preload = "metadata";
    video.onloadedmetadata = () =>
      finish(Number.isFinite(video.duration) ? video.duration : null);
    video.onerror = () => finish(null);
    video.src = url;
  });

/** Moves one item to a new index, returning a new array. Out-of-range moves are no-ops. */
const moveItem = <T,>(items: T[], from: number, to: number): T[] => {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return items;
  }

  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
};

/**
 * The grab bar a merchant drags to reorder a tile.
 *
 * A separate handle rather than a draggable tile: the tile is a `<label>` wrapping a
 * caption text field, and making the whole thing draggable would hijack text selection
 * inside that field.
 *
 * It also takes arrow keys. Native HTML5 drag events are unreachable by keyboard, and this
 * is the only way to reorder — so without this the feature would be pointer-only. Keeping
 * it on the handle means no extra controls appear in the grid.
 */
function DragHandle({
  position,
  total,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  position: number;
  total: number;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: (to: number) => void;
}) {
  const { t } = useLanguage();
  const index = position - 1;

  const onKeyDown = (event: ReactKeyboardEvent) => {
    const to =
      event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? index - 1
        : event.key === "ArrowRight" || event.key === "ArrowDown"
          ? index + 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? total - 1
              : null;

    if (to === null) return;
    // Claimed before the bounds check, so Home on the first tile still does not scroll
    // the page out from under a merchant who is part-way through reordering.
    event.preventDefault();
    onMove(to);
  };

  return (
    <span
      draggable
      role="button"
      tabIndex={0}
      aria-label={t("mapping.reorderHandle", { position, total })}
      onDragStart={(event) => {
        // Firefox refuses to start a drag unless some data is set, even though the drop
        // handler reads the dragged index from React state rather than the payload.
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(index));
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onKeyDown={onKeyDown}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        padding: "2px 0",
        borderRadius: 4,
        cursor: "grab",
        color: "#6d7175",
        background: "#f6f6f7",
        fontSize: 12,
        lineHeight: 1,
        userSelect: "none",
      }}
    >
      <span aria-hidden="true">⠿</span>
      <span aria-hidden="true">{position}</span>
    </span>
  );
}

/**
 * Says what a video entry is, and — more usefully — what state it is in.
 *
 * A transcoding video looks identical to a finished one at a glance, so without this a
 * merchant would read a poster-less placeholder as a broken image rather than as work in
 * progress. Images get no badge; there is nothing to say about them.
 */
/**
 * Marks a tile as video.
 *
 * No processing or failed states: the loader keeps not-ready media out of the gallery, so
 * anything with a tile is ready by definition. Upload progress and failures are reported by
 * the banner and toast instead, while the upload is happening.
 */
function MediaStatusBadge({ media }: { media: SliderImage }) {
  const { t } = useLanguage();
  if (!isVideoMedia(media)) return null;

  return <s-badge tone="info">{t("mapping.videoBadge")}</s-badge>;
}

/**
 * Turns Shopify's `MediaErrorCode` into a sentence saying what to do about it.
 *
 * Falls back to Shopify's own English text for anything unmapped — the `MODEL3D_*` and
 * `GENERIC_FILE_*` codes, which cannot reach a tile, and whatever Shopify adds next.
 * That fallback is why a missing translation degrades to something still useful rather
 * than to a raw key.
 */
/**
 * Turns Shopify's media error into something a merchant can act on.
 *
 * Prefers our own translated wording for the code, because Shopify's own message is English
 * only and phrased as a restatement of the failure rather than as what to do about it. Falls
 * back to their text for codes we have not covered, so a new one still says something.
 *
 * Returns a string rather than a node: this is read out in a toast now, not printed on a
 * tile — not-ready media no longer reaches the gallery at all.
 */
const mediaErrorMessage = (
  media: Pick<SliderImage, "errorCode" | "errorMessage">,
  t: (key: TranslationKey) => string,
) => {
  const key = media.errorCode ? (`mediaError.${media.errorCode}` as TranslationKey) : null;
  const translated = key ? t(key) : "";

  // `t` echoes the key back when there is no entry for it; that is the signal to fall back.
  return translated && translated !== key
    ? translated
    : media.errorMessage || t("mapping.mediaErrorUnknown");
};

/**
 * A gallery entry's still, with a play badge over it when the entry is a video.
 *
 * `media.url` is already the poster for video, so the `<img>` needs no special case —
 * the badge is the only thing that tells a merchant this row is not a photo.
 */
/**
 * The × that removes a tile's media from the product.
 *
 * Rendered as a **sibling** of the tile's `<label>`, never inside it. A `<label>` forwards
 * clicks to the control it wraps, so a delete button nested in one would also toggle that
 * tile's `Show` checkbox on its way out — silently changing the variant mapping. Keeping
 * it outside removes the problem rather than patching it with `stopPropagation`.
 */
function DeleteMediaButton({ onDelete }: { onDelete: () => void }) {
  const { t } = useLanguage();

  return (
    <button
      type="button"
      aria-label={t("mapping.deleteMedia")}
      onClick={onDelete}
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        zIndex: 2,
        width: 22,
        height: 22,
        display: "grid",
        placeItems: "center",
        padding: 0,
        borderRadius: "50%",
        border: "1px solid #d1d5db",
        background: "#ffffff",
        color: "#5c5f62",
        fontSize: 15,
        lineHeight: 1,
        cursor: "pointer",
      }}
    >
      <span aria-hidden="true">×</span>
    </button>
  );
}

function MediaThumb({ media }: { media: SliderImage }) {
  const { t } = useLanguage();

  return (
    <div style={{ position: "relative", lineHeight: 0 }}>
      {media.url ? (
        <img
          src={media.url}
          alt={media.alt ?? ""}
          width="120"
          height="120"
          style={{
            width: "100%",
            height: 120,
            objectFit: "cover",
            borderRadius: 6,
            background: "#f6f6f7",
          }}
        />
      ) : (
        /* Never an <img> with an empty src — several browsers re-request the current page
           for that and draw a broken-image glyph. A video Shopify has not made a poster
           for yet still needs a tile, so it gets a plain box to hold its place. */
        <div
          role="img"
          aria-label={t("mapping.mediaPending")}
          style={{
            width: "100%",
            height: 120,
            borderRadius: 6,
            background: "#f6f6f7",
            border: "1px dashed #c9cccf",
          }}
        />
      )}
      {isPlayableMedia(media) ? (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            fontSize: 26,
            color: "#ffffff",
            textShadow: "0 1px 6px rgba(0, 0, 0, 0.6)",
          }}
        >
          ▶
        </span>
      ) : null}
    </div>
  );
}

/**
 * POSTs one file to its staged target, reporting progress as a 0-1 fraction. Resolves to
 * an error string, or `null` on success.
 *
 * `XMLHttpRequest` rather than `fetch` for one reason: only XHR exposes upload progress.
 * A several-hundred-megabyte video with no feedback is indistinguishable from a hang, and
 * this is the one request in the app that can run for minutes.
 */
const uploadToStagedTarget = (
  slot: StagedVideoSlot,
  file: File,
  onProgress: (fraction: number) => void,
) =>
  new Promise<string | null>((resolve) => {
    const body = new FormData();
    // Parameters ahead of the file field — the storage backend requires that ordering,
    // the same way the server-side image path in `uploadProductImages` does.
    for (const parameter of slot.target.parameters) {
      body.append(parameter.name, parameter.value);
    }
    body.append("file", file, file.name);

    const request = new XMLHttpRequest();
    request.open("POST", slot.target.url ?? "");
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });
    request.addEventListener("load", () =>
      resolve(
        request.status >= 200 && request.status < 300
          ? null
          : `${file.name} (${request.status})`,
      ),
    );
    // Cross-origin failures surface as `error` with status 0 and no detail, so the
    // filename is all there is to report.
    request.addEventListener("error", () => resolve(file.name));
    request.addEventListener("abort", () => resolve(file.name));
    request.send(body);
  });

/**
 * Uploads videos straight from the browser to Shopify's storage backend.
 *
 * Three steps, sequential on purpose so the progress bar means something:
 *   1. `/app/video-upload` mints one signed target per file.
 *   2. Each file is POSTed to its own target — these bytes never touch the app server.
 *   3. The `attach-videos` intent hands the resulting `resourceUrl`s to `productUpdate`.
 *
 * Step 3 goes through `useSubmit` rather than a fetcher so its result lands in the
 * route's `useActionData`, which is what the toast and the processing poll are wired to —
 * the same reason the library picker submits that way.
 */
function UploadVideoForm({ busy }: { busy: boolean }) {
  const { t } = useLanguage();
  const submit = useSubmit();
  const params = useParams();
  const shopify = useAppBridge();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<number | null>(null);

  const finish = (message?: string) => {
    setProgress(null);
    setFiles([]);
    if (inputRef.current) inputRef.current.value = "";
    if (message) shopify.toast.show(message);
  };

  /**
   * Rejects what Shopify would reject, before a byte is uploaded.
   *
   * Both limits are Shopify's and neither can be raised, so an over-limit file is a
   * guaranteed failure — but today it is one the merchant discovers only after the upload
   * *and* the transcode, minutes later. Both answers are knowable here in milliseconds.
   *
   * The server still validates: this is a shortcut, not the gate.
   */
  const screenFiles = async (picked: File[]) => {
    const accepted: File[] = [];
    const rejected: string[] = [];

    for (const file of picked) {
      // Reuses the size message the server-side check already had, rather than a second
      // near-identical string saying the same thing.
      if (file.size > MAX_VIDEO_BYTES) {
        rejected.push(t("mapping.videoTooLarge", { filename: file.name }));
        continue;
      }

      // `null` means the duration could not be read — allow it through rather than block a
      // file Shopify may well accept. See `readVideoDuration`.
      const duration = await readVideoDuration(file);
      if (duration !== null && duration > MAX_VIDEO_DURATION_SECONDS) {
        rejected.push(t("mapping.videoTooLong", { filename: file.name }));
        continue;
      }

      accepted.push(file);
    }

    setFiles(accepted);
    // Clearing the input keeps its filename list from claiming rejected files are queued.
    if (!accepted.length && inputRef.current) inputRef.current.value = "";
    if (rejected.length) shopify.toast.show(rejected.join(" "), { isError: true });
  };

  const startUpload = async () => {
    if (!files.length) return;
    setProgress(0);

    let staged: StageVideosResult;
    try {
      // A plain `fetch`, not a fetcher: the flow below is a sequence of awaits, and App
      // Bridge patches same-origin fetch with the session token either way.
      const response = await fetch("/app/video-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: files.map((file) => ({
            name: file.name,
            type: file.type,
            size: file.size,
          })),
        }),
      });
      staged = (await response.json()) as StageVideosResult;
    } catch {
      finish(t("mapping.toastUploadFailed", { reason: t("mapping.videoNoTarget") }));
      return;
    }

    if (!staged.ok) {
      finish(staged.message);
      return;
    }

    const attached: Array<{ url: string; alt: string }> = [];
    const failures = [...staged.rejected];

    for (const [position, slot] of staged.slots.entries()) {
      // `slot.index` points back into this exact array — see `StagedVideoSlot`.
      const file = files[slot.index];
      if (!file) continue;

      const error = await uploadToStagedTarget(slot, file, (fraction) =>
        setProgress((position + fraction) / staged.slots.length),
      );

      if (error) {
        failures.push(error);
      } else {
        attached.push({
          url: slot.target.resourceUrl ?? "",
          // Matches the image path: the filename keeps alt text non-empty.
          alt: file.name.replace(/\.[^.]+$/, ""),
        });
      }
    }

    if (!attached.length) {
      finish(t("mapping.toastUploadFailed", { reason: failures.join(" ") }));
      return;
    }

    const body = new FormData();
    body.set("intent", "attach-videos");
    body.set("videos", JSON.stringify(attached));
    submit(body, { method: "post", action: `/app/products/${params.productId}` });
    finish(failures.length ? failures.join(" ") : undefined);
  };

  const uploading = progress !== null;

  return (
    <s-stack direction="block" gap="small">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={VIDEO_MIME_TYPES.join(",")}
        disabled={busy || uploading}
        aria-label={t("mapping.addVideos")}
        onChange={(event) => void screenFiles(Array.from(event.currentTarget.files ?? []))}
      />
      <s-button
        variant="secondary"
        disabled={!files.length || busy || uploading || undefined}
        loading={uploading || undefined}
        onClick={startUpload}
      >
        {t("mapping.addVideos")}
      </s-button>
      {uploading ? (
        <s-text>
          {t("mapping.videoUploadProgress", { percent: Math.round(progress * 100) })}
        </s-text>
      ) : null}
      <s-text>{t("mapping.addVideosHelp")}</s-text>
    </s-stack>
  );
}

/** Attaches a YouTube or Vimeo video by URL. No upload, no storage — Shopify embeds it. */
function ExternalVideoForm({ busy }: { busy: boolean }) {
  const { t } = useLanguage();
  const submit = useSubmit();
  const params = useParams();
  const [videoUrl, setVideoUrl] = useState("");

  const attach = () => {
    if (!videoUrl.trim()) return;

    const body = new FormData();
    body.set("intent", "attach-external-video");
    body.set("videoUrl", videoUrl.trim());
    submit(body, { method: "post", action: `/app/products/${params.productId}` });
    setVideoUrl("");
  };

  return (
    <s-stack direction="block" gap="small">
      <s-text-field
        label={t("mapping.externalVideoLabel")}
        details={t("mapping.externalVideoHelp")}
        value={videoUrl}
        disabled={busy || undefined}
        onInput={(event) => setVideoUrl(event.currentTarget.value)}
      />
      <s-button
        variant="secondary"
        disabled={!videoUrl.trim() || busy || undefined}
        onClick={attach}
      >
        {t("mapping.addExternalVideo")}
      </s-button>
    </s-stack>
  );
}

const PICKER_MODAL_ID = "gn-image-library";
const DELETE_MODAL_ID = "gn-confirm-media-deletion";

/**
 * Browses images that already live in Shopify — the Files library, or images on the
 * store's other products — and attaches the chosen ones to this product.
 *
 * Data is fetched on demand from the `app.image-library` resource route rather than
 * the page loader, so opening the modal is what costs the Admin API calls.
 */
function ImageLibraryPicker() {
  const { t } = useLanguage();
  const library = useFetcher<typeof libraryLoader>();
  const submit = useSubmit();
  const params = useParams();
  const [source, setSource] = useState<"files" | "products">("files");
  const [search, setSearch] = useState("");
  const [images, setImages] = useState<PickerImage[]>([]);
  const [selected, setSelected] = useState<PickerImage[]>([]);
  // Whether the in-flight request is a "load more" (append) or a fresh list (replace).
  const appending = useRef(false);

  const load = (
    nextSource: "files" | "products",
    nextSearch: string,
    cursor?: string | null,
  ) => {
    const query = new URLSearchParams({ source: nextSource });
    if (nextSearch.trim()) query.set("search", nextSearch.trim());
    if (cursor) query.set("cursor", cursor);
    appending.current = Boolean(cursor);
    library.load(`/app/image-library?${query.toString()}`);
  };

  useEffect(() => {
    if (!library.data) return;
    const page = library.data;
    setImages((current) => (appending.current ? [...current, ...page.images] : page.images));
  }, [library.data]);

  const switchSource = (next: "files" | "products") => {
    if (next === source) return;
    setSource(next);
    setImages([]);
    load(next, search);
  };

  const toggle = (image: PickerImage) =>
    setSelected((current) =>
      current.some((entry) => entry.id === image.id)
        ? current.filter((entry) => entry.id !== image.id)
        : [...current, image],
    );

  const reset = () => {
    setSelected([]);
    setImages([]);
    setSearch("");
    setSource("files");
  };

  /**
   * Submitted through `useSubmit` rather than a fetcher so the result lands in the
   * route's `useActionData` — that is what the existing toast and the "still
   * processing" revalidate are wired to.
   */
  const addSelected = () => {
    if (!selected.length) return;

    const body = new FormData();
    body.set("intent", "attach-images");
    body.set("images", JSON.stringify(selected));
    submit(body, { method: "post", action: `/app/products/${params.productId}` });
  };

  const loading = library.state !== "idle";

  return (
    <s-modal
      id={PICKER_MODAL_ID}
      heading={t("mapping.pickerHeading")}
      onShow={() => load(source, search)}
      onHide={reset}
    >
      <s-stack direction="block" gap="base">
        <s-stack direction="inline" gap="small">
          <s-button
            variant={source === "files" ? "primary" : "secondary"}
            onClick={() => switchSource("files")}
          >
            {t("mapping.pickerFiles")}
          </s-button>
          <s-button
            variant={source === "products" ? "primary" : "secondary"}
            onClick={() => switchSource("products")}
          >
            {t("mapping.pickerProducts")}
          </s-button>
        </s-stack>

        <s-text-field
          label={t("mapping.pickerSearch")}
          value={search}
          onInput={(event) => setSearch(event.currentTarget.value)}
          onChange={(event) => {
            setImages([]);
            load(source, event.currentTarget.value);
          }}
        />

        <s-paragraph>{t("mapping.pickerCopyNote")}</s-paragraph>

        {selected.length ? (
          <s-text>{t("mapping.pickerSelected", { count: selected.length })}</s-text>
        ) : null}

        {library.data?.error ? (
          <s-banner tone="critical">{library.data.error}</s-banner>
        ) : null}

        {images.length ? (
          // Only the grid scrolls, so the tabs and search stay reachable above it.
          <div
            style={{
              maxHeight: 360,
              overflowY: "auto",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
              gap: 12,
            }}
          >
            {images.map((image) => {
              const isSelected = selected.some((entry) => entry.id === image.id);

              return (
                // The control is the nested s-checkbox; jsx-a11y cannot see inside a
                // custom element, so it reads this label as having none.
                // eslint-disable-next-line jsx-a11y/label-has-associated-control
                <label
                  key={image.id}
                  style={{
                    border: isSelected ? "2px solid #202223" : "1px solid #d1d5db",
                    borderRadius: 8,
                    padding: 8,
                    cursor: "pointer",
                    display: "grid",
                    gap: 8,
                  }}
                >
                  <img
                    src={image.url}
                    alt={image.alt}
                    width="120"
                    height="120"
                    style={{
                      width: "100%",
                      height: 120,
                      objectFit: "cover",
                      borderRadius: 6,
                      background: "#f6f6f7",
                    }}
                  />
                  <s-checkbox
                    label={image.source || t("mapping.show")}
                    checked={isSelected}
                    onChange={() => toggle(image)}
                  />
                </label>
              );
            })}
          </div>
        ) : (
          <s-paragraph>{loading ? "" : t("mapping.pickerEmpty")}</s-paragraph>
        )}

        {library.data?.nextCursor ? (
          <s-button
            variant="secondary"
            loading={loading || undefined}
            onClick={() => load(source, search, library.data?.nextCursor)}
          >
            {t("mapping.pickerLoadMore")}
          </s-button>
        ) : null}
      </s-stack>

      {/*
        The action slots take a bare `s-button` and nothing else — wrapping this in a
        <Form> to get a normal submit made s-modal drop the child, so the button never
        rendered at all. The submit therefore happens in JS, as the removal modal on
        the products page does. Variants are load-bearing too: primary-action accepts
        only `primary`, secondary-actions only `secondary`/`auto`.
      */}
      <s-button
        slot="primary-action"
        variant="primary"
        disabled={!selected.length || undefined}
        command="--hide"
        commandFor={PICKER_MODAL_ID}
        onClick={addSelected}
      >
        {t("mapping.pickerAdd")}
      </s-button>
      <s-button
        slot="secondary-actions"
        variant="secondary"
        command="--hide"
        commandFor={PICKER_MODAL_ID}
      >
        {t("common.cancel")}
      </s-button>
    </s-modal>
  );
}

/** Every way to add media, kept together so both render sites stay in sync. */
function AddImagesControls({ busy }: { busy: boolean }) {
  const { t } = useLanguage();

  return (
    <s-stack direction="block" gap="base">
      <UploadImagesForm busy={busy} />
      <s-button
        variant="secondary"
        disabled={busy || undefined}
        command="--show"
        commandFor={PICKER_MODAL_ID}
      >
        {t("mapping.addFromShopify")}
      </s-button>
      <UploadVideoForm busy={busy} />
      <ExternalVideoForm busy={busy} />
    </s-stack>
  );
}

export default function ProductMapping() {
  const { product, pendingMedia, options, usesShopDefaults, hasDraft } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const params = useParams();
  const shopify = useAppBridge();
  const submit = useSubmit();
  const { t } = useLanguage();
  const [activeVariantId, setActiveVariantId] = useState(
    product.variants?.[0]?.id ?? "",
  );
  const [variantImageMap, setVariantImageMap] = useState(product.variantImageMap ?? {});
  const [imageCaptions, setImageCaptions] = useState<Record<string, string>>(
    product.imageCaptions ?? {},
  );
  const [useShopDefaults, setUseShopDefaults] = useState(usesShopDefaults);
  const [productOptions, setProductOptions] = useState<SliderOptions>(options);
  /**
   * Media ids in display order. Seeded from `product.images`, which the loader has already
   * sorted by any saved `mediaOrder`, so this starts out matching what is on screen.
   */
  const [order, setOrder] = useState<string[]>(() =>
    (product.images ?? []).map((image) => image.id),
  );
  /**
   * Whether the merchant has actually moved something this session.
   *
   * Without it, the first Save mapping on any product would persist its current order and
   * silently pin the gallery — a product that had simply been following Shopify's order
   * would stop tracking it, with nothing in the UI to say why.
   */
  const [orderTouched, setOrderTouched] = useState(false);
  /** Index being dragged, and the tile it is currently over. */
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  /** The entry the × was clicked on, held while the confirmation dialog is open. */
  const [pendingDeletion, setPendingDeletion] = useState<SliderImage | null>(null);
  const activeVariant =
    product.variants?.find((variant) => variant.id === activeVariantId) ??
    product.variants?.[0] ??
    null;
  const activeMappedImageIds = new Set(
    activeVariant ? variantImageMap[activeVariant.id] ?? [] : [],
  );
  /**
   * Both flags key off `formData` rather than `navigation.state`, because it is set for
   * the *whole* life of a write navigation — including the "loading" phase after an
   * action redirects, while the destination's loaders run. Gating on
   * `state === "submitting"` switched the spinner off at the start of that phase, which
   * for Save as draft is the longest part of the wait: a round trip plus the Admin API
   * call inside `hydrateProducts`.
   *
   * It must not become `state !== "idle"` either — that is true of ordinary GET
   * navigations, so every link click would put the page into a saving state. `formData`
   * is undefined when idle and on plain GETs.
   */
  const isSaving = navigation.formData != null;
  // Per-intent, so saving the variant mapping does not spin the title bar's buttons and
  // the three option actions do not spin each other.
  const submittingIntent = navigation.formData?.get("intent")?.toString();
  // The options form lives mid-page while its button sits in the title bar, so the
  // button submits this element rather than being a `type="submit"` inside it —
  // `s-button` has no `form` attribute to re-associate the two.
  const optionsFormRef = useRef<HTMLFormElement>(null);

  /**
   * One form, three intents. `new FormData(form)` reuses the inputs `SliderOptionsInputs`
   * already renders, so the draft and publish paths cannot drift apart the way a second
   * hand-built copy of ~20 hidden fields would.
   */
  const submitOptions = (intent: string) => {
    const form = optionsFormRef.current;
    if (!form) return;

    const formData = new FormData(form);
    formData.set("intent", intent);
    submit(formData, { method: "post", action: `/app/products/${params.productId}` });
  };

  /**
   * The gallery as the merchant currently has it arranged.
   *
   * Rebuilt from `order` rather than held as its own array of images, so a revalidation —
   * the video processing poll runs several — refreshes each entry's data without
   * discarding an in-progress reorder. Media missing from `order` is appended, which is
   * what puts a just-uploaded image at the end.
   */
  const orderedImages = useMemo(() => {
    const images = product.images ?? [];
    const byId = new Map(images.map((image) => [image.id, image]));
    const ranked = order.flatMap((id) => {
      const image = byId.get(id);
      return image ? [image] : [];
    });
    const rankedIds = new Set(ranked.map((image) => image.id));

    return [...ranked, ...images.filter((image) => !rankedIds.has(image.id))];
  }, [product.images, order]);

  // Mirrors `mediaForVariant` on the storefront: a variant's mapped images if it has
  // any, otherwise the whole set. Most variants start unmapped, so the fallback is the
  // common case and getting it wrong would make the preview misleading.
  const mappedPreviewImages = orderedImages.filter((image) =>
    activeMappedImageIds.has(image.id),
  );
  const previewImages = mappedPreviewImages.length ? mappedPreviewImages : orderedImages;

  /**
   * Opens the confirmation dialog for one tile.
   *
   * The × is a plain `<button>`, so it cannot use the `command="--show"` attribute the
   * other modals on this page are opened with — that is an `s-button` feature. Reaching
   * for the element and calling `showOverlay()` is the documented imperative equivalent.
   */
  const requestDeletion = (media: SliderImage) => {
    setPendingDeletion(media);
    const modal = document.getElementById(DELETE_MODAL_ID) as
      | (HTMLElement & { showOverlay?: () => void })
      | null;
    modal?.showOverlay?.();
  };

  const confirmDeletion = () => {
    if (!pendingDeletion?.mediaId) return;

    const body = new FormData();
    body.set("intent", "delete-media");
    body.set("mediaId", pendingDeletion.mediaId);
    submit(body, { method: "post", action: `/app/products/${params.productId}` });
    setPendingDeletion(null);
  };

  /** Single entry point for both the drop handler and the handle's arrow keys. */
  const moveMedia = (from: number, to: number) => {
    const next = moveItem(
      orderedImages.map((image) => image.id),
      from,
      Math.min(Math.max(to, 0), orderedImages.length - 1),
    );
    setOrder(next);
    setOrderTouched(true);
  };

  useEffect(() => {
    setActiveVariantId(product.variants?.[0]?.id ?? "");
    setVariantImageMap(product.variantImageMap ?? {});
    setImageCaptions(product.imageCaptions ?? {});
  }, [product]);

  /**
   * Keyed on the product **id**, not the product object, unlike the reset above.
   *
   * `product` gets a new identity on every revalidation, and the video processing poll
   * fires several of them — re-seeding the order there would throw away a merchant's drag
   * partway through an upload. Nothing needs it to: `orderedImages` already appends media
   * the order does not mention and skips ids whose media has gone, so additions and
   * deletions resolve without touching this state. Only moving to a different product
   * genuinely invalidates the arrangement.
   */
  useEffect(() => {
    setOrder((product.images ?? []).map((image) => image.id));
    setOrderTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  useEffect(() => {
    setUseShopDefaults(usesShopDefaults);
    setProductOptions(options);
  }, [usesShopDefaults, options]);

  useEffect(() => {
    if (actionData?.message) {
      shopify.toast.show(actionData.message);
    }
  }, [actionData, shopify]);

  /** Failures already announced, so a revalidation cannot toast the same one twice. */
  const reportedFailures = useRef(new Set<string>());

  /**
   * Shopify processes media asynchronously, so just-attached media has no URL yet and is
   * filtered out of the loader's data. Re-fetch until it appears.
   *
   * A single 4-second retry was enough while this was images only. Video transcoding runs
   * for minutes, so the wait backs off instead — roughly two minutes in total, then it
   * gives up rather than polling the Admin API forever behind an abandoned tab.
   */
  const [pollStep, setPollStep] = useState<number | null>(null);
  // How many gallery entries existed when the poll started. Still the signal for images,
  // which appear only once they are usable.
  const pollBaseline = useRef(0);

  useEffect(() => {
    if (!actionData?.processing) return;
    pollBaseline.current = product.images?.length ?? 0;
    setPollStep(0);
    // `product` is deliberately not a dependency: the baseline must be read at the moment
    // the action reports processing, not re-read on the revalidation this triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionData]);

  useEffect(() => {
    if (pollStep === null) return;

    /**
     * Read from `pendingMedia`, **not** `product.images` — not-ready media is filtered out
     * of the gallery by the loader, so a status check against `images` is always false and
     * the poll would stop on its first tick, leaving the video to appear only after a
     * manual reload.
     *
     * Video is done when nothing is still processing; images, which only ever reach the
     * gallery once usable, keep the original count test.
     */
    const stillProcessing = pendingMedia.some(
      (media) => media.status === "processing",
    );
    const grew = (product.images?.length ?? 0) > pollBaseline.current;
    const settled = stillProcessing ? false : grew;

    const delay = PROCESSING_POLL_DELAYS[pollStep];
    if (delay === undefined || settled) {
      setPollStep(null);
      return;
    }

    const timer = window.setTimeout(() => {
      revalidator.revalidate();
      setPollStep((step) => (step === null ? null : step + 1));
    }, delay);
    return () => window.clearTimeout(timer);
    // revalidator is intentionally omitted: it changes identity on every revalidation,
    // which would restart the timer in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollStep, product, pendingMedia]);

  /**
   * Reports an upload failure once, while the upload is still in flight.
   *
   * Gated on `pollStep !== null` — that window *is* "while uploading". Reloading the page
   * later finds the same failed media and says nothing, which is the intent: a failure is
   * news about an upload you just did, not a permanent condition of the product.
   *
   * Declared after the poll state on purpose; it reads `pollStep`.
   */
  useEffect(() => {
    if (pollStep === null) return;

    for (const media of pendingMedia) {
      if (media.status !== "failed") continue;
      if (reportedFailures.current.has(media.id)) continue;

      reportedFailures.current.add(media.id);
      shopify.toast.show(mediaErrorMessage(media, t), { isError: true });
    }
  }, [pendingMedia, pollStep, shopify, t]);

  const toggleMappedImage = (variantId: string, imageId: string, checked: boolean) => {
    setVariantImageMap((currentMap) => {
      const imageIds = new Set(currentMap[variantId] ?? []);
      if (checked) {
        imageIds.add(imageId);
      } else {
        imageIds.delete(imageId);
      }

      return {
        ...currentMap,
        [variantId]: Array.from(imageIds),
      };
    });
  };

  // Cleared captions drop their key rather than storing an empty string, so the
  // storefront's `caption || item.alt` fallback kicks back in.
  const setCaption = (imageId: string, caption: string) => {
    setImageCaptions((current) => {
      const next = { ...current };
      if (caption.trim()) {
        next[imageId] = caption;
      } else {
        delete next[imageId];
      }
      return next;
    });
  };

  return (
    <s-page heading={product.title}>
      <s-link slot="breadcrumb-actions" href="/app/products">
        {t("products.pageTitle")}
      </s-link>
      {/* Save is the primary action and Back a secondary one because that is what each
          slot is documented for: `primary-action` is "typically Save or Create", while
          `secondary-actions` covers "Cancel, Delete". */}
      <s-button slot="secondary-actions" href="/app/products">
        {t("common.back")}
      </s-button>
      <s-button
        slot="secondary-actions"
        loading={submittingIntent === "options-draft" || undefined}
        onClick={() => submitOptions("options-draft")}
      >
        {t("products.saveAsDraft")}
      </s-button>
      {hasDraft ? (
        <s-button
          slot="secondary-actions"
          tone="critical"
          loading={submittingIntent === "options-discard" || undefined}
          onClick={() => submitOptions("options-discard")}
        >
          {t("products.discardDraft")}
        </s-button>
      ) : null}
      <s-button
        slot="primary-action"
        variant="primary"
        icon="save"
        loading={submittingIntent === "options" || undefined}
        onClick={() => submitOptions("options")}
      >
        {hasDraft ? t("products.publish") : t("dashboard.saveSettings")}
      </s-button>

      {/*
        The preview is pinned by owning this grid rather than using s-page's `aside`
        slot. Sticky needs a containing block taller than itself; as a grid item the
        preview gets the full row height, which the tall left column sets. Inside an
        aside section it had no travel room and simply scrolled away. `align-items:
        start` is load-bearing — a stretched item would fill the row and kill sticky
        again. Media queries force a <style> block: inline styles cannot express them.
      */}
      <style>{`
        .gn-editor-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 320px;
          gap: 16px;
          align-items: start;
        }
        .gn-editor-main { display: grid; gap: 16px; align-content: start; }
        .gn-editor-preview {
          position: sticky;
          top: 16px;
          max-height: calc(100vh - 32px);
          overflow-y: auto;
        }
        @media (max-width: 900px) {
          .gn-editor-grid { grid-template-columns: minmax(0, 1fr); }
          .gn-editor-preview { position: static; max-height: none; overflow-y: visible; }
        }
      `}</style>

      <div className="gn-editor-grid">
        <div className="gn-editor-main">
          <s-section heading={t("products.optionsHeading")}>
            <s-stack direction="block" gap="base">
              {/* Without this there is no visible difference between a drafted and a
                  published product, and nothing tells the merchant their change is
                  not live. */}
              {hasDraft ? (
                <s-banner heading={t("products.draftBannerHeading")} tone="warning">
                  <s-paragraph>{t("products.draftBannerBody")}</s-paragraph>
                </s-banner>
              ) : null}

              <s-paragraph>{t("products.optionsIntro")}</s-paragraph>

              <s-checkbox
                label={t("products.useShopDefaults")}
                details={t("products.useShopDefaultsHelp")}
                checked={useShopDefaults}
                onChange={(event) => setUseShopDefaults(event.currentTarget.checked)}
              />

              <SliderOptionsFields
                value={productOptions}
                onChange={setProductOptions}
                disabled={useShopDefaults}
              />

              {/* Hidden inputs only — the submit button for this form is the title
                  bar's Save settings action, which submits this element by ref. */}
              <Form
                ref={optionsFormRef}
                method="post"
                action={`/app/products/${params.productId}`}
              >
                <input type="hidden" name="intent" value="options" />
                {useShopDefaults ? (
                  <input type="hidden" name="useShopDefaults" value="on" />
                ) : null}
                <SliderOptionsInputs value={productOptions} />
              </Form>
            </s-stack>
          </s-section>

          <s-section heading={t("mapping.heading")}>
            <s-stack direction="block" gap="base">
              <s-paragraph>{t("mapping.intro")}</s-paragraph>

              {/* Without this, freshly attached video looks like it simply failed: it has
                  no poster until Shopify finishes transcoding, so it is absent from the
                  grid for as long as that takes. */}
              {pollStep !== null ? (
                <s-banner tone="info">
                  <s-paragraph>{t("mapping.videoProcessing")}</s-paragraph>
                </s-banner>
              ) : null}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                  gap: 16,
                  alignItems: "start",
                }}
              >
                <s-box padding="base" borderWidth="base" borderRadius="base">
                  <s-stack direction="block" gap="base">
                    <s-text>
                      {t("mapping.imagesForVariant", {
                        variant: activeVariant
                          ? `${activeVariant.sku || activeVariant.title} - ${activeVariant.title}`
                          : t("mapping.selectedVariant"),
                      })}
                    </s-text>
                    {product.images?.length ? <AddImagesControls busy={isSaving} /> : null}
                    {/* The grab bar is small and its keyboard behaviour is not
                        discoverable, so the one place to explain both is here. */}
                    {(product.images?.length ?? 0) > 1 ? (
                      <s-text>{t("mapping.reorderHelp")}</s-text>
                    ) : null}
                    {product.images?.length ? (
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                          gap: 12,
                        }}
                      >
                        {orderedImages.map((image, index) => (
                          // The wrapper exists so the × can sit over the tile without
                          // being inside the <label> — see `DeleteMediaButton`.
                          <div
                            key={image.id}
                            style={{ position: "relative" }}
                            onDragOver={(event) => {
                              // Without preventDefault the browser treats this as a
                              // non-droppable target and never fires onDrop at all.
                              if (dragIndex === null) return;
                              event.preventDefault();
                              event.dataTransfer.dropEffect = "move";
                              if (dropIndex !== index) setDropIndex(index);
                            }}
                            onDrop={(event) => {
                              if (dragIndex === null) return;
                              event.preventDefault();
                              moveMedia(dragIndex, index);
                              setDragIndex(null);
                              setDropIndex(null);
                            }}
                          >
                            {image.mediaId ? (
                              <DeleteMediaButton
                                onDelete={() => requestDeletion(image)}
                              />
                            ) : null}
                          <label
                            style={{
                              border:
                                dropIndex === index && dragIndex !== index
                                  ? "2px dashed #5c6ac4"
                                  : activeMappedImageIds.has(image.id)
                                    ? "2px solid #202223"
                                    : "1px solid #d1d5db",
                              borderRadius: 8,
                              padding: 8,
                              cursor: activeVariant ? "pointer" : "default",
                              display: "grid",
                              gap: 8,
                              opacity: dragIndex === index ? 0.5 : 1,
                            }}
                          >
                            <DragHandle
                              position={index + 1}
                              total={orderedImages.length}
                              onDragStart={() => setDragIndex(index)}
                              onDragEnd={() => {
                                setDragIndex(null);
                                setDropIndex(null);
                              }}
                              onMove={(to) => moveMedia(index, to)}
                            />
                            <MediaThumb media={image} />
                            <MediaStatusBadge media={image} />
                            <s-checkbox
                              label={t("mapping.show")}
                              checked={activeMappedImageIds.has(image.id)}
                              disabled={!activeVariant}
                              onChange={(event) => {
                                if (!activeVariant) return;
                                toggleMappedImage(
                                  activeVariant.id,
                                  image.id,
                                  event.currentTarget.checked,
                                );
                              }}
                            />
                            {/* Unlike the checkbox above, a caption belongs to the image
                                across every variant, not to the selected one. */}
                            <s-text-field
                              label={t("mapping.caption")}
                              details={t("mapping.captionHelp")}
                              value={imageCaptions[image.id] ?? ""}
                              maxLength={MAX_CAPTION_LENGTH}
                              onInput={(event) =>
                                setCaption(image.id, event.currentTarget.value)
                              }
                            />
                          </label>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <s-stack direction="block" gap="base">
                        <s-paragraph>{t("mapping.noImages")}</s-paragraph>
                        <AddImagesControls busy={isSaving} />
                      </s-stack>
                    )}
                  </s-stack>
                </s-box>

                <s-box padding="base" borderWidth="base" borderRadius="base">
                  <s-stack direction="block" gap="small">
                    <s-text>{t("mapping.variantsHeading")}</s-text>
                    {product.variants?.length ? (
                      product.variants.map((variant) => {
                        const mappedCount = (variantImageMap[variant.id] ?? []).length;

                        return (
                          <s-stack
                            key={variant.id}
                            direction="inline"
                            gap="small"
                            alignItems="center"
                          >
                            <s-button
                              variant={
                                variant.id === activeVariant?.id ? "primary" : "secondary"
                              }
                              onClick={() => setActiveVariantId(variant.id)}
                            >
                              {variant.sku || variant.title} - {variant.title}
                            </s-button>
                            <s-badge tone={mappedCount > 0 ? "success" : "neutral"}>
                              {mappedCount > 0
                                ? t("mapping.mappedCount", { count: mappedCount })
                                : t("mapping.unmapped")}
                            </s-badge>
                          </s-stack>
                        );
                      })
                    ) : (
                      <s-paragraph>{t("mapping.noVariants")}</s-paragraph>
                    )}
                  </s-stack>
                </s-box>
              </div>
            </s-stack>
          </s-section>

          <s-section>
            <Form method="post" action={`/app/products/${params.productId}`}>
              <input
                type="hidden"
                name="variantImageMap"
                value={JSON.stringify(variantImageMap)}
              />
              <input
                type="hidden"
                name="imageCaptions"
                value={JSON.stringify(imageCaptions)}
              />
              {/*
                Sent only once there is an order worth keeping: either the merchant moved
                something, or the product already had a saved order that an untouched save
                must not wipe. Otherwise an empty array goes up, which means "no custom
                order" and leaves the gallery tracking Shopify's own sequence.
              */}
              <input
                type="hidden"
                name="mediaOrder"
                value={JSON.stringify(
                  orderTouched || product.mediaOrder?.length
                    ? orderedImages.map((image) => image.id)
                    : [],
                )}
              />
              <s-button type="submit" variant="primary" loading={isSaving || undefined}>
                {t("mapping.saveMapping")}
              </s-button>
            </Form>
          </s-section>
        </div>

        <div className="gn-editor-preview">
          <s-section heading={t("dashboard.livePreview")}>
            <SliderPreview options={productOptions} images={previewImages} />
            <s-paragraph tone="neutral">{t("dashboard.livePreviewCaption")}</s-paragraph>
          </s-section>
        </div>
      </div>

      {/* Stays outside the grid: a modal must not be laid out as a grid item. */}
      <ImageLibraryPicker />

      <s-modal
        id={DELETE_MODAL_ID}
        heading={t("mapping.confirmDeleteHeading")}
        onHide={() => setPendingDeletion(null)}
      >
        <s-paragraph>
          {t("mapping.confirmDeleteBody", {
            media: pendingDeletion?.alt || t("mapping.confirmDeleteFallbackName"),
          })}
        </s-paragraph>
        {/*
          The variants are load-bearing, not styling: s-modal accepts only a `primary`
          variant in primary-action and only `secondary`/`auto` in secondary-actions.
          Anything else is dropped and the button never renders. `tone` is separate, so a
          critical primary stays red.
        */}
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          command="--hide"
          commandFor={DELETE_MODAL_ID}
          onClick={confirmDeletion}
        >
          {t("mapping.confirmDeleteButton")}
        </s-button>
        <s-button
          slot="secondary-actions"
          variant="secondary"
          command="--hide"
          commandFor={DELETE_MODAL_ID}
        >
          {t("common.cancel")}
        </s-button>
      </s-modal>
    </s-page>
  );
}

/**
 * A missing product is a real edge case here — a stale bookmark, a product
 * deleted in Shopify, or one pushed past the plan limit by a downgrade — so it
 * gets an explanation and a way back rather than React Router's bare status text.
 */
export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error) && error.status === 404) {
    return <ProductNotFound />;
  }

  return boundary.error(error);
}

function ProductNotFound() {
  const { t } = useLanguage();

  return (
    <s-page heading={t("products.notFoundHeading")}>
      <s-link slot="breadcrumb-actions" href="/app/products">
        {t("products.pageTitle")}
      </s-link>

      <s-section>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("products.notFoundBody")}</s-paragraph>
          <s-link href="/app/products">{t("products.backToProducts")}</s-link>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
