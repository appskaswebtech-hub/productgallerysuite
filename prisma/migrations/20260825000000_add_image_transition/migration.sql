-- AlterTable: how the stage image changes when moving to another image, and how long it takes
ALTER TABLE "ProductSliderSetting" ADD COLUMN "imageTransition" TEXT NOT NULL DEFAULT 'fade';
ALTER TABLE "ProductSliderSetting" ADD COLUMN "transitionSpeed" INTEGER NOT NULL DEFAULT 300;
