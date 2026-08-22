import { useLanguage } from "../i18n/LanguageContext";

/**
 * Relative size of each event type, as horizontal bars.
 *
 * Deliberately *not* a funnel. The four metrics do not decrease in step: the storefront
 * fires `gallery_view` once when a gallery boots, `image_view` on every image change and
 * `zoom` on every stage mouseenter when hover-zoom is on, so image views routinely
 * exceed gallery views. Bars are scaled to the largest value and carry raw counts only —
 * a drop-off percentage between these series would be meaningless.
 *
 * One hue, for the reason spelled out in `AnalyticsChart`: the four stat-card accents
 * fail a colour-blindness check as a data palette. Every row is named in text, so
 * nothing here depends on colour.
 */

const SERIES = "#6c4fc7";
const TRACK = "#f1ecfd";
const INK = "#1c1730";
const INK_MUTED = "#6d6d7a";

export function ActivityBreakdown({
  rows,
}: {
  rows: Array<{ label: string; value: number }>;
}) {
  const { t } = useLanguage();

  const peak = Math.max(...rows.map((row) => row.value), 0);

  if (!rows.length || peak === 0) {
    return (
      <div
        style={{
          border: `1px dashed ${TRACK}`,
          borderRadius: 8,
          padding: "28px 16px",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: INK }}>
          {t("analytics.noData")}
        </div>
        <div style={{ fontSize: 12, color: INK_MUTED, marginTop: 4 }}>
          {t("analytics.emptyHint")}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {rows.map((row) => (
        <div key={row.label}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 12,
              marginBottom: 4,
            }}
          >
            <span style={{ fontSize: 12, color: INK_MUTED }}>{row.label}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: INK }}>
              {row.value}
            </span>
          </div>
          <div
            style={{
              height: 8,
              borderRadius: 999,
              background: TRACK,
              overflow: "hidden",
            }}
          >
            {/* A zero row keeps the empty track rather than a sliver, since the count
                beside it already says zero. */}
            <div
              style={{
                height: "100%",
                width: `${(row.value / peak) * 100}%`,
                borderRadius: 999,
                background: SERIES,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
