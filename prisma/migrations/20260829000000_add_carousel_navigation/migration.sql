-- AlterTable: what the shopper uses to move a carousel — arrows, a drag bar, or both
ALTER TABLE "ProductSliderSetting" ADD COLUMN "carouselNavigation" TEXT NOT NULL DEFAULT 'arrows';
