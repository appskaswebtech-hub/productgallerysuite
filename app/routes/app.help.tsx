import type { CSSProperties } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getCachedBillingPlan, limitProductsForPlan } from "../billing.server";
import { ENTERPRISE_PLAN } from "../billing-plans";
import prisma from "../db.server";
import { StatCard, StatGrid } from "../components/StatCard";
import { useLanguage } from "../i18n/LanguageContext";
import type { TranslationKey } from "../i18n/translations";

const SUPPORT_EMAIL = "support@gallerynest.app";

const STEP_KEYS: { titleKey: TranslationKey; textKey: TranslationKey }[] = [
  { titleKey: "help.step1Title", textKey: "help.step1Text" },
  { titleKey: "help.step2Title", textKey: "help.step2Text" },
  { titleKey: "help.step3Title", textKey: "help.step3Text" },
  { titleKey: "help.step4Title", textKey: "help.step4Text" },
];

const FAQ_KEYS: { questionKey: TranslationKey; answerKey: TranslationKey }[] = [
  { questionKey: "help.faq1Q", answerKey: "help.faq1A" },
  { questionKey: "help.faq2Q", answerKey: "help.faq2A" },
  { questionKey: "help.faq3Q", answerKey: "help.faq3A" },
  { questionKey: "help.faq4Q", answerKey: "help.faq4A" },
  { questionKey: "help.faq5Q", answerKey: "help.faq5A" },
  { questionKey: "help.faq6Q", answerKey: "help.faq6A" },
];

const TROUBLESHOOT_KEYS: TranslationKey[] = [
  "help.troubleshoot1",
  "help.troubleshoot2",
  "help.troubleshoot3",
  "help.troubleshoot4",
];

const parseJsonArray = (value: string | null | undefined): unknown[] => {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [setting, plan] = await Promise.all([
    prisma.productSliderSetting.findUnique({ where: { shop: session.shop } }),
    getCachedBillingPlan(session.shop),
  ]);

  return {
    shop: session.shop,
    plan,
    productCount: limitProductsForPlan(parseJsonArray(setting?.products), plan).length,
    appEnabled: setting?.appEnabled ?? true,
  };
};

export default function Help() {
  const { shop, plan, productCount, appEnabled } = useLoaderData<typeof loader>();
  const { t } = useLanguage();

  const cardStyle = (accent: string): CSSProperties => ({
    borderTop: `3px solid ${accent}`,
    borderRadius: 10,
    background: "#ffffff",
    boxShadow: "0 2px 10px rgba(60, 30, 110, 0.06)",
    padding: 14,
  });

  return (
    <s-page heading={t("help.pageTitle")}>
      <s-link slot="breadcrumb-actions" href="/app">
        {t("help.breadcrumb")}
      </s-link>
      <s-link slot="primary-action" href="/app">
        {t("common.back")}
      </s-link>

      <s-section>
        <div
          style={{
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
              {t("help.pageTitle")}
            </span>
            <span style={{ color: "#d8c9ff", fontSize: 13 }}>
              {t("help.heroTagline")}
            </span>
          </s-stack>
        </div>
      </s-section>

      <s-section heading={t("help.yourSetup")}>
        <StatGrid>
          <StatCard accent="#6c4fc7" label={t("help.setupShop")}>
            <s-text>{shop}</s-text>
          </StatCard>
          <StatCard accent="#3f8ae0" label={t("help.setupPlan")} value={plan}>
            <s-link href="/app/billing">{t("dashboard.manageBilling")}</s-link>
          </StatCard>
          <StatCard
            accent="#2fae87"
            label={t("help.setupProducts")}
            value={productCount}
          >
            <s-link href="/app">{t("help.openDashboard")}</s-link>
          </StatCard>
          <StatCard
            accent={appEnabled ? "#2fae87" : "#d68f2f"}
            label={t("settings.appEnabled")}
          >
            <s-badge tone={appEnabled ? "success" : "warning"}>
              {appEnabled ? t("settings.statusLive") : t("settings.statusPaused")}
            </s-badge>
            <s-link href="/app/settings">{t("help.openSettings")}</s-link>
          </StatCard>
        </StatGrid>
      </s-section>

      <s-section heading={t("help.quickStart")}>
        <s-stack direction="block" gap="base">
          {STEP_KEYS.map((step, index) => (
            <div key={step.titleKey} style={cardStyle("#6c4fc7")}>
              <s-stack direction="inline" gap="base" alignItems="start">
                <span
                  style={{
                    flex: "0 0 auto",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 28,
                    height: 28,
                    borderRadius: 999,
                    background: "linear-gradient(135deg, #6c4fc7, #a084e8)",
                    color: "#ffffff",
                    fontWeight: 700,
                    fontSize: 13,
                  }}
                >
                  {index + 1}
                </span>
                <s-stack direction="block" gap="small">
                  <s-heading>{t(step.titleKey)}</s-heading>
                  <s-text tone="neutral">{t(step.textKey)}</s-text>
                </s-stack>
              </s-stack>
            </div>
          ))}
        </s-stack>
      </s-section>

      <s-section heading={t("help.faq")}>
        <div
          style={{
            borderRadius: 12,
            border: "1px solid #e2d8fb",
            boxShadow: "0 2px 10px rgba(60, 30, 110, 0.06)",
            overflow: "hidden",
          }}
        >
          {FAQ_KEYS.map((faq, index) => (
            <details
              key={faq.questionKey}
              style={{
                borderTop: index === 0 ? "none" : "1px solid #eee6fc",
                background: index % 2 === 0 ? "#ffffff" : "#fbf9ff",
              }}
            >
              <summary
                style={{
                  cursor: "pointer",
                  padding: "12px 16px",
                  fontWeight: 600,
                  fontSize: 14,
                  listStyle: "revert",
                }}
              >
                {t(faq.questionKey)}
              </summary>
              <div style={{ padding: "0 16px 14px 16px", fontSize: 14, lineHeight: 1.5 }}>
                {t(faq.answerKey)}
              </div>
            </details>
          ))}
        </div>
      </s-section>

      <s-section heading={t("help.troubleshooting")}>
        <s-unordered-list>
          {TROUBLESHOOT_KEYS.map((key) => (
            <s-list-item key={key}>{t(key)}</s-list-item>
          ))}
        </s-unordered-list>
      </s-section>

      <s-section heading={t("help.support")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("help.supportText")}</s-paragraph>
          <s-text tone="neutral">
            {plan === ENTERPRISE_PLAN
              ? t("help.prioritySupportOn")
              : t("help.prioritySupportOff")}
          </s-text>
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-link href={`mailto:${SUPPORT_EMAIL}`}>{t("help.supportEmail")}</s-link>
            <s-text tone="neutral">{SUPPORT_EMAIL}</s-text>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
