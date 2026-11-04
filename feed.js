/* ==========================================================================
   feed.js - content straight from the commit, not from the Pages build.

   GitHub Pages only serves a new commit once it has rebuilt (a minute or two),
   and it caches its own JSON for ten minutes on top of that. raw.githubusercontent
   serves the exact blob the moment the branch moves, allows cross-origin reads
   and supports range requests, so a dashboard publish is live in seconds.

   This file sits in front of window.fetch and quietly does two things:

     1. A JSON file that belongs to this repo is read from raw first, with a
        cache-buster, and from Pages only if raw cannot answer.
     2. The media paths inside those files (audio, covers, photos, clips) and
        the download_url values from the GitHub contents API are re-pointed at
        raw, so a track uploaded a moment ago plays without waiting for a build.

   Everything else - third-party endpoints, POSTs, non-JSON - passes through
   untouched. Naming, ordering and fallbacks stay exactly as the page expects.

   window.XIDFeed
     .json(path)       -> parsed JSON from the commit, or the fallback
     .text(path)       -> raw text, or null
     .media(url)       -> repo path or Pages URL -> cache-busted raw URL
     .repoPath(url)    -> repo-relative path, or "" for external/inline
     .rawUrl(path)     -> absolute raw URL
     .watch(paths, cb) -> poll and fire once when a committed file changes
   ========================================================================== */
