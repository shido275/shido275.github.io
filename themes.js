/* ==========================================================================
   Theme loader.

   Reads themes.json and paints the page with one of the palettes listed there.
   A palette is just the set of custom properties the stylesheets already read
   (--bg, --text, --blood, ...), so an old theme can be brought back without
   keeping old stylesheets around.

   A theme may also name its own stylesheet ("css"). That is for a look that
   changed the layout, the type and the background too, not just the colours:
   the file is injected after the site's own stylesheets while that theme is
   active, and taken out again when the theme changes, so nothing leaks into
   the next look.

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
    const LINK_ID = "xid-theme-css";
    const root = document.documentElement;

    const cssName = name => (String(name).startsWith("--") ? String(name) : `--${name}`);

    /* One slot for a theme's own stylesheet: swapped in place, removed when a
       theme without one takes over. Appended last so it wins over style.css. */
    function stylesheet(href) {
        const existing = document.getElementById(LINK_ID);
        const url = href ? String(href) : "";
        if (!url) {
            if (existing) existing.remove();
            return;
        }
        if (existing) {
            if (existing.getAttribute("href") !== url) existing.setAttribute("href", url);
            return;
        }
        const link = document.createElement("link");
        link.id = LINK_ID;
        link.rel = "stylesheet";
        link.href = url;
        document.head.appendChild(link);
    }

    function apply(theme) {
        if (!theme || !theme.vars || typeof theme.vars !== "object") return false;
        Object.keys(theme.vars).forEach(name => {
            const value = theme.vars[name];
            if (value == null || value === "") return;
            root.style.setProperty(cssName(name), String(value));
        });
        root.setAttribute("data-theme", theme.id || "");
        stylesheet(theme.css);
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

/* ==========================================================================
   The data layer, the cycled background and the visualizer are pulled in from
   here so the page keeps the script tags it already had. async=false keeps them
   in order and delays DOMContentLoaded, so feed.js has wrapped fetch before
   site.js asks it for anything, background.js has a body to paint behind, and
   visualizer.js has replaced the old paint loop before the audio starts.
   ========================================================================== */
(function () {
    "use strict";
    const here = document.currentScript;
    const anchor = here && here.nextSibling;

    // Loaded last so it wins over style.css and the theme's own stylesheet.
    const polish = document.createElement("link");
    polish.rel = "stylesheet";
    polish.href = "style-perf.css";
    document.head.appendChild(polish);

    /* Every theme moves: theme-motion.css paints these two fixed, empty layers
       while its theme is active. They are mounted straight away so switching
       theme never flashes a gap, and they take no pointer events. */
    const motion = document.createElement("link");
    motion.rel = "stylesheet";
    motion.href = "theme-motion.css";
    document.head.appendChild(motion);

    const stage = document.createElement("div");
    stage.className = "xid-motion";
    stage.setAttribute("aria-hidden", "true");
    stage.innerHTML = '<span class="xid-motion__a"></span><span class="xid-motion__b"></span>';
    (document.body || document.documentElement).appendChild(stage);

    ["feed.js", "background.js", "visualizer.js", "mobile.js", "profile.js"].forEach(src => {
        const script = document.createElement("script");
        script.src = src;
        script.async = false;
        if (anchor && anchor.parentNode) {
            anchor.parentNode.insertBefore(script, anchor);
        } else {
            document.body.appendChild(script);
        }
    });
})();
