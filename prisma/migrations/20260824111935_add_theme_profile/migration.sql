-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ProductSliderSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productIds" TEXT NOT NULL DEFAULT '[]',
    "products" TEXT NOT NULL DEFAULT '[]',
    "stageLayout" TEXT NOT NULL DEFAULT 'single',
    "carouselPerView" INTEGER NOT NULL DEFAULT 3,
    "carouselNavigation" TEXT NOT NULL DEFAULT 'arrows',
    "thumbnailPosition" TEXT NOT NULL DEFAULT 'left',
    "thumbnailSize" INTEGER NOT NULL DEFAULT 76,
    "thumbnailShape" TEXT NOT NULL DEFAULT 'square',
    "thumbnailHoverEffect" TEXT NOT NULL DEFAULT 'none',
    "syncVariantImages" BOOLEAN NOT NULL DEFAULT true,
    "hideThumbnails" BOOLEAN NOT NULL DEFAULT false,
    "hideZoomIcon" BOOLEAN NOT NULL DEFAULT false,
    "zoomIconPosition" TEXT NOT NULL DEFAULT 'top-right',
    "previousArrowSvg" TEXT NOT NULL DEFAULT '',
    "nextArrowSvg" TEXT NOT NULL DEFAULT '',
    "zoomIconSvg" TEXT NOT NULL DEFAULT '',
    "appEnabled" BOOLEAN NOT NULL DEFAULT true,
    "defaultLocale" TEXT NOT NULL DEFAULT 'en',
    "zoomTrigger" TEXT NOT NULL DEFAULT 'hover',
    "zoomLevel" INTEGER NOT NULL DEFAULT 200,
    "loopSlides" BOOLEAN NOT NULL DEFAULT true,
    "keyboardNavigation" BOOLEAN NOT NULL DEFAULT true,
    "replaceThemeGallery" BOOLEAN NOT NULL DEFAULT true,
    "lazyLoadImages" BOOLEAN NOT NULL DEFAULT true,
    "accentColor" TEXT NOT NULL DEFAULT '#111111',
    "hoverNavigation" BOOLEAN NOT NULL DEFAULT false,
    "hoverNavigationSpeed" INTEGER NOT NULL DEFAULT 1200,
    "hoverNavigationAxis" TEXT NOT NULL DEFAULT 'horizontal',
    "hoverNavigationInvert" BOOLEAN NOT NULL DEFAULT false,
    "imageTransition" TEXT NOT NULL DEFAULT 'fade',
    "hoverTransition" TEXT NOT NULL DEFAULT 'fade',
    "transitionSpeed" INTEGER NOT NULL DEFAULT 300,
    "themeProfile" TEXT NOT NULL DEFAULT 'auto',
    "customGallerySelector" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ProductSliderSetting" ("accentColor", "appEnabled", "carouselNavigation", "carouselPerView", "createdAt", "defaultLocale", "hideThumbnails", "hideZoomIcon", "hoverNavigation", "hoverNavigationAxis", "hoverNavigationInvert", "hoverNavigationSpeed", "hoverTransition", "id", "imageTransition", "keyboardNavigation", "lazyLoadImages", "loopSlides", "nextArrowSvg", "previousArrowSvg", "productIds", "products", "replaceThemeGallery", "shop", "stageLayout", "syncVariantImages", "thumbnailHoverEffect", "thumbnailPosition", "thumbnailShape", "thumbnailSize", "transitionSpeed", "updatedAt", "zoomIconPosition", "zoomIconSvg", "zoomLevel", "zoomTrigger") SELECT "accentColor", "appEnabled", "carouselNavigation", "carouselPerView", "createdAt", "defaultLocale", "hideThumbnails", "hideZoomIcon", "hoverNavigation", "hoverNavigationAxis", "hoverNavigationInvert", "hoverNavigationSpeed", "hoverTransition", "id", "imageTransition", "keyboardNavigation", "lazyLoadImages", "loopSlides", "nextArrowSvg", "previousArrowSvg", "productIds", "products", "replaceThemeGallery", "shop", "stageLayout", "syncVariantImages", "thumbnailHoverEffect", "thumbnailPosition", "thumbnailShape", "thumbnailSize", "transitionSpeed", "updatedAt", "zoomIconPosition", "zoomIconSvg", "zoomLevel", "zoomTrigger" FROM "ProductSliderSetting";
DROP TABLE "ProductSliderSetting";
ALTER TABLE "new_ProductSliderSetting" RENAME TO "ProductSliderSetting";
CREATE UNIQUE INDEX "ProductSliderSetting_shop_key" ON "ProductSliderSetting"("shop");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
