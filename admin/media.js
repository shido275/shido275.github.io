/* ==========================================================================
   EPK media tools - press photos and videos.

   Both tools edit the same epk-media.json, so they share one in-memory
   document. Load once and either tool can publish without wiping the other's
   collection.
   ========================================================================== */
(function () {
    "use strict";

    const CORE = window.ReleaseImport;
    const Admin = window.Admin;
    const $ = id => document.getElementById(id);
    const esc = Admin.escapeHtml;

    const media = {
        loaded: false,
        loadedFrom: "",
        raw: null,
        photos: [], // { file?, src, caption, alt, credit }
        videos: []  // { file?, url, title, kind, venue, date, note }
    };

    function status(id, text, tone) {
        const node = $(id);
        if (!node) return;
        node.textContent = text;
        node.dataset.tone = tone || "";
    }

    /* ------------------------------------------------------------------ load */

    async function loadMedia(force) {
        if (media.loaded && !force) return;
        if (!Admin.state.config.token) {
            Admin.log("Connect a token to load the current EPK.");
            return;
        }
        try {
            const doc = await Admin.readJson(CORE.MEDIA_PATH);
            media.raw = doc;
            media.photos = doc && Array.isArray(doc.photos) ? doc.photos.map(photo => ({ ...photo })) : [];
            media.videos = doc && Array.isArray(doc.videos) ? doc.videos.map(video => ({ ...video })) : [];
            media.loaded = true;
            media.loadedFrom = Admin.state.config.branch;
            Admin.log(`EPK loaded: ${media.photos.length} photo(s), ${media.videos.length} video(s).`);
            renderPhotos();
            renderVideos();
        } catch (error) {
            Admin.log(`Could not load ${CORE.MEDIA_PATH}: ${error.message}`);
            status("photos-count", "Load failed", "error");
        }
    }

    function photoThumb(photo, index) {
        if (photo.file) return `<img class="media-row__thumb" alt="" src="${URL.createObjectURL(photo.file)}">`;
        if (photo.src) return `<img class="media-row__thumb" alt="" src="../${esc(photo.src)}" loading="lazy">`;
        return `<span class="media-row__thumb">${index + 1}</span>`;
    }

    function videoThumb(video) {
        if (video.file) return `<span class="media-row__thumb">file</span>`;
        if (video.videoId) return `<img class="media-row__thumb" alt="" src="https://i.ytimg.com/vi/${esc(video.videoId)}/mqdefault.jpg" loading="lazy">`;
        return `<span class="media-row__thumb">${video.source === "vimeo" ? "vimeo" : "embed"}</span>`;
    }

    /* ---------------------------------------------------------------- photos */

    function renderPhotos() {
        const list = $("photos-list");
        list.innerHTML = media.photos.map((photo, index) => `
            <div class="media-row" data-photo="${index}">
                ${photoThumb(photo, index)}
                <div class="media-row__fields">
                    <input data-photo-field="caption" data-index="${index}" value="${esc(photo.caption || "")}" placeholder="Caption" aria-label="Caption">
                    <input data-photo-field="alt" data-index="${index}" value="${esc(photo.alt || "")}" placeholder="Alt text" aria-label="Alt text">
                    <input data-photo-field="credit" data-index="${index}" value="${esc(photo.credit || "")}" placeholder="Photo credit" aria-label="Photo credit">
                </div>
                <div class="media-row__actions">
                    <button class="button ghost" type="button" data-photo-move="-1" data-index="${index}" aria-label="Move up">&uarr;</button>
                    <button class="button ghost" type="button" data-photo-move="1" data-index="${index}" aria-label="Move down">&darr;</button>
                    <button class="button ghost" type="button" data-photo-remove="${index}" aria-label="Remove photo">Remove</button>
                </div>
            </div>
        `).join("");
        $("photos-empty").hidden = media.photos.length > 0;
        status("photos-count", `${media.photos.length} photo${media.photos.length === 1 ? "" : "s"}`, "ok");
    }

    function addPhotoFiles(fileList) {
        const incoming = Array.from(fileList || []);
        let added = 0;
        incoming.forEach(file => {
            if (!CORE.isImage(file.name)) {
                Admin.log(`Skipped ${file.name} - photos must be .jpg, .png, .webp or .svg.`);
                return;
            }
            media.photos.push({ file, caption: "", alt: CORE.prettyName(file.name), credit: "" });
            added += 1;
        });
        if (added) Admin.log(`${added} photo(s) queued.`);
        renderPhotos();
    }

    function wirePhotos() {
        $("photos-input").addEventListener("change", event => {
            addPhotoFiles(event.target.files);
            event.target.value = "";
        });

        const zone = $("photos-dropzone");
        ["dragenter", "dragover"].forEach(name => zone.addEventListener(name, event => {
            event.preventDefault();
            zone.classList.add("is-hot");
        }));
        ["dragleave", "drop"].forEach(name => zone.addEventListener(name, event => {
            event.preventDefault();
            zone.classList.remove("is-hot");
        }));
        zone.addEventListener("drop", event => addPhotoFiles(event.dataTransfer.files));

        $("photos-list").addEventListener("input", event => {
            const input = event.target.closest("[data-photo-field]");
            if (!input) return;
            const photo = media.photos[Number(input.dataset.index)];
            if (!photo) return;
            photo[input.dataset.photoField] = input.value;
        });

        $("photos-list").addEventListener("click", event => {
            const move = event.target.closest("[data-photo-move]");
            const remove = event.target.closest("[data-photo-remove]");
            if (move) {
                const from = Number(move.dataset.index);
                const to = from + Number(move.dataset.photoMove);
                if (to < 0 || to >= media.photos.length) return;
                const [item] = media.photos.splice(from, 1);
                media.photos.splice(to, 0, item);
                renderPhotos();
                return;
            }
            if (remove) {
                media.photos.splice(Number(remove.dataset.photoRemove), 1);
                renderPhotos();
            }
        });

        $("photos-load").addEventListener("click", () => loadMedia(true));

        $("photos-plan").addEventListener("click", () => {
            try {
                Admin.renderPlan("photos-output", buildPhotoPlan(), photoStats);
            } catch (error) {
                Admin.log(`Photo plan failed: ${error.message}`);
            }
        });

        $("photos-publish").addEventListener("click", () => {
            Admin.publish({
                prefix: "photos",
                outputId: "photos-output",
                build: buildPhotoPlan,
                defaultMessage: `Update EPK photos (${media.photos.length} image${media.photos.length === 1 ? "" : "s"})`,
                stats: photoStats
            });
        });
    }

    function photoStats(plan) {
        return [[`${plan.photoCount}`, "photo(s)"], [`${plan.videoCount}`, "video(s) kept"]];
    }

    function buildPhotoPlan() {
        return CORE.planMedia({ photos: media.photos, videos: media.videos, existing: media.raw });
    }

    /* ---------------------------------------------------------------- videos */

    function renderVideos() {
        const list = $("videos-list");
        list.innerHTML = media.videos.map((video, index) => `
            <div class="media-row" data-video="${index}">
                ${videoThumb(video)}
                <div class="media-row__fields">
                    <input data-video-field="title" data-index="${index}" value="${esc(video.title || "")}" placeholder="Title" aria-label="Video title">
                    <select data-video-field="kind" data-index="${index}" aria-label="Video type">
                        ${CORE.VIDEO_KINDS.map(kind => `<option value="${esc(kind)}"${video.kind === kind ? " selected" : ""}>${esc(kind)}</option>`).join("")}
                    </select>
                    <input data-video-field="venue" data-index="${index}" value="${esc(video.venue || "")}" placeholder="Venue" aria-label="Venue">
                    <input data-video-field="date" data-index="${index}" value="${esc(video.date || "")}" placeholder="Date" aria-label="Date">
                    <input data-video-field="url" data-index="${index}" value="${esc(video.url || "")}" placeholder="Link" aria-label="Video link">
                    <span class="media-row__badge">${esc(video.source || (video.file ? "file" : ""))}</span>
                </div>
                <div class="media-row__actions">
                    <button class="button ghost" type="button" data-video-move="-1" data-index="${index}" aria-label="Move up">&uarr;</button>
                    <button class="button ghost" type="button" data-video-move="1" data-index="${index}" aria-label="Move down">&darr;</button>
                    <button class="button ghost" type="button" data-video-remove="${index}" aria-label="Remove video">Remove</button>
                </div>
            </div>
        `).join("");
        $("videos-empty").hidden = media.videos.length > 0;
        status("videos-count", `${media.videos.length} video${media.videos.length === 1 ? "" : "s"}`, "ok");
    }

    function addVideo() {
        const title = $("video-title").value.trim();
        const url = $("video-url").value.trim();
        const file = $("video-file").files && $("video-file").files[0];

        if (!title) {
            Admin.log("Give the video a title first.");
            return;
        }
        if (!url && !file) {
            Admin.log("Paste a YouTube/Vimeo link or choose a clip file.");
            return;
        }

        const entry = {
            title,
            kind: $("video-kind").value,
            venue: $("video-venue").value.trim(),
            date: $("video-date").value,
            note: $("video-note").value.trim()
        };
        if (file) entry.file = file;
        else entry.url = url;

        media.videos.push(entry);
        Admin.log(`Queued video "${title}".`);
        ["video-title", "video-url", "video-venue", "video-date", "video-note"].forEach(id => {
            $(id).value = "";
        });
        $("video-file").value = "";
        renderVideos();
    }

    function wireVideos() {
        $("video-kind").innerHTML = CORE.VIDEO_KINDS
            .map(kind => `<option value="${esc(kind)}">${esc(kind)}</option>`)
            .join("");

        $("videos-add").addEventListener("click", addVideo);
        $("videos-load").addEventListener("click", () => loadMedia(true));

        $("videos-list").addEventListener("input", event => {
            const input = event.target.closest("[data-video-field]");
            if (!input) return;
            const video = media.videos[Number(input.dataset.index)];
            if (!video) return;
            video[input.dataset.videoField] = input.value;
        });
        $("videos-list").addEventListener("change", event => {
            const input = event.target.closest("[data-video-field]");
            if (!input) return;
            const video = media.videos[Number(input.dataset.index)];
            if (!video) return;
            video[input.dataset.videoField] = input.value;
        });
        $("videos-list").addEventListener("click", event => {
            const move = event.target.closest("[data-video-move]");
            const remove = event.target.closest("[data-video-remove]");
            if (move) {
                const from = Number(move.dataset.index);
                const to = from + Number(move.dataset.videoMove);
                if (to < 0 || to >= media.videos.length) return;
                const [item] = media.videos.splice(from, 1);
                media.videos.splice(to, 0, item);
                renderVideos();
                return;
            }
            if (remove) {
                media.videos.splice(Number(remove.dataset.videoRemove), 1);
                renderVideos();
            }
        });

        $("videos-plan").addEventListener("click", () => {
            try {
                Admin.renderPlan("videos-output", buildVideoPlan(), videoStats);
            } catch (error) {
                Admin.log(`Video plan failed: ${error.message}`);
            }
        });

        $("videos-publish").addEventListener("click", () => {
            Admin.publish({
                prefix: "videos",
                outputId: "videos-output",
                build: buildVideoPlan,
                defaultMessage: `Update EPK videos (${media.videos.length} video${media.videos.length === 1 ? "" : "s"})`,
                stats: videoStats
            });
        });
    }

    function videoStats(plan) {
        return [[`${plan.videoCount}`, "video(s)"], [`${plan.photoCount}`, "photo(s) kept"]];
    }

    function buildVideoPlan() {
        return CORE.planMedia({ photos: media.photos, videos: media.videos, existing: media.raw });
    }

    /* ------------------------------------------------------------------ boot */

    function init() {
        wirePhotos();
        wireVideos();
        renderPhotos();
        renderVideos();
        // Both views edit one document, so load it as soon as either opens.
        Admin.registerView("photos", () => loadMedia(false));
        Admin.registerView("videos", () => loadMedia(false));
    }

    document.addEventListener("DOMContentLoaded", init);
})();
