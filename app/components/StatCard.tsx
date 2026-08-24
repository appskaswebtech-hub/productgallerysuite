import type { CSSProperties, ReactNode } from "react";

const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
  gap: 10,
};

/**
 * `accent` mixed with white, `weight` being the accent's share (0-1).
 *
 * Computed here rather than with CSS `color-mix()` on purpose: an unsupported `color-mix`
 * makes the whole declaration invalid, which would leave these cards with *no* background
 * — showing the grey page through them — instead of falling back to white. A resolved
 * `rgb()` has no such cliff.
 */
export const tint = (accent: string, weight: number) => {
  const hex = accent.replace("#", "");
  if (hex.length !== 6) return "#ffffff";

  const channel = (start: number) => {
    const value = parseInt(hex.slice(start, start + 2), 16);
    return Number.isNaN(value) ? 255 : Math.round(value * weight + 255 * (1 - weight));
  };

  return `rgb(${channel(0)}, ${channel(2)}, ${channel(4)})`;
};

/**
 * A tint of the card's own accent, plus a solid edge in that accent.
 *
 * The tint is kept very light on purpose: the value and label sit on this surface as dark
 * ink, so the background has to stay far enough from them to keep text contrast. The accent
 * earns its visibility from the 3px edge, which is a mark rather than a text background and
 * so is not bound by the text-contrast floor.
 */
const cardStyle = (accent: string): CSSProperties => ({
  borderLeft: `3px solid ${accent}`,
  borderRadius: 8,
  background: tint(accent, 0.07),
  boxShadow: "0 1px 6px rgba(60, 30, 110, 0.05)",
  padding: "12px 14px",
  minHeight: 96,
  display: "flex",
  flexDirection: "column",
  gap: 4,
});

/**
 * Two lines are reserved whether or not the label needs them, so every value in a row
 * lands on the same baseline — "Zooms" and "Full-screen opens" must not push their
 * numbers to different heights. Clamping rather than `nowrap` + ellipsis keeps the long
 * translations readable: Spanish "Aperturas a pantalla completa" loses its tail instead
 * of every label being truncated to fit the shortest column.
 */
const labelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  // Neutral muted ink, not the old purple-tinted one: these cards now come in four hues,
  // and a violet-cast label reads as a mistake on the orange and aqua tints. It is also
  // darker, which lifts this 11px label clear of the contrast floor it was sitting on.
  color: "#5c5866",
  lineHeight: 1.25,
  minHeight: "2.5em",
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

const valueStyle: CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  lineHeight: 1.2,
  color: "#1c1730",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const captionStyle: CSSProperties = {
  fontSize: 11,
  // Neutral muted ink, not the old purple-tinted one: these cards now come in four hues,
  // and a violet-cast label reads as a mistake on the orange and aqua tints. It is also
  // darker, which lifts this 11px label clear of the contrast floor it was sitting on.
  color: "#5c5866",
  lineHeight: 1.2,
};

export function StatGrid({ children }: { children: ReactNode }) {
  return <div style={gridStyle}>{children}</div>;
}

/**
 * Label and value are plain spans on purpose: `s-text` and `s-heading` own their
 * typography in shadow DOM and ignore an external font size, and a metric value was
 * never a section heading anyway. Anything that belongs under the value — a usage bar,
 * an `s-link`, an `s-badge` — comes in as children and is pinned to the card's bottom
 * edge so it aligns across the row.
 */
export function StatCard({
  accent,
  label,
  value,
  caption,
  children,
}: {
  accent: string;
  label: ReactNode;
  value?: ReactNode;
  /** Small muted line under the value — for a qualifier too long to sit inside it. */
  caption?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div style={cardStyle(accent)}>
      <span style={labelStyle}>{label}</span>
      {value === undefined ? null : <span style={valueStyle}>{value}</span>}
      {caption === undefined ? null : <span style={captionStyle}>{caption}</span>}
      {children === undefined ? null : (
        <div
          style={{
            marginTop: "auto",
            paddingTop: 6,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
