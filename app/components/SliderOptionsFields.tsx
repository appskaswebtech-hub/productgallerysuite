import type { CSSProperties } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import {
  CAROUSEL_NAVIGATIONS,
  CAROUSEL_PER_VIEW,
  HOVER_NAVIGATION_AXES,
  HOVER_SPEED_MAX,
  HOVER_SPEED_MIN,
  HOVER_SPEED_STEP,
  IMAGE_TRANSITIONS,
  STAGE_LAYOUTS,
  THUMBNAIL_HOVER_EFFECTS,
  THUMBNAIL_SHAPES,
  THUMBNAIL_SIZES,
  TRANSITION_SPEED_MAX,
  TRANSITION_SPEED_MIN,
  TRANSITION_SPEED_STEP,
  ZOOM_LEVELS,
  ZOOM_TRIGGERS,
  applySliderConstraints,
  type CarouselNavigation,
  type HoverNavigationAxis,
  type ImageTransition,
  type SliderOptions,
  type StageLayout,
  type ThumbnailHoverEffect,
  type ThumbnailNavigation,
  type ThumbnailPosition,
  type ThumbnailShape,
  type ZoomIconPosition,
  type ZoomTrigger,
} from "../slider-options";

const cardStyle = (accent: string): CSSProperties => ({
  borderTop: `3px solid ${accent}`,
  borderRadius: 10,
  background: "#ffffff",
  boxShadow: "0 2px 10px rgba(60, 30, 110, 0.06)",
  padding: 14,
});

const groupLabelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.03em",
  textTransform: "uppercase",
  color: "#8a7bb5",
};

const THUMBNAIL_SIZE_LABEL_KEYS = [
  "dashboard.small",
  "dashboard.medium",
  "dashboard.default",
  "dashboard.large",
  "dashboard.extraLarge",
  "dashboard.maximum",
] as const;

/**
 * The four option groups, shared by the shop-defaults editor on the Products page
 * and the per-product override editor. `value` is always a complete set of
 * options; `onChange` receives the whole set back with constraints applied.
 */
