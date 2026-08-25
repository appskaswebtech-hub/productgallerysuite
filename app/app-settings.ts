import {
  DEFAULT_LOCALE,
  normalizeLocale,
  type SupportedLocale,
} from "./i18n/languages";

/**
 * App-wide settings — the ones that are not configurable per product. Everything
 * about how the slider and zoom look and behave lives in `./slider-options`.
 *
 * Pure module — no Prisma, safe to import from client code.
 */
export type AppSettings = {
  appEnabled: boolean;
  defaultLocale: SupportedLocale;
  lazyLoadImages: boolean;
  accentColor: string;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  appEnabled: true,
  defaultLocale: DEFAULT_LOCALE,
  lazyLoadImages: true,
  accentColor: "#111111",
};

export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const safeAccentColor = (value: string | null | undefined) =>
  value && HEX_COLOR.test(value)
    ? value.toLowerCase()
    : DEFAULT_APP_SETTINGS.accentColor;

/**
 * Only the app-level columns, structurally typed rather than imported from Prisma so this
 * module stays free of the client and safe to import from browser code.
 */
type SettingRow = {
  appEnabled?: boolean | null;
  defaultLocale?: string | null;
  lazyLoadImages?: boolean | null;
  accentColor?: string | null;
};

/** Applies defaults to a (possibly missing) ProductSliderSetting row. */
export const appSettingsFromRow = (
  row: SettingRow | null | undefined,
): AppSettings => ({
  appEnabled: row?.appEnabled ?? DEFAULT_APP_SETTINGS.appEnabled,
  defaultLocale: normalizeLocale(row?.defaultLocale),
  lazyLoadImages: row?.lazyLoadImages ?? DEFAULT_APP_SETTINGS.lazyLoadImages,
  accentColor: safeAccentColor(row?.accentColor),
});

/** Reads and validates the app settings out of a submitted settings form. */
export const appSettingsFromFormData = (formData: FormData): AppSettings => ({
  appEnabled: formData.get("appEnabled") === "on",
  defaultLocale: normalizeLocale(formData.get("defaultLocale")?.toString()),
  lazyLoadImages: formData.get("lazyLoadImages") === "on",
  accentColor: safeAccentColor(formData.get("accentColor")?.toString()),
});
