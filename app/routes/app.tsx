import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { syncBillingPlan } from "../billing.server";
import {
  ENTERPRISE_PLAN,
  PLAN_FEATURE_KEYS,
  PLAN_ORDER,
  PLAN_PRICES,
  STARTER_PLAN,
} from "../billing-plans";
import { resolveLocale } from "../settings.server";
import { LanguageProvider, useLanguage } from "../i18n/LanguageContext";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const { plan, stale, starterAccepted } = await syncBillingPlan({
    billing,
    shop: session.shop,
  });

  /**
   * Billing must stay reachable, or the gate covers the only page that can lift it and the
   * app becomes unusable with no way out.
   */
  const isBillingRoute = new URL(request.url).pathname.startsWith("/app/billing");

  /**
   * `stale` means `billing.check` failed and `syncBillingPlan` fell back to the cached
   * plan. Gating on that would lock a **paying** merchant out of an app they pay for
   * whenever Shopify's billing API hiccups or the cache is behind — so the gate deliberately
   * fails open. Letting an unpaid shop through for one request is the far smaller harm.
   *
   * Starter is not a subscription: it is what `normalizePlan` returns when no paid plan is
   * found, so it is exactly the "no active paid plan" case.
   *
   * `starterAccepted` is what separates a merchant who *chose* the free plan from one who
   * has never chosen at all — both read as `plan === STARTER_PLAN`, and only the latter
   * should be gated.
   */
  const blocked =
    !stale && plan === STARTER_PLAN && !starterAccepted && !isBillingRoute;

  // eslint-disable-next-line no-undef
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    detectedLocale: await resolveLocale(request, session.shop),
    blocked,
  };
};

function AppNav() {
  const { t } = useLanguage();

  return (
    <s-app-nav>
      {/*
        `rel="home"` makes the NestGallery app title itself open this route.
        App Bridge hides the link from the nav list, so Dashboard is reached
        through the app title rather than its own item. It has to be a plain
        anchor: Polaris types `s-link` with a closed prop set that has no `rel`.
      */}
      <a href="/app" rel="home">
        {t("nav.dashboard")}
      </a>
      <s-link href="/app/products">{t("nav.products")}</s-link>
      <s-link href="/app/analytics">{t("nav.analytics")}</s-link>
      <s-link href="/app/billing">{t("nav.billing")}</s-link>
      <s-link href="/app/settings">{t("nav.settings")}</s-link>
      <s-link href="/app/help">{t("nav.help")}</s-link>
    </s-app-nav>
  );
}

/**
 * Shown in place of the page when the shop has no paid plan.
 *
 * Rendered **instead of** `<Outlet />`, not layered over it. An overlay would leave the real
 * page mounted underneath — in the DOM, reachable by keyboard, and still holding its
 * loader's data for anyone who opens devtools — and would need a focus trap and z-index
 * management to block properly. Swapping the outlet needs none of that: there is nothing
 * behind it to escape to or read.
 */
