"use strict";

(() => {
  const VERSION = "2026-08-24-theme-profiles-v1";
  const ROOT_SELECTOR = "[data-gallery-nest-slider]";
  const POSITION_CLASSES = [
    "gn-slider--left",
    "gn-slider--right",
    "gn-slider--top",
    "gn-slider--bottom",
  ];
  /**
   * Per-theme gallery containers, tried *before* the generic list below.
   *
   * Additive by design: a profile that matches nothing falls through to `GALLERY_SELECTORS`
   * and then to the image-URL fallback, so picking the wrong theme degrades to the historic
   * behaviour rather than breaking the gallery.
   *
   * Confidence varies and is worth knowing before trusting one. Dawn and Impulse are the
   * selectors this app has always shipped and are well proven. Debut's are longstanding
   * public markup. **Horizon and Prestige are unverified** — sourced from documentation
   * rather than a running store — which is exactly why the `custom` profile exists.
   */
  const THEME_SELECTORS = {
    horizon: [".media-gallery__grid", ".product-media-container", ".product-media"],
    dawn: [".product__media-wrapper", "media-gallery", "[id^='MediaGallery-']"],
    impulse: [".product__photos", ".product-single__media-group", ".product__main-photos"],
    debut: [".product-single__photos", "#ProductPhoto", ".product-single__photo"],
    prestige: [".Product__Gallery", ".Product__SlideshowNavScroller"],
  };

  const GALLERY_SELECTORS = [
    ".product__media-wrapper",
    ".product__media-list",
    "product-media-gallery",
    "media-gallery",
    "[id^='MediaGallery-']",
    "[data-product-media-gallery]",
    ".product-media-container",
    ".product-gallery",
    ".product-gallery__media",
    ".product-single__media-group",
    ".product__photos",
    ".product__media",
  ];

  const STRINGS = {
    en: {
      galleryLabel: "Product image gallery",
      close: "Close gallery",
      prev: "Previous image",
      next: "Next image",
      viewImage: (n) => `View image ${n}`,
      viewVideo: (n) => `Play video ${n}`,
      openVideo: "Play video",
      openGallery: "Open image gallery",
      zoomIn: "Turn on zoom",
      zoomOut: "Turn off zoom",
      empty: "No product images found.",
      scrollImages: "Scroll through images",
    },
    es: {
      galleryLabel: "Galería de imágenes del producto",
      close: "Cerrar galería",
      prev: "Imagen anterior",
      next: "Imagen siguiente",
      viewImage: (n) => `Ver imagen ${n}`,
      viewVideo: (n) => `Reproducir el video ${n}`,
      openVideo: "Reproducir el video",
      openGallery: "Abrir galería de imágenes",
      zoomIn: "Activar el zoom",
      zoomOut: "Desactivar el zoom",
      empty: "No se encontraron imágenes del producto.",
      scrollImages: "Desplazarse por las imágenes",
    },
    it: {
      galleryLabel: "Galleria immagini prodotto",
      close: "Chiudi galleria",
      prev: "Immagine precedente",
      next: "Immagine successiva",
      viewImage: (n) => `Visualizza immagine ${n}`,
      viewVideo: (n) => `Riproduci il video ${n}`,
      openVideo: "Riproduci il video",
      openGallery: "Apri galleria immagini",
      zoomIn: "Attiva lo zoom",
      zoomOut: "Disattiva lo zoom",
      empty: "Nessuna immagine del prodotto trovata.",
      scrollImages: "Scorri tra le immagini",
    },
    de: {
      galleryLabel: "Produktbildergalerie",
      close: "Galerie schließen",
      prev: "Vorheriges Bild",
      next: "Nächstes Bild",
      viewImage: (n) => `Bild ${n} ansehen`,
      viewVideo: (n) => `Video ${n} abspielen`,
      openVideo: "Video abspielen",
      openGallery: "Bildergalerie öffnen",
      zoomIn: "Zoom einschalten",
      zoomOut: "Zoom ausschalten",
      empty: "Keine Produktbilder gefunden.",
      scrollImages: "Durch die Bilder blättern",
    },
    fr: {
      galleryLabel: "Galerie d'images du produit",
      close: "Fermer la galerie",
      prev: "Image précédente",
      next: "Image suivante",
      viewImage: (n) => `Voir l'image ${n}`,
      viewVideo: (n) => `Lire la vidéo ${n}`,
      openVideo: "Lire la vidéo",
      openGallery: "Ouvrir la galerie d'images",
      zoomIn: "Activer le zoom",
      zoomOut: "Désactiver le zoom",
      empty: "Aucune image de produit trouvée.",
      scrollImages: "Faire défiler les images",
    },
  };

  const detectLang = () => {
    const raw = (document.documentElement.lang || "en").split("-")[0].toLowerCase();
    return STRINGS[raw] ? raw : "en";
  };

  const t = (key, ...args) => {
    const lang = detectLang();
    const value = STRINGS[lang]?.[key] ?? STRINGS.en[key];
    return typeof value === "function" ? value(...args) : value;
  };

  const parseJson = (root, selector) => {
    const node = root.querySelector(selector);
    if (!node?.textContent) return [];

    try {
      const parsed = JSON.parse(node.textContent);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const normalizeId = (id) => String(id || "").split("/").pop();

  /**
   * Every id an entry can legitimately be addressed by.
   *
   * Image entries carry two: the media id and the ProductImage id. The admin keys
   * `variantImageMap` and `imageCaptions` by the latter, while Liquid may hand back
   * either, so anything matching an entry against merchant data has to try both — see
   * the comment in `product-slider.liquid`.
   */
  const mediaKeys = (item) =>
    [normalizeId(item?.id), normalizeId(item?.imageId)].filter(Boolean);

  const isVideoItem = (item) =>
    item?.type === "video" || item?.type === "external_video";

  /** A video with no playable source is a poster and nothing else — not worth a badge. */
  const isPlayable = (item) =>
    (item?.type === "video" && item.sources?.length > 0) ||
    (item?.type === "external_video" && Boolean(item.embedUrl));

  /**
   * Reorders the gallery to the sequence the merchant arranged in the app.
   *
   * Ranks through `mediaKeys`, never `item.id`: the admin stores the ProductImage id for
   * an image but the media id for a video, and only `mediaKeys` reconciles the two — using
   * `item.id` alone would silently leave videos unsorted.
   *
   * Mirrors `applyMediaOrder` in the admin: stable sort, unranked media last, so a fresh
   * upload the saved order does not mention lands at the end on both ends of the app.
   * `MAX_SAFE_INTEGER` rather than `Infinity`, or two unranked entries compare as `NaN`.
   */
  const orderMedia = (media, order) => {
    if (!Array.isArray(order) || !order.length) return media;

    const rank = new Map(order.map((id, index) => [normalizeId(id), index]));
    const rankOf = (item) => {
      for (const key of mediaKeys(item)) {
        const position = rank.get(key);
        if (position !== undefined) return position;
      }
      return Number.MAX_SAFE_INTEGER;
    };

    return [...media].sort((a, b) => rankOf(a) - rankOf(b));
  };

  const getMedia = (root) =>
    parseJson(root, "[data-gallery-nest-media]").filter((media) => media.src);

  const getVariants = (root) =>
    parseJson(root, "[data-gallery-nest-variants]").filter(
      (variant) => variant.id && variant.mediaId,
    );

  const sanitizeSvg = (svg) => {
    const value = String(svg || "").trim();
    if (!value.toLowerCase().startsWith("<svg")) return "";
    if (/<script|on\w+=|javascript:/i.test(value)) return "";
    return value;
  };

  const defaultIcon = (name) => {
    if (name === "prev") {
      return '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12.7 15.3a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4l4.6-4.6a1 1 0 1 1 1.4 1.4L8.8 10l3.9 3.9a1 1 0 0 1 0 1.4Z"/></svg>';
    }

    if (name === "next") {
      return '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.3 4.7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4l-4.6 4.6a1 1 0 1 1-1.4-1.4l3.9-3.9-3.9-3.9a1 1 0 0 1 0-1.4Z"/></svg>';
    }

    if (name === "close") {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.64 4.22 12 10.59l6.36-6.37 1.42 1.42L13.41 12l6.37 6.36-1.42 1.42L12 13.41l-6.36 6.37-1.42-1.42L10.59 12 4.22 5.64l1.42-1.42Z"/></svg>';
    }

    return '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 2.5a4.5 4.5 0 0 1 3.5 7.32l1.84 1.84a1 1 0 0 1-1.42 1.42L9.1 11.24A4.5 4.5 0 1 1 7 2.5Zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm6.75 7.25a1 1 0 0 1 1-1H17a1 1 0 0 1 1 1V14a1 1 0 1 1-2 0v-.84l-2.54 2.55a1 1 0 0 1-1.42-1.42L14.6 11.75h-.85a1 1 0 0 1-1-1Z"/></svg>';
  };

  const icon = (name, customSvg) => sanitizeSvg(customSvg) || defaultIcon(name);

  /**
   * The play triangle laid over a video's poster.
   *
   * Playback is lightbox-only, so in the slider this badge is the *whole* signal that an
   * entry is a video — without it a video is indistinguishable from a photo until the
   * shopper happens to open it.
   */
  const playBadge = () => {
    const badge = document.createElement("span");
    badge.className = "gn-play-badge";
    badge.setAttribute("aria-hidden", "true");
    badge.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="M8 5.14v13.72a1 1 0 0 0 1.53.85l10.79-6.86a1 1 0 0 0 0-1.7L9.53 4.29A1 1 0 0 0 8 5.14Z"/></svg>';
    return badge;
  };

  const safeAccentColor = (color) =>
    /^#[0-9a-f]{6}$/i.test(String(color || "")) ? String(color).toLowerCase() : "";

  const safeZoomScale = (zoomLevel) => {
    const scale = Number(zoomLevel) / 100;
    return Number.isFinite(scale) ? Math.min(Math.max(scale, 1), 4) : 2;
  };

  const thumbLoadingAttrs = (settings) =>
    settings.lazyLoadImages === false ? "" : ' loading="lazy" decoding="async"';

  const safeHoverSpeed = (speed) => {
    // Number(null) and Number("") are 0, which would clamp to the minimum rather
    // than fall back to the default when the field is absent.
    if (speed === null || speed === undefined || speed === "") return 1200;
    const parsed = Math.round(Number(speed));
    return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 200), 5000) : 1200;
  };

  const matches = (query) => {
    try {
      return window.matchMedia(query).matches;
    } catch {
      return false;
    }
  };

  const prefersMouse = () => matches("(hover: hover) and (pointer: fine)");

  /**
   * Batches gallery interaction counts and sends them once, when the shopper leaves.
   *
   * Counting in memory matters: a request per slide change would put the app in the
   * critical path of a product page. `sendBeacon` is used because a `fetch` started
   * during unload is not guaranteed to complete — and it cannot set headers, hence
   * the typed Blob. The relative path lets Shopify's proxy sign the request.
   */
  const createTracker = (productId, enabled) => {
    if (!enabled || typeof navigator === "undefined" || !navigator.sendBeacon) {
      return { track: () => {} };
    }

    const counts = Object.create(null);
    let scheduled = false;

    const flush = () => {
      const payload = { productId, counts: { ...counts } };
      if (!Object.keys(payload.counts).length) return;

      // Cleared before sending: a failed beacon must not resend on a later flush and
      // double-count what the shopper actually did.
      for (const key of Object.keys(counts)) delete counts[key];

      try {
        navigator.sendBeacon(
          "/apps/gallery-nest/events",
          new Blob([JSON.stringify(payload)], { type: "application/json" }),
        );
      } catch {
        // Analytics must never break the gallery.
      }
    };

    const scheduleFlush = () => {
      if (scheduled) return;
      scheduled = true;
      // `pagehide` covers bfcache navigations that never fire `unload`; the
      // visibility check catches tab switches on mobile, where `pagehide` may not run.
      window.addEventListener("pagehide", flush);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flush();
      });
    };

    return {
      track: (type) => {
        counts[type] = (counts[type] || 0) + 1;
        scheduleFlush();
      },
    };
  };

  /**
   * How long the cursor must rest on one side before hover-navigation starts.
   * Long enough that sweeping across the image to reach the thumbnails does not
   * advance it, short enough that the feature answers straight away — the
   * merchant's speed setting governs the cadence after this first step, not it.
   */
  const HOVER_INTENT_DELAY = 300;

  const normalizeImageUrl = (src) => {
    try {
      return new URL(src, window.location.origin).pathname.replace(
        /_(\d+x|pico|icon|thumb|small|compact|medium|large|grande|master)(?=\.)/,
        "",
      );
    } catch {
      return src;
    }
  };

  /**
   * The selectors the merchant's theme choice puts ahead of the generic list.
   *
   * The theme editor wins over the shop setting, and an empty dataset value means the block
   * was left on "Use app setting" — which is why this checks for a non-empty string rather
   * than mere presence.
   */
  const themeSelectors = (root, settings) => {
    const profile =
      root.dataset.themeProfile || settings.themeProfile || "auto";

    if (profile === "custom") {
      const selector =
        root.dataset.themeSelector || settings.customGallerySelector || "";
      return selector ? [selector] : [];
    }

    return THEME_SELECTORS[profile] || [];
  };

  /**
   * `querySelectorAll` throws on a malformed selector, and the `custom` profile's value is
   * typed by hand in the theme editor. Unguarded, a single typo would take the whole gallery
   * down; here it just contributes no matches and the next pass takes over.
   */
  const queryAll = (selector) => {
    try {
      return Array.from(document.querySelectorAll(selector));
    } catch {
      console.warn(`[gallery-nest] ignoring invalid gallery selector: ${selector}`);
      return [];
    }
  };

  /**
   * Climbs to the nearest ancestor matching one of the theme profile's selectors.
   *
   * Guarded like `queryAll`, for the same reason: the `custom` profile's selector is typed
   * by hand and `closest` throws on a malformed one.
   */
  const galleryHostFromProfile = (node, profileSelectors = []) => {
    for (const selector of profileSelectors) {
      try {
        const match = node.closest(selector);
        if (match) return match;
      } catch {
        // Reported once by `queryAll`; climbing silently skips it.
      }
    }
    return null;
  };

  const galleryHost = (node, profileSelectors = []) =>
    // The theme's own selectors first: on a theme whose wrapper is none of the three below,
    // climbing straight to those would overshoot the real container.
    galleryHostFromProfile(node, profileSelectors) ||
    node.closest(".product__media-wrapper") ||
    node.closest(".product-gallery") ||
    node.closest(".product-single__media-group") ||
    node;

  const findNativeGallery = (root, media, profileSelectors = []) => {
    // Profile pass first, then the generic union — order is the whole mechanism.
    const nativeGallery = [...profileSelectors, ...GALLERY_SELECTORS]
      .flatMap(queryAll)
      .filter((node) => node && !node.contains(root) && node !== root)
      // Wrapped, not passed by reference: `map` supplies (value, index, array), so
      // `galleryHost` would receive the index as its selector list.
      .map((node) => galleryHost(node, profileSelectors))
      .find((node, index, nodes) => node && nodes.indexOf(node) === index);

    if (nativeGallery) return nativeGallery;

    const mediaUrls = new Set(
      media.flatMap((item) => [item.thumb, item.src, item.zoom]).filter(Boolean).map(
        normalizeImageUrl,
      ),
    );

    if (!mediaUrls.size) return null;

    return Array.from(document.images)
      .filter((image) => !root.contains(image))
      .filter((image) => mediaUrls.has(normalizeImageUrl(image.currentSrc || image.src)))
      .map(
        (image) =>
          galleryHostFromProfile(image, profileSelectors) ||
          image.closest(
            ".product__media-wrapper, product-media-gallery, media-gallery, .product-gallery, .product__photos, .product-single__media-group",
          ) ||
          image.closest(".shopify-section") ||
          image.parentElement,
      )
      .find(Boolean);
  };

  const replaceNativeGallery = (root, media, profileSelectors = []) => {
    const host = findNativeGallery(root, media, profileSelectors);
    if (!host) {
      // The one genuinely diagnostic case: the gallery could not be located at all, so the
      // slider renders in place instead of replacing the theme's. Names the theme's
      // container as the thing to capture for a new profile.
      console.warn(
        "[gallery-nest] no theme gallery found to replace — set Theme to \"Custom selector\" and supply your gallery's container selector",
      );
      return;
    }

    host.prepend(root);
    host.classList.add("gn-slider-host");
    host.removeAttribute("hidden");
    host.style.removeProperty("display");
    host.dataset.galleryNestHidden = "true";
  };

  const currentVariantId = () => {
    const urlVariant = new URL(window.location.href).searchParams.get("variant");
    if (urlVariant) return urlVariant;

    const input = document.querySelector(
      'form[action*="/cart/add"] [name="id"], product-form [name="id"], [name="id"]',
    );
    return input?.value || input?.getAttribute("value") || null;
  };

  const mediaForVariant = (media, variantId, variantImageMap) => {
    if (!variantId) return media;

    const safeVariantImageMap =
      variantImageMap && typeof variantImageMap === "object" ? variantImageMap : {};
    const normalizedVariantId = normalizeId(variantId);
    const mappedIds =
      safeVariantImageMap[String(variantId)] ||
      safeVariantImageMap[normalizedVariantId] ||
      Object.entries(safeVariantImageMap).find(
        ([mapVariantId]) => normalizeId(mapVariantId) === normalizedVariantId,
      )?.[1];

    if (Array.isArray(mappedIds)) {
      const selectedIds = new Set(mappedIds.map(normalizeId));
      const mappedMedia = media.filter((item) =>
        mediaKeys(item).some((key) => selectedIds.has(key)),
      );
      if (mappedMedia.length) return mappedMedia;
    }

    const taggedMedia = media.filter((item) =>
      (item.variantIds || []).map(normalizeId).includes(normalizedVariantId),
    );

    return taggedMedia.length ? taggedMedia : media;
  };

  /**
   * Stops whatever a lightbox viewer node is playing and releases the bytes behind it.
   *
   * `pause()` alone is not enough. A `<video>` fed by `<source>` children has no `src`
   * attribute to clear, so the documented way to abort its in-flight fetch is to empty
   * the children and re-`load()` — without that, a shopper who opens three videos leaves
   * three downloads running. An `<iframe>` needs its `src` dropped or the embedded
   * YouTube player keeps playing audio from a node no one can see.
   */
  const stopMedia = (node) => {
    if (!node) return;
    if (typeof node.pause === "function") node.pause();
    node.removeAttribute("src");
    if (typeof node.load === "function") {
      node.replaceChildren();
      node.load();
    }
  };

  const openLightbox = (media, startIndex, settings) => {
    let activeIndex = startIndex;
    const lightbox = document.createElement("div");
    lightbox.className = "gn-lightbox";
    lightbox.setAttribute("role", "dialog");
    lightbox.setAttribute("aria-modal", "true");
    lightbox.setAttribute("aria-label", t("galleryLabel"));
    lightbox.innerHTML = `
      <div class="gn-lightbox__bar">
        <span class="gn-lightbox__counter"></span>
        <button class="gn-lightbox__close" type="button" aria-label="${t("close")}">${defaultIcon("close")}</button>
      </div>
      <div class="gn-lightbox__viewer">
        ${
          media.length > 1
            ? `<button class="gn-lightbox__nav gn-lightbox__nav--prev" type="button" aria-label="${t("prev")}">${icon("prev", settings.previousArrowSvg)}</button>`
            : ""
        }
        <div class="gn-lightbox__frame"></div>
        ${
          media.length > 1
            ? `<button class="gn-lightbox__nav gn-lightbox__nav--next" type="button" aria-label="${t("next")}">${icon("next", settings.nextArrowSvg)}</button>`
            : ""
        }
      </div>
      <div class="gn-lightbox__thumbs" role="list"></div>
    `;

    const counter = lightbox.querySelector(".gn-lightbox__counter");
    const viewerFrame = lightbox.querySelector(".gn-lightbox__frame");
    const close = lightbox.querySelector(".gn-lightbox__close");
    const prev = lightbox.querySelector(".gn-lightbox__nav--prev");
    const next = lightbox.querySelector(".gn-lightbox__nav--next");
    const thumbs = lightbox.querySelector(".gn-lightbox__thumbs");
    const previousOverflow = document.documentElement.style.overflow;

    // The lightbox lives on document.body, outside the slider root, so it needs
    // its own copy of the accent colour.
    const accentColor = safeAccentColor(settings.accentColor);
    if (accentColor) lightbox.style.setProperty("--gn-active", accentColor);

    /**
     * Replaces whatever is in the viewer with the element this entry needs.
     *
     * The previous node is always discarded rather than reused. A `<video>` left in the
     * DOM keeps playing audio after the shopper has moved on, and an `<iframe>` keeps a
     * YouTube player alive behind a closed lightbox — so tearing down is the point of
     * this function, not a side effect of it.
     */
    const renderViewer = (item) => {
      const previous = viewerFrame.firstElementChild;
      if (previous) {
        stopMedia(previous);
        previous.remove();
      }

      if (item.type === "video" && item.sources?.length) {
        const video = document.createElement("video");
        video.className = "gn-lightbox__video";
        video.controls = true;
        video.playsInline = true;
        video.preload = "metadata";
        video.poster = item.zoom || item.src;
        // `alt` has no meaning on <video>; the accessible name goes on the label.
        if (item.alt) video.setAttribute("aria-label", item.alt);
        // Highest resolution first. The browser takes the first source it can play rather
        // than the best one, and every rendition here is H.264 — so whichever is listed
        // first is simply the one that gets used.
        const sources = [...item.sources].sort((a, b) => (b.height || 0) - (a.height || 0));
        for (const source of sources) {
          const node = document.createElement("source");
          node.src = source.url;
          node.type = source.mimeType;
          video.append(node);
        }
        viewerFrame.append(video);
        return video;
      }

      if (item.type === "external_video" && item.embedUrl) {
        const embed = document.createElement("iframe");
        embed.className = "gn-lightbox__embed";
        embed.src = item.embedUrl;
        embed.title = item.alt || t("galleryLabel");
        embed.allow = "accelerometer; encrypted-media; picture-in-picture; fullscreen";
        embed.allowFullscreen = true;
        embed.setAttribute("frameborder", "0");
        viewerFrame.append(embed);
        return embed;
      }

      const image = document.createElement("img");
      image.className = "gn-lightbox__image";
      image.src = item.zoom || item.src;
      image.alt = item.alt || "";
      viewerFrame.append(image);
      return image;
    };

    const setActive = (index) => {
      activeIndex = settings.loopSlides === false
        ? Math.min(Math.max(index, 0), media.length - 1)
        : (index + media.length) % media.length;
      const item = media[activeIndex];
      renderViewer(item);
      counter.textContent = `${activeIndex + 1} / ${media.length}`;
      if (settings.loopSlides === false) {
        if (prev) prev.disabled = activeIndex === 0;
        if (next) next.disabled = activeIndex === media.length - 1;
      }
      thumbs.querySelectorAll(".gn-lightbox__thumb").forEach((thumb, thumbIndex) => {
        thumb.setAttribute("aria-current", String(thumbIndex === activeIndex));
      });
    };

    const closeLightbox = () => {
      document.removeEventListener("keydown", onKeydown);
      document.documentElement.style.overflow = previousOverflow;
      // Removing `lightbox` alone does not reliably stop audio in every browser.
      stopMedia(viewerFrame.firstElementChild);
      lightbox.remove();
    };

    const onKeydown = (event) => {
      // Escape always closes, regardless of the keyboard navigation setting.
      if (event.key === "Escape") closeLightbox();
      if (settings.keyboardNavigation === false || media.length <= 1) return;
      // A focused <video> owns the arrow keys for seeking, and an <iframe> owns them
      // outright. Stealing them here would make the player's own controls unusable.
      if (viewerFrame.contains(event.target)) return;
      if (event.key === "ArrowLeft") setActive(activeIndex - 1);
      if (event.key === "ArrowRight") setActive(activeIndex + 1);
    };

    media.forEach((item, index) => {
      const thumb = document.createElement("button");
      thumb.type = "button";
      thumb.className = "gn-lightbox__thumb";
      thumb.setAttribute("aria-label", isVideoItem(item) ? t("viewVideo", index + 1) : t("viewImage", index + 1));
      thumb.innerHTML = `<img src="${item.thumb || item.src}" alt=""${thumbLoadingAttrs(settings)}>`;
      if (isPlayable(item)) thumb.append(playBadge());
      thumb.addEventListener("click", () => setActive(index));
      thumbs.append(thumb);
    });

    close.addEventListener("click", closeLightbox);
    prev?.addEventListener("click", () => setActive(activeIndex - 1));
    next?.addEventListener("click", () => setActive(activeIndex + 1));
    lightbox.addEventListener("click", (event) => {
      if (event.target === lightbox) closeLightbox();
    });
    document.addEventListener("keydown", onKeydown);
    document.documentElement.style.overflow = "hidden";
    document.body.append(lightbox);
    setActive(activeIndex);
    close.focus();
  };

  const renderSlider = (root, allMedia, position, settings) => {
    let activeIndex = 0;
    let visibleMedia = allMedia;
    const safePosition = ["left", "right", "top", "bottom"].includes(position)
      ? position
      : "left";
    const zoomPosition = [
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
    ].includes(settings.zoomIconPosition)
      ? settings.zoomIconPosition
      : "top-right";
    const hideThumbnails = !!settings.hideThumbnails;
    const isCarousel = settings.stageLayout === "carousel";
    const perView = ["2", "3", "4"].includes(String(settings.carouselPerView))
      ? Number(settings.carouselPerView)
      : 3;
    const carouselNavigation = ["arrows", "slider", "both"].includes(
      settings.carouselNavigation,
    )
      ? settings.carouselNavigation
      : "arrows";
    const showsScroller = isCarousel && carouselNavigation !== "arrows";
    const thumbShape = ["square", "rounded", "circle", "polaroid", "card"].includes(
      settings.thumbnailShape,
    )
      ? settings.thumbnailShape
      : "square";
    const thumbHoverEffect = ["none", "lift", "caption"].includes(
      settings.thumbnailHoverEffect,
    )
      ? settings.thumbnailHoverEffect
      : "none";
    // Polaroid and card show their caption permanently; the overlay effect reveals it on
    // hover. The remaining shapes have nowhere to put one, so no element is created.
    const showsCaption =
      thumbShape === "polaroid" || thumbShape === "card" || thumbHoverEffect === "caption";
    const imageCaptions =
      settings.imageCaptions && typeof settings.imageCaptions === "object"
        ? settings.imageCaptions
        : {};
    const hideZoomIcon = !!settings.hideZoomIcon;
    const zoomTrigger = ["hover", "click", "off"].includes(settings.zoomTrigger)
      ? settings.zoomTrigger
      : "hover";
    const thumbnailSize = Math.min(Math.max(Number(settings.thumbnailSize || 76), 48), 140);
    const hoverSpeed = safeHoverSpeed(settings.hoverNavigationSpeed);
    const hoverAxis = ["horizontal", "vertical"].includes(settings.hoverNavigationAxis)
      ? settings.hoverNavigationAxis
      : "horizontal";
    const hoverInvert = settings.hoverNavigationInvert === true;
    const imageTransition = ["none", "fade", "slide", "zoom"].includes(
      settings.imageTransition,
    )
      ? settings.imageTransition
      : "fade";
    // Hover cycling picks its own effect, so a deliberate slide on click can sit
    // alongside something quieter under the resting cursor.
    const hoverTransition = ["none", "fade", "slide", "zoom"].includes(
      settings.hoverTransition,
    )
      ? settings.hoverTransition
      : "fade";
    const transitionSpeed = Math.min(
      Math.max(Number(settings.transitionSpeed || 300), 100),
      1000,
    );
    // Hover cycling fires on its own interval, and a step must not restart an animation
    // the previous step has not finished — that leaves the image jittering in place and
    // never settling. 0.8 leaves it visibly at rest before the next step begins.
    const hoverTransitionSpeed = Math.min(
      transitionSpeed,
      Math.round(hoverSpeed * 0.8),
    );
    const tracker = createTracker(settings.productId, settings.analyticsEnabled === true);
    const canHoverNavigate =
      settings.hoverNavigation === true &&
      // Hover-zoom would fight with this over the same mouse movement.
      zoomTrigger !== "hover" &&
      // Mouse-only by nature. Deliberately not gated on prefers-reduced-motion:
      // the shopper starts this by resting the cursor, so it is not the
      // unrequested animation that setting exists to suppress, and gating on it
      // made the merchant's setting do nothing with no way to tell why.
      prefersMouse();

    const accentColor = safeAccentColor(settings.accentColor);

    root.classList.add(
      "gn-slider",
      `gn-slider--${safePosition}`,
      `gn-thumbs--${thumbShape}`,
      `gn-thumbs--hover-${thumbHoverEffect}`,
    );
    root.classList.toggle("gn-slider--single", hideThumbnails);
    root.style.setProperty("--gn-thumb-size", `${thumbnailSize}px`);
    root.style.setProperty("--gn-zoom-scale", String(safeZoomScale(settings.zoomLevel)));
    root.style.setProperty("--gn-transition-speed", `${transitionSpeed}ms`);
    root.style.setProperty("--gn-per-view", String(perView));
    if (accentColor) root.style.setProperty("--gn-active", accentColor);
    root.classList.remove(
      ...POSITION_CLASSES.filter((className) => className !== `gn-slider--${safePosition}`),
    );

    if (!allMedia.length) {
      root.innerHTML = `<div class="gn-slider__empty">${t("empty")}</div>`;
      root.hidden = false;
      return;
    }

    root.innerHTML = `
      <div class="gn-slider__thumbs" role="list"></div>
      <div class="gn-slider__stage${isCarousel ? " gn-slider__stage--carousel" : ""}">
        ${
          hideZoomIcon
            ? ""
            : `<button class="gn-slider__zoom-icon gn-slider__zoom-icon--${zoomPosition}" type="button" aria-label="${zoomTrigger === "click" ? t("zoomIn") : t("openGallery")}"${zoomTrigger === "click" ? ' aria-pressed="false"' : ""}>${icon("zoom", settings.zoomIconSvg)}</button>`
        }
        ${
          isCarousel
            ? // Every slide's src is set here rather than in setActive: a carousel has no
              // single image to swap, it scrolls. `alt` is deliberately left empty and
              // assigned as a property below — it is merchant text, and interpolating it
              // into this template would be an attribute-injection hole.
              `<div class="gn-slider__track">${visibleMedia
                .map(
                  (item) =>
                    `<div class="gn-slider__slide"><img class="gn-slider__main" src="${item.zoom || item.src}" alt=""></div>`,
                )
                .join("")}</div>`
            : `<div class="gn-slider__frame"><img class="gn-slider__main" alt=""></div>`
        }
        ${
          showsScroller
            ? `<div class="gn-slider__scroller" role="slider" tabindex="0" aria-label="${t("scrollImages")}" aria-valuemin="1" aria-valuemax="${visibleMedia.length}" aria-valuenow="1"><div class="gn-slider__scroller-thumb"></div></div>`
            : ""
        }
      </div>
    `;

    const stage = root.querySelector(".gn-slider__stage");
    const track = root.querySelector(".gn-slider__track");
    const scroller = root.querySelector(".gn-slider__scroller");
    const scrollerThumb = root.querySelector(".gn-slider__scroller-thumb");
    const frame = root.querySelector(".gn-slider__frame");
    const main = root.querySelector(".gn-slider__main");
    const thumbs = root.querySelector(".gn-slider__thumbs");
    const zoom = root.querySelector(".gn-slider__zoom-icon");

    const slides = track ? Array.from(track.querySelectorAll(".gn-slider__slide")) : [];
    slides.forEach((slide, index) => {
      const image = slide.querySelector(".gn-slider__main");
      if (image) image.alt = visibleMedia[index]?.alt || "";
      // Every carousel slide is on screen at once, so each video needs its own badge.
      if (isPlayable(visibleMedia[index])) slide.append(playBadge());
    });

    // The single-image stage shows one entry at a time, so it gets one badge that
    // `setActive` shows or hides. Created even when the gallery holds no video: the
    // active entry can become one after a variant change.
    const stagePlayBadge = playBadge();
    stagePlayBadge.hidden = true;
    if (frame) frame.append(stagePlayBadge);

    let prevButton = null;
    let nextButton = null;
    let isZoomArmed = false;
    // Assigned by the scroller block below when there is a drag bar. Defaulting to a
    // no-op lets the boot sequence call it unconditionally, including in single-image and
    // arrows-only layouts where no bar exists. Declared here rather than inside that
    // block so the boot sequence at the end of renderSlider can reach it.
    let refreshScroller = () => {};
    // The boot sequence calls setActive itself. Counting those would report an
    // image_view on every page load and drown out actual browsing.
    let booting = true;

    const rebuildNavigation = () => {
      root.querySelectorAll(".gn-slider__button").forEach((button) => button.remove());
      prevButton = null;
      nextButton = null;
      if (visibleMedia.length <= 1) return;
      // `isCarousel` is load-bearing here: this function also serves the single-image
      // layout, where the arrows are the only navigation and must never be suppressed.
      if (isCarousel && carouselNavigation === "slider") return;

      const prev = document.createElement("button");
      prev.type = "button";
      prev.className = "gn-slider__button gn-slider__button--prev";
      prev.setAttribute("aria-label", t("prev"));
      prev.innerHTML = icon("prev", settings.previousArrowSvg);
      prev.addEventListener("click", () => setActive(activeIndex - 1));

      const next = document.createElement("button");
      next.type = "button";
      next.className = "gn-slider__button gn-slider__button--next";
      next.setAttribute("aria-label", t("next"));
      next.innerHTML = icon("next", settings.nextArrowSvg);
      next.addEventListener("click", () => setActive(activeIndex + 1));

      prevButton = prev;
      nextButton = next;
      stage.append(prev, next);
    };

    const rebuildThumbs = () => {
      thumbs.innerHTML = "";
      if (hideThumbnails) return;

      visibleMedia.forEach((item, index) => {
        const thumb = document.createElement("button");
        thumb.type = "button";
        thumb.className = "gn-slider__thumb";
        thumb.setAttribute(
          "aria-label",
          isVideoItem(item) ? t("viewVideo", index + 1) : t("viewImage", index + 1),
        );
        thumb.innerHTML = `<img src="${item.thumb || item.src}" alt=""${thumbLoadingAttrs(settings)}>`;
        if (isPlayable(item)) thumb.append(playBadge());

        if (showsCaption) {
          // The proxy keys captions by normalized numeric id while Liquid emits the raw
          // one — the same mismatch `mediaForVariant` normalizes around. Alt text is the
          // fallback so these shapes say something before any caption is written.
          const caption =
            mediaKeys(item).map((key) => imageCaptions[key]).find(Boolean) ||
            item.alt ||
            "";

          if (caption) {
            const captionNode = document.createElement("span");
            captionNode.className =
              thumbHoverEffect === "caption" && thumbShape !== "polaroid" && thumbShape !== "card"
                ? "gn-slider__caption gn-slider__caption--overlay"
                : "gn-slider__caption";
            // textContent, never innerHTML: captions are merchant-authored free text and
            // interpolating them into the template above would be a stored-XSS vector.
            captionNode.textContent = caption;
            thumb.append(captionNode);
          }
        }

        thumb.addEventListener("click", () => setActive(index));
        thumbs.append(thumb);
      });
    };

    const ANIMATION_CLASSES = [
      "gn-anim--fade",
      "gn-anim--slide-forward",
      "gn-anim--slide-back",
      "gn-anim--zoom",
    ];

    /**
     * `forward` must be decided from the *raw* index, before the wrap below folds it
     * back into range: next-from-last arrives as `length` and prev-from-first as `-1`,
     * so comparing the wrapped values would reverse the direction on exactly those two
     * moves. Removing the class and forcing a reflow restarts an animation that is
     * already running, which a repeated tap in the same direction otherwise would not.
     */
    const playTransition = (forward, transition, durationMs) => {
      if (transition === "none" || !frame) return;

      frame.classList.remove(...ANIMATION_CLASSES);
      void frame.offsetWidth;
      // Written on every play, not just the hover ones: a conditional override would
      // leave the clamped hover duration on the element after the cursor left, and the
      // next arrow click would quietly animate at hover speed instead of the configured
      // one. `--gn-transition-speed` stays as the stylesheet-level default.
      frame.style.animationDuration = `${durationMs}ms`;

      if (transition === "fade") frame.classList.add("gn-anim--fade");
      else if (transition === "zoom") frame.classList.add("gn-anim--zoom");
      else frame.classList.add(forward ? "gn-anim--slide-forward" : "gn-anim--slide-back");
    };

    const setActive = (index, { hover = false, scroll = true } = {}) => {
      const forward = index > activeIndex;
      activeIndex = settings.loopSlides === false
        ? Math.min(Math.max(index, 0), visibleMedia.length - 1)
        : (index + visibleMedia.length) % visibleMedia.length;
      if (isCarousel) {
        // Nothing to swap — every slide already holds its image, so "active" means
        // "scrolled to". `is-zooming` deliberately stays off the stage here: that rule
        // matches every image in the track and would scale the whole row at once.
        // `scroll: false` is how the drag-bar sync updates the index without re-scrolling
        // the track it is reacting to.
        if (scroll) {
          slides[activeIndex]?.scrollIntoView({
            behavior: booting ? "auto" : "smooth",
            block: "nearest",
            inline: "start",
          });
        }
        if (scroller) {
          scroller.setAttribute("aria-valuenow", String(activeIndex + 1));
        }
      } else {
        const item = visibleMedia[activeIndex];
        main.src = item.zoom || item.src;
        main.alt = item.alt || "";
        // A click-armed zoom survives slide and variant changes — it is only turned
        // off by clicking the magnifier again — but the new image starts un-panned.
        // Never on a video, though: magnifying a poster tells the shopper nothing, and
        // the scaled-up frame fights the play badge for the same pixels.
        stage.classList.toggle("is-zooming", isZoomArmed && !isVideoItem(item));
        main.style.transformOrigin = "center";
        stagePlayBadge.hidden = !isPlayable(item);
      }
      if (settings.loopSlides === false) {
        if (prevButton) prevButton.disabled = activeIndex === 0;
        if (nextButton) nextButton.disabled = activeIndex === visibleMedia.length - 1;
      }
      thumbs.querySelectorAll(".gn-slider__thumb").forEach((thumb, thumbIndex) => {
        thumb.setAttribute("aria-current", String(thumbIndex === activeIndex));
      });
      // The boot call paints the first image; animating it would look like a glitch on
      // load rather than a response to anything the shopper did.
      if (!booting) {
        playTransition(
          forward,
          hover ? hoverTransition : imageTransition,
          hover ? hoverTransitionSpeed : transitionSpeed,
        );
        tracker.track("image_view");
      }
    };

    if (scroller && track) {
      let scrollEndTimer = null;

      /** Cheap and side-effect free, so it runs on every scroll event to stay live. */
      const syncThumb = () => {
        // Guarded so this can never write `width: NaN%` if called before layout.
        if (!track.scrollWidth) return;

        const visibleRatio = track.clientWidth / track.scrollWidth;
        const offsetRatio = track.scrollLeft / track.scrollWidth;
        scrollerThumb.style.width = `${Math.min(visibleRatio, 1) * 100}%`;
        scrollerThumb.style.left = `${offsetRatio * 100}%`;
      };

      /** The slide currently nearest the track's left edge. */
      const nearestIndex = () => {
        let closest = 0;
        let smallest = Infinity;
        slides.forEach((slide, index) => {
          const distance = Math.abs(slide.offsetLeft - track.scrollLeft);
          if (distance < smallest) {
            smallest = distance;
            closest = index;
          }
        });
        return closest;
      };

      const maxScroll = () => Math.max(track.scrollWidth - track.clientWidth, 0);

      const scrollToPointer = (event) => {
        const rect = scroller.getBoundingClientRect();
        const thumbWidth = scrollerThumb.offsetWidth;
        // Measured against the thumb's travel, not the whole bar, so grabbing the thumb
        // centre keeps it under the cursor instead of drifting ahead of it.
        const travel = Math.max(rect.width - thumbWidth, 1);
        const ratio = (event.clientX - rect.left - thumbWidth / 2) / travel;
        track.scrollLeft = Math.min(Math.max(ratio, 0), 1) * maxScroll();
      };

      track.addEventListener(
        "scroll",
        () => {
          syncThumb();
          // Debounced to scroll-end on purpose: syncing per event would fire an
          // `image_view` for every slide a drag or a smooth scroll passes through, so a
          // single gesture across the gallery would report the whole gallery as viewed.
          if (scrollEndTimer) window.clearTimeout(scrollEndTimer);
          scrollEndTimer = window.setTimeout(() => {
            const index = nearestIndex();
            if (index !== activeIndex) setActive(index, { scroll: false });
          }, 120);
        },
        { passive: true },
      );

      scroller.addEventListener("pointerdown", (event) => {
        scroller.setPointerCapture(event.pointerId);
        // Drives the `grabbing` cursor. A class rather than `:active` because the capture
        // above means the pointer leaves the thumb as soon as the drag starts, at which
        // point `:active` would stop matching and the cursor would flip back mid-gesture.
        scroller.classList.add("is-dragging");
        scrollToPointer(event);
      });
      scroller.addEventListener("pointermove", (event) => {
        if (scroller.hasPointerCapture(event.pointerId)) scrollToPointer(event);
      });
      // `pointercancel` as well as `pointerup`: a drag interrupted by the browser — a
      // system gesture, or the tab losing focus — never fires `pointerup`, and the cursor
      // would stay stuck as a closed hand.
      for (const type of ["pointerup", "pointercancel"]) {
        scroller.addEventListener(type, (event) => {
          // Guarded: the browser has already dropped the capture by the time
          // `pointercancel` fires, and releasing one that is gone throws.
          if (scroller.hasPointerCapture(event.pointerId)) {
            scroller.releasePointerCapture(event.pointerId);
          }
          scroller.classList.remove("is-dragging");
        });
      }

      // The gallery has no other keyboard navigation — the arrow-key handler lives in the
      // lightbox — so with thumbnails hidden this bar is the only control a keyboard user
      // has in slider mode.
      scroller.addEventListener("keydown", (event) => {
        if (event.key === "ArrowLeft") setActive(activeIndex - 1);
        else if (event.key === "ArrowRight") setActive(activeIndex + 1);
        else if (event.key === "Home") setActive(0);
        else if (event.key === "End") setActive(visibleMedia.length - 1);
        else return;
        event.preventDefault();
      });

      /**
       * Fewer images than fit on screen means nothing to scroll and a full-width thumb
       * that does nothing, so the bar hides rather than sitting there dead.
       *
       * Reversible and re-runnable on purpose. It cannot be decided once at build time:
       * the gallery still carries `[hidden]` then, which is `display: none`, so the track
       * measures 0 and every carousel would conclude it has nothing to scroll. It also
       * has to be re-run on resize, because `--gn-per-view` drops to 2 below 750px — a
       * gallery that does not overflow at 4-per-view does overflow at 2.
       */
      refreshScroller = () => {
        // Not laid out yet (still hidden, or detached). Measuring now would be wrong in
        // exactly the way that hid this bar permanently.
        if (!track.scrollWidth) return;

        const scrollable = maxScroll() > 0;
        scroller.hidden = !scrollable;
        if (scrollable) syncThumb();
      };

      if (typeof ResizeObserver === "function") {
        new ResizeObserver(() => refreshScroller()).observe(track);
      } else {
        window.addEventListener("resize", () => refreshScroller());
      }
    }

    const renderForVariant = (variantId) => {
      const variantMedia = mediaForVariant(allMedia, variantId, settings.variantImageMap);
      const variantFirstIndex = allMedia.findIndex(
        (item) => String(item.id) === String(variantMedia[0]?.id),
      );
      if (variantFirstIndex >= 0) setActive(variantFirstIndex);
    };

    /**
     * The element the pointer is currently zooming: the lone stage image in single mode,
     * or the hovered slide in a carousel. Measuring the *stage* in carousel mode would
     * put the transform origin in the wrong place on every slide but the first.
     */
    const zoomTargetFor = (event) => {
      if (!isCarousel) {
        // Video is never a zoom target: what is on screen is a poster, and magnifying it
        // shows the shopper a blurrier version of a still they cannot play from there.
        return isVideoItem(visibleMedia[activeIndex]) ? null : { box: stage, image: main };
      }

      const slide = event.target.closest?.(".gn-slider__slide");
      if (!slide) return null;
      if (isVideoItem(visibleMedia[slides.indexOf(slide)])) return null;

      return { box: slide, image: slide.querySelector(".gn-slider__main") };
    };

    const trackPointer = (event) => {
      const target = zoomTargetFor(event);
      if (!target?.image) return;

      const rect = target.box.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 100;
      const y = ((event.clientY - rect.top) / rect.height) * 100;
      target.image.style.transformOrigin = `${x}% ${y}%`;
    };

    /** Only the slide under the cursor magnifies; the rest of the row stays put. */
    const setSlideZoom = (event, on) => {
      const target = zoomTargetFor(event);
      if (!target) return;

      target.box.classList.toggle("is-zooming", on);
      if (!on && target.image) target.image.style.transformOrigin = "center";
    };

    const setZoomArmed = (next) => {
      // Only arming counts — disarming is the same shopper turning it back off.
      if (next && !isZoomArmed) tracker.track("zoom");
      isZoomArmed = next;
      // In a carousel the armed state is applied per slide as the cursor moves, so the
      // stage must never carry the class — it would scale every image at once.
      if (!isCarousel) {
        stage.classList.toggle("is-zooming", next);
        main.style.cursor = next ? "zoom-out" : "zoom-in";
        if (!next) main.style.transformOrigin = "center";
      } else {
        // Cursor goes on the images, not the stage: `.gn-slider__main` carries
        // `cursor: zoom-in` in CSS, which would win over an inline style on an ancestor.
        slides.forEach((slide) => {
          const image = slide.querySelector(".gn-slider__main");
          if (image) image.style.cursor = next ? "zoom-out" : "zoom-in";
          if (!next) {
            slide.classList.remove("is-zooming");
            if (image) image.style.transformOrigin = "center";
          }
        });
      }
      if (zoom) {
        zoom.classList.toggle("is-active", next);
        zoom.setAttribute("aria-pressed", String(next));
        zoom.setAttribute("aria-label", next ? t("zoomOut") : t("zoomIn"));
      }
    };

    let hoverTimer = null;
    let hoverIntent = null;
    let hoverDirection = 0;

    const stopHoverNav = () => {
      // Both handles: a pending first step left running would advance an image
      // the cursor has already moved away from.
      if (hoverIntent) window.clearTimeout(hoverIntent);
      if (hoverTimer) window.clearInterval(hoverTimer);
      hoverIntent = null;
      hoverTimer = null;
      hoverDirection = 0;
    };

    /** Advances one image. Returns false once a non-looping slider is at the end. */
    const hoverStep = (direction) => {
      if (settings.loopSlides === false) {
        const atEnd =
          direction > 0 ? activeIndex >= visibleMedia.length - 1 : activeIndex <= 0;
        if (atEnd) {
          stopHoverNav();
          return false;
        }
      }
      setActive(activeIndex + direction, { hover: true });
      return true;
    };

    const startHoverNav = (direction) => {
      if (hoverDirection === direction && (hoverTimer || hoverIntent)) return;

      stopHoverNav();
      hoverDirection = direction;
      hoverIntent = window.setTimeout(() => {
        hoverIntent = null;
        if (!hoverStep(direction)) return;
        hoverTimer = window.setInterval(() => hoverStep(direction), hoverSpeed);
      }, HOVER_INTENT_DELAY);
    };

    const openLightboxFromStage = () => {
      stopHoverNav();
      tracker.track("lightbox_open");
      const lightboxMedia = mediaForVariant(
        allMedia,
        currentVariantId(),
        settings.variantImageMap,
      );
      const lightboxStartIndex = Math.max(
        0,
        lightboxMedia.findIndex(
          (item) => String(item.id) === String(visibleMedia[activeIndex]?.id),
        ),
      );
      openLightbox(lightboxMedia, lightboxStartIndex, settings);
    };

    // One delegated listener on the track rather than a pair per slide: the slide count
    // is merchant data, and per-node listeners would need tearing down.
    const zoomHost = isCarousel ? track : stage;

    if (zoomTrigger === "hover") {
      zoomHost.addEventListener("mousemove", trackPointer);

      if (isCarousel) {
        zoomHost.addEventListener("mouseover", (event) => {
          const target = zoomTargetFor(event);
          if (!target || target.box.classList.contains("is-zooming")) return;
          setSlideZoom(event, true);
          tracker.track("zoom");
        });
        zoomHost.addEventListener("mouseout", (event) => setSlideZoom(event, false));
      } else {
        zoomHost.addEventListener("mouseenter", () => {
          if (isVideoItem(visibleMedia[activeIndex])) return;
          stage.classList.add("is-zooming");
          tracker.track("zoom");
        });
        zoomHost.addEventListener("mouseleave", () => {
          stage.classList.remove("is-zooming");
          main.style.transformOrigin = "center";
        });
      }
    } else if (zoomTrigger === "click") {
      // No mouseenter/mouseleave: the magnifier stays on once armed, even when the
      // cursor leaves the image, until the icon is clicked a second time.
      zoomHost.addEventListener("mousemove", (event) => {
        if (!isZoomArmed) return;
        trackPointer(event);
        // Armed zoom follows the cursor from slide to slide, so the class has to move
        // with it rather than being set once.
        if (isCarousel) setSlideZoom(event, true);
      });

      if (isCarousel) {
        zoomHost.addEventListener("mouseout", (event) => {
          if (isZoomArmed) setSlideZoom(event, false);
        });
        slides.forEach((slide, index) => {
          const image = slide.querySelector(".gn-slider__main");
          if (!image) return;
          image.style.cursor = "zoom-in";
          image.addEventListener("click", () => {
            // `openLightboxFromStage` starts from `activeIndex`, so without this a click
            // on the fourth slide would open the lightbox on the first.
            setActive(index);
            openLightboxFromStage();
          });
        });
      } else {
        main.style.cursor = "zoom-in";
        // The magnifier icon owns the zoom here, so the lightbox moves to the image.
        main.addEventListener("click", openLightboxFromStage);
      }
    } else if (isCarousel) {
      slides.forEach((slide) => {
        const image = slide.querySelector(".gn-slider__main");
        if (image) image.style.cursor = hideZoomIcon ? "default" : "pointer";
      });
    } else {
      main.style.cursor = hideZoomIcon ? "default" : "pointer";
    }

    if (canHoverNavigate && visibleMedia.length > 1) {
      stage.addEventListener("mousemove", (event) => {
        // Hover cycling exists for flipping through photos. Letting it run on a video
        // would advance the gallery out from under a shopper who is reaching for the play
        // badge, which is the one thing they can do with this slide.
        if (isVideoItem(visibleMedia[activeIndex])) {
          stopHoverNav();
          return;
        }

        const rect = stage.getBoundingClientRect();
        // The near half of the chosen axis goes back, the far half goes forward —
        // unless inverted, which swaps the two halves.
        const nearHalf =
          hoverAxis === "vertical"
            ? event.clientY - rect.top < rect.height / 2
            : event.clientX - rect.left < rect.width / 2;
        const direction = (nearHalf ? -1 : 1) * (hoverInvert ? -1 : 1);
        startHoverNav(direction);
        // Leave the cursor alone while an armed zoom owns it.
        if (!isZoomArmed) {
          main.style.cursor =
            hoverAxis === "vertical"
              ? direction > 0
                ? "s-resize"
                : "n-resize"
              : direction > 0
                ? "e-resize"
                : "w-resize";
        }
      });
      stage.addEventListener("mouseleave", stopHoverNav);
    }

    /**
     * Playback lives in the lightbox, so a video has to open it on click whatever the
     * zoom trigger is. `click` already wires the stage and every slide to the lightbox;
     * `hover` and `off` do not, which would leave a video with no way to play at all
     * beyond the corner magnifier — and that is hidden whenever `hideZoomIcon` is set.
     */
    if (zoomTrigger !== "click") {
      zoomHost.addEventListener("click", (event) => {
        const index = isCarousel
          ? slides.indexOf(event.target.closest?.(".gn-slider__slide"))
          : activeIndex;
        if (index < 0 || !isPlayable(visibleMedia[index])) return;

        // A click on a non-active carousel slide should play *that* video, and
        // `openLightboxFromStage` starts from whatever is active.
        if (isCarousel && index !== activeIndex) setActive(index);
        openLightboxFromStage();
      });
    }

    zoom?.addEventListener("click", (event) => {
      event.stopPropagation();
      if (zoomTrigger === "click") {
        setZoomArmed(!isZoomArmed);
        return;
      }
      openLightboxFromStage();
    });

    if (settings.syncVariantImages) {
      wireVariantChanges(renderForVariant);
    }

    rebuildThumbs();
    rebuildNavigation();
    setActive(0);
    if (settings.syncVariantImages) {
      renderForVariant(currentVariantId());
    }
    booting = false;
    tracker.track("gallery_view");
    root.hidden = false;
    // Must come after the unhide: until this line the gallery is `display: none`, so the
    // track measures 0 and the drag bar would conclude it has nothing to scroll.
    refreshScroller();
  };

  const wireVariantChanges = (renderForVariant) => {
    const update = (variantId) => window.requestAnimationFrame(() => renderForVariant(variantId));

    document.addEventListener("change", (event) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.matches('form[action*="/cart/add"] select, form[action*="/cart/add"] input') ||
          target.closest("variant-selects, variant-radios, product-form"))
      ) {
        update(currentVariantId());
      }
    });

    ["variant:change", "variantChange", "product:variant-change"].forEach((eventName) => {
      document.addEventListener(eventName, (event) => {
        update(event.detail?.variant?.id || event.detail?.variantId || currentVariantId());
      });
    });

    ["pushState", "replaceState"].forEach((method) => {
      const original = window.history[method];
      if (!original || original.galleryNestWrapped) return;

      window.history[method] = function (...args) {
        const result = original.apply(this, args);
        window.dispatchEvent(new Event("gallery-nest:url-change"));
        return result;
      };
      window.history[method].galleryNestWrapped = true;
    });

    window.addEventListener("popstate", () => update(currentVariantId()));
    window.addEventListener("gallery-nest:url-change", () => update(currentVariantId()));
  };

  const init = async (root) => {
    if (root.dataset.galleryNestReady === "true") return;

    root.dataset.galleryNestReady = "true";
    root.dataset.galleryNestVersion = VERSION;

    const media = getMedia(root);
    const variants = getVariants(root);
    const mediaWithFallbackVariantIds = media.map((item) => ({
      ...item,
      variantIds:
        item.variantIds?.length > 0
          ? item.variantIds
          : variants
              .filter((variant) =>
                mediaKeys(item).includes(normalizeId(variant.mediaId)),
              )
              .map((variant) => variant.id),
    }));
    const productId = root.dataset.productId;
    const appProxyPath = root.dataset.appProxyPath || "/apps/gallery-nest/slider-settings";
    const hasOnlyDefaultVariant = root.dataset.hasOnlyDefaultVariant === "true";

    if (!productId) return;

    try {
      const response = await fetch(`${appProxyPath}?product_id=${encodeURIComponent(productId)}`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return;

      const settings = await response.json();
      if (!settings.enabled) return;

      const finalSettings = {
        ...settings,
        hideThumbnails: hasOnlyDefaultVariant || settings.hideThumbnails,
        // Carried through for the analytics beacon, which reports per product.
        productId,
      };

      // Applied before both calls below: `replaceNativeGallery` matches the theme's own
      // gallery against these URLs, and `renderSlider` treats index 0 as the opening
      // slide — so reordering afterwards would leave the wrong image showing first.
      const orderedMedia = orderMedia(mediaWithFallbackVariantIds, settings.mediaOrder);

      if (settings.replaceThemeGallery !== false) {
        replaceNativeGallery(root, orderedMedia, themeSelectors(root, settings));
      }
      renderSlider(root, orderedMedia, settings.thumbnailPosition, finalSettings);
    } catch {
      root.dataset.galleryNestReady = "false";
    }
  };

  const initAll = () => {
    document.querySelectorAll(ROOT_SELECTOR).forEach(init);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAll);
  } else {
    initAll();
  }
})();
