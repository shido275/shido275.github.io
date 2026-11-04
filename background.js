/* ==========================================================================
   background.js - the site's cycled backdrop.

   backgrounds.json lists images, GIFs and video clips; this paints them into
   two fixed layers behind everything else and crossfades between them. An open
   tab picks up a dashboard publish on its own (feed.js watches the file).

   Nothing here runs when the list is empty, so the stylesheet's own backdrop
   stays exactly as designed until a background is actually published.
   ========================================================================== */
(function () {
    "use strict";

    const FEED = window.XIDFeed;
    const PATH = "backgrounds.json";
    const DEFAULTS = { enabled: true, interval: 9, transition: "fade", dim: 0.55, blur: 0 };

    const state = {
        doc: DEFAULTS,
        items: [],
        index: 0,
        active: 0,
        timer: 0,
        layers: [],
        root: null
    };

    const reducedMotion = () => Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

    function ensureRoot() {
        if (state.root) return state.root;
        const root = document.createElement("div");
        root.className = "xid-backdrop";
        root.setAttribute("aria-hidden", "true");
        for (let index = 0; index < 2; index += 1) {
            const layer = document.createElement("div");
            layer.className = "xid-backdrop__layer";
            root.appendChild(layer);
            state.layers.push(layer);
        }
        const scrim = document.createElement("div");
        scrim.className = "xid-backdrop__scrim";
        root.appendChild(scrim);
        document.body.insertBefore(root, document.body.firstChild);
        state.root = root;
        return root;
    }

    function makeNode(item) {
        if (item.kind === "video") {
            const video = document.createElement("video");
            video.src = FEED ? FEED.media(item.src) : item.src;
            video.muted = true;
            video.loop = true;
            video.autoplay = true;
            video.setAttribute("muted", "");
            video.setAttribute("playsinline", "");
            video.setAttribute("preload", "auto");
            const playback = video.play();
            if (playback && typeof playback.catch === "function") playback.catch(() => {});
            return video;
        }
        const img = document.createElement("img");
        img.src = FEED ? FEED.media(item.src) : item.src;
        img.alt = item.caption || "";
        img.decoding = "async";
        return img;
    }

    function preload(item) {
        if (!item || item.kind === "video" || !FEED) return Promise.resolve();
        return new Promise(resolve => {
            const probe = new Image();
            probe.onload = resolve;
            probe.onerror = resolve;
            probe.src = FEED.media(item.src);
        });
    }

    async function show(index) {
        if (!state.items.length || !state.layers.length) return;
        const item = state.items[index % state.items.length];
        await preload(item);
        const next = (state.active + 1) % 2;
        const layer = state.layers[next];
        layer.innerHTML = "";
        layer.appendChild(makeNode(item));
        layer.classList.add("is-on");
        state.layers[state.active].classList.remove("is-on");
        state.active = next;
        state.index = index % state.items.length;
    }

    function schedule() {
        clearTimeout(state.timer);
        if (state.items.length < 2 || reducedMotion()) return;
        const every = Math.max(3000, (Number(state.doc.interval) || DEFAULTS.interval) * 1000);
        state.timer = setTimeout(async () => {
            if (!document.hidden) await show(state.index + 1);
            schedule();
        }, every);
    }

    function clearLayers() {
        state.layers.forEach(layer => {
            layer.classList.remove("is-on");
            layer.innerHTML = "";
        });
        state.active = 0;
        state.index = 0;
    }

    function restart(doc) {
        state.doc = doc && typeof doc === "object" ? doc : DEFAULTS;
        const settings = state.doc;
        state.items = (Array.isArray(settings.items) ? settings.items : []).filter(item => item && item.src);

        clearTimeout(state.timer);
        const root = ensureRoot();
        root.style.setProperty("--xid-bg-dim", String(settings.dim == null ? DEFAULTS.dim : settings.dim));
        root.style.setProperty("--xid-bg-blur", `${Number(settings.blur) || 0}px`);
        root.style.setProperty("--xid-bg-fade", settings.transition === "cut" ? "0.001s" : "1.2s");

        if (!settings.enabled || !state.items.length) {
            clearLayers();
            document.documentElement.removeAttribute("data-background");
            return;
        }

        document.documentElement.setAttribute("data-background", "on");
        clearLayers();
        show(0).then(schedule);
    }

    async function boot() {
        if (!document.body) return;
        const doc = FEED ? await FEED.json(PATH) : null;
        restart(doc);

        if (FEED && FEED.watch) {
            FEED.watch([PATH], async () => {
                restart(await FEED.json(PATH));
            }, 25000);
        }

        document.addEventListener("visibilitychange", () => {
            if (!document.hidden && state.items.length > 1) schedule();
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }
})();
