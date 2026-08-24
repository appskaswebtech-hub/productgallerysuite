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
/**
 * Which theme's gallery markup to target.
 *
 * `auto` is the historical behaviour — try a union of known selectors, then match images by
 * URL — and stays the default. The named profiles only add a first pass of selectors ahead
 * of that, so picking the wrong one degrades to `auto` rather than breaking the gallery.
 *
 * `custom` hands the selector to the merchant, which is what makes themes nobody has
 * enumerated here work at all.
 */
export const THEME_PROFILES = [
  "auto",
  "horizon",
  "dawn",
  "impulse",
  "debut",
  "prestige",
  "custom",
] as const;

export type ThemeProfile = (typeof THEME_PROFILES)[number];

/** One runaway selector should not be able to bloat the settings row. */
export const MAX_GALLERY_SELECTOR_LENGTH = 200;

export type AppSettings = {
  appEnabled: boolean;
  defaultLocale: SupportedLocale;
  lazyLoadImages: boolean;
  accentColor: string;
  themeProfile: ThemeProfile;
  /** Only consulted when `themeProfile` is `custom`. */
  customGallerySelector: string;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  appEnabled: true,
  defaultLocale: DEFAULT_LOCALE,
  lazyLoadImages: true,
  accentColor: "#111111",
  themeProfile: "auto",
  customGallerySelector: "",
};

export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const safeAccentColor = (value: string | null | undefined) =>
  value && HEX_COLOR.test(value)
    ? value.toLowerCase()
    : DEFAULT_APP_SETTINGS.accentColor;

/**
 * Falls back to `auto` rather than trusting the stored string. A profile hand-edited in the
 * database, or left behind by a future rename, would otherwise reach the storefront and
 * select nothing.
 */
const safeThemeProfile = (value: string | null | undefined): ThemeProfile =>
  THEME_PROFILES.includes(value as ThemeProfile)
    ? (value as ThemeProfile)
    : DEFAULT_APP_SETTINGS.themeProfile;

const safeGallerySelector = (value: string | null | undefined) =>
  typeof value === "string" ? value.trim().slice(0, MAX_GALLERY_SELECTOR_LENGTH) : "";

type SettingRow = {
  appEnabled?: boolean | null;
  defaultLocale?: string | null;
  lazyLoadImages?: boolean | null;
  accentColor?: string | null;
  themeProfile?: string | null;
  customGallerySelector?: string | null;
};

/** Applies defaults to a (possibly missing) ProductSliderSetting row. */
export const appSettingsFromRow = (
  row: SettingRow | null | undefined,
): AppSettings => ({
  appEnabled: row?.appEnabled ?? DEFAULT_APP_SETTINGS.appEnabled,
  defaultLocale: normalizeLocale(row?.defaultLocale),
  lazyLoadImages: row?.lazyLoadImages ?? DEFAULT_APP_SETTINGS.lazyLoadImages,
  accentColor: safeAccentColor(row?.accentColor),
  themeProfile: safeThemeProfile(row?.themeProfile),
  customGallerySelector: safeGallerySelector(row?.customGallerySelector),
});

/** Reads and validates the app settings out of a submitted settings form. */
export const appSettingsFromFormData = (formData: FormData): AppSettings => ({
  appEnabled: formData.get("appEnabled") === "on",
  defaultLocale: normalizeLocale(formData.get("defaultLocale")?.toString()),
  lazyLoadImages: formData.get("lazyLoadImages") === "on",
  accentColor: safeAccentColor(formData.get("accentColor")?.toString()),
  themeProfile: safeThemeProfile(formData.get("themeProfile")?.toString()),
  customGallerySelector: safeGallerySelector(
    formData.get("customGallerySelector")?.toString(),
  ),
});
