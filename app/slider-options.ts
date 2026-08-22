/**
 * Slider and zoom options — the set a merchant can configure per product.
 *
 * Every field has a shop-wide default (stored in its own column on
 * `ProductSliderSetting`) and can be overridden per product (stored as an
 * `overrides` object inside that product's entry in the `products` JSON blob).
 *
 * Pure module — no Prisma, safe to import from client code.
 */

export const THUMBNAIL_POSITIONS = ["left", "right", "top", "bottom"] as const;
export const THUMBNAIL_SIZES = ["56", "68", "76", "88", "100", "112"] as const;

/**
 * How the main image area is laid out:
 * - `single`   — one image at a time, swapped by the arrows and thumbnails
 * - `carousel` — several images side by side in a scrolling track
 *
 * Transitions only apply to `single`: a carousel scrolls rather than swapping a src.
 */
export const STAGE_LAYOUTS = ["single", "carousel"] as const;

/** How many images a carousel shows at once. Narrow screens clamp below this. */
export const CAROUSEL_PER_VIEW = ["2", "3", "4"] as const;

/**
 * What the shopper uses to move a carousel:
 * - `arrows` — the overlay ‹ › buttons only
 * - `slider` — a draggable bar under the track only
 * - `both`   — both at once
 */
export const CAROUSEL_NAVIGATIONS = ["arrows", "slider", "both"] as const;

/**
 * Thumbnail framing. `polaroid` and `card` carry a visible caption strip, so they make
 * the thumbnail taller than wide; the other three are square.
 */
export const THUMBNAIL_SHAPES = [
  "square",
  "rounded",
  "circle",
  "polaroid",
  "card",
] as const;

/**
 * What a thumbnail does under the cursor. Independent of shape, so a circular thumbnail
 * can also lift. `caption` reveals the image's caption over it.
 */
export const THUMBNAIL_HOVER_EFFECTS = ["none", "lift", "caption"] as const;
export const ZOOM_ICON_POSITIONS = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
] as const;

/**
 * What turns the storefront magnifier on:
 * - `hover` — magnifies while the cursor is over the image (the corner icon opens the lightbox)
 * - `click` — the corner icon toggles the magnifier; it stays on until clicked again
 * - `off`   — no magnification at all
 */
export const ZOOM_TRIGGERS = ["hover", "click", "off"] as const;
export const ZOOM_LEVELS = ["150", "200", "250", "300"] as const;

/** Bounds for the hover-navigation cycling delay, in milliseconds. */
export const HOVER_SPEED_MIN = 200;
export const HOVER_SPEED_MAX = 5000;
export const HOVER_SPEED_STEP = 100;

/**
 * Which axis hover-navigation splits the image on to pick a direction:
 * - `horizontal` — left half goes back, right half goes forward
 * - `vertical`   — top half goes back, bottom half goes forward
 */
export const HOVER_NAVIGATION_AXES = ["horizontal", "vertical"] as const;

/**
 * How the stage image changes when the shopper moves to another image:
 * - `none`  — swaps instantly
 * - `fade`  — old fades out, new fades in
 * - `slide` — new image slides in from the direction of travel
 * - `zoom`  — new image scales up while fading in
 *
 * Chosen twice over: `imageTransition` covers click-driven moves (arrows, thumbnails,
 * keyboard, variant changes) and `hoverTransition` covers hover cycling, so a merchant
 * can pair a deliberate slide on click with something quieter under the cursor.
 */
export const IMAGE_TRANSITIONS = ["none", "fade", "slide", "zoom"] as const;

/** Bounds for the transition duration, in milliseconds. */
export const TRANSITION_SPEED_MIN = 100;
export const TRANSITION_SPEED_MAX = 1000;
export const TRANSITION_SPEED_STEP = 50;

export type ThumbnailPosition = (typeof THUMBNAIL_POSITIONS)[number];
export type StageLayout = (typeof STAGE_LAYOUTS)[number];
export type CarouselNavigation = (typeof CAROUSEL_NAVIGATIONS)[number];
export type ThumbnailShape = (typeof THUMBNAIL_SHAPES)[number];
export type ThumbnailHoverEffect = (typeof THUMBNAIL_HOVER_EFFECTS)[number];
export type ZoomIconPosition = (typeof ZOOM_ICON_POSITIONS)[number];
export type ZoomTrigger = (typeof ZOOM_TRIGGERS)[number];
export type HoverNavigationAxis = (typeof HOVER_NAVIGATION_AXES)[number];
export type ImageTransition = (typeof IMAGE_TRANSITIONS)[number];

