-- AlterTable: which axis hover-navigation splits the image on to pick a direction
ALTER TABLE "ProductSliderSetting" ADD COLUMN "hoverNavigationAxis" TEXT NOT NULL DEFAULT 'horizontal';
