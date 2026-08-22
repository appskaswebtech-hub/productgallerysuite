/**
 * Gallery analytics vocabulary — event types, ranges and the shapes the report takes.
 *
 * Pure module — no Prisma, safe to import from client code. The Analytics page renders
 * the range picker and metric columns in the browser, so these cannot live in
 * `./analytics.server`, which React Router strips from the client bundle.
 */

/** The only event types the endpoint accepts; anything else is discarded. */
export const EVENT_TYPES = [
  "gallery_view",
  "image_view",
  "zoom",
  "lightbox_open",
] as const;

export type GalleryEventType = (typeof EVENT_TYPES)[number];

/**
 * Ceiling on a single flush. A genuine session cannot produce this many, so anything
 * above it is a tampered or repeated payload and is clamped rather than rejected —
 * silently dropping the whole batch would lose the legitimate events alongside it.
 */
export const MAX_EVENTS_PER_FLUSH = 500;

/** Windows the Analytics page offers. Anything else in `?days=` is coerced away. */
export const ANALYTICS_RANGES = [7, 30, 90] as const;

export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export type EventCounts = Record<GalleryEventType, number>;

export type AnalyticsReport = {
  totals: EventCounts;
  /** One entry per day in the window, including days with no activity. */
  daily: Array<{ day: string; counts: EventCounts }>;
  /** Every product with recorded activity, busiest first. */
  products: Array<{ productId: string; counts: EventCounts }>;
};

/** UTC day key. Shops span timezones; one basis keeps the counters comparable. */
export const utcDay = (date = new Date()) => date.toISOString().slice(0, 10);

export const isEventType = (value: string): value is GalleryEventType =>
  (EVENT_TYPES as readonly string[]).includes(value);

export const safeRange = (value: unknown): AnalyticsRange => {
  const parsed = Number(value);
  return (ANALYTICS_RANGES as readonly number[]).includes(parsed)
    ? (parsed as AnalyticsRange)
    : 30;
};

export const emptyCounts = (): EventCounts =>
  Object.fromEntries(EVENT_TYPES.map((type) => [type, 0])) as EventCounts;

/** Every UTC day in the window, oldest first, so the chart can show gaps as gaps. */
export const daysInRange = (days: number) => {
  const out: string[] = [];
  const cursor = new Date();
  cursor.setUTCDate(cursor.getUTCDate() - (days - 1));

  for (let i = 0; i < days; i += 1) {
    out.push(utcDay(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return out;
};

/**
 * Coerces an untrusted `{ [eventType]: count }` object into known types and sane
 * counts. Returns only entries worth writing.
 */
export const sanitizeEventCounts = (raw: unknown) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];

  return Object.entries(raw as Record<string, unknown>).flatMap(([type, value]) => {
    if (!isEventType(type)) return [];

    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed) || parsed <= 0) return [];

    return [{ type, count: Math.min(parsed, MAX_EVENTS_PER_FLUSH) }];
  });
};
