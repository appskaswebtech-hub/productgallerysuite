import { useEffect, useState, type CSSProperties } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  DEFAULT_APP_SETTINGS,
  HEX_COLOR,
  appSettingsFromFormData,
} from "../app-settings";

import { getAppSettings, resolveLocale, saveAppSettings } from "../settings.server";
import { useLanguage } from "../i18n/LanguageContext";
import {
  LANGUAGE_LABELS,
  SUPPORTED_LOCALES,
  normalizeLocale,
} from "../i18n/languages";
import { translate } from "../i18n/translations";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  return getAppSettings(session.shop);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const locale = await resolveLocale(request, session.shop);
  const formData = await request.formData();

  const isReset = formData.get("intent")?.toString() === "reset";

  /**
   * Guarded because an unhandled throw here reaches the ErrorBoundary, which replaces the
   * whole page with "Application Error" and a stack trace — one such crash printed the
   * settings table's column list into the merchant's browser.
   *
   * The exception text deliberately does not reach the toast for that same reason: the
   * merchant gets a readable message, the detail goes to the server log.
   */
  try {
    await saveAppSettings(
      session.shop,
      isReset ? DEFAULT_APP_SETTINGS : appSettingsFromFormData(formData),
    );
  } catch (error) {
    console.error("[settings] save failed", error);

    return { ok: false, message: translate(locale, "settings.toastSaveFailed") };
  }

  return {
    ok: true,
    message: translate(locale, isReset ? "settings.toastReset" : "settings.toastSaved"),
  };
};

