-- CreateTable: aggregated gallery interactions, counters only — no shopper data
CREATE TABLE "GalleryStat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- The upsert target: one counter per shop + product + day + event type.
CREATE UNIQUE INDEX "GalleryStat_shop_productId_day_eventType_key" ON "GalleryStat"("shop", "productId", "day", "eventType");

-- Serves the dashboard's "last N days for this shop" read.
CREATE INDEX "GalleryStat_shop_day_idx" ON "GalleryStat"("shop", "day");
