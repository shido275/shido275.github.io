/* ==========================================================================
   EPK media - slideshows for press photos and videos, the All Links
   directory, and the Rumble live status.

   Reads committed JSON so the dashboard (and a scheduled workflow, for live
   status) can drive the site without touching markup. Every mount point keeps
   its static fallback: if a data file is missing or empty, nothing here runs
   and the hand-written markup stays on screen.
   ========================================================================== */
(function () {
    "use strict";

    const MEDIA_URL = "epk-media.json";
    const LINKS_URL = "links.json";
    const LIVE_URL = "live.json";
    const DEFAULT_INTERVAL = 6000;
    const LIVE_POLL_MS = 60000;

    function escapeHtml(value) {
        return String(value == null ? "" : value).replace(/[&<>"']/g, character => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        }[character]));
    }

    async function fetchJson(url) {
        try {
            const response = await fetch(url, { cache: "no-cache" });
            if (!response.ok) return null;
            return await response.json();
        } catch {
            return null;
        }
    }

    const reducedMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* ------------------------------------------------------------------ photos */

    function mountPhotos(root, media) {
        const photos = (media.photos || []).filter(photo => photo && photo.src);
        if (!photos.length) return;

        const settings = media.slideshow || {};
        const autoplay = settings.autoplay !== false;
        const interval = Math.max(2500, Number(settings.interval) || DEFAULT_INTERVAL);
        const many = photos.length > 1;

        const slides = photos.map((photo, index) => `
            <figure class="slide${index === 0 ? " is-active" : ""}" data-slide="${index}">
                <img src="${escapeHtml(photo.src)}" alt="${escapeHtml(photo.alt || photo.caption || "X/iD photo")}"
                    loading="${index === 0 ? "eager" : "lazy"}" decoding="async">
                ${photo.caption || photo.credit ? `<figcaption>
                    ${photo.caption ? `<span class="slide-caption">${escapeHtml(photo.caption)}</span>` : ""}
                    ${photo.credit ? `<span class="slide-credit">${escapeHtml(photo.credit)}</span>` : ""}
                </figcaption>` : ""}
            </figure>
        `).join("");

        const dots = photos.map((photo, index) => `
            <button class="slide-dot${index === 0 ? " is-active" : ""}" type="button" data-goto="${index}"
                role="tab" aria-selected="${index === 0}"
                aria-label="Photo ${index + 1}${photo.caption ? `: ${escapeHtml(photo.caption)}` : ""}"></button>
        `).join("");

        root.classList.add("has-slideshow");
        root.innerHTML = `
            <div class="slideshow" data-count="${photos.length}">
                <div class="slideshow-stage" tabindex="0" role="group" aria-roledescription="carousel"
                    aria-label="Press photos" aria-live="polite">
                    ${slides}
                </div>
                ${many ? `
                <button class="slideshow-arrow slideshow-arrow--prev" type="button" aria-label="Previous photo">&#8249;</button>
                <button class="slideshow-arrow slideshow-arrow--next" type="button" aria-label="Next photo">&#8250;</button>
                <div class="slideshow-footer">
                    <div class="slideshow-dots" role="tablist" aria-label="Choose a photo">${dots}</div>
                    <p class="slide-counter" aria-hidden="true">1 / ${photos.length}</p>
                </div>` : ""}
            </div>
        `;

        const figures = [...root.querySelectorAll(".slide")];
        const dotButtons = [...root.querySelectorAll(".slide-dot")];
        const counter = root.querySelector(".slide-counter");
        const stage = root.querySelector(".slideshow-stage");
        let index = 0;
        let timer = null;

        function apply(next) {
            index = (next + figures.length) % figures.length;
            figures.forEach((figure, position) => figure.classList.toggle("is-active", position === index));
            dotButtons.forEach((dot, position) => {
                dot.classList.toggle("is-active", position === index);
                dot.setAttribute("aria-selected", String(position === index));
            });
            if (counter) counter.textContent = `${index + 1} / ${figures.length}`;
        }

        function stop() {
            if (timer) {
                window.clearInterval(timer);
                timer = null;
            }
        }

        function start() {
            if (!autoplay || !many || reducedMotion()) return;
            stop();
            timer = window.setInterval(() => apply(index + 1), interval);
        }

        function go(next) {
            apply(next);
            start();
        }

        root.querySelector(".slideshow-arrow--prev")?.addEventListener("click", () => go(index - 1));
        root.querySelector(".slideshow-arrow--next")?.addEventListener("click", () => go(index + 1));
        dotButtons.forEach(dot => dot.addEventListener("click", () => go(Number(dot.dataset.goto))));

        stage?.addEventListener("keydown", event => {
            if (event.key === "ArrowLeft") {
                event.preventDefault();
                go(index - 1);
            }
            if (event.key === "ArrowRight") {
                event.preventDefault();
                go(index + 1);
            }
        });

        // Pause while the visitor is reading or tabbing through it.
        const wrapper = root.querySelector(".slideshow");
        ["mouseenter", "focusin"].forEach(name => wrapper.addEventListener(name, stop));
        ["mouseleave", "focusout"].forEach(name => wrapper.addEventListener(name, stop));
        ["mouseleave", "focusout"].forEach(name => wrapper.addEventListener(name, start));
        document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));

        // Swipe on touch screens.
        let touchStart = null;
        stage?.addEventListener("touchstart", event => {
            touchStart = event.touches[0].clientX;
        }, { passive: true });
        stage?.addEventListener("touchend", event => {
            if (touchStart == null) return;
            const delta = event.changedTouches[0].clientX - touchStart;
            if (Math.abs(delta) > 45) go(index + (delta < 0 ? 1 : -1));
            touchStart = null;
        }, { passive: true });

        start();
    }

    /* ------------------------------------------------------------------ videos */

    function videoPoster(video) {
        if (video.source === "youtube" && video.videoId) return `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`;
        return "";
    }

    function videoBadge(video) {
        const bits = [video.kind];
        if (video.venue) bits.push(video.venue);
        if (video.date) bits.push(video.date);
        return bits.filter(Boolean).join(" / ");
    }

    function embedFor(video) {
        const autoplay = "autoplay=1&rel=0";
        if (video.source === "youtube-playlist" && video.playlist) {
            return `<iframe src="https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(video.playlist)}&${autoplay}"
                title="${escapeHtml(video.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowfullscreen></iframe>`;
        }
        if (video.source === "youtube" && video.videoId) {
            return `<iframe src="https://www.youtube.com/embed/${encodeURIComponent(video.videoId)}?${autoplay}"
                title="${escapeHtml(video.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowfullscreen></iframe>`;
        }
        if (video.source === "vimeo" && video.videoId) {
            return `<iframe src="https://player.vimeo.com/video/${encodeURIComponent(video.videoId)}?autoplay=1"
                title="${escapeHtml(video.title)}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
        }
        return `<video controls autoplay playsinline preload="metadata" src="${escapeHtml(video.url)}"></video>`;
    }

    function mountVideos(root, media) {
        const videos = (media.videos || []).filter(video => video && (video.videoId || video.playlist || video.url));
        if (!videos.length) return;

        const many = videos.length > 1;

        root.classList.add("has-slideshow", "has-video");
        root.innerHTML = `
            <div class="video-slideshow" data-count="${videos.length}">
                <div class="video-stage" aria-live="polite"></div>
                <div class="video-caption">
                    <span class="video-kind"></span>
                    <h3 class="video-title"></h3>
                    <p class="video-note"></p>
                </div>
                ${many ? `
                <div class="video-controls">
                    <button class="slideshow-arrow slideshow-arrow--prev" type="button" aria-label="Previous video">&#8249;</button>
                    <span class="video-counter" aria-hidden="true"></span>
                    <button class="slideshow-arrow slideshow-arrow--next" type="button" aria-label="Next video">&#8250;</button>
                </div>
                <div class="video-thumbs" role="tablist" aria-label="Choose a video">
                    ${videos.map((video, index) => `
                        <button class="video-thumb${index === 0 ? " is-active" : ""}" type="button" data-goto="${index}" role="tab"
                            aria-selected="${index === 0}">
                            ${videoPoster(video) ? `<img src="${escapeHtml(videoPoster(video))}" alt="" loading="lazy" decoding="async">` : `<span class="video-thumb__empty"></span>`}
                            <span class="video-thumb__label">${escapeHtml(video.title)}</span>
                        </button>
                    `).join("")}
                </div>` : ""}
            </div>
        `;

        const stage = root.querySelector(".video-stage");
        const kindEl = root.querySelector(".video-kind");
        const titleEl = root.querySelector(".video-title");
        const noteEl = root.querySelector(".video-note");
        const counter = root.querySelector(".video-counter");
        const thumbs = [...root.querySelectorAll(".video-thumb")];
        let index = 0;

        function render() {
            const video = videos[index];
            const poster = videoPoster(video);
            kindEl.textContent = videoBadge(video);
            titleEl.textContent = video.title || "";
            noteEl.textContent = video.note || "";
            stage.innerHTML = `
                <div class="video-poster${poster ? "" : " video-poster--plain"}">
                    ${poster ? `<img src="${escapeHtml(poster)}" alt="" loading="eager" decoding="async">` : ""}
                    <button class="video-play" type="button" aria-label="Play ${escapeHtml(video.title)}">
                        <span aria-hidden="true">&#9654;</span>
                    </button>
                </div>
            `;
            stage.querySelector(".video-play")?.addEventListener("click", () => {
                stage.innerHTML = embedFor(video);
            });
            if (counter) counter.textContent = `${index + 1} / ${videos.length}`;
            thumbs.forEach((thumb, position) => {
                thumb.classList.toggle("is-active", position === index);
                thumb.setAttribute("aria-selected", String(position === index));
            });
        }

        function go(next) {
            index = (next + videos.length) % videos.length;
            render();
        }

        root.querySelector(".slideshow-arrow--prev")?.addEventListener("click", () => go(index - 1));
        root.querySelector(".slideshow-arrow--next")?.addEventListener("click", () => go(index + 1));
        thumbs.forEach(thumb => thumb.addEventListener("click", () => go(Number(thumb.dataset.goto))));

        render();
    }

    /* ------------------------------------------------------------------- links */

    const LINK_GROUPS = [
        { key: "featured", selector: "#links-featured" },
        { key: "platforms", selector: "#links-platforms" },
        { key: "socials", selector: "#links-social" },
        { key: "business", selector: "#links-business" },
        { key: "quickSocials", selector: "#links-quick" }
    ];

    function renderLinkGroup(key, list) {
        if (key === "featured") {
            return list.map(item => `
                <a class="mega-link${item.accent ? ` accent-${escapeHtml(item.accent)}` : ""}" href="${escapeHtml(item.url)}">
                    <span>${escapeHtml(item.label)}</span>
                    ${item.description ? `<small>${escapeHtml(item.description)}</small>` : ""}
                </a>
            `).join("");
        }
        if (key === "socials") {
            return list.map(item => `
                <a href="${escapeHtml(item.url)}"><strong>${escapeHtml(item.label)}</strong>${item.handle ? `<span>${escapeHtml(item.handle)}</span>` : ""}</a>
            `).join("");
        }
        if (key === "quickSocials") {
            return list.map(item => `<a href="${escapeHtml(item.url)}">${escapeHtml(item.label)}</a>`).join("");
        }
        return list.map(item => `<a class="link-tile" href="${escapeHtml(item.url)}">${escapeHtml(item.label)}</a>`).join("");
    }

    function applyLinks(doc) {
        if (!doc || typeof doc !== "object") return;
        LINK_GROUPS.forEach(group => {
            const list = Array.isArray(doc[group.key]) ? doc[group.key].filter(item => item && item.label && item.url) : [];
            if (!list.length) return;
            const target = document.querySelector(group.selector);
            if (!target) return;
            target.innerHTML = renderLinkGroup(group.key, list);
        });
    }

    /* -------------------------------------------------------------------- live */

    /*  live.json is written by scripts/rumble-live.js in a scheduled workflow:
        the Rumble API has no CORS headers and includes the stream key, so the
        browser never talks to Rumble directly. Three states are supported:
        live, offline with a last broadcast, and no data at all (static markup
        is left alone). */
    function renderLive(doc) {
        const player = document.querySelector("#live-player");
        const chat = document.querySelector("#live-chat");
        if (!player || !doc || typeof doc !== "object") return;

        const channel = escapeHtml(doc.channel || "https://rumble.com/user/yaboishido");
        const stream = doc.live && doc.stream && doc.stream.embedUrl ? doc.stream : null;
        const last = doc.lastStream && doc.lastStream.id ? doc.lastStream : null;

        if (stream) {
            player.classList.add("live-on");
            player.innerHTML = `
                <div class="live-embed">
                    <iframe src="${escapeHtml(stream.embedUrl)}" title="${escapeHtml(stream.title || "Rumble livestream")}"
                        allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>
                </div>
                <div class="live-meta">
                    <span class="live-badge">Live now</span>
                    <span class="live-title">${escapeHtml(stream.title || "Rumble livestream")}</span>
                    <a class="live-link" href="${escapeHtml(stream.pageUrl || channel)}" target="_blank" rel="noopener">Open on Rumble</a>
                </div>
            `;
        } else {
            player.classList.remove("live-on");
            player.innerHTML = `
                <div class="live-offline">
                    <span class="live-badge live-badge--off">Offline</span>
                    <p>${last
                        ? `Last stream: ${escapeHtml(last.title || "untitled")}`
                        : "No stream is running right now."}</p>
                    <a class="button primary" href="${channel}" target="_blank" rel="noopener">Watch live on Rumble</a>
                </div>
            `;
        }

        if (chat) {
            chat.innerHTML = `
                <div class="live-chat-note">
                    <p>${stream ? "Chat runs on Rumble while the stream is up." : "Follow on Rumble to catch the next one."}</p>
                    <a class="live-link" href="${channel}" target="_blank" rel="noopener">Open Rumble</a>
                </div>
            `;
        }
    }

    async function watchLive() {
        const doc = await fetchJson(LIVE_URL);
        renderLive(doc);

        // The workflow refreshes live.json every few minutes; poll lightly.
        window.setInterval(async () => {
            if (document.hidden) return;
            const next = await fetchJson(LIVE_URL);
            if (next) renderLive(next);
        }, LIVE_POLL_MS);
    }

    /* -------------------------------------------------------------------- boot */

    async function boot() {
        const photoRoot = document.querySelector("#epk-photos");
        const videoRoot = document.querySelector("#epk-videos");
        const linksRoot = document.querySelector("#links-featured");
        const liveRoot = document.querySelector("#live-player");

        if (photoRoot || videoRoot) {
            const media = await fetchJson(MEDIA_URL);
            if (media) {
                if (photoRoot) mountPhotos(photoRoot, media);
                if (videoRoot) mountVideos(videoRoot, media);
            }
        }

        if (linksRoot) {
            applyLinks(await fetchJson(LINKS_URL));
        }

        if (liveRoot) {
            await watchLive();
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }
})();
