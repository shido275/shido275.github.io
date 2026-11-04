/* ==========================================================================
   Background tool - the images, GIFs and video clips that cycle behind the
   whole site. Mounts its own nav item and section, reads backgrounds.json, lets
   the list be built, reordered and tuned, then commits the uploads, the file
   and the registry in one atomic commit.
   ========================================================================== */
(function () {
    "use strict";

    const Core = window.BackgroundCore;
    const Admin = window.Admin;
    const $ = id => document.getElementById(id);
    const esc = Admin.escapeHtml;

    const model = {
        loaded: false,
        existing: null,
        items: [],
        settings: { enabled: true, interval: 9, transition: "fade", dim: 0.55, blur: 0 }
    };

    const MARKUP = `
        <div class="panel-head">
            <p class="eyebrow">Site</p>
            <h1 id="backgrounds-heading">Background</h1>
            <p class="hint">Images, GIFs and video clips that cycle behind every page. Uploads go to
                <code>assets/backgrounds/</code>; the order below is the order they play, and an open site picks a
                publish up on its own.</p>
        </div>

        <div class="panel">
            <div class="row">
                <button class="button" type="button" id="backgrounds-load">Load current background</button>
                <label class="button" for="backgrounds-input">Add images or video</label>
                <input id="backgrounds-input" type="file" accept="image/*,video/*" multiple hidden>
                <span class="status" id="backgrounds-count">0 items</span>
            </div>
            <div class="dropzone" id="backgrounds-dropzone">
                <strong>Drop backgrounds</strong>
                <span>.jpg - .png - .webp - .gif - .avif - .mp4 - .webm</span>
            </div>

            <div class="field-grid">
                <label class="wide">Or paste a link
                    <input id="backgrounds-url" autocomplete="off" placeholder="https://... or assets/...">
                </label>
                <label>Seconds per item
                    <input id="backgrounds-interval" type="number" min="3" max="120" step="1" value="9">
                </label>
                <label>Transition
                    <select id="backgrounds-transition">
                        <option value="fade">Crossfade</option>
                        <option value="cut">Hard cut</option>
                    </select>
                </label>
                <label>Dim <span class="range-value" id="backgrounds-dim-value">55%</span>
                    <input id="backgrounds-dim" type="range" min="0" max="0.95" step="0.05" value="0.55">
                </label>
                <label>Blur <span class="range-value" id="backgrounds-blur-value">0px</span>
                    <input id="backgrounds-blur" type="range" min="0" max="24" step="1" value="0">
                </label>
                <label class="checkbox checkbox--inline"><input type="checkbox" id="backgrounds-enabled"
                        checked> Show the background on the site</label>
            </div>
            <div class="row">
                <button class="button" type="button" id="backgrounds-add-url">Add link</button>
            </div>

            <div class="bg-grid" id="backgrounds-list"></div>
            <p class="muted" id="backgrounds-empty">Nothing queued - the site keeps its plain backdrop.</p>
        </div>

        <div class="panel">
            <div class="panel-head">
                <p class="eyebrow">Publish</p>
                <h2>Commit background</h2>
            </div>
            <div class="publish-grid">
                <label>Commit message<input id="backgrounds-message" autocomplete="off"
                        value="Update the site background"></label>
                <label>Branch<input id="backgrounds-branch" autocomplete="off" spellcheck="false"
                        placeholder="main"></label>
                <label class="checkbox"><input type="checkbox" id="backgrounds-dryrun"> Dry run</label>
            </div>
            <div class="row">
                <button class="button" type="button" id="backgrounds-plan">Preview plan</button>
                <button class="button primary" type="button" id="backgrounds-publish">Publish background</button>
            </div>
            <div id="backgrounds-output" aria-live="polite"></div>
        </div>
    `;

    function status(text, tone) {
        const node = $("backgrounds-count");
        if (!node) return;
        node.textContent = text;
        node.dataset.tone = tone || "";
    }

    function mount() {
        const nav = document.querySelector(".admin-nav");
        const settings = nav && nav.querySelector('[data-view="settings"]');
        if (nav && !nav.querySelector('[data-view="backgrounds"]')) {
            const button = document.createElement("button");
            button.className = "admin-nav__item";
            button.type = "button";
            button.dataset.view = "backgrounds";
            button.innerHTML = "<span>Background</span><small>Cycled backdrop</small>";
            button.addEventListener("click", () => Admin.switchView("backgrounds"));
            nav.insertBefore(button, settings);
        }

        const main = document.querySelector(".admin-main");
        if (!main || $("view-backgrounds")) return;
        const section = document.createElement("section");
        section.className = "admin-view";
        section.id = "view-backgrounds";
        section.setAttribute("aria-labelledby", "backgrounds-heading");
        section.innerHTML = MARKUP;
        main.insertBefore(section, $("view-settings"));
    }

    function previewSrc(item) {
        if (item.file) return URL.createObjectURL(item.file);
        return `../${esc(item.src)}`;
    }

    function renderSettings() {
        $("backgrounds-enabled").checked = model.settings.enabled !== false;
        $("backgrounds-interval").value = model.settings.interval;
        $("backgrounds-transition").value = model.settings.transition;
        $("backgrounds-dim").value = model.settings.dim;
        $("backgrounds-blur").value = model.settings.blur;
        $("backgrounds-dim-value").textContent = `${Math.round(Number(model.settings.dim) * 100)}%`;
        $("backgrounds-blur-value").textContent = `${Math.round(Number(model.settings.blur))}px`;
    }

    function render() {
        const list = $("backgrounds-list");
        list.innerHTML = model.items.map((item, index) => `
            <figure class="bg-card">
                <div class="bg-card__preview">
                    ${item.kind === "video"
                        ? `<video src="${previewSrc(item)}" muted loop playsinline preload="metadata"></video>`
                        : `<img src="${previewSrc(item)}" alt="${esc(item.caption || "")}" loading="lazy">`}
                    <span class="bg-card__kind">${item.kind === "video" ? "video" : "image"}</span>
                    <span class="bg-card__index">${index + 1}</span>
                </div>
                <input class="bg-card__caption" data-bg-field="caption" data-index="${index}"
                    value="${esc(item.caption || "")}" placeholder="Caption (optional)" aria-label="Caption">
                <div class="bg-card__actions">
                    <button class="button ghost" type="button" data-bg-move="-1" data-index="${index}"
                        aria-label="Move up" ${index === 0 ? "disabled" : ""}>&uarr;</button>
                    <button class="button ghost" type="button" data-bg-move="1" data-index="${index}"
                        aria-label="Move down" ${index === model.items.length - 1 ? "disabled" : ""}>&darr;</button>
                    <button class="button ghost" type="button" data-bg-remove="${index}">Remove</button>
                </div>
            </figure>
        `).join("");

        $("backgrounds-empty").hidden = model.items.length > 0;
        status(`${model.items.length} item${model.items.length === 1 ? "" : "s"}`, "ok");
    }

    function addFiles(fileList) {
        let added = 0;
        Array.from(fileList || []).forEach(file => {
            const kind = Core.kindOf(file.name);
            if (!kind) {
                Admin.log(`Skipped ${file.name} - backgrounds must be images or video.`);
                return;
            }
            model.items.push({ file, src: "", kind, caption: "" });
            added += 1;
        });
        if (added) Admin.log(`${added} background file(s) queued.`);
        render();
    }

    function addUrl() {
        const input = $("backgrounds-url");
        const src = input.value.trim();
        if (!src) return;
        if (/^\s*(javascript|vbscript):/i.test(src)) {
            Admin.log("That URL is not allowed.");
            return;
        }
        model.items.push({ src, kind: Core.kindOf(src) || "image", caption: "" });
        input.value = "";
        render();
    }

    async function load(force) {
        if (model.loaded && !force) return;
        if (!Admin.state.config.token) {
            Admin.log("Connect a token to load the current background.");
            return;
        }
        try {
            const doc = await Admin.readJson(Core.BACKGROUND_PATH);
            model.existing = doc;
            const read = Core.readBackground(doc);
            model.items = read.items.map(item => ({ ...item }));
            model.settings = {
                enabled: read.enabled,
                interval: read.interval,
                transition: read.transition,
                dim: read.dim,
                blur: read.blur
            };
            model.loaded = true;
            renderSettings();
            render();
            Admin.log(`Background loaded: ${model.items.length} item(s).`);
        } catch (error) {
            Admin.log(`Could not load ${Core.BACKGROUND_PATH}: ${error.message}`);
            status("Load failed", "error");
        }
    }

    function plan() {
        return Core.planBackground({
            items: model.items,
            settings: model.settings,
            existing: model.existing
        });
    }

    function wire() {
        $("backgrounds-load").addEventListener("click", () => load(true));

        $("backgrounds-input").addEventListener("change", event => {
            addFiles(event.target.files);
            event.target.value = "";
        });

        const zone = $("backgrounds-dropzone");
        ["dragenter", "dragover"].forEach(name => zone.addEventListener(name, event => {
            event.preventDefault();
            zone.classList.add("is-hot");
        }));
        ["dragleave", "drop"].forEach(name => zone.addEventListener(name, event => {
            event.preventDefault();
            zone.classList.remove("is-hot");
        }));
        zone.addEventListener("drop", event => addFiles(event.dataTransfer.files));

        $("backgrounds-add-url").addEventListener("click", addUrl);
        $("backgrounds-url").addEventListener("keydown", event => {
            if (event.key === "Enter") {
                event.preventDefault();
                addUrl();
            }
        });

        $("backgrounds-list").addEventListener("click", event => {
            const move = event.target.closest("[data-bg-move]");
            if (move) {
                const index = Number(move.dataset.index);
                const target = index + Number(move.dataset.bgMove);
                if (target < 0 || target >= model.items.length) return;
                const [item] = model.items.splice(index, 1);
                model.items.splice(target, 0, item);
                render();
                return;
            }
            const remove = event.target.closest("[data-bg-remove]");
            if (remove) {
                model.items.splice(Number(remove.dataset.bgRemove), 1);
                render();
            }
        });

        $("backgrounds-list").addEventListener("input", event => {
            const field = event.target.closest("[data-bg-field]");
            if (!field) return;
            const item = model.items[Number(field.dataset.index)];
            if (item) item.caption = field.value;
        });

        $("backgrounds-enabled").addEventListener("change", event => {
            model.settings.enabled = event.target.checked;
        });
        $("backgrounds-interval").addEventListener("input", event => {
            model.settings.interval = Number(event.target.value) || 9;
        });
        $("backgrounds-transition").addEventListener("change", event => {
            model.settings.transition = event.target.value;
        });
        $("backgrounds-dim").addEventListener("input", event => {
            model.settings.dim = Number(event.target.value);
            $("backgrounds-dim-value").textContent = `${Math.round(model.settings.dim * 100)}%`;
        });
        $("backgrounds-blur").addEventListener("input", event => {
            model.settings.blur = Number(event.target.value);
            $("backgrounds-blur-value").textContent = `${Math.round(model.settings.blur)}px`;
        });

        $("backgrounds-plan").addEventListener("click", () => {
            try {
                const built = plan();
                Admin.renderPlan("backgrounds-output", built, [[`${built.count}`, "item(s)"]]);
                Admin.log("Background plan ready.");
            } catch (error) {
                Admin.log(`Plan failed: ${error.message}`);
            }
        });

        $("backgrounds-publish").addEventListener("click", async () => {
            const sha = await Admin.publish({
                prefix: "backgrounds",
                outputId: "backgrounds-output",
                build: plan,
                defaultMessage: "Update the site background",
                stats: built => [[`${built.count}`, "item(s)"]]
            });
            if (sha) {
                model.existing = plan().doc;
                model.loaded = true;
            }
        });
    }

    function boot() {
        if (!window.BackgroundCore || !window.Admin || !document.querySelector(".admin-main")) return;
        if (!document.getElementById("view-backgrounds")) {
            mount();
            wire();
            Admin.registerView("backgrounds", () => load(false));
        }
    }

    window.BackgroundTool = { model, load, render };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }
})();
