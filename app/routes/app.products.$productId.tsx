import { useEffect, useRef, useState } from "react";
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
  normalizeShopifyId,
  type SliderProduct,
} from "../products";
import { getSavedProducts, hydrateProduct, saveProducts } from "../products.server";
import {
  MAX_IMAGES_PER_UPLOAD,
  attachMediaToProduct,
  isShopifyCdnUrl,
  partitionUploadableFiles,
  uploadProductImages,
  type PickerImage,
} from "../media.server";
import type { loader as libraryLoader } from "./app.image-library";
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

  return {
    product: await hydrateProduct(admin, savedProduct),
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

type ActionResult = {
  ok: boolean;
  message: string;
  /** Set when Shopify is still processing newly uploaded media. */
  processing?: boolean;
};

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
  await saveProducts(
    session.shop,
    patch((product) => ({
      ...product,
      variantImageMap: nextMap,
      imageCaptions: nextCaptions,
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

const PICKER_MODAL_ID = "gn-image-library";

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

/** The two ways to add an image, kept together so both render sites stay in sync. */
function AddImagesControls({ busy }: { busy: boolean }) {
  const { t } = useLanguage();

  return (
    <s-stack direction="block" gap="small">
      <UploadImagesForm busy={busy} />
      <s-button
        variant="secondary"
        disabled={busy || undefined}
        command="--show"
        commandFor={PICKER_MODAL_ID}
      >
        {t("mapping.addFromShopify")}
      </s-button>
    </s-stack>
  );
}

export default function ProductMapping() {
  const { product, options, usesShopDefaults, hasDraft } =
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

  // Mirrors `mediaForVariant` on the storefront: a variant's mapped images if it has
  // any, otherwise the whole set. Most variants start unmapped, so the fallback is the
  // common case and getting it wrong would make the preview misleading.
  const mappedPreviewImages = (product.images ?? []).filter((image) =>
    activeMappedImageIds.has(image.id),
  );
  const previewImages = mappedPreviewImages.length
    ? mappedPreviewImages
    : product.images ?? [];

  useEffect(() => {
    setActiveVariantId(product.variants?.[0]?.id ?? "");
    setVariantImageMap(product.variantImageMap ?? {});
    setImageCaptions(product.imageCaptions ?? {});
  }, [product]);

  useEffect(() => {
    setUseShopDefaults(usesShopDefaults);
    setProductOptions(options);
  }, [usesShopDefaults, options]);

  useEffect(() => {
    if (actionData?.message) {
      shopify.toast.show(actionData.message);
    }
  }, [actionData, shopify]);

  // Shopify processes media asynchronously, so a just-uploaded image has no URL yet
  // and is filtered out of the loader's data. Re-fetch once it has had a moment.
  useEffect(() => {
    if (!actionData?.processing) return;

    const timer = window.setTimeout(() => revalidator.revalidate(), 4000);
    return () => window.clearTimeout(timer);
    // revalidator is intentionally omitted: it changes identity on every revalidation,
    // which would restart the timer in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionData]);

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
                    {product.images?.length ? (
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                          gap: 12,
                        }}
                      >
                        {product.images.map((image) => (
                          <label
                            key={image.id}
                            style={{
                              border: activeMappedImageIds.has(image.id)
                                ? "2px solid #202223"
                                : "1px solid #d1d5db",
                              borderRadius: 8,
                              padding: 8,
                              cursor: activeVariant ? "pointer" : "default",
                              display: "grid",
                              gap: 8,
                            }}
                          >
                            <img
                              src={image.url}
                              alt={image.alt ?? ""}
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
