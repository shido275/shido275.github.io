/* ==========================================================================
   Theme loader.

   Reads themes.json and paints the page with one of the palettes listed there.
   A palette is just the set of custom properties the stylesheets already read
   (--bg, --text, --blood, ...), so an old theme can be brought back without
   keeping old stylesheets around.

   Two modes, both decided in the dashboard:
     - fixed    one theme, chosen once
     - rotate   a different theme on every page load (never the same twice in a
                row, so it visibly changes)
   A ?theme=<id> query string previews one theme without touching the saved
   choice, which is handy for checking an old look before switching to it.
   ========================================================================== */
(function () {
    "use strict";

    const THEMES_URL = "themes.json";
    const LAST_KEY = "xid.theme.last";
    const root = document.documentElement;

    const cssName = name => (String(name).startsWith("--") ? String(name) : `--${name}`);

    function apply(theme) {
        if (!theme || !theme.vars || typeof theme.vars !== "object") return false;
        Object.keys(theme.vars).forEach(name => {
            const value = theme.vars[name];
            if (value == null || value === "") return;
            root.style.setProperty(cssName(name), String(value));
        });
        root.setAttribute("data-theme", theme.id || "");
        return true;
    }

    function requestedId() {
        try {
            return new URLSearchParams(window.location.search).get("theme") || "";
        } catch {
            return "";
        }
    }

    function readLast() {
        try {
            return window.sessionStorage.getItem(LAST_KEY) || "";
        } catch {
            return "";
        }
    }

    function remember(id) {
        try {
            window.sessionStorage.setItem(LAST_KEY, id);
        } catch {
            /* private mode: rotation just may repeat */
        }
    }

    function choose(doc) {
        const themes = Array.isArray(doc && doc.themes)
            ? doc.themes.filter(theme => theme && theme.id && theme.vars && typeof theme.vars === "object")
            : [];
        if (!themes.length) return null;

        const wanted = requestedId();
        if (wanted) {
            const preview = themes.find(theme => theme.id === wanted);
            if (preview) return preview;
        }

        const fallback = themes.find(theme => theme.id === doc.default) || themes[0];
        if (!doc.rotate) return fallback;

        // Rotation: a different theme each load, never the one before it.
        const last = readLast();
        const pool = themes.length > 1 ? themes.filter(theme => theme.id !== last) : themes;
        const next = pool[Math.floor(Math.random() * pool.length)] || fallback;
        remember(next.id);
        return next;
    }

    async function load() {
        try {
            const response = await fetch(`${THEMES_URL}?v=${Date.now()}`, { cache: "no-cache" });
            if (!response.ok) return null;
            const doc = await response.json();
            const theme = choose(doc);
            if (!theme) return null;
            apply(theme);
            return theme;
        } catch {
            // A missing or broken themes.json leaves the stylesheet's own palette.
            return null;
        }
    }

    window.XIDTheme = {
        apply,
        load,
        current: () => root.getAttribute("data-theme") || ""
    };

    load();
})();
