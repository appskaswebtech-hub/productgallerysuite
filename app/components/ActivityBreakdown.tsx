import { useLanguage } from "../i18n/LanguageContext";
import { tint } from "./StatCard";

/**
 * Relative size of each event type, as horizontal bars.
 *
 * Deliberately *not* a funnel. The four metrics do not decrease in step: the storefront
 * fires `gallery_view` once when a gallery boots, `image_view` on every image change and
 * `zoom` on every stage mouseenter when hover-zoom is on, so image views routinely
 * exceed gallery views. Bars are scaled to the largest value and carry raw counts only —
 * a drop-off percentage between these series would be meaningless.
 *
 * Each bar wears its own metric's hue, supplied by the caller so a metric looks the same
 * here as on its stat tile. Those hues are a validated categorical palette — see the note
 * on `METRICS` in `app.analytics.tsx` for what was checked and why the previous set was
 * barred from charts. Two of the four fall below 3:1 against this surface, which is legal
 * only because every row is named in text with its count beside it: **that label is the
 * relief the palette depends on, not decoration.**
 */

/** Neutral fallback for a caller that supplies no accent. */
const SERIES = "#6c4fc7";
const INK = "#1c1730";
const INK_MUTED = "#6d6d7a";
const EMPTY_BORDER = "#e6e0f7";

/** The bar's own hue, lightened, so each track belongs to its metric. */
const trackFor = (accent: string) => tint(accent, 0.14);

export function ActivityBreakdown({
  rows,
}: {
  rows: Array<{ label: string; value: number; accent?: string }>;
}) {
  const { t } = useLanguage();

  const peak = Math.max(...rows.map((row) => row.value), 0);

  if (!rows.length || peak === 0) {
    return (
      <div
        style={{
          border: `1px dashed ${EMPTY_BORDER}`,
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
      {rows.map((row) => {
        const accent = row.accent ?? SERIES;

        return (
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
              {/* A dot in the metric's hue ties the row to its stat tile. The name still
                  carries the identity — the dot is the second encoding, never the only one,
                  which is what lets two of these hues sit under 3:1 on this surface. */}
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  color: INK_MUTED,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: accent,
                    flex: "0 0 auto",
                  }}
                />
                {row.label}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: INK }}>
                {row.value}
              </span>
            </div>
            <div
              style={{
                height: 10,
                borderRadius: 999,
                background: trackFor(accent),
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
                  background: accent,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