export function SliderOptionsFields({
  value,
  onChange,
  disabled = false,
}: {
  value: SliderOptions;
  onChange: (next: SliderOptions) => void;
  disabled?: boolean;
}) {
  const { t, locale } = useLanguage();

  const set = <K extends keyof SliderOptions>(key: K, next: SliderOptions[K]) =>
    onChange(applySliderConstraints({ ...value, [key]: next }));

  // Hover-navigation and hover-zoom would react to the same mouse movement.
  const canHoverNavigate = value.zoomTrigger !== "hover";
  // A carousel scrolls rather than swapping the stage image, so the transitions have
  // nothing to animate. Disabled with an explanation beats silently doing nothing.
  const isCarousel = value.stageLayout === "carousel";

  return (
    <s-stack direction="block" gap="base">
      <div style={cardStyle("#6c4fc7")}>
        <s-stack direction="block" gap="base">
          <span style={groupLabelStyle}>{t("dashboard.layoutGroup")}</span>

          <s-select
            key={`stageLayout-${locale}`}
            label={t("dashboard.stageLayout")}
            value={value.stageLayout}
            disabled={disabled}
            onChange={(event) =>
              set(
                "stageLayout",
                ((STAGE_LAYOUTS as readonly string[]).includes(
                  event.currentTarget.value,
                )
                  ? event.currentTarget.value
                  : "single") as StageLayout,
              )
            }
          >
            <s-option value="single">{t("dashboard.stageLayoutSingle")}</s-option>
            <s-option value="carousel">{t("dashboard.stageLayoutCarousel")}</s-option>
          </s-select>

          <s-select
            key={`carouselPerView-${locale}`}
            label={t("dashboard.carouselPerView")}
            value={String(value.carouselPerView)}
            disabled={disabled || !isCarousel}
            onChange={(event) =>
              set("carouselPerView", Number(event.currentTarget.value || 3))
            }
          >
            {CAROUSEL_PER_VIEW.map((count) => (
              <s-option key={count} value={count}>
                {count}
              </s-option>
            ))}
          </s-select>

          <s-select
            key={`carouselNavigation-${locale}`}
            label={t("dashboard.carouselNavigation")}
            value={value.carouselNavigation}
            disabled={disabled || !isCarousel}
            onChange={(event) =>
              set(
                "carouselNavigation",
                ((CAROUSEL_NAVIGATIONS as readonly string[]).includes(
                  event.currentTarget.value,
                )
                  ? event.currentTarget.value
                  : "arrows") as CarouselNavigation,
              )
            }
          >
            <s-option value="arrows">{t("dashboard.carouselNavArrows")}</s-option>
            <s-option value="slider">{t("dashboard.carouselNavSlider")}</s-option>
            <s-option value="both">{t("dashboard.carouselNavBoth")}</s-option>
          </s-select>

          <s-select
            key={`thumbnailPosition-${locale}`}
            label={t("dashboard.thumbnailPosition")}
            value={value.thumbnailPosition}
            disabled={disabled}
            onChange={(event) =>
              set(
                "thumbnailPosition",
                (event.currentTarget.value || "left") as ThumbnailPosition,
              )
            }
          >
            <s-option value="left">{t("dashboard.left")}</s-option>
            <s-option value="right">{t("dashboard.right")}</s-option>
            <s-option value="top">{t("dashboard.top")}</s-option>
            <s-option value="bottom">{t("dashboard.bottom")}</s-option>
          </s-select>

          {/* Beside the position it depends on: the control orients itself from that
              choice, running up/down for left/right and left/right for top/bottom. */}
          <s-select
            key={`thumbnailNavigation-${locale}`}
            label={t("dashboard.thumbnailNavigation")}
            details={t("dashboard.thumbnailNavigationHelp")}
            value={value.thumbnailNavigation}
            disabled={disabled}
            onChange={(event) =>
              set(
                "thumbnailNavigation",
                (event.currentTarget.value || "none") as ThumbnailNavigation,
              )
            }
          >
            <s-option value="none">{t("dashboard.thumbnailNavNone")}</s-option>
            <s-option value="arrows">{t("dashboard.thumbnailNavArrows")}</s-option>
            <s-option value="scrollbar">{t("dashboard.thumbnailNavScrollbar")}</s-option>
          </s-select>

          <s-select
            key={`thumbnailSize-${locale}`}
            label={t("dashboard.thumbnailSize")}
            value={String(value.thumbnailSize)}
            disabled={disabled || value.hideThumbnails}
            onChange={(event) =>
              set("thumbnailSize", Number(event.currentTarget.value || 76))
            }
          >
            {THUMBNAIL_SIZES.map((size, index) => (
              <s-option key={size} value={size}>
                {t(THUMBNAIL_SIZE_LABEL_KEYS[index])}
              </s-option>
            ))}
          </s-select>

          <s-select
            key={`thumbnailShape-${locale}`}
            label={t("dashboard.thumbnailShape")}
            value={value.thumbnailShape}
            disabled={disabled || value.hideThumbnails}
            onChange={(event) =>
              set(
                "thumbnailShape",
                ((THUMBNAIL_SHAPES as readonly string[]).includes(
                  event.currentTarget.value,
                )
                  ? event.currentTarget.value
                  : "square") as ThumbnailShape,
              )
            }
          >
            <s-option value="square">{t("dashboard.shapeSquare")}</s-option>
            <s-option value="rounded">{t("dashboard.shapeRounded")}</s-option>
            <s-option value="circle">{t("dashboard.shapeCircle")}</s-option>
            <s-option value="polaroid">{t("dashboard.shapePolaroid")}</s-option>
            <s-option value="card">{t("dashboard.shapeCard")}</s-option>
          </s-select>

          <s-select
            key={`thumbnailHoverEffect-${locale}`}
            label={t("dashboard.thumbnailHoverEffect")}
            details={t("dashboard.thumbnailHoverEffectHelp")}
            value={value.thumbnailHoverEffect}
            disabled={disabled || value.hideThumbnails}
            onChange={(event) =>
              set(
                "thumbnailHoverEffect",
                ((THUMBNAIL_HOVER_EFFECTS as readonly string[]).includes(
                  event.currentTarget.value,
                )
                  ? event.currentTarget.value
                  : "none") as ThumbnailHoverEffect,
              )
            }
          >
            <s-option value="none">{t("dashboard.transitionNone")}</s-option>
            <s-option value="lift">{t("dashboard.hoverEffectLift")}</s-option>
            <s-option value="caption">{t("dashboard.hoverEffectCaption")}</s-option>
          </s-select>

          <s-checkbox
            label={t("dashboard.hideThumbnails")}
            checked={value.hideThumbnails}
            disabled={disabled}
            onChange={(event) => set("hideThumbnails", event.currentTarget.checked)}
          />
        </s-stack>
      </div>

      <div style={cardStyle("#2fae87")}>
        <s-stack direction="block" gap="base">
          <span style={groupLabelStyle}>{t("settings.behaviourGroup")}</span>

          <s-checkbox
            label={t("dashboard.syncVariantImages")}
            checked={value.syncVariantImages}
            disabled={disabled}
            onChange={(event) => set("syncVariantImages", event.currentTarget.checked)}
          />

          <s-checkbox
            label={t("settings.loopSlides")}
            details={t("settings.loopSlidesHelp")}
            checked={value.loopSlides}
            disabled={disabled}
            onChange={(event) => set("loopSlides", event.currentTarget.checked)}
          />

          <s-select
            key={`imageTransition-${locale}`}
            label={t("dashboard.imageTransition")}
            details={isCarousel ? t("dashboard.transitionCarouselNote") : undefined}
            value={value.imageTransition}
            disabled={disabled || isCarousel}
            onChange={(event) =>
              set(
                "imageTransition",
                ((IMAGE_TRANSITIONS as readonly string[]).includes(
                  event.currentTarget.value,
                )
                  ? event.currentTarget.value
                  : "fade") as ImageTransition,
              )
            }
          >
            <s-option value="none">{t("dashboard.transitionNone")}</s-option>
            <s-option value="fade">{t("dashboard.transitionFade")}</s-option>
            <s-option value="slide">{t("dashboard.transitionSlide")}</s-option>
            <s-option value="zoom">{t("dashboard.transitionZoom")}</s-option>
          </s-select>

          <s-number-field
            label={t("settings.transitionSpeed")}
            details={t("settings.transitionSpeedHelp")}
            value={String(value.transitionSpeed)}
            min={TRANSITION_SPEED_MIN}
            max={TRANSITION_SPEED_MAX}
            step={TRANSITION_SPEED_STEP}
            suffix="ms"
            // Governs both transitions, so it is only meaningless when neither side
            // animates — click alone being None still leaves hover a duration to use.
            disabled={
              disabled ||
              (value.imageTransition === "none" && value.hoverTransition === "none")
            }
            onInput={(event) => set("transitionSpeed", Number(event.currentTarget.value))}
          />

          <s-checkbox
            label={t("settings.keyboardNavigation")}
            details={t("settings.keyboardNavigationHelp")}
            checked={value.keyboardNavigation}
            disabled={disabled}
            onChange={(event) => set("keyboardNavigation", event.currentTarget.checked)}
          />

          <s-checkbox
            label={t("settings.replaceThemeGallery")}
            details={t("settings.replaceThemeGalleryHelp")}
            checked={value.replaceThemeGallery}
            disabled={disabled}
            onChange={(event) => set("replaceThemeGallery", event.currentTarget.checked)}
          />

          <s-checkbox
            label={t("settings.hoverNavigation")}
            details={
              canHoverNavigate
                ? t("settings.hoverNavigationHelp")
                : t("settings.hoverNavigationDisabled")
            }
            checked={value.hoverNavigation}
            disabled={disabled || !canHoverNavigate}
            onChange={(event) => set("hoverNavigation", event.currentTarget.checked)}
          />

          <s-number-field
            label={t("settings.hoverSpeed")}
            details={t("settings.hoverSpeedHelp")}
            value={String(value.hoverNavigationSpeed)}
            min={HOVER_SPEED_MIN}
            max={HOVER_SPEED_MAX}
            step={HOVER_SPEED_STEP}
            suffix="ms"
            disabled={disabled || !canHoverNavigate || !value.hoverNavigation}
            onInput={(event) =>
              set("hoverNavigationSpeed", Number(event.currentTarget.value))
            }
          />

          <s-select
            key={`hoverNavigationAxis-${locale}`}
            label={t("settings.hoverAxis")}
            details={t("settings.hoverAxisHelp")}
            value={value.hoverNavigationAxis}
            disabled={disabled || !canHoverNavigate || !value.hoverNavigation}
            onChange={(event) =>
              set(
                "hoverNavigationAxis",
                ((HOVER_NAVIGATION_AXES as readonly string[]).includes(
                  event.currentTarget.value,
                )
                  ? event.currentTarget.value
                  : "horizontal") as HoverNavigationAxis,
              )
            }
          >
            <s-option value="horizontal">{t("settings.hoverAxisHorizontal")}</s-option>
            <s-option value="vertical">{t("settings.hoverAxisVertical")}</s-option>
          </s-select>

          <s-checkbox
            label={t("settings.hoverInvert")}
            details={t("settings.hoverInvertHelp")}
            checked={value.hoverNavigationInvert}
            disabled={disabled || !canHoverNavigate || !value.hoverNavigation}
            onChange={(event) =>
              set("hoverNavigationInvert", event.currentTarget.checked)
            }
          />

          <s-select
            key={`hoverTransition-${locale}`}
            label={t("dashboard.hoverTransition")}
            details={isCarousel ? t("dashboard.transitionCarouselNote") : undefined}
            value={value.hoverTransition}
            disabled={
              disabled || isCarousel || !canHoverNavigate || !value.hoverNavigation
            }
            onChange={(event) =>
              set(
                "hoverTransition",
                ((IMAGE_TRANSITIONS as readonly string[]).includes(
                  event.currentTarget.value,
                )
                  ? event.currentTarget.value
                  : "fade") as ImageTransition,
              )
            }
          >
            <s-option value="none">{t("dashboard.transitionNone")}</s-option>
            <s-option value="fade">{t("dashboard.transitionFade")}</s-option>
            <s-option value="slide">{t("dashboard.transitionSlide")}</s-option>
            <s-option value="zoom">{t("dashboard.transitionZoom")}</s-option>
          </s-select>
        </s-stack>
      </div>

      <div style={cardStyle("#d68f2f")}>
        <s-stack direction="block" gap="base">
          <span style={groupLabelStyle}>{t("dashboard.zoomGallery")}</span>

          <s-select
            key={`zoomTrigger-${locale}`}
            label={t("settings.zoomTrigger")}
            details={t("settings.zoomTriggerHelp")}
            value={value.zoomTrigger}
            disabled={disabled}
            onChange={(event) =>
              set(
                "zoomTrigger",
                ((ZOOM_TRIGGERS as readonly string[]).includes(
                  event.currentTarget.value,
                )
                  ? event.currentTarget.value
                  : "hover") as ZoomTrigger,
              )
            }
          >
            <s-option value="hover">{t("settings.zoomTriggerHover")}</s-option>
            <s-option value="click">{t("settings.zoomTriggerClick")}</s-option>
            <s-option value="off">{t("settings.zoomTriggerOff")}</s-option>
          </s-select>

          <s-select
            key={`zoomLevel-${locale}`}
            label={t("settings.zoomLevel")}
            value={String(value.zoomLevel)}
            disabled={disabled || value.zoomTrigger === "off"}
            onChange={(event) => set("zoomLevel", Number(event.currentTarget.value || 200))}
          >
            {ZOOM_LEVELS.map((level) => (
              <s-option key={level} value={level}>
                {`${Number(level) / 100}×`}
              </s-option>
            ))}
          </s-select>

          <s-checkbox
            label={t("dashboard.hideZoomIcon")}
            checked={value.hideZoomIcon}
            disabled={disabled}
            onChange={(event) => set("hideZoomIcon", event.currentTarget.checked)}
          />

          <s-select
            key={`zoomIconPosition-${locale}`}
            label={t("dashboard.zoomIconPosition")}
            value={value.zoomIconPosition}
            disabled={disabled || value.hideZoomIcon}
            onChange={(event) =>
              set(
                "zoomIconPosition",
                (event.currentTarget.value || "top-right") as ZoomIconPosition,
              )
            }
          >
            <s-option value="top-left">{t("dashboard.topLeft")}</s-option>
            <s-option value="top-right">{t("dashboard.topRight")}</s-option>
            <s-option value="bottom-left">{t("dashboard.bottomLeft")}</s-option>
            <s-option value="bottom-right">{t("dashboard.bottomRight")}</s-option>
          </s-select>
        </s-stack>
      </div>

      <div style={cardStyle("#3f8ae0")}>
        <s-stack direction="block" gap="base">
          <span style={groupLabelStyle}>{t("dashboard.svgGroup")}</span>

          <s-text-area
            label={t("dashboard.previousArrowSvg")}
            rows={4}
            value={value.previousArrowSvg}
            disabled={disabled}
            onInput={(event) => set("previousArrowSvg", event.currentTarget.value)}
          />

          <s-text-area
            label={t("dashboard.nextArrowSvg")}
            rows={4}
            value={value.nextArrowSvg}
            disabled={disabled}
            onInput={(event) => set("nextArrowSvg", event.currentTarget.value)}
          />

          <s-text-area
            label={t("dashboard.zoomIconSvg")}
            rows={4}
            value={value.zoomIconSvg}
            disabled={disabled || value.hideZoomIcon}
            onInput={(event) => set("zoomIconSvg", event.currentTarget.value)}
          />
        </s-stack>
      </div>
    </s-stack>
  );
}

