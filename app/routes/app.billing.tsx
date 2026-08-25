import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  BASIC_PLAN,
  ENTERPRISE_PLAN,
  PLAN_FEATURE_KEYS,
  PLAN_ORDER,
  PLAN_PRICES,
  STARTER_PLAN,
  type GalleryNestPlan,
} from "../billing-plans";
import {
  BILLING_TEST,
  authenticate,
} from "../shopify.server";
import { acceptStarterPlan, syncBillingPlan } from "../billing.server";
import { useLanguage } from "../i18n/LanguageContext";
import { detectLocaleFromRequest } from "../i18n/detectLocale.server";
import { translate, type TranslationKey } from "../i18n/translations";

const COMPARISON_ROW_KEYS: {
  labelKey: TranslationKey;
  values: Record<GalleryNestPlan, string>;
}[] = [
  {
    labelKey: "billing.rowProducts",
    values: { [STARTER_PLAN]: "5", [BASIC_PLAN]: "100", [ENTERPRISE_PLAN]: "unlimited" },
  },
  {
    labelKey: "billing.rowZoomGallery",
    values: { [STARTER_PLAN]: "✓", [BASIC_PLAN]: "✓", [ENTERPRISE_PLAN]: "✓" },
  },
  {
    labelKey: "billing.rowVariantMapping",
    values: { [STARTER_PLAN]: "✓", [BASIC_PLAN]: "✓", [ENTERPRISE_PLAN]: "✓" },
  },
  {
    labelKey: "billing.rowCustomArrows",
    values: { [STARTER_PLAN]: "—", [BASIC_PLAN]: "✓", [ENTERPRISE_PLAN]: "✓" },
  },
  {
    labelKey: "billing.rowAnalytics",
    values: { [STARTER_PLAN]: "—", [BASIC_PLAN]: "—", [ENTERPRISE_PLAN]: "✓" },
  },
  {
    labelKey: "billing.rowPrioritySupport",
    values: { [STARTER_PLAN]: "—", [BASIC_PLAN]: "—", [ENTERPRISE_PLAN]: "✓" },
  },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const billingPlan = await syncBillingPlan({ billing, shop: session.shop });

  return {
    currentPlan: billingPlan.plan,
    starterAccepted: billingPlan.starterAccepted,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const locale = detectLocaleFromRequest(request);
  const formData = await request.formData();
  const plan = formData.get("plan")?.toString();

  if (plan === STARTER_PLAN) {
    // Records the opt-in, which is what lifts the paywall. Before this stamped
    // `starterAcceptedAt`, the write was inert: `syncBillingPlan` sets exactly the same
    // plan and subscriptionId on the very next request anyway.
    await acceptStarterPlan(session.shop);

    return { ok: true, message: translate(locale, "billing.toastStarterSelected") };
  }

  if (plan !== BASIC_PLAN && plan !== ENTERPRISE_PLAN) {
    return { ok: false, message: translate(locale, "billing.toastInvalidPlan") };
  }

  const url = new URL(request.url);
  await billing.request({
    plan,
    isTest: BILLING_TEST,
    returnUrl: `${url.origin}/app/billing`,
  });
};

export default function Billing() {
  const { currentPlan, starterAccepted } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const { t } = useLanguage();
  const isSubmitting = navigation.state === "submitting";

  useEffect(() => {
    if (actionData?.message) {
      shopify.toast.show(actionData.message, { isError: actionData.ok === false });
    }
  }, [actionData, shopify]);

  return (
    <s-page heading={t("billing.pageTitle")}>
      <s-link slot="breadcrumb-actions" href="/app">
        {t("billing.breadcrumb")}
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
              {t("billing.pageTitle")}
            </span>
            <span style={{ color: "#d8c9ff", fontSize: 13 }}>
              {t("billing.heroTagline")}
            </span>
          </s-stack>
        </div>
      </s-section>

      <s-section heading={t("billing.choosePlan")}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 16,
          }}
        >
          {PLAN_ORDER.map((plan) => {
            /**
             * Starter needs the extra `starterAccepted` test, and without it the free plan
             * is unreachable: every shop with no paid subscription reads as
             * `currentPlan === STARTER_PLAN`, so Starter rendered as "Current plan" with a
             * **disabled** button — including for a merchant sent here by the paywall
             * specifically to choose it. They could never click it, and the gate had no
             * free exit.
             */
            const isCurrent =
              plan === STARTER_PLAN
                ? currentPlan === STARTER_PLAN && starterAccepted
                : currentPlan === plan;
            const isPaid = plan !== STARTER_PLAN;
            const isPopular = plan === BASIC_PLAN;

            return (
              <div
                key={plan}
                style={
                  isPopular
                    ? {
                        borderRadius: 12,
                        background: "linear-gradient(160deg, #efe9ff, #ffffff)",
                        boxShadow: "0 6px 20px rgba(108, 79, 199, 0.18)",
                        border: "1px solid #cabdf2",
                      }
                    : undefined
                }
              >
                <s-box
                  padding="base"
                  borderWidth={isPopular ? undefined : "base"}
                  borderRadius="base"
                  background={isCurrent ? "subdued" : undefined}
                >
                  <s-stack direction="block" gap="base">
                    <s-stack direction="inline" gap="small" alignItems="center">
                      <s-heading>{plan}</s-heading>
                      {isCurrent ? (
                        <s-badge tone="success">{t("billing.currentPlanBadge")}</s-badge>
                      ) : isPopular ? (
                        <s-badge tone="info">{t("billing.mostPopular")}</s-badge>
                      ) : null}
                    </s-stack>
                    <s-heading>
                      {plan === STARTER_PLAN ? t("billing.free") : PLAN_PRICES[plan]}
                      {isPaid ? ` ${t("billing.perMonth")}` : ""}
                    </s-heading>
                    <s-stack direction="block" gap="small">
                      {PLAN_FEATURE_KEYS[plan].map((featureKey) => (
                        <s-text key={featureKey}>✓ {t(featureKey)}</s-text>
                      ))}
                    </s-stack>
                    <Form method="post">
                      <input type="hidden" name="plan" value={plan} />
                      <s-button
                        type="submit"
                        variant={isCurrent ? "secondary" : "primary"}
                        disabled={isCurrent}
                        loading={isSubmitting || undefined}
                      >
                        {isCurrent
                          ? t("billing.currentPlanButton")
                          : plan === STARTER_PLAN
                            ? t("billing.chooseStarter")
                            : `${t("billing.choosePrefix")} ${plan}`}
                      </s-button>
                    </Form>
                  </s-stack>
                </s-box>
              </div>
            );
          })}
        </div>
      </s-section>

      <s-section heading={t("billing.comparePlans")}>
        <div
          style={{
            overflowX: "auto",
            borderRadius: 12,
            border: "1px solid #e2d8fb",
            boxShadow: "0 2px 10px rgba(60, 30, 110, 0.06)",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "#f7f4ff" }}>
                <th style={{ textAlign: "left", padding: "10px 14px" }}>
                  {t("billing.feature")}
                </th>
                {PLAN_ORDER.map((plan) => (
                  <th key={plan} style={{ textAlign: "center", padding: "10px 14px" }}>
                    {plan}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARISON_ROW_KEYS.map((row, rowIndex) => (
                <tr
                  key={row.labelKey}
                  style={{
                    background: rowIndex % 2 === 0 ? "#ffffff" : "#fbf9ff",
                  }}
                >
                  <td style={{ padding: "10px 14px", borderTop: "1px solid #eee6fc" }}>
                    {t(row.labelKey)}
                  </td>
                  {PLAN_ORDER.map((plan) => (
                    <td
                      key={plan}
                      style={{
                        textAlign: "center",
                        padding: "10px 14px",
                        borderTop: "1px solid #eee6fc",
                      }}
                    >
                      {row.values[plan] === "unlimited"
                        ? t("dashboard.unlimited")
                        : row.values[plan]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
