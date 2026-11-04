/* ==========================================================================
   Theme tool.

   themes.json is the single source of truth for the site's look: which palette
   visitors get, whether it rotates on every reload, and every palette available
   (including the ones recovered from older versions of the site). This panel
   edits that one file and commits it like any other content change.
   ========================================================================== */
(function () {
    "use strict";

    const Admin = window.Admin;
    const $ = id => document.getElementById(id);
    const PATH = "themes.json";
    const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

    const state = { doc: null, saved: "", loaded: false };

    const clone = value => JSON.parse(JSON.stringify(value));

    /* Palettes live in the repo, so their values are data: only let a value
       through to a style attribute when it looks like a plain CSS colour. */
    function colour(value, fallback) {
        const text = String(value == null ? "" : value).trim();
        return /^[wh#a-zA-Z0-9(),.%\s-]+$/.test(text) && !/[;{}"'<>]/.test(text) ? text : fallback;
    }

    function swatch(theme) {
        const vars = theme.vars || {};
        return `<span class="theme-swatch" style="background:${colour(vars["--bg"], "#000")};color:${colour(vars["--text"], "#fff")};border-color:${colour(vars["--line-active"], "#333")}">`
            + `<span class="theme-swatch__dot" style="background:${colour(vars["--blood"], "#888")}"></span>`
            + `<span class="theme-swatch__dot" style="background:${colour(vars["--cyan"], "#888")}"></span>`
            + `<span class="theme-swatch__dot" style="background:${colour(vars["--gold"], "#888")}"></span>`
            + `</span>`;
    }

    function render() {
        const list = $("themes-list");
        const doc = state.doc;
        if (!doc) {
            list.innerHTML = `<p class="muted">No themes loaded. Connect a token, then press Load themes.</p>`;
            $("themes-count").textContent = "Not loaded";
            return;
        }
        const themes = Array.isArray(doc.themes) ? doc.themes : [];
        list.innerHTML = themes.map(theme => `
            <div class="theme-card${theme.id === doc.default ? " is-current" : ""}">
                ${swatch(theme)}
                <div class="theme-card__body">
                    <strong>${Admin.escapeHtml(theme.label || theme.id)}</strong>
                    <small>${Admin.escapeHtml(theme.era || "")}</small>
                    <p>${Admin.escapeHtml(theme.note || "")}</p>
                </div>
                <div class="theme-card__actions">
                    <label class="checkbox"><input type="radio" name="theme-default" value="${Admin.escapeHtml(theme.id)}"${theme.id === doc.default ? " checked" : ""}> Default</label>
                    <a class="button ghost" href="../index.html?theme=${encodeURIComponent(theme.id)}" target="_blank" rel="noopener">Preview</a>
                </div>
            </div>
        `).join("");
        $("themes-count").textContent = `${themes.length} theme${themes.length === 1 ? "" : "s"}`;
        $("themes-rotate").checked = Boolean(doc.rotate);
    }

    async function load() {
        if (!Admin.state.config.token) {
            state.doc = null;
            render();
            Admin.setStatus("Connect a token to read the themes", "warn");
            return null;
        }
        try {
            const doc = await Admin.readJson(PATH);
            if (!doc || !Array.isArray(doc.themes) || !doc.themes.length) {
                throw new Error(`${PATH} has no themes`);
            }
            state.doc = clone(doc);
            state.saved = `${JSON.stringify(doc, null, 2)}\n`;
            state.loaded = true;
            render();
            Admin.setStatus(`Loaded ${doc.themes.length} theme(s)`, "ok");
            return doc;
        } catch (error) {
            state.doc = null;
            render();
            Admin.log(`Theme load failed: ${error.message}`);
            Admin.setStatus("Could not load themes", "error");
            return null;
        }
    }

    function build() {
        if (!state.doc) throw new Error("Load the themes first");
        const themes = state.doc.themes;
        if (!Array.isArray(themes) || !themes.length) throw new Error("Keep at least one theme");

        const ids = new Set();
        themes.forEach(theme => {
            if (!theme.id || !SAFE_ID.test(theme.id)) {
                throw new Error(`"${theme.id || "(no id)"}" is not a usable theme id - use letters, digits, dot, dash or underscore`);
            }
            if (ids.has(theme.id)) throw new Error(`Two themes share the id ${theme.id}`);
            ids.add(theme.id);
            if (!theme.vars || !Object.keys(theme.vars).length) throw new Error(`${theme.id} has no colour tokens`);
        });
        if (!ids.has(state.doc.default)) throw new Error(`The default theme "${state.doc.default}" is not in the list`);

        const body = `${JSON.stringify(state.doc, null, 2)}\n`;
        const warnings = [];
        if (body === state.saved) warnings.push("Nothing has changed since the last load.");

        return {
            writes: [{ path: PATH, kind: "theme settings", text: body }],
            warnings,
            totalBytes: body.length
        };
    }

    function preview() {
        try {
            const plan = build();
            Admin.renderPlan("themes-output", plan, [
                ["themes", String((state.doc.themes || []).length)],
                ["default", String(state.doc.default)],
                ["rotation", state.doc.rotate ? "on" : "off"]
            ]);
            return plan;
        } catch (error) {
            $("themes-output").innerHTML = `<p class="warn-list">${Admin.escapeHtml(error.message)}</p>`;
            return null;
        }
    }

    async function commit() {
        if (!Admin.state.config.token) {
            Admin.log("Connect a token first - opening Connect.");
            Admin.switchView("settings");
            return null;
        }
        const result = await Admin.publish({
            prefix: "themes",
            outputId: "themes-output",
            defaultMessage: "Set the site theme",
            build,
            stats: () => [
                ["themes", String((state.doc.themes || []).length)],
                ["default", String(state.doc.default)],
                ["rotation", state.doc.rotate ? "on" : "off"]
            ]
        });
        if (result) {
            state.saved = `${JSON.stringify(state.doc, null, 2)}\n`;
            Admin.setStatus("Theme committed", "ok");
        }
        return result;
    }

    function init() {
        if (!$("themes-list")) return;

        $("themes-load").addEventListener("click", load);

        $("themes-list").addEventListener("change", event => {
            const radio = event.target.closest('input[name="theme-default"]');
            if (!radio || !state.doc) return;
            state.doc.default = radio.value;
            render();
        });

        $("themes-rotate").addEventListener("change", event => {
            if (!state.doc) return;
            state.doc.rotate = event.target.checked;
        });

        $("themes-plan").addEventListener("click", preview);
        $("themes-publish").addEventListener("click", commit);

        // Returning the promise keeps the first read awaitable (the app ignores it).
        Admin.registerView("themes", () => (state.loaded ? undefined : load()));
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
