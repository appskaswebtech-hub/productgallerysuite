/**
 * Gallery interaction analytics — the database half.
 *
 * Storefront events arrive batched and are folded into per-day counters rather than
 * stored individually — `GalleryStat` holds one row per shop + product + day + event
 * type however much traffic a shop gets. Nothing identifying a shopper is recorded.
 *
 * The vocabulary (event types, ranges, report shapes) lives in `./analytics` so the
 * Analytics page can import it client-side.
 */

import prisma from "./db.server";
import {
  daysInRange,
  emptyCounts,
  isEventType,
  utcDay,
  type AnalyticsReport,
  type GalleryEventType,
} from "./analytics";

export {
  ANALYTICS_RANGES,
  EVENT_TYPES,
  MAX_EVENTS_PER_FLUSH,
  isEventType,
  safeRange,
  sanitizeEventCounts,
  utcDay,
  type AnalyticsRange,
  type AnalyticsReport,
  type EventCounts,
  type GalleryEventType,
} from "./analytics";

/** Folds a batch into the day's counters, creating rows on first sight. */
export const recordEvents = async (
  shop: string,
  productId: string,
  counts: Array<{ type: GalleryEventType; count: number }>,
) => {
  const day = utcDay();

  await Promise.all(
    counts.map(({ type, count }) =>
      prisma.galleryStat.upsert({
        where: {
          shop_productId_day_eventType: { shop, productId, day, eventType: type },
        },
        create: { shop, productId, day, eventType: type, count },
        update: { count: { increment: count } },
      }),
    ),
  );
};

/**
 * Totals, a per-day series and a per-product breakdown — all folded from a single
 * read, so the extra depth costs no extra query.
 */
export const getAnalyticsReport = async (
  shop: string,
  days: number = 30,
): Promise<AnalyticsReport> => {
  const window = daysInRange(days);

  const rows = await prisma.galleryStat.findMany({
    where: { shop, day: { gte: window[0] } },
    select: { productId: true, day: true, eventType: true, count: true },
  });

  const totals = emptyCounts();
  const byDay = new Map(window.map((day) => [day, emptyCounts()]));
  const byProduct = new Map<string, ReturnType<typeof emptyCounts>>();

  for (const row of rows) {
    if (!isEventType(row.eventType)) continue;

    totals[row.eventType] += row.count;

    // Rows outside the window are already excluded by the query, but a day key that
    // is not in the map would silently vanish — skip rather than create a stray day.
    const day = byDay.get(row.day);
    if (day) day[row.eventType] += row.count;

    let product = byProduct.get(row.productId);
    if (!product) {
      product = emptyCounts();
      byProduct.set(row.productId, product);
    }
    product[row.eventType] += row.count;
  }

  return {
    totals,
    daily: window.map((day) => ({ day, counts: byDay.get(day) ?? emptyCounts() })),
    // Gallery views are the fair basis for "busiest" — image views scale with how many
    // images a product happens to have, which says nothing about shopper interest.
    products: [...byProduct.entries()]
      .map(([productId, counts]) => ({ productId, counts }))
      .sort((a, b) => b.counts.gallery_view - a.counts.gallery_view),
  };
};
