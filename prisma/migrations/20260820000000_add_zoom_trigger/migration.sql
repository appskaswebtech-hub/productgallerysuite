-- AlterTable: replace the zoomOnHover boolean with a three-way zoomTrigger mode
ALTER TABLE "ProductSliderSetting" ADD COLUMN "zoomTrigger" TEXT NOT NULL DEFAULT 'hover';
UPDATE "ProductSliderSetting" SET "zoomTrigger" = 'off' WHERE "zoomOnHover" = false;
ALTER TABLE "ProductSliderSetting" DROP COLUMN "zoomOnHover";