export default function Settings() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const { t, locale, setLocale } = useLanguage();

  const [appEnabled, setAppEnabled] = useState(loaderData.appEnabled);
  const [defaultLocale, setDefaultLocale] = useState(loaderData.defaultLocale);
  const [lazyLoadImages, setLazyLoadImages] = useState(loaderData.lazyLoadImages);
  const [accentColor, setAccentColor] = useState(loaderData.accentColor);

  const isSaving = navigation.state === "submitting";
  const isAccentColorValid = HEX_COLOR.test(accentColor);

  useEffect(() => {
    setAppEnabled(loaderData.appEnabled);
    setDefaultLocale(loaderData.defaultLocale);
    setLazyLoadImages(loaderData.lazyLoadImages);
    setAccentColor(loaderData.accentColor);
  }, [
    loaderData.appEnabled,
    loaderData.defaultLocale,
    loaderData.lazyLoadImages,
    loaderData.accentColor,
  ]);

  useEffect(() => {
    if (actionData?.message) {
      shopify.toast.show(actionData.message, { isError: actionData.ok === false });
    }
  }, [actionData, shopify]);

  const cardStyle = (accent: string): CSSProperties => ({
    borderTop: `3px solid ${accent}`,
    borderRadius: 10,
    background: "#ffffff",
    boxShadow: "0 2px 10px rgba(60, 30, 110, 0.06)",
    padding: 14,
  });

  const groupLabelStyle: CSSProperties = {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.03em",
    textTransform: "uppercase",
    color: "#8a7bb5",
  };

  return (
    <s-page heading={t("settings.pageTitle")}>
      <s-link slot="breadcrumb-actions" href="/app">
        {t("nav.dashboard")}
      </s-link>
      <s-link slot="primary-action" href="/app">
        {t("common.back")}
      </s-link>

      <s-section>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 16,
            borderRadius: 14,
            padding: "24px 28px",
            background: "linear-gradient(135deg, #1c1730 0%, #3a2d63 55%, #6c4fc7 100%)",
            boxShadow: "0 8px 24px rgba(45, 24, 90, 0.25)",
            color: "#f6f3ff",
          }}
        >
          <s-stack direction="block" gap="small">
            <span
              style={{
                color: "#ffffff",
                letterSpacing: "0.04em",
                fontSize: 26,
                fontWeight: 700,
              }}
            >
              {t("settings.pageTitle")}
            </span>
            <span style={{ color: "#d8c9ff", fontSize: 13 }}>
              {t("settings.heroTagline")}
            </span>
          </s-stack>

          <s-badge tone={appEnabled ? "success" : "warning"}>
            {appEnabled ? t("settings.statusLive") : t("settings.statusPaused")}
          </s-badge>
        </div>
      </s-section>

      <s-section heading={t("settings.generalGroup")}>
        <div style={cardStyle("#6c4fc7")}>
          <s-stack direction="block" gap="base">
            <span style={groupLabelStyle}>{t("settings.generalGroup")}</span>

            <s-checkbox
              label={t("settings.appEnabled")}
              details={t("settings.appEnabledHelp")}
              checked={appEnabled}
              onChange={(event) => setAppEnabled(event.currentTarget.checked)}
            />

            <s-select
              key={`defaultLocale-${locale}`}
              label={t("settings.defaultLanguage")}
              details={t("settings.defaultLanguageHelp")}
              value={defaultLocale}
              onChange={(event) =>
                setDefaultLocale(normalizeLocale(event.currentTarget.value))
              }
            >
              {SUPPORTED_LOCALES.map((code) => (
                <s-option key={code} value={code}>
                  {LANGUAGE_LABELS[code]}
                </s-option>
              ))}
            </s-select>
          </s-stack>
        </div>
      </s-section>

      <s-section heading={t("settings.performanceGroup")}>
        <div style={cardStyle("#3f8ae0")}>
          <s-stack direction="block" gap="base">
            <span style={groupLabelStyle}>{t("settings.performanceGroup")}</span>

            <s-checkbox
              label={t("settings.lazyLoadImages")}
              details={t("settings.lazyLoadImagesHelp")}
              checked={lazyLoadImages}
              onChange={(event) => setLazyLoadImages(event.currentTarget.checked)}
            />
          </s-stack>
        </div>
      </s-section>

      <s-section heading={t("settings.appearanceGroup")}>
        <div style={cardStyle("#6c4fc7")}>
          <s-stack direction="block" gap="base">
            <span style={groupLabelStyle}>{t("settings.appearanceGroup")}</span>

            <s-stack direction="inline" gap="base" alignItems="center">
              <input
                type="color"
                aria-label={t("settings.accentColor")}
                value={isAccentColorValid ? accentColor : "#111111"}
                onChange={(event) => setAccentColor(event.currentTarget.value)}
                style={{
                  width: 44,
                  height: 44,
                  padding: 0,
                  border: "1px solid #e2d8fb",
                  borderRadius: 8,
                  background: "none",
                  cursor: "pointer",
                }}
              />
              <s-text-field
                label={t("settings.accentColor")}
                details={t("settings.accentColorHelp")}
                value={accentColor}
                error={
                  isAccentColorValid ? undefined : t("settings.accentColorInvalid")
                }
                onInput={(event) => setAccentColor(event.currentTarget.value)}
              />
            </s-stack>
          </s-stack>
        </div>
      </s-section>

      <s-section>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("settings.sliderOptionsMoved")}</s-paragraph>
          <s-link href="/app/products">{t("products.editDefaults")}</s-link>
        </s-stack>
      </s-section>

      <s-section>
        <Form method="post">
          {appEnabled ? <input type="hidden" name="appEnabled" value="on" /> : null}
          <input type="hidden" name="defaultLocale" value={defaultLocale} />
          {lazyLoadImages ? (
            <input type="hidden" name="lazyLoadImages" value="on" />
          ) : null}
          <input type="hidden" name="accentColor" value={accentColor} />
          <s-button
            type="submit"
            variant="primary"
            icon="save"
            disabled={!isAccentColorValid}
            loading={isSaving || undefined}
            onClick={() => setLocale(defaultLocale)}
          >
            {t("settings.saveSettings")}
          </s-button>
        </Form>
      </s-section>

      <s-section heading={t("settings.resetGroup")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("settings.resetIntro")}</s-paragraph>
          <Form method="post">
            <input type="hidden" name="intent" value="reset" />
            <s-button
              type="submit"
              tone="critical"
              variant="secondary"
              loading={isSaving || undefined}
              onClick={() => setLocale(DEFAULT_APP_SETTINGS.defaultLocale)}
            >
              {t("settings.resetButton")}
            </s-button>
          </Form>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
