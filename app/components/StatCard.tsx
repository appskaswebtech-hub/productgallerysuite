import type { CSSProperties, ReactNode } from "react";

const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
  gap: 10,
};

const cardStyle = (accent: string): CSSProperties => ({
  borderTop: `2px solid ${accent}`,
  borderRadius: 8,
  background: "#ffffff",
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
  color: "#8a7bb5",
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
  color: "#8a7bb5",
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
