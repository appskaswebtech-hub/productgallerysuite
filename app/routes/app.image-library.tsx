/**
 * Resource route backing the "add from Shopify" picker.
 *
 * Loader only, no component. It lives apart from the product page because the picker
 * is usually never opened — folding these queries into that loader would spend two
 * Admin API calls on every product view for a modal most merchants never see.
 */

import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { listLibraryFiles, listProductLibrary } from "../media.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const source = url.searchParams.get("source");
  const search = url.searchParams.get("search") ?? undefined;
  const cursor = url.searchParams.get("cursor");

  const page =
    source === "products"
      ? await listProductLibrary(admin, { search, cursor })
      : await listLibraryFiles(admin, { search, cursor });

  return page;
};
