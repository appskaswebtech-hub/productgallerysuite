-- AlterTable: hover-to-navigate the slider, with a configurable cycling speed
ALTER TABLE "ProductSliderSetting" ADD COLUMN "hoverNavigation" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ProductSliderSetting" ADD COLUMN "hoverNavigationSpeed" INTEGER NOT NULL DEFAULT 1200;
