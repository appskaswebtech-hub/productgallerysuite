-- AlterTable
ALTER TABLE "ProductSliderSetting" ADD COLUMN "appEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ProductSliderSetting" ADD COLUMN "defaultLocale" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "ProductSliderSetting" ADD COLUMN "zoomOnHover" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ProductSliderSetting" ADD COLUMN "zoomLevel" INTEGER NOT NULL DEFAULT 200;
ALTER TABLE "ProductSliderSetting" ADD COLUMN "loopSlides" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ProductSliderSetting" ADD COLUMN "keyboardNavigation" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ProductSliderSetting" ADD COLUMN "replaceThemeGallery" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ProductSliderSetting" ADD COLUMN "lazyLoadImages" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ProductSliderSetting" ADD COLUMN "accentColor" TEXT NOT NULL DEFAULT '#111111';
