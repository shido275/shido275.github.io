/* ==========================================================================
   Profile photo panel - the avatar on the All Links page, which the EPK also
   uses as a dimmed backdrop.

   Mounts its own panel inside the All Links view, so the dashboard keeps one
   script tag per tool and links.js stays about links. The upload lands in
   assets/photos/ and the path plus alt text go to profile.json, which is the
   only file the site reads for either placement.
   ========================================================================== */
(function () {
    "use strict";

    const CORE = window.ReleaseImport;
    const Admin = window.Admin;
    if (!CORE || !Admin) return;

    const $ = id => document.getElementById(id);

    const PROFILE_PATH = "profile.json";
    const DEFAULT_SRC = "assets/profile-avatar.png";
    const DEFAULT_ALT = "X/i\\D profile image";

    const state = {
        loaded: false,
        src: "",
        alt: "",
        file: null,
        objectUrl: ""
    };

    const MARKUP = `
        <div class="panel-head">
            <p class="eyebrow">Profile</p>
            <h2>Profile photo</h2>
            <p class="hint">Shown at the top of the <code>#/links</code> page, and dimmed behind the first
                section of the EPK. Upload a square-ish photo - it is cropped to a circle on the page.</p>
        </div>
        <div class="media-row">
            <img class="media-row__thumb" id="profile-preview" alt="" src="../${DEFAULT_SRC}">
            <div class="media-row__fields">
                <input type="file" id="profile-file" accept="image/*" aria-label="Profile photo">
                <input id="profile-alt" autocomplete="off" placeholder="Alt text" aria-label="Alt text">
                <span class="status" id="profile-status">Built-in photo</span>
            </div>
            <div class="media-row__actions">
                <button class="button ghost" type="button" id="profile-load">Load current</button>
            </div>
        </div>

        <div class="publish-grid">
            <label>Commit message<input id="profile-message" autocomplete="off"></label>
            <label>Branch<input id="profile-branch" autocomplete="off" spellcheck="false"></label>
            <label class="checkbox"><input type="checkbox" id="profile-dryrun"> Dry run</label>
        </div>
        <div class="row">
            <button class="button" type="button" id="profile-plan">Preview plan</button>
            <button class="button primary" type="button" id="profile-publish">Publish profile photo</button>
        </div>
        <div id="profile-output" aria-live="polite"></div>
    `;

    function status(text, tone) {
        const node = $("profile-status");
        if (!node) return;
        node.textContent = text;
        node.dataset.tone = tone || "";
    }

    /* ------------------------------------------------------------------ load */

    async function load(force) {
        if (state.loaded && !force) return;
        if (!Admin.state.config.token) {
            Admin.log("Connect a token to load the current profile photo.");
            return;
        }
        try {
            const doc = await Admin.readJson(PROFILE_PATH);
            state.src = doc && typeof doc.src === "string" ? doc.src.trim() : "";
            state.alt = doc && typeof doc.alt === "string" ? doc.alt : "";
            state.file = null;
            state.loaded = true;
            $("profile-file").value = "";
            $("profile-alt").value = state.alt;
            render();
            Admin.log(state.src
                ? `Profile photo loaded: ${state.src}`
                : `No ${PROFILE_PATH} yet - the site keeps its built-in photo.`);
        } catch (error) {
            Admin.log(`Could not load ${PROFILE_PATH}: ${error.message}`);
            status("Load failed", "error");
        }
    }

    function render() {
        const preview = $("profile-preview");
        if (!preview) return;
        if (state.objectUrl) {
            URL.revokeObjectURL(state.objectUrl);
            state.objectUrl = "";
        }
        if (state.file) state.objectUrl = URL.createObjectURL(state.file);
        preview.src = state.objectUrl || (state.src ? `../${state.src}` : `../${DEFAULT_SRC}`);
        if (state.file) {
            status(`New photo: ${state.file.name} (${CORE.formatBytes(state.file.size)})`, "ok");
        } else if (state.src) {
            status(state.src, "ok");
        } else {
            status("Built-in photo");
        }
    }

    /* ------------------------------------------------------------------ plan */

    function buildPlan() {
        const alt = ($("profile-alt").value || "").trim() || DEFAULT_ALT;
        const writes = [];
        let src = (state.src || "").trim();

        if (state.file) {
            if (!CORE.isImage(state.file.name)) {
                throw new Error(`${state.file.name} is not an image - use .jpg, .png, .webp or .svg.`);
            }
            if (state.file.size > CORE.MAX_FILE_BYTES) {
                throw new Error(`${state.file.name} is ${CORE.formatBytes(state.file.size)} - GitHub rejects blobs over 45 MB.`);
            }
            src = `${CORE.PHOTO_DIR}/profile-${CORE.slugify(CORE.baseName(state.file.name))}${CORE.ext(state.file.name)}`;
            writes.push({ path: CORE.assertRepoPath(src), kind: "profile-photo", file: state.file });
        }
        if (!src) throw new Error("Choose a photo first.");

        const doc = { src, alt };
        writes.push({ path: PROFILE_PATH, kind: "profile", text: `${JSON.stringify(doc, null, 2)}\n` });

        const warnings = [];
        if (state.file && state.file.size > 2 * 1024 * 1024) {
            warnings.push(`${CORE.formatBytes(state.file.size)} is a heavy avatar - a photo under 2 MB is kinder to a phone.`);
        }

        return {
            writes,
            doc,
            src,
            warnings,
            totalBytes: writes.reduce((sum, write) => sum + (write.file ? write.file.size : write.text.length), 0)
        };
    }

    function stats(plan) {
        return [[plan.src, "photo"], ["links + EPK", "where it shows"]];
    }

    /* --------------------------------------------------------------- publish */

    async function publish() {
        const sha = await Admin.publish({
            prefix: "profile",
            outputId: "profile-output",
            build: buildPlan,
            defaultMessage: "Update the All Links profile photo",
            stats
        });
        if (!sha) return;
        // Re-read what the branch now holds, so a second publish starts clean.
        state.file = null;
        state.loaded = false;
        $("profile-file").value = "";
        await load(true);
    }

    /* ----------------------------------------------------------------- mount */

    function wire() {
        $("profile-file").addEventListener("change", event => {
            const file = event.target.files && event.target.files[0];
            if (!file) return;
            if (!CORE.isImage(file.name)) {
                Admin.log(`${file.name} is not an image - use .jpg, .png, .webp or .svg.`);
                event.target.value = "";
                return;
            }
            state.file = file;
            render();
        });

        $("profile-alt").addEventListener("input", () => {
            state.alt = $("profile-alt").value;
        });

        $("profile-load").addEventListener("click", () => load(true));

        $("profile-plan").addEventListener("click", () => {
            try {
                Admin.renderPlan("profile-output", buildPlan(), stats);
            } catch (error) {
                Admin.log(`Profile plan failed: ${error.message}`);
            }
        });

        $("profile-publish").addEventListener("click", publish);

        // links.js owns the All Links view hook, so this listens alongside it.
        const navItem = document.querySelector('.admin-nav__item[data-view="links"]');
        if (navItem) navItem.addEventListener("click", () => load(false));
    }

    function mount() {
        const view = $("view-links");
        if (!view || $("profile-panel")) return;

        const panel = document.createElement("div");
        panel.className = "panel";
        panel.id = "profile-panel";
        panel.innerHTML = MARKUP;

        // Sits above the publish panel, so committing stays the last step.
        const output = $("links-output");
        const publishPanel = output && output.closest(".panel");
        if (publishPanel && publishPanel.parentNode === view) {
            view.insertBefore(panel, publishPanel);
        } else {
            view.appendChild(panel);
        }

        if (!$("profile-branch").value.trim()) $("profile-branch").value = CORE.suggestToolBranch("profile");

        wire();
        render();
        if (Admin.state.config.token) load(false);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", mount);
    } else {
        mount();
    }
})();
