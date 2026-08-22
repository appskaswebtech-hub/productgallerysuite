import { useLanguage } from "../i18n/LanguageContext";

/**
 * Daily trend of a single metric, as hand-rolled inline SVG — Polaris ships no chart
 * component.
 *
 * Deliberately one series in one hue. The app's four stat-card accents fail a
 * colour-blindness check as a *data* palette (blue and purple sit at ΔE 14.9 for normal
 * vision, below the 15 floor), so they are safe as labelled card borders but must not
 * become chart series. A single series also needs no legend — the heading names it.
 */

/** Passes the 3:1 contrast floor against the white card surface. */
const SERIES = "#6c4fc7";
const AXIS = "#d8cdf5";
const INK_MUTED = "#6d6d7a";

const CHART_HEIGHT = 160;
const LABEL_BAND = 18;
const BAR_GAP = 2;

/** "2026-08-21" → "21 Aug", for axis and tooltip labels. */
const shortDay = (day: string, locale: string) => {
  const parsed = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(parsed.valueOf())
    ? day
    : parsed.toLocaleDateString(locale, {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      });
};

export function AnalyticsChart({
  points,
  label,
}: {
  points: Array<{ day: string; value: number }>;
  /** Names the series, e.g. "Gallery views" — used in the accessible summary. */
  label: string;
}) {
  const { t, locale } = useLanguage();

  const peak = Math.max(...points.map((point) => point.value), 0);
  const total = points.reduce((sum, point) => sum + point.value, 0);

  // Zero traffic still gets the full frame — baseline, endpoint labels, real height — so
  // the section reads as "nothing yet" rather than as a component that failed to render.
  // No placeholder bars: nothing on this surface should be mistakable for real traffic.
  if (!points.length || total === 0) {
    return (
      <div style={{ width: "100%" }}>
        <div
          style={{
            height: CHART_HEIGHT,
            borderBottom: `1px solid ${AXIS}`,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            padding: "0 16px",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: "#1c1730" }}>
            {t("analytics.noData")}
          </div>
          <div style={{ fontSize: 12, color: INK_MUTED, marginTop: 4 }}>
            {t("analytics.emptyHint")}
          </div>
        </div>

        {points.length ? (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 12,
              color: INK_MUTED,
              marginTop: 4,
            }}
          >
            <span>{shortDay(points[0].day, locale)}</span>
            <span>{shortDay(points[points.length - 1].day, locale)}</span>
          </div>
        ) : null}
      </div>
    );
  }

  const slot = 100 / points.length;

  return (
    <div style={{ width: "100%" }}>
      <svg
        viewBox={`0 0 100 ${CHART_HEIGHT + LABEL_BAND}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label}: ${total} across ${points.length} days, peaking at ${peak}`}
        style={{ width: "100%", height: CHART_HEIGHT + LABEL_BAND, display: "block" }}
      >
        {/* Baseline only — a full grid would compete with the bars. */}
        <line
          x1="0"
          y1={CHART_HEIGHT}
          x2="100"
          y2={CHART_HEIGHT}
          stroke={AXIS}
          strokeWidth="0.5"
          vectorEffect="non-scaling-stroke"
        />

        {points.map((point, index) => {
          // Zero-height bars are kept as a visible sliver so an inactive day reads as
          // a gap in the series rather than a missing bar.
          const height = peak > 0 ? (point.value / peak) * (CHART_HEIGHT - 12) : 0;
          const barWidth = Math.max(slot - BAR_GAP, 0.5);
          const x = index * slot + BAR_GAP / 2;

          return (
            <g key={point.day}>
              <title>{`${shortDay(point.day, locale)} — ${point.value}`}</title>
              <rect
                x={x}
                y={CHART_HEIGHT - Math.max(height, 1)}
                width={barWidth}
                height={Math.max(height, 1)}
                rx="1"
                fill={SERIES}
                opacity={point.value === 0 ? 0.18 : 1}
              />
            </g>
          );
        })}
      </svg>

      {/* Endpoint labels live outside the SVG so preserveAspectRatio="none" cannot
          stretch the type. */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 12,
          color: INK_MUTED,
          marginTop: 4,
        }}
      >
        <span>{shortDay(points[0].day, locale)}</span>
        <span>
          {t("analytics.peakLabel", { count: peak })}
        </span>
        <span>{shortDay(points[points.length - 1].day, locale)}</span>
      </div>
    </div>
  );
}
