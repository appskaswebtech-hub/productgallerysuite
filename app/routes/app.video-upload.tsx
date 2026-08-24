/**
 * Resource route that mints staged upload slots for product video.
 *
 * Action only, no component — the sibling of `app.image-library`, and split out of the
 * product page for the same reason its picker is: this is one step of a flow, not a page.
 *
 * It exists at all because video bytes must not pass through this server. The browser
 * asks here for signed targets, POSTs the file straight to Shopify's storage backend,
 * then comes back to the product route's `attach-videos` intent with the `resourceUrl`.
 * Uploading a gigabyte through a React Router action would buffer the whole file in
 * memory and sit well past most hosts' request timeout.
 *
 * Requests arrive as JSON rather than multipart: only the name, type and size are needed
 * to size an upload slot.
 */

import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  MAX_VIDEOS_PER_UPLOAD,
  createStagedVideoTargets,
  partitionUploadableFiles,
  type StagedFileDescriptor,
  type StagedTarget,
} from "../media.server";
import { resolveLocale } from "../settings.server";
import { translate } from "../i18n/translations";

/**
 * One upload slot, tagged with the caller's own index for the file it was minted for.
 *
 * Shopify returns targets positionally against what it was *asked* for, which is the
 * accepted subset — not what the browser holds. Echoing the client's index is what stops
 * a single rejected video from shifting every later target onto the wrong bytes. It is an
 * index rather than a filename because two selected files may share a name, and matching
 * on that would upload one of them twice and silently drop the other.
 */
export type StagedVideoSlot = { index: number; target: StagedTarget };

/** A file the client wants a slot for, carrying its position in the client's own list. */
type IndexedDescriptor = StagedFileDescriptor & { index: number };

export type StageVideosResult =
  | { ok: true; slots: StagedVideoSlot[]; rejected: string[] }
  | { ok: false; message: string };

/** Keeps a hand-rolled request body from reaching `stagedUploadsCreate` as `undefined`. */
const parseDescriptors = (payload: unknown): IndexedDescriptor[] => {
  const files = (payload as { files?: unknown })?.files;
  if (!Array.isArray(files)) return [];

  // The index is this array's own, not a client-supplied field — a caller cannot use it
  // to point a slot at something it did not ask for.
  return files.flatMap((entry, index) => {
    const name = typeof entry?.name === "string" ? entry.name : "";
    const type = typeof entry?.type === "string" ? entry.type : "";
    const size = Number(entry?.size);
    if (!name || !type || !Number.isFinite(size) || size <= 0) return [];
    return [{ name, type, size, index }];
  });
};

/**
 * Replies with real JSON rather than a bare object.
 *
 * The client `fetch`es this directly so it can `await` each step of the upload in order,
 * instead of driving a state machine off a fetcher's re-renders. A resource route reached
 * that way has to hand back a `Response` — the same thing the app-proxy route does.
 */
const reply = (result: StageVideosResult, status = 200) =>
  Response.json(result, { status });

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await resolveLocale(request, session.shop);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    payload = null;
  }

  const files = parseDescriptors(payload);
  if (!files.length) {
    return reply({ ok: false, message: translate(locale, "mapping.toastUploadNoFiles") }, 400);
  }
  if (files.length > MAX_VIDEOS_PER_UPLOAD) {
    return reply({ ok: false, message: translate(locale, "mapping.videoTooMany") }, 400);
  }

  // Vetted before the API call, so an oversized or wrong-format file is rejected before
  // the browser has pushed a single byte at Shopify's storage backend.
  const { accepted, rejected } = partitionUploadableFiles(
    files,
    (reason, filename) =>
      translate(
        locale,
        reason === "size" ? "mapping.videoTooLarge" : "mapping.videoBadType",
        { filename },
      ),
    "video",
  );

  if (!accepted.length) {
    return reply(
      {
        ok: false,
        message: translate(locale, "mapping.toastUploadFailed", {
          reason: rejected.join(" "),
        }),
      },
      400,
    );
  }

  const { targets, error } = await createStagedVideoTargets(admin, accepted);
  if (error) {
    return reply(
      { ok: false, message: translate(locale, "mapping.toastUploadFailed", { reason: error }) },
      502,
    );
  }

  const slots = accepted.flatMap((file, position) => {
    const target = targets[position];
    return target?.url && target.resourceUrl ? [{ index: file.index, target }] : [];
  });

  if (!slots.length) {
    return reply(
      {
        ok: false,
        message: translate(locale, "mapping.toastUploadFailed", {
          reason: translate(locale, "mapping.videoNoTarget"),
        }),
      },
      502,
    );
  }

  return reply({ ok: true, slots, rejected });
};
