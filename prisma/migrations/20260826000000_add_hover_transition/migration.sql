-- AlterTable: hover cycling gets its own transition, independent of click-driven moves
ALTER TABLE "ProductSliderSetting" ADD COLUMN "hoverTransition" TEXT NOT NULL DEFAULT 'fade';
