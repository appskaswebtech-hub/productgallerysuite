import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { resolveLocale } from "../settings.server";
import { LanguageProvider, useLanguage } from "../i18n/LanguageContext";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    detectedLocale: await resolveLocale(request, session.shop),
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

export default function App() {
  const { apiKey, detectedLocale } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <LanguageProvider detectedLocale={detectedLocale}>
        <AppNav />
        <Outlet />
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