(function () {
    "use strict";

    const DEFAULT_SITE = { owner: "shido275", repo: "shido275.github.io", branch: "main" };
    const site = window.SITE_CONFIG || DEFAULT_SITE;
    const OWNER = site.owner || DEFAULT_SITE.owner;
    const REPO = site.repo || DEFAULT_SITE.repo;
    const BRANCH = site.branch || DEFAULT_SITE.branch;
    const RAW_ROOT = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/`;
    const TIMEOUT = 8000;

    const originalFetch = typeof window.fetch === "function" ? window.fetch.bind(window) : null;
    const textCache = new Map();
    let stamp = Date.now();

    const localPreview = () => ["", "localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
    const isExternal = url => /^(https?:)?\/\//i.test(String(url || ""));
    const isInline = url => /^(data:|blob:)/i.test(String(url || ""));
    const isApi = url => /^https?:\/\/api\.github\.com\//i.test(String(url || ""));
    const isJson = path => /\.json$/i.test(String(path || ""));

    // "Music/x y.wav", "/Music/x y.wav" and the full Pages URL all answer
    // "Music/x y.wav". External services answer "" so they are left alone.
    function repoPath(url) {
        if (!url || isInline(url)) return "";
        let path = String(url).trim();
        const raw = path.match(/^https?:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.+)$/i);
        if (raw) {
            path = raw[1];
        } else if (path.startsWith(`https://${OWNER}.github.io/`) || path.startsWith(`http://${OWNER}.github.io/`)) {
            path = path.replace(/^https?:\/\/[^/]+\//, "");
        } else if (isExternal(path)) {
            return "";
        }
        path = path.split("#")[0].split("?")[0].replace(/^\.?\//, "");
        try {
            path = decodeURIComponent(path);
        } catch {
            /* leave it as it came */
        }
        return path;
    }

    function encodePath(path) {
        return String(path).split("/").map(encodeURIComponent).join("/");
    }

    function rawUrl(path, bust) {
        return `${RAW_ROOT}${encodePath(path)}${bust === false ? "" : `?v=${stamp}`}`;
    }

    // A file uploaded a minute ago is already on raw; the Pages copy is not.
    function media(url) {
        const path = repoPath(url);
        return path ? rawUrl(path) : url;
    }

    async function get(url, timeout) {
        const fetcher = originalFetch || window.fetch;
        const controller = typeof AbortController === "function" ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), timeout || TIMEOUT) : null;
        try {
            return await fetcher(url, {
                cache: "no-store",
                signal: controller ? controller.signal : undefined
            });
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    /* ------------------------------------------------------- payload rewriting */

    /* Manifests name their media as repo paths; the EPK does the same for
       photos and uploaded clips. Re-point them at the commit. */
    function rewriteContent(path, doc) {
        const key = String(path || "").toLowerCase();
        if (key === "music-manifest.json" || key === "beats-manifest.json") {
            if (!Array.isArray(doc)) return doc;
            return doc.map(track => ({
                ...track,
                audioUrl: media(track.audioUrl),
                coverUrl: track.coverUrl ? media(track.coverUrl) : ""
            }));
        }
        if (key === "epk-media.json") {
            if (!doc || typeof doc !== "object") return doc;
            return {
                ...doc,
                photos: (doc.photos || []).map(photo => (photo && photo.src ? { ...photo, src: media(photo.src) } : photo)),
                videos: (doc.videos || []).map(video => (
                    video && video.source === "file" && video.url ? { ...video, url: media(video.url) } : video
                ))
            };
        }
        return doc;
    }

    /* The contents API reflects a push immediately but hands back Pages URLs.
       Rewrite every download_url so the files resolve from the commit. */
    function rewriteDownloadUrls(value) {
        if (Array.isArray(value)) return value.map(rewriteDownloadUrls);
        if (!value || typeof value !== "object") return value;
        const out = {};
        Object.keys(value).forEach(key => {
            out[key] = key === "download_url" && typeof value[key] === "string"
                ? media(value[key])
                : rewriteDownloadUrls(value[key]);
        });
        return out;
    }

    async function patchedJson(response, transform, cacheKey) {
        if (!response || !response.ok || typeof Response !== "function") return response;
        const copy = response.clone();
        try {
            const text = await response.text();
            const parsed = JSON.parse(text);
            if (cacheKey) textCache.set(cacheKey, text);
            return new Response(JSON.stringify(transform(parsed)), {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers
            });
        } catch {
            return copy;
        }
    }

    /* ----------------------------------------------------------- the wrapper */

    if (originalFetch) {
        window.fetch = async function (input, init) {
            const url = typeof input === "string" ? input : (input && input.url) || String(input);
            const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
            if (method !== "GET") return originalFetch(input, init);

            const path = repoPath(url);
            const fromApi = isApi(url);

            // A repo JSON file: the commit first, Pages second.
            if (!fromApi && path && isJson(path)) {
                try {
                    const fresh = await originalFetch(rawUrl(path), init);
                    if (fresh.ok) return patchedJson(fresh, doc => rewriteContent(path, doc), path);
                } catch {
                    /* fall through to the Pages copy */
                }
                const fallback = await originalFetch(input, init);
                return patchedJson(fallback, doc => rewriteContent(path, doc), path);
            }

            const response = await originalFetch(input, init);
            if (fromApi && response.ok) return patchedJson(response, rewriteDownloadUrls);
            return response;
        };
    }

    /* ---------------------------------------------------------------- helpers */

    async function json(path, options) {
        const opts = options || {};
        const fallback = opts.fallback !== undefined ? opts.fallback : null;
        const read = async url => {
            const response = await get(url);
            if (!response.ok) return null;
            const text = await response.text();
            textCache.set(path, text);
            return rewriteContent(path, JSON.parse(text));
        };

        const order = localPreview() ? [`${path}?v=${stamp}`, rawUrl(path)] : [rawUrl(path), `${path}?v=${stamp}`];
        for (const url of order) {
            try {
                const doc = await read(url);
                if (doc != null) return doc;
            } catch {
                /* try the next source */
            }
        }
        return fallback;
    }

    async function text(path) {
        try {
            const response = await get(rawUrl(path));
            return response.ok ? await response.text() : null;
        } catch {
            return null;
        }
    }

    /* Poll the small data files and fire once when their content changed, so an
       open tab picks a publish up without a reload. The first reading is the
       page's own load, so a publish after that is always seen. */
    function watch(paths, onChange, intervalMs) {
        const files = Array.isArray(paths) ? paths : [paths];
        const seen = new Map();
        files.forEach(path => {
            if (textCache.has(path)) seen.set(path, textCache.get(path));
        });

        let busy = false;
        async function tick() {
            if (busy || document.hidden) return;
            busy = true;
            const changed = [];
            try {
                for (const path of files) {
                    const next = await text(path);
                    if (next == null) continue;
                    const before = seen.get(path);
                    if (before !== undefined && before !== next) changed.push(path);
                    seen.set(path, next);
                }
            } catch {
                /* a failed poll is not an error */
            }
            busy = false;
            if (changed.length) {
                stamp = Date.now();
                onChange(changed);
            }
        }

        window.setInterval(tick, Math.max(5000, intervalMs || 20000));
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden) tick();
        });
        window.addEventListener("focus", tick);
        return tick;
    }

    window.XIDFeed = {
        media,
        json,
        text,
        watch,
        rawUrl,
        repoPath,
        localPreview,
        get stamp() {
            return stamp;
        }
    };
})();
