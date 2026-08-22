-- AlterTable: the main image area can show one image or a scrolling row of several
ALTER TABLE "ProductSliderSetting" ADD COLUMN "stageLayout" TEXT NOT NULL DEFAULT 'single';
ALTER TABLE "ProductSliderSetting" ADD COLUMN "carouselPerView" INTEGER NOT NULL DEFAULT 3;