export type SliderOptions = {
  // Layout
  stageLayout: StageLayout;
  carouselPerView: number;
  carouselNavigation: CarouselNavigation;
  thumbnailPosition: ThumbnailPosition;
  thumbnailSize: number;
  thumbnailShape: ThumbnailShape;
  thumbnailHoverEffect: ThumbnailHoverEffect;
  hideThumbnails: boolean;
  // Behaviour
  syncVariantImages: boolean;
  loopSlides: boolean;
  hoverNavigation: boolean;
  hoverNavigationSpeed: number;
  hoverNavigationAxis: HoverNavigationAxis;
  hoverNavigationInvert: boolean;
  replaceThemeGallery: boolean;
  imageTransition: ImageTransition;
  hoverTransition: ImageTransition;
  transitionSpeed: number;
  // Zoom
  zoomTrigger: ZoomTrigger;
  zoomLevel: number;
  hideZoomIcon: boolean;
  zoomIconPosition: ZoomIconPosition;
  keyboardNavigation: boolean;
  // Custom icons
  previousArrowSvg: string;
  nextArrowSvg: string;
  zoomIconSvg: string;
};

export const DEFAULT_SLIDER_OPTIONS: SliderOptions = {
  stageLayout: "single",
  carouselPerView: 3,
  carouselNavigation: "arrows",
  thumbnailPosition: "left",
  thumbnailSize: 76,
  thumbnailShape: "square",
  thumbnailHoverEffect: "none",
  hideThumbnails: false,
  syncVariantImages: true,
  loopSlides: true,
  hoverNavigation: false,
  hoverNavigationSpeed: 1200,
  hoverNavigationAxis: "horizontal",
  hoverNavigationInvert: false,
  replaceThemeGallery: true,
  imageTransition: "fade",
  hoverTransition: "fade",
  transitionSpeed: 300,
  zoomTrigger: "hover",
  zoomLevel: 200,
  hideZoomIcon: false,
  zoomIconPosition: "top-right",
  keyboardNavigation: true,
  previousArrowSvg: "",
  nextArrowSvg: "",
  zoomIconSvg: "",
};

export const SLIDER_OPTION_KEYS = Object.keys(
  DEFAULT_SLIDER_OPTIONS,
) as (keyof SliderOptions)[];

const oneOf = <T extends string>(
  allowed: readonly T[],
  value: unknown,
  fallback: T,
): T => (allowed.includes(value as T) ? (value as T) : fallback);

const bool = (value: unknown, fallback: boolean) =>
  typeof value === "boolean" ? value : fallback;

const safeThumbnailSize = (value: unknown) =>
  (THUMBNAIL_SIZES as readonly string[]).includes(String(value))
    ? Number(value)
    : DEFAULT_SLIDER_OPTIONS.thumbnailSize;

const safeCarouselPerView = (value: unknown) =>
  (CAROUSEL_PER_VIEW as readonly string[]).includes(String(value))
    ? Number(value)
    : DEFAULT_SLIDER_OPTIONS.carouselPerView;

const safeZoomLevel = (value: unknown) =>
  (ZOOM_LEVELS as readonly string[]).includes(String(value))
    ? Number(value)
    : DEFAULT_SLIDER_OPTIONS.zoomLevel;

const safeHoverSpeed = (value: unknown) => {
  // Number(null) and Number("") are both 0, so an absent or cleared value would
  // otherwise clamp to the minimum instead of falling back to the default.
  if (value === null || value === undefined || value === "") {
    return DEFAULT_SLIDER_OPTIONS.hoverNavigationSpeed;
  }

  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return DEFAULT_SLIDER_OPTIONS.hoverNavigationSpeed;
  return Math.min(Math.max(parsed, HOVER_SPEED_MIN), HOVER_SPEED_MAX);
};

