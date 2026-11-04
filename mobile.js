/* ==========================================================================
   mobile.js - the small behaviours the phone layout needs.

   The site's own script builds the mobile nav drawer and the fixed player bar,
   but nothing owns the bits between them:

     - the drawer sits over the page with no scrim, so tapping outside it does
       nothing and the page scrolls underneath while it is open;
     - its height is 100vh, which on phones is taller than the visible area
       once the browser toolbar is showing, so its last items are cut off;
     - the page spacer under the player bar is a fixed guess, so it either
       leaves a gap or hides the footer depending on the bar's real height;
     - the polish stylesheet has to stay after the theme's stylesheet, or the
       theme wins and the heavy effects come back.

   This file fixes those four things and nothing else. It adds no dependency
   and does no work while the page is simply being read.
   ========================================================================== */
(function () {
    "use strict";

    const BREAKPOINT = 820;
    const root = document.documentElement;
    const body = document.body;

    const nav = () => document.querySelector(".site-nav");
    const toggle = () => document.querySelector(".nav-mobile-toggle");
    const isOpen = () => {
        const node = nav();
        return Boolean(node && node.classList.contains("open"));
    };

    let scrim = null;

    function scrimNode() {
        if (scrim && scrim.isConnected) return scrim;
        scrim = document.createElement("div");
        scrim.className = "xid-nav-scrim";
        scrim.id = "xid-nav-scrim";
        scrim.setAttribute("aria-hidden", "true");
        scrim.addEventListener("click", close);
        body.appendChild(scrim);
        return scrim;
    }

    /* site.js owns the toggle; this only mirrors its state. */
    function sync() {
        const open = isOpen();
        body.classList.toggle("nav-open", open);
        const button = toggle();
        if (button) button.setAttribute("aria-expanded", open ? "true" : "false");
        return open;
    }

    function close() {
        const node = nav();
        if (!node || !node.classList.contains("open")) return false;
        node.classList.remove("open");
        const button = toggle();
        if (button) button.setAttribute("aria-expanded", "false");
        sync();
        return true;
    }

    /* The spacer under the fixed bar should be the bar's height, not a guess. */
    function measurePlayer() {
        const bar = document.querySelector(".player-bar");
        if (!bar) return 0;
        const height = Math.round(bar.getBoundingClientRect().height);
        if (height > 0) root.style.setProperty("--xid-player-h", `${height}px`);
        return height;
    }

    /* 100vh includes the browser toolbar area on phones; 100dvh does not. This
       is a fallback for browsers without dvh support. */
    function measureViewport() {
        const height = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        if (height > 0) root.style.setProperty("--xid-vh", `${Math.round(height / 100)}px`);
        return Math.round(height / 100 * 10) / 10;
    }

    /* The theme's stylesheet is appended after the polish sheet when a theme
       loads, which would put the theme back in front. Moving the polish sheet
       to the end of the head settles the order for good. */
    function raisePolish() {
        const links = [...document.querySelectorAll('link[rel="stylesheet"]')];
        const polish = links.find(link => /style-perf\.css(\?|$)/.test(link.getAttribute("href") || ""));
        if (polish && polish !== document.head.lastElementChild) document.head.appendChild(polish);
    }

    function onOutside(event) {
        if (!isOpen()) return;
        const node = nav();
        const button = toggle();
        const target = event.target;
        if (node && node.contains(target)) return;
        if (button && button.contains(target)) return;
        close();
    }

    function wire() {
        scrimNode();
        sync();

        const node = nav();
        if (node && typeof MutationObserver === "function") {
            new MutationObserver(() => sync()).observe(node, { attributes: true, attributeFilter: ["class"] });
        }

        document.addEventListener("pointerdown", onOutside, { passive: true });
        document.addEventListener("keydown", event => {
            if (event.key === "Escape") close();
        });
        window.addEventListener("hashchange", close);
        window.addEventListener("resize", () => {
            measureViewport();
            measurePlayer();
            if (window.innerWidth > BREAKPOINT) close();
        }, { passive: true });
        window.addEventListener("orientationchange", () => {
            window.setTimeout(() => {
                measureViewport();
                measurePlayer();
            }, 120);
        }, { passive: true });

        // The theme can apply after load, and the bar's height changes when the
        // title wraps or the visualizer opens, so keep measuring.
        if (typeof MutationObserver === "function") {
            new MutationObserver(raisePolish).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
        }
        const bar = document.querySelector(".player-bar");
        if (bar && typeof ResizeObserver === "function") {
            new ResizeObserver(measurePlayer).observe(bar);
        }

        measureViewport();
        measurePlayer();
        raisePolish();
        window.setTimeout(() => {
            measurePlayer();
            raisePolish();
        }, 1200);
    }

    /* Exposed so the behaviour is testable without a browser. */
    window.XIDMobile = {
        isOpen,
        close,
        sync,
        measurePlayer,
        measureViewport,
        raisePolish
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", wire);
    } else {
        wire();
    }
})();
