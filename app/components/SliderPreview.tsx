import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import { isPlayableMedia } from "../products";
import type { SliderImage } from "../products";
import type { SliderOptions } from "../slider-options";

/**
 * A scaled-down mock of the storefront gallery, driven by the options the merchant is
 * currently editing.
 *
 * The layout rules mirror `gallery-nest-slider.css`: `thumbnailPosition` decides which
 * side the strip sits on, and the strip runs along the cross axis. Most behavioural
 * options (hover navigation, zoom trigger, loop) have nothing to show in a still image
 * and are not represented.
 *
 * `imageTransition` is the exception: clicking a thumbnail changes the image here too,
 * so the chosen transition is replayed on that change. The keyframes are duplicated
 * from `gallery-nest-slider.css` because the storefront stylesheet is not loaded in the
 * admin — keep the two in step.
 *
 * `thumbnailShape` is mirrored too. Its caption is filled with the image's **alt text**,
 * not the real caption — this component only receives `SliderImage[]`, and captions live
 * in the product's `imageCaptions` map — so treat that text as indicative. The
 * hover-overlay effect is not shown at all; a still mock has no hover to demonstrate.
 */

const surfaceStyle: CSSProperties = {
  position: "relative",
  display: "flex",
  gap: 8,
  padding: 14,
  borderRadius: 12,
  background: "linear-gradient(160deg, #f7f4ff 0%, #efe9ff 100%)",
  border: "1px solid #e2d8fb",
};

const stageStyle: CSSProperties = {
  position: "relative",
  flex: 1,
  // Flex items default to min-width:auto and refuse to shrink below their content,
  // which would push the strip's scrollbar past the card edge.
  minWidth: 0,
  aspectRatio: "1 / 1",
  borderRadius: 10,
  overflow: "hidden",
  background: "linear-gradient(135deg, #d9cffb, #b9a4ee)",
};

/**
 * `left`/`right` stack the strip beside the image; `top`/`bottom` above or below.
 *
 * These map straight across only because the markup below renders the thumbnail strip
 * **before** the stage, matching `gallery-nest-slider.js`. Reverse that order and every
 * position silently flips — which is exactly the bug this ordering was written to fix.
 */
const surfaceDirection = (position: SliderOptions["thumbnailPosition"]) => {
  if (position === "right") return "row-reverse";
  if (position === "top") return "column";
  if (position === "bottom") return "column-reverse";
  return "row";
};

const TRANSITION_KEYFRAMES = `
  @keyframes gn-preview-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes gn-preview-slide-forward {
    from { opacity: 0; transform: translateX(12%); }
    to { opacity: 1; transform: translateX(0); }
  }
  @keyframes gn-preview-slide-back {
    from { opacity: 0; transform: translateX(-12%); }
    to { opacity: 1; transform: translateX(0); }
  }
  @keyframes gn-preview-zoom {
    from { opacity: 0; transform: scale(0.96); }
    to { opacity: 1; transform: scale(1); }
  }
  @media (prefers-reduced-motion: reduce) {
    .gn-preview-stage-image { animation-name: gn-preview-fade !important; }
  }
`;

/**
 * Marks a video entry the way the storefront does — the mock shows the poster, because
 * the storefront gallery shows the poster too; playback only happens in the lightbox,
 * which this mock has no equivalent of.
 */
/**
 * Stands in for a video whose poster Shopify has not produced yet.
 *
 * An `<img>` with an empty `src` re-requests the current page in several browsers and
 * draws a broken-image glyph, so a poster-less entry gets a plain box that holds its slot
 * in the layout instead.
 */
function PendingMedia({ style }: { style: CSSProperties }) {
  return <div style={{ ...style, background: "#e4dcfb", border: "1px dashed #b9a4ee" }} />;
}

function PlayBadge({ size }: { size: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
        fontSize: size,
        color: "#ffffff",
        textShadow: "0 1px 4px rgba(0, 0, 0, 0.55)",
        pointerEvents: "none",
      }}
    >
      ▶
    </span>
  );
}

/**
 * Only polaroid and card carry a permanently visible caption. The hover-overlay effect
 * is not reproduced here — a still mock has no hover state worth showing.
 */
const showsPreviewCaption = (options: SliderOptions) =>
  options.thumbnailShape === "polaroid" || options.thumbnailShape === "card";

/** Mirrors the shape rules in `gallery-nest-slider.css`. */
const thumbShapeStyle = (
  shape: SliderOptions["thumbnailShape"],
  thumbSize: number,
): CSSProperties => {
  if (shape === "rounded") return { height: thumbSize, borderRadius: 10 };
  if (shape === "circle") return { height: thumbSize, borderRadius: "50%" };
  if (shape === "polaroid") {
    return {
      height: "auto",
      borderRadius: 2,
      padding: "4px 4px 0 4px",
      boxShadow: "0 1px 4px rgba(0, 0, 0, 0.18)",
    };
  }
  if (shape === "card") {
    return {
      height: "auto",
      borderRadius: 10,
      boxShadow: "0 2px 8px rgba(0, 0, 0, 0.12)",
    };
  }
  return { height: thumbSize, borderRadius: 0 };
};