/** Same null/empty guard as `safeHoverSpeed`: Number("") is 0, not the default. */
const safeTransitionSpeed = (value: unknown) => {
  if (value === null || value === undefined || value === "") {
    return DEFAULT_SLIDER_OPTIONS.transitionSpeed;
  }

  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return DEFAULT_SLIDER_OPTIONS.transitionSpeed;
  return Math.min(Math.max(parsed, TRANSITION_SPEED_MIN), TRANSITION_SPEED_MAX);
};

const safeSvg = (value: unknown) => (typeof value === "string" ? value : "");

/**
 * Hover-navigation and hover-zoom would both fire on the same mouse movement, so
 * they are mutually exclusive. This is a *per-product* rule — a product that
 * overrides `zoomTrigger` to `hover` must have its own `hoverNavigation` forced
 * off, regardless of what the shop default says.
 */
export const applySliderConstraints = (options: SliderOptions): SliderOptions =>
  options.zoomTrigger === "hover"
    ? { ...options, hoverNavigation: false }
    : options;

/** Coerces an untrusted object into a complete, valid set of options. */
export const sanitizeSliderOptions = (
  raw: Partial<Record<keyof SliderOptions, unknown>> | null | undefined,
): SliderOptions => {
  const source = raw ?? {};

  return applySliderConstraints({
    stageLayout: oneOf(
      STAGE_LAYOUTS,
      source.stageLayout,
      DEFAULT_SLIDER_OPTIONS.stageLayout,
    ),
    carouselPerView: safeCarouselPerView(source.carouselPerView),
    carouselNavigation: oneOf(
      CAROUSEL_NAVIGATIONS,
      source.carouselNavigation,
      DEFAULT_SLIDER_OPTIONS.carouselNavigation,
    ),
    thumbnailPosition: oneOf(
      THUMBNAIL_POSITIONS,
      source.thumbnailPosition,
      DEFAULT_SLIDER_OPTIONS.thumbnailPosition,
    ),
    thumbnailSize: safeThumbnailSize(source.thumbnailSize),
    thumbnailShape: oneOf(
      THUMBNAIL_SHAPES,
      source.thumbnailShape,
      DEFAULT_SLIDER_OPTIONS.thumbnailShape,
    ),
    thumbnailHoverEffect: oneOf(
      THUMBNAIL_HOVER_EFFECTS,
      source.thumbnailHoverEffect,
      DEFAULT_SLIDER_OPTIONS.thumbnailHoverEffect,
    ),
    hideThumbnails: bool(source.hideThumbnails, DEFAULT_SLIDER_OPTIONS.hideThumbnails),
    syncVariantImages: bool(
      source.syncVariantImages,
      DEFAULT_SLIDER_OPTIONS.syncVariantImages,
    ),
    loopSlides: bool(source.loopSlides, DEFAULT_SLIDER_OPTIONS.loopSlides),
    hoverNavigation: bool(
      source.hoverNavigation,
      DEFAULT_SLIDER_OPTIONS.hoverNavigation,
    ),
    hoverNavigationSpeed: safeHoverSpeed(source.hoverNavigationSpeed),
    hoverNavigationAxis: oneOf(
      HOVER_NAVIGATION_AXES,
      source.hoverNavigationAxis,
      DEFAULT_SLIDER_OPTIONS.hoverNavigationAxis,
    ),
    hoverNavigationInvert: bool(
      source.hoverNavigationInvert,
      DEFAULT_SLIDER_OPTIONS.hoverNavigationInvert,
    ),
    replaceThemeGallery: bool(
      source.replaceThemeGallery,
      DEFAULT_SLIDER_OPTIONS.replaceThemeGallery,
    ),
    imageTransition: oneOf(
      IMAGE_TRANSITIONS,
      source.imageTransition,
      DEFAULT_SLIDER_OPTIONS.imageTransition,
    ),
    hoverTransition: oneOf(
      IMAGE_TRANSITIONS,
      source.hoverTransition,
      DEFAULT_SLIDER_OPTIONS.hoverTransition,
    ),
    transitionSpeed: safeTransitionSpeed(source.transitionSpeed),
    zoomTrigger: oneOf(
      ZOOM_TRIGGERS,
      source.zoomTrigger,
      DEFAULT_SLIDER_OPTIONS.zoomTrigger,
    ),
    zoomLevel: safeZoomLevel(source.zoomLevel),
    hideZoomIcon: bool(source.hideZoomIcon, DEFAULT_SLIDER_OPTIONS.hideZoomIcon),
    zoomIconPosition: oneOf(
      ZOOM_ICON_POSITIONS,
      source.zoomIconPosition,
      DEFAULT_SLIDER_OPTIONS.zoomIconPosition,
    ),
    keyboardNavigation: bool(
      source.keyboardNavigation,
      DEFAULT_SLIDER_OPTIONS.keyboardNavigation,
    ),
    previousArrowSvg: safeSvg(source.previousArrowSvg),
    nextArrowSvg: safeSvg(source.nextArrowSvg),
    zoomIconSvg: safeSvg(source.zoomIconSvg),
  });
};

