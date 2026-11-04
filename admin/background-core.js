/* ==========================================================================
   Background core - pure functions for the site backdrop.

   The dashboard decides what the list looks like, this turns it into the writes
   one commit needs: the uploaded files, any file that is no longer referenced,
   and backgrounds.json itself. No DOM, no network, so it can be tested.
   ========================================================================== */
(function (global, factory) {
    "use strict";
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    if (global) global.BackgroundCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    const BACKGROUND_PATH = "backgrounds.json";
    const BACKGROUND_DIR = "assets/backgrounds";
    const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".svg"];
    const VIDEO_EXTENSIONS = [".mp4", ".webm", ".mov", ".m4v"];
    const TRANSITIONS = ["fade", "cut"];
    const MAX_IMAGE_BYTES = 45 * 1024 * 1024;
    const MAX_VIDEO_BYTES = 90 * 1024 * 1024;

    function ext(name) {
        const index = String(name).lastIndexOf(".");
        return index <= 0 ? "" : String(name).slice(index).toLowerCase();
    }

    function baseName(name) {
        const index = String(name).lastIndexOf(".");
        return index <= 0 ? String(name) : String(name).slice(0, index);
    }

    // "image" | "video" | "" - decided by the file name or the URL extension.
    function kindOf(name) {
        const suffix = ext(name);
        if (IMAGE_EXTENSIONS.includes(suffix)) return "image";
        if (VIDEO_EXTENSIONS.includes(suffix)) return "video";
        return "";
    }

    function slugify(value) {
        const slug = String(value || "")
            .normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^\w\s-]/g, "")
            .trim()
            .replace(/\s+/g, "-")
            .toLowerCase()
            .slice(0, 48);
        return slug || "background";
    }

    function clean(value) {
        return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
    }

    function formatBytes(bytes) {
        const value = Number(bytes) || 0;
        if (value < 1024) return `${value} B`;
        if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
        return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    }

    function clamp(value, min, max, fallback) {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.min(max, Math.max(min, number));
    }

    function isInsideBackgroundDir(path) {
        return String(path || "").startsWith(`${BACKGROUND_DIR}/`);
    }

    /* items: [{ file?, src, kind?, caption }]
       settings: { enabled, interval, transition, dim, blur }
       existing: the backgrounds.json currently on the branch (for clean-up) */
    function planBackground(options) {
        const opts = options || {};
        const settings = opts.settings || {};
        const warnings = [];
        const writes = [];
        const used = new Set();
        const items = [];

        (opts.items || []).forEach(item => {
            if (!item) return;
            let src = clean(item.src);
            let kind = item.kind === "video" || item.kind === "image" ? item.kind : kindOf(src);

            if (item.file) {
                const fileKind = kindOf(item.file.name);
                if (!fileKind) {
                    warnings.push(`${item.file.name} is not an image (.jpg, .png, .webp, .gif, .avif) or a video (.mp4, .webm, .mov).`);
                    return;
                }
                if (fileKind === "video" && item.file.size > MAX_VIDEO_BYTES) {
                    warnings.push(`${item.file.name} is ${formatBytes(item.file.size)} - over 90 MB. Trim it or host it elsewhere.`);
                    return;
                }
                if (fileKind === "image" && item.file.size > MAX_IMAGE_BYTES) {
                    warnings.push(`${item.file.name} is ${formatBytes(item.file.size)} - too large for GitHub.`);
                    return;
                }
                const base = slugify(baseName(item.file.name));
                let name = `${base}${ext(item.file.name)}`;
                let counter = 2;
                while (used.has(name.toLowerCase())) {
                    name = `${base}-${counter}${ext(item.file.name)}`;
                    counter += 1;
                }
                used.add(name.toLowerCase());
                src = `${BACKGROUND_DIR}/${name}`;
                kind = fileKind;
                writes.push({ path: src, kind: `background-${fileKind}`, file: item.file });
            }

            if (!src) return;
            if (/^\s*(javascript|vbscript):/i.test(src)) {
                warnings.push(`"${src}" is not a usable background - dropped.`);
                return;
            }
            if (/^http:\/\//i.test(src)) {
                warnings.push(`"${src}" is plain http:// - an https site will block it. Host it on https instead.`);
                return;
            }
            if (!kind) {
                warnings.push(`"${src}" has no image or video extension, so it is treated as an image.`);
                kind = "image";
            }

            items.push({ src, kind, caption: clean(item.caption) });
        });

        const doc = {
            enabled: settings.enabled !== false,
            interval: clamp(settings.interval, 3, 120, 9),
            transition: TRANSITIONS.includes(settings.transition) ? settings.transition : "fade",
            dim: clamp(settings.dim, 0, 0.95, 0.55),
            blur: clamp(settings.blur, 0, 24, 0),
            items
        };

        writes.push({
            path: BACKGROUND_PATH,
            kind: "background-index",
            text: `${JSON.stringify(doc, null, 2)}\n`
        });

        // Uploaded files this change no longer uses are deleted in the same commit.
        const keep = new Set(items.map(item => item.src.toLowerCase()));
        (opts.existing && Array.isArray(opts.existing.items) ? opts.existing.items : []).forEach(item => {
            const src = clean(item && item.src);
            if (!src || !isInsideBackgroundDir(src)) return;
            if (!keep.has(src.toLowerCase())) writes.push({ path: src, kind: "delete", delete: true });
        });

        if (!items.length) warnings.push("The list is empty - the site keeps its plain backdrop.");
        if (items.length === 1 && items[0].kind === "video") warnings.push("A single video loops forever; add images to break it up.");

        const totalBytes = writes.reduce((sum, write) => (
            sum + (write.file ? write.file.size : (write.text ? write.text.length : 0))
        ), 0);

        return { writes, doc, warnings, totalBytes, count: items.length };
    }

    /* Whatever is on the branch -> the shape the editor works with. */
    function readBackground(source) {
        const doc = source && typeof source === "object" ? source : {};
        return {
            enabled: doc.enabled !== false,
            interval: clamp(doc.interval, 3, 120, 9),
            transition: TRANSITIONS.includes(doc.transition) ? doc.transition : "fade",
            dim: clamp(doc.dim, 0, 0.95, 0.55),
            blur: clamp(doc.blur, 0, 24, 0),
            items: (Array.isArray(doc.items) ? doc.items : [])
                .filter(item => item && item.src)
                .map(item => ({
                    src: clean(item.src),
                    kind: item.kind === "video" ? "video" : kindOf(item.src) || "image",
                    caption: clean(item.caption)
                }))
        };
    }

    return {
        BACKGROUND_PATH,
        BACKGROUND_DIR,
        IMAGE_EXTENSIONS,
        VIDEO_EXTENSIONS,
        TRANSITIONS,
        MAX_IMAGE_BYTES,
        MAX_VIDEO_BYTES,
        ext,
        baseName,
        kindOf,
        slugify,
        clean,
        formatBytes,
        clamp,
        planBackground,
        readBackground
    };
});
