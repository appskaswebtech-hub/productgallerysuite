import prisma from "./db.server";
import { appSettingsFromRow, type AppSettings } from "./app-settings";
import { normalizeLocale, type SupportedLocale } from "./i18n/languages";

export const getAppSettings = async (shop: string): Promise<AppSettings> => {
  const setting = await prisma.productSliderSetting.findUnique({ where: { shop } });
  return appSettingsFromRow(setting);
};

/**
 * Writes only the app-level settings columns. Prisma's `update` touches just the
 * fields supplied, so `products` / `productIds` and every dashboard-owned field
 * are left untouched.
 */
export const saveAppSettings = async (shop: string, values: AppSettings) => {
  await prisma.productSliderSetting.upsert({
    where: { shop },
    create: { shop, ...values },
    update: { ...values },
  });

  return values;
};

/**
 * Locale for server-rendered copy: an explicit `?locale=` wins, otherwise fall
 * back to the shop's saved default. `detectLocaleFromRequest` only knows about
 * the query param, so it can't do the second half on its own.
 */
export const resolveLocale = async (
  request: Request,
  shop: string,
): Promise<SupportedLocale> => {
  const requested = new URL(request.url).searchParams.get("locale");
  if (requested) return normalizeLocale(requested);

  const setting = await prisma.productSliderSetting.findUnique({
    where: { shop },
    select: { defaultLocale: true },
  });

  return normalizeLocale(setting?.defaultLocale);
};