/** The shop-wide defaults, read off a (possibly missing) ProductSliderSetting row. */
export const sliderOptionsFromRow = (
  row: Partial<Record<keyof SliderOptions, unknown>> | null | undefined,
): SliderOptions => sanitizeSliderOptions(row);

/**
 * A product's effective options: the shop defaults unless it carries its own
 * `overrides`, in which case those win outright. Storing the complete set on an
 * overriding product means a later change to a shop default does not silently
 * reshape a product the merchant has already customised.
 */
export const resolveSliderOptions = (
  shopDefaults: SliderOptions,
  product: { overrides?: unknown } | null | undefined,
): SliderOptions => {
  const overrides = product?.overrides;
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    return shopDefaults;
  }

  return sanitizeSliderOptions({
    ...shopDefaults,
    ...(overrides as Partial<Record<keyof SliderOptions, unknown>>),
  });
};

export const hasSliderOverrides = (product: { overrides?: unknown } | null | undefined) =>
  Boolean(
    product?.overrides &&
      typeof product.overrides === "object" &&
      !Array.isArray(product.overrides),
  );

/** Reads a complete set of options out of a submitted form. */
export const sliderOptionsFromFormData = (formData: FormData): SliderOptions =>
  sanitizeSliderOptions({
    stageLayout: formData.get("stageLayout")?.toString(),
    carouselPerView: formData.get("carouselPerView")?.toString(),
    carouselNavigation: formData.get("carouselNavigation")?.toString(),
    thumbnailPosition: formData.get("thumbnailPosition")?.toString(),
    thumbnailSize: formData.get("thumbnailSize")?.toString(),
    thumbnailShape: formData.get("thumbnailShape")?.toString(),
    thumbnailHoverEffect: formData.get("thumbnailHoverEffect")?.toString(),
    hideThumbnails: formData.get("hideThumbnails") === "on",
    syncVariantImages: formData.get("syncVariantImages") === "on",
    loopSlides: formData.get("loopSlides") === "on",
    hoverNavigation: formData.get("hoverNavigation") === "on",
    hoverNavigationSpeed: formData.get("hoverNavigationSpeed")?.toString(),
    hoverNavigationAxis: formData.get("hoverNavigationAxis")?.toString(),
    hoverNavigationInvert: formData.get("hoverNavigationInvert") === "on",
    replaceThemeGallery: formData.get("replaceThemeGallery") === "on",
    imageTransition: formData.get("imageTransition")?.toString(),
    hoverTransition: formData.get("hoverTransition")?.toString(),
    transitionSpeed: formData.get("transitionSpeed")?.toString(),
    zoomTrigger: formData.get("zoomTrigger")?.toString(),
    zoomLevel: formData.get("zoomLevel")?.toString(),
    hideZoomIcon: formData.get("hideZoomIcon") === "on",
    zoomIconPosition: formData.get("zoomIconPosition")?.toString(),
    keyboardNavigation: formData.get("keyboardNavigation") === "on",
    previousArrowSvg: formData.get("previousArrowSvg")?.toString() ?? "",
    nextArrowSvg: formData.get("nextArrowSvg")?.toString() ?? "",
    zoomIconSvg: formData.get("zoomIconSvg")?.toString() ?? "",
  });
