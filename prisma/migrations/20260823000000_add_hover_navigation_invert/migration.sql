-- AlterTable: swap which half of the image moves forward on hover
ALTER TABLE "ProductSliderSetting" ADD COLUMN "hoverNavigationInvert" BOOLEAN NOT NULL DEFAULT false;
