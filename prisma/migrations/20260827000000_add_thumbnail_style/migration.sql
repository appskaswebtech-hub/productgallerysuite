-- AlterTable: thumbnail framing and what a thumbnail does under the cursor
ALTER TABLE "ProductSliderSetting" ADD COLUMN "thumbnailShape" TEXT NOT NULL DEFAULT 'square';
ALTER TABLE "ProductSliderSetting" ADD COLUMN "thumbnailHoverEffect" TEXT NOT NULL DEFAULT 'none';