function BillingGate() {
  const { t } = useLanguage();

  return (
    <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 40,
          display: "grid",
          placeItems: "center",
          padding: 24,
          // `placeItems: center` is the overflow-safe way to centre: the card sits in an
          // auto-sized row track that starts at the top, so a card taller than the frame
          // scrolls with its top edge still reachable. Flex `alignItems: center` and grid
          // `placeContent: center` both strand the top instead — do not "simplify" to those.
          overflowY: "auto",
          // Blurs the page rendered behind it. The tint alone would read as flat grey —
          // the blur is what makes the app look present but out of reach.
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          background: "rgba(28, 23, 48, 0.45)",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 960,
            borderRadius: 20,
            overflow: "hidden",
            background: "#ffffff",
            boxShadow: "0 18px 48px rgba(28, 23, 48, 0.35)",
          }}
        >
          {/* The same gradient the Settings hero uses, so the paywall reads as part of the
              app rather than a bolted-on screen. */}
          <div
            style={{
              padding: "32px 36px",
              textAlign: "center",
              background:
                "linear-gradient(135deg, #1c1730 0%, #3a2d63 55%, #6c4fc7 100%)",
              color: "#f6f3ff",
            }}
          >
            <span
              style={{
                display: "inline-block",
                padding: "5px 16px",
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                background: "rgba(255, 255, 255, 0.18)",
              }}
            >
              {t("billing.gateBadge")}
            </span>
            <div style={{ marginTop: 14, fontSize: 30, fontWeight: 700, color: "#ffffff" }}>
              {t("billing.gateHeading")}
            </div>
            <div style={{ marginTop: 10, fontSize: 16, color: "#d8c9ff" }}>
              {t("billing.gateBody")}
            </div>
          </div>

          {/*
            Driven by PLAN_ORDER, so it stays correct if a plan is added or repriced.

            Starter appears here as something the merchant actively picks. It is not a
            Shopify subscription — accepting it only records the choice locally — but it is
            still a choice, which is the point: being on Starter by default is what raises
            this gate, so the free tier has to be opted into rather than fallen into.

            `auto-fit` sizes the columns instead of a media query, matching the Billing
            page's own grid: three across when there is room, then two, then one.
          */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            }}
          >
            {PLAN_ORDER.map((plan) => {
              const recommended = plan === ENTERPRISE_PLAN;
              const isFree = plan === STARTER_PLAN;

              return (
                <div
                  key={plan}
                  style={{
                    padding: "26px 22px 30px",
                    borderTop: "1px solid #e2d8fb",
                    background: recommended ? "#f7f4ff" : "#ffffff",
                    display: "flex",
                    flexDirection: "column",
                    gap: 14,
                  }}
                >
                  <div style={{ textAlign: "center", minHeight: 28 }}>
                    {recommended ? (
                      <span
                        style={{
                          display: "inline-block",
                          padding: "4px 14px",
                          borderRadius: 999,
                          fontSize: 12,
                          fontWeight: 700,
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                          background: "#6c4fc7",
                          color: "#ffffff",
                        }}
                      >
                        {t("billing.gatePopular")}
                      </span>
                    ) : null}
                  </div>

                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#1c1730" }}>
                      {plan}
                    </div>
                    <div style={{ fontSize: 40, fontWeight: 700, color: "#1c1730" }}>
                      {isFree ? t("billing.free") : PLAN_PRICES[plan]}
                    </div>
                    {/* No "/ month" under Starter — "Free / month" is nonsense. The
                        non-breaking space is deliberate: it reserves the line so all three
                        feature lists start at the same height. A plain " " would collapse
                        and the free column would ride up a line. */}
                    <div style={{ fontSize: 15, color: "#5c5866" }}>
                      {isFree ? " " : t("billing.gatePerMonth")}
                    </div>
                  </div>

                  {/*
                    `role="list"` is load-bearing, not redundant: Safari with VoiceOver drops
                    list semantics from a <ul> whose `list-style` is `none`, so without it
                    these stop being announced as a list of features.

                    The markers go because centred text cannot keep them — a bullet beside a
                    centred line sits at a ragged left edge and reads as broken.
                  */}
                  {/* eslint-disable-next-line jsx-a11y/no-redundant-roles -- the role is
                      only redundant while the implicit one survives, and `list-style: none`
                      is exactly the case where Safari/VoiceOver drops it. */}
                  <ul
                    role="list"
                    style={{
                      margin: 0,
                      padding: 0,
                      listStyle: "none",
                      textAlign: "center",
                      display: "grid",
                      gap: 9,
                      fontSize: 15,
                      color: "#3a3446",
                    }}
                  >
                    {PLAN_FEATURE_KEYS[plan].map((featureKey) => (
                      <li key={featureKey}>{t(featureKey)}</li>
                    ))}
                  </ul>

                  {/*
                    Navigates to Billing rather than purchasing from here, so
                    `billing.request` has exactly one caller — the Billing page — instead of
                    two paths that could drift apart.
                  */}
                  {/*
                    `justifyItems: center` centres the button at its natural width. It works
                    on the grid *item* — the custom element's host, which is styleable from
                    outside — so it does not depend on Polaris giving the host an
                    inline-level display the way `textAlign` would.

                    `marginTop: auto` keeps the buttons on one line across columns whose
                    feature lists differ in length. That is now doing real work: Starter
                    advertises four features against the other plans' five.
                  */}
                  <div
                    style={{
                      marginTop: "auto",
                      display: "grid",
                      justifyItems: "center",
                    }}
                  >
                    <s-button variant="primary" href="/app/billing">
                      {isFree
                        ? t("billing.chooseStarter")
                        : t("billing.gateStartWith", { plan })}
                    </s-button>
                  </div>
                </div>
              );
            })}
          </div>

          <div
            style={{
              padding: "16px 24px",
              borderTop: "1px solid #e2d8fb",
              textAlign: "center",
              fontSize: 13,
              color: "#5c5866",
              background: "#fbfaff",
            }}
          >
            {t("billing.gateFooter")}
          </div>
        </div>
    </div>
  );
}

/**
 * `inert`, spelled for React 18.
 *
 * React 19 accepts `inert` as a boolean prop; **18.3.1, which this project is on, does
 * not** — `inert={true}` logs "Received `true` for a non-boolean attribute" and the
 * attribute never reaches the DOM. An empty string renders as the bare `inert` attribute,
 * which is what the HTML spec wants, and the cast also covers React 18's missing typing.
 *
 * Do not "tidy" this into `inert` or `inert={true}`: focus containment behind the paywall
 * silently stops working, and nothing fails loudly when it does.
 */
const INERT = { inert: "" } as unknown as { inert?: boolean };

export default function App() {
  const { apiKey, detectedLocale, blocked } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <LanguageProvider detectedLocale={detectedLocale}>
        {/* The nav stays, so a gated merchant can still reach Billing. */}
        <AppNav />

        {/*
          The page renders behind the paywall so there is something for the modal's
          `backdrop-filter` to blur — a scrim over nothing just looks like flat grey.

          `inert` is what makes that safe: without it, Tab walks into the blurred page and
          focus lands on controls nobody can see. It also blocks pointer events, so the
          page cannot be clicked through the blur.

          The trade is that the page's markup and data are in the DOM, so a merchant with
          devtools could read their own settings past the paywall. Acceptable here — the
          data is theirs and this is a commercial gate, not a security boundary.
        */}
        <div {...(blocked ? INERT : {})}>
          <Outlet />
        </div>
        {blocked ? <BillingGate /> : null}
      </LanguageProvider>
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
