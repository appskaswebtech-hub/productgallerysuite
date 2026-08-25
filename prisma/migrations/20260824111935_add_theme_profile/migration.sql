-- AlterTable: which theme's gallery markup to target, and the merchant's own selector.
--
-- Deliberately two plain ADD COLUMNs rather than the table rebuild Prisma first generated
-- for this. That rebuild recreated ProductSliderSetting with the *entire* schema, including
-- eight columns that later migrations (20260825 onward) add themselves — so replaying the
-- history from scratch failed with "duplicate column name: imageTransition" and blocked
-- every subsequent migration. Adding only what this migration is about keeps the history
-- replayable.
ALTER TABLE "ProductSliderSetting" ADD COLUMN "themeProfile" TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE "ProductSliderSetting" ADD COLUMN "customGallerySelector" TEXT NOT NULL DEFAULT '';
