/* ==========================================================================
   Profile photo - the picture at the top of the All Links page, reused as a
   dimmed backdrop behind the first section of the EPK.

   profile.json is written by the dashboard's Profile panel. It is kept apart
   from links.json on purpose: the link tools rewrite their whole document, so a
   photo stored in there would be dropped the next time anything was reordered.
   A missing, empty or broken file leaves the hand-written avatar exactly as it
   is - nothing here runs unless there is a photo to show.
   ========================================================================== */
(function () {
    "use strict";

    const PROFILE_URL = "profile.json";
    const DEFAULT_SRC = "assets/profile-avatar.png";
    const DEFAULT_ALT = "X/i\\D profile image";
    /* Repo paths and https URLs only: this value is handed to an <img> and to a
       CSS url(), so nothing that could smuggle in script or break the rule. */
    const SAFE_SRC = /^(?:[A-Za-z0-9._~/-]+|https?:\/\/[^\s"'()]+)$/;

    /* The path ends up inside url(""), so any quote, paren or space is encoded
       before it can close the value. */
    function cssUrl(src) {
        return `url("${String(src).replace(/["'()\\\s]/g, character => encodeURIComponent(character))}")`;
    }

    function apply(doc) {
        if (!doc || typeof doc !== "object") return;
        const src = typeof doc.src === "string" ? doc.src.trim() : "";
        if (!src || !SAFE_SRC.test(src)) return;
        const alt = (typeof doc.alt === "string" && doc.alt.trim()) || DEFAULT_ALT;

        const avatar = document.querySelector(".all-links-hero .profile-avatar");
        if (avatar) {
            avatar.alt = alt;
            // A path that no longer exists must not leave a broken image.
            avatar.addEventListener("error", () => {
                avatar.src = DEFAULT_SRC;
            }, { once: true });
            avatar.src = src;
        }

        /* The backdrop only appears once the photo has decoded, so a missing
           file never leaves the EPK hero with a half-painted layer. */
        const hero = document.querySelector("#view-epk .hero");
        if (!hero) return;
        const probe = new Image();
        probe.onload = () => {
            hero.style.setProperty("--epk-profile", cssUrl(src));
            hero.classList.add("has-profile-bg");
        };
        probe.src = src;
    }

    async function load() {
        try {
            const response = await fetch(`${PROFILE_URL}?v=${Date.now()}`, { cache: "no-store" });
            if (!response.ok) return;
            apply(await response.json());
        } catch {
            /* no profile.json yet (or offline): the static markup stands */
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", load);
    } else {
        load();
    }
})();