/** Mirrors the storefront mapping in `gallery-nest-slider.js`. */
const animationName = (
  transition: SliderOptions["imageTransition"],
  forward: boolean,
) => {
  if (transition === "none") return undefined;
  if (transition === "fade") return "gn-preview-fade";
  if (transition === "zoom") return "gn-preview-zoom";
  return forward ? "gn-preview-slide-forward" : "gn-preview-slide-back";
};

export function SliderPreview({
  options,
  images,
}: {
  options: SliderOptions;
  images: SliderImage[];
}) {
  const { t } = useLanguage();
  const [activeIndex, setActiveIndex] = useState(0);
  const [forward, setForward] = useState(true);

  // The active variant can change which images these are, so an index from the
  // previous set would point at nothing.
  useEffect(() => {
    setActiveIndex(0);
  }, [images]);

  const selectImage = (index: number) => {
    setForward(index > activeIndex);
    setActiveIndex(index);
  };

  const isStacked = options.thumbnailPosition === "top" || options.thumbnailPosition === "bottom";
  // Thumbnails are scaled down: the real sizes (56-112px) would swamp the aside column.
  const thumbSize = Math.min(48, Math.max(28, Number(options.thumbnailSize) / 2));
  const active = images[activeIndex] ?? images[0] ?? null;

  /**
   * The thumbnail rail's scroll control, drawn as it sits on the storefront.
   *
   * Indicative only, like the carousel bar below it — the preview does not scroll, so these
   * show the merchant *what* the control is and *where* it sits, nothing more.
   *
   * Placement mirrors the storefront rule that arrows bracket the rail's ends while a bar
   * sits alongside it, so the wrapper's direction depends on the control as well as the
   * axis. `isStacked` already carries the axis.
   */
  const thumbNav = options.thumbnailNavigation ?? "none";
  const thumbNavAlongRail = thumbNav === "arrows" ? isStacked : !isStacked;

  /* Mirrors the storefront's rail arrow: a white disc with a hairline border, not a filled
     accent dot — the same control the main gallery arrows use, scaled to the mock. */
  const thumbArrow = (
    <span
      style={{
        flex: "0 0 auto",
        width: 14,
        height: 14,
        borderRadius: 999,
        background: "#ffffff",
        border: "1px solid #d9d3ea",
        boxSizing: "border-box",
      }}
    />
  );

  const thumbScrollBar = (
    <span
      style={{
        flex: "0 0 auto",
        borderRadius: 999,
        background: "rgba(18, 18, 18, 0.1)",
        ...(isStacked
          ? { height: 5, alignSelf: "stretch" }
          : { width: 5, alignSelf: "stretch" }),
        position: "relative",
      }}
    >
      <span
        style={{
          position: "absolute",
          borderRadius: 999,
          background: "#6c4fc7",
          // Roughly half the track, the way a real thumb reads when about half the rail
          // is on screen.
          ...(isStacked
            ? { top: 0, bottom: 0, left: 0, width: "55%" }
            : { left: 0, right: 0, top: 0, height: "55%" }),
        }}
      />
    </span>
  );

  const zoomDot = !options.hideZoomIcon ? (
    <div
      style={{
        position: "absolute",
        width: 22,
        height: 22,
        borderRadius: "50%",
        background: "#ffffff",
        boxShadow: "0 2px 6px rgba(60, 30, 110, 0.25)",
        ...(options.zoomIconPosition.includes("top") ? { top: 8 } : { bottom: 8 }),
        ...(options.zoomIconPosition.includes("left") ? { left: 8 } : { right: 8 }),
      }}
    />
  ) : null;

  if (!images.length) {
    return (
      <>
        <div style={{ ...surfaceStyle, flexDirection: surfaceDirection(options.thumbnailPosition) }}>
          {!options.hideThumbnails ? (
            <div
              style={{
                display: "flex",
                flexShrink: 0,
                flexDirection: isStacked ? "row" : "column",
                gap: 6,
              }}
            >
              {[0, 1, 2].map((index) => (
                <div
                  key={index}
                  style={{
                    width: thumbSize,
                    height: thumbSize,
                    borderRadius: 6,
                    background: index === 0 ? "#8d6fe0" : "#cabdf2",
                  }}
                />
              ))}
            </div>
          ) : null}
          <div style={stageStyle}>{zoomDot}</div>
        </div>
        <s-paragraph tone="neutral">{t("mapping.noImages")}</s-paragraph>
      </>
    );
  }

  return (
    <div style={{ ...surfaceStyle, flexDirection: surfaceDirection(options.thumbnailPosition) }}>
      {!options.hideThumbnails ? (
        <div
          style={{
            display: "flex",
            flexShrink: 0,
            alignItems: "center",
            gap: 4,
            // Along the rail for arrows, across it for a bar — the storefront rule.
            flexDirection: thumbNavAlongRail ? "row" : "column",
          }}
        >
          {thumbNav === "arrows" ? thumbArrow : null}
        <div
          style={{
            display: "flex",
            // Holds its width so the scrollbar below cannot widen the whole card.
            flexShrink: 0,
            flexDirection: isStacked ? "row" : "column",
            gap: 6,
            ...(isStacked
              ? { overflowX: "auto" }
              : { maxHeight: 240, overflowY: "auto" }),
          }}
        >
          {images.map((image, index) => (
            <button
              key={image.id}
              type="button"
              onClick={() => selectImage(index)}
              aria-current={index === activeIndex}
              style={{
                flex: "0 0 auto",
                width: thumbSize,
                padding: 0,
                overflow: "hidden",
                cursor: "pointer",
                background: showsPreviewCaption(options) ? "#ffffff" : "#cabdf2",
                border:
                  index === activeIndex ? "2px solid #6c4fc7" : "1px solid #d8cdf5",
                display: "flex",
                flexDirection: "column",
                ...thumbShapeStyle(options.thumbnailShape, thumbSize),
              }}
            >
              <span
                style={{
                  position: "relative",
                  width: "100%",
                  height: thumbSize,
                  flex: "0 0 auto",
                  lineHeight: 0,
                }}
              >
                {image.url ? (
                  <img
                    src={image.url}
                    alt={image.alt ?? ""}
                    style={{
                      width: "100%",
                      height: thumbSize,
                      objectFit: "cover",
                      display: "block",
                    }}
                  />
                ) : (
                  <PendingMedia style={{ width: "100%", height: thumbSize }} />
                )}
                {isPlayableMedia(image) ? (
                  <PlayBadge size={Math.round(thumbSize / 2.5)} />
                ) : null}
              </span>
              {showsPreviewCaption(options) && image.alt ? (
                <span
                  style={{
                    fontSize: 9,
                    lineHeight: 1.3,
                    padding: "4px 3px",
                    color: "#333333",
                    textAlign: options.thumbnailShape === "card" ? "left" : "center",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    wordBreak: "break-word",
                  }}
                >
                  {image.alt}
                </span>
              ) : null}
            </button>
          ))}
        </div>
          {thumbNav === "arrows" ? thumbArrow : null}
          {thumbNav === "scrollbar" ? thumbScrollBar : null}
        </div>
      ) : null}

      {options.stageLayout === "carousel" ? (
        // A static row standing in for the scrolling track — the mock does not scroll,
        // and the drag bar below it is likewise indicative only.
        <div
          style={{
            ...stageStyle,
            aspectRatio: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            background: "transparent",
          }}
        >
        <div style={{ display: "flex", gap: 6 }}>
          {images.slice(0, options.carouselPerView).map((image) => (
            <div
              key={image.id}
              style={{
                flex: `0 0 calc((100% - ${(options.carouselPerView - 1) * 6}px) / ${options.carouselPerView})`,
                aspectRatio: "1 / 1",
                borderRadius: 8,
                overflow: "hidden",
                background: "linear-gradient(135deg, #d9cffb, #b9a4ee)",
              }}
            >
              {image.url ? (
                <img
                  src={image.url}
                  alt={image.alt ?? ""}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: "block",
                  }}
                />
              ) : (
                <PendingMedia style={{ width: "100%", height: "100%" }} />
              )}
              {isPlayableMedia(image) ? <PlayBadge size={28} /> : null}
            </div>
          ))}
        </div>
          {options.carouselNavigation !== "arrows" ? (
            <div
              style={{
                position: "relative",
                height: 5,
                borderRadius: 999,
                background: "rgba(18, 18, 18, 0.1)",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: 0,
                  width: `${Math.min(100, (options.carouselPerView / Math.max(images.length, options.carouselPerView)) * 100)}%`,
                  borderRadius: 999,
                  background: "#6c4fc7",
                }}
              />
            </div>
          ) : null}
          {zoomDot}
        </div>
      ) : (
      <div style={stageStyle}>
        <style>{TRANSITION_KEYFRAMES}</style>
        {active && !active.url ? (
          <PendingMedia style={{ width: "100%", height: "100%" }} />
        ) : null}
        {active && active.url ? (
          // Keyed on the transition settings as well as the index, so changing the
          // dropdown or the speed replays it immediately instead of waiting for the
          // next thumbnail click.
          <img
            key={`${activeIndex}-${options.imageTransition}-${options.transitionSpeed}`}
            className="gn-preview-stage-image"
            src={active.url}
            alt={active.alt ?? ""}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
              animationName: animationName(options.imageTransition, forward),
              animationDuration: `${options.transitionSpeed}ms`,
              animationTimingFunction: "ease",
            }}
          />
        ) : null}
        {active && isPlayableMedia(active) ? <PlayBadge size={44} /> : null}
        {zoomDot}
      </div>
      )}
    </div>
  );
}