/** Hidden inputs mirroring a set of options, for submission with a plain Form. */
export function SliderOptionsInputs({ value }: { value: SliderOptions }) {
  return (
    <>
      <input type="hidden" name="stageLayout" value={value.stageLayout} />
      <input
        type="hidden"
        name="carouselPerView"
        value={String(value.carouselPerView)}
      />
      <input
        type="hidden"
        name="carouselNavigation"
        value={value.carouselNavigation}
      />
      <input type="hidden" name="thumbnailPosition" value={value.thumbnailPosition} />
      <input
        type="hidden"
        name="thumbnailNavigation"
        value={value.thumbnailNavigation}
      />
      <input type="hidden" name="thumbnailSize" value={String(value.thumbnailSize)} />
      <input type="hidden" name="thumbnailShape" value={value.thumbnailShape} />
      <input
        type="hidden"
        name="thumbnailHoverEffect"
        value={value.thumbnailHoverEffect}
      />
      {value.hideThumbnails ? (
        <input type="hidden" name="hideThumbnails" value="on" />
      ) : null}
      {value.syncVariantImages ? (
        <input type="hidden" name="syncVariantImages" value="on" />
      ) : null}
      {value.loopSlides ? <input type="hidden" name="loopSlides" value="on" /> : null}
      {value.hoverNavigation ? (
        <input type="hidden" name="hoverNavigation" value="on" />
      ) : null}
      <input
        type="hidden"
        name="hoverNavigationSpeed"
        value={String(value.hoverNavigationSpeed)}
      />
      <input
        type="hidden"
        name="hoverNavigationAxis"
        value={value.hoverNavigationAxis}
      />
      {value.hoverNavigationInvert ? (
        <input type="hidden" name="hoverNavigationInvert" value="on" />
      ) : null}
      {value.replaceThemeGallery ? (
        <input type="hidden" name="replaceThemeGallery" value="on" />
      ) : null}
      <input type="hidden" name="imageTransition" value={value.imageTransition} />
      <input type="hidden" name="hoverTransition" value={value.hoverTransition} />
      <input
        type="hidden"
        name="transitionSpeed"
        value={String(value.transitionSpeed)}
      />
      <input type="hidden" name="zoomTrigger" value={value.zoomTrigger} />
      <input type="hidden" name="zoomLevel" value={String(value.zoomLevel)} />
      {value.hideZoomIcon ? (
        <input type="hidden" name="hideZoomIcon" value="on" />
      ) : null}
      <input type="hidden" name="zoomIconPosition" value={value.zoomIconPosition} />
      {value.keyboardNavigation ? (
        <input type="hidden" name="keyboardNavigation" value="on" />
      ) : null}
      <input type="hidden" name="previousArrowSvg" value={value.previousArrowSvg} />
      <input type="hidden" name="nextArrowSvg" value={value.nextArrowSvg} />
      <input type="hidden" name="zoomIconSvg" value={value.zoomIconSvg} />
    </>
  );
}
