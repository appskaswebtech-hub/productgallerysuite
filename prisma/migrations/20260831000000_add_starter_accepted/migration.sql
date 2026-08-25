-- Records that a merchant actively subscribed to the free Starter plan.
--
-- Written by hand as a plain ALTER rather than generated: `prisma migrate dev` has twice
-- emitted a RedefineTables rebuild for this project, which drops and recreates the table and
-- has broken the migration history before. A nullable column needs no rebuild.
ALTER TABLE "ShopBilling" ADD COLUMN "starterAcceptedAt" DATETIME;
