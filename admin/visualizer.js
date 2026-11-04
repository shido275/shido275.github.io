/* ==========================================================================
   Visualizer tool - pick the frequency display, or cycle it.

   Writes visualizer.json, which the site's visualizer.js reads. The styles
   themselves live in that file; this only chooses between them.
   ========================================================================== */
(function () {
    "use strict";

    const Admin = window.Admin;
    const $ = id => document.getElementById(id);
    const PATH = "visualizer.json";

    const MODES = [
        { id: "bars", label: "Bars", note: "Classic frequency bars climbing from the bottom edge." },
        { id: "mirror", label: "Mirror", note: "The same bars folded out from the centre line." },
        { id: "wave", label: "Waveform", note: "The raw waveform as a single glowing trace." },
        { id: "radial", label: "Radial", note: "Frequency spokes around a ring - the busiest of the set." },
        { id: "dots", label: "Dotmatrix", note: "A grid of squares that light up with the low end." },
        { id: "pulse", label: "Pulse", note: "Rings that expand with the bass, no bars at all." },
        { id: "off", label: "Off", note: "Show nothing; the panel stays black." }
    ];

    const model = { loaded: false, mode: "bars", rotate: false };

    const MARKUP = `
        <div class="panel-head">
            <p class="eyebrow">Player</p>
            <h1 id="visualizer-heading">Visualizer</h1>
            <p class="hint">The frequency display in the player bar. It only paints while a track is playing, the
                panel is open and the tab is visible, so a still display costs nothing.</p>
        </div>

        <div class="panel">
            <div class="panel-head">
                <p class="eyebrow">Style</p>
                <h2>What plays</h2>
            </div>
            <div class="vis-grid" id="visualizer-list"></div>
            <label class="checkbox checkbox--inline" style="margin-top: 1rem;">
                <input type="checkbox" id="visualizer-rotate"> Cycle the style on every page load
            </label>
            <p class="hint">With cycling on, each reload picks a different style and never repeats the one before it.
                Without it, visitors always get the style chosen above.</p>
            <div class="row">
                <button class="button" type="button" id="visualizer-load">Load current setting</button>
                <span class="status" id="visualizer-status">Not loaded</span>
            </div>
        </div>

        <div class="panel">
            <div class="panel-head">
                <p class="eyebrow">Publish</p>
                <h2>Commit visualizer</h2>
            </div>
            <div class="publish-grid">
                <label>Commit message<input id="visualizer-message" autocomplete="off" value="Set the player visualizer"></label>
                <label>Branch<input id="visualizer-branch" autocomplete="off" spellcheck="false" placeholder="main"></label>
                <label class="checkbox"><input type="checkbox" id="visualizer-dryrun"> Dry run</label>
            </div>
            <div class="row">
                <button class="button" type="button" id="visualizer-plan">Preview plan</button>
                <button class="button primary" type="button" id="visualizer-publish">Publish visualizer</button>
            </div>
            <div id="visualizer-output" aria-live="polite"></div>
        </div>
    `;

    function say(text, tone) {
        const node = $("visualizer-status");
        if (!node) return;
        node.textContent = text;
        node.dataset.tone = tone || "";
    }

    function mount() {
        const nav = document.querySelector(".admin-nav");
        const settings = nav && nav.querySelector('[data-view="settings"]');
        if (nav && !nav.querySelector('[data-view="visualizer"]')) {
            const button = document.createElement("button");
            button.className = "admin-nav__item";
            button.type = "button";
            button.dataset.view = "visualizer";
            button.innerHTML = "<span>Visualizer</span><small>Player display</small>";
            button.addEventListener("click", () => Admin.switchView("visualizer"));
            nav.insertBefore(button, settings);
        }

        const main = document.querySelector(".admin-main");
        if (!main || $("view-visualizer")) return;
        const section = document.createElement("section");
        section.className = "admin-view";
        section.id = "view-visualizer";
        section.setAttribute("aria-labelledby", "visualizer-heading");
        section.innerHTML = MARKUP;
        main.insertBefore(section, $("view-settings"));
    }

    function render() {
        const list = $("visualizer-list");
        list.innerHTML = MODES.map(mode => `
            <label class="vis-card${mode.id === model.mode ? " is-current" : ""}">
                <input type="radio" name="visualizer-mode" value="${mode.id}"${mode.id === model.mode ? " checked" : ""}>
                <span class="vis-preview" data-mode="${mode.id}"></span>
                <strong>${Admin.escapeHtml(mode.label)}</strong>
                <small>${Admin.escapeHtml(mode.note)}</small>
            </label>
        `).join("");
        $("visualizer-rotate").checked = Boolean(model.rotate);
        const label = (MODES.find(mode => mode.id === model.mode) || MODES[0]).label;
        say(`${label}${model.rotate ? " - cycling" : ""}`, "ok");
    }

    async function load(force) {
        if (model.loaded && !force) return;
        if (!Admin.state.config.token) {
            say("Connect a token to read the setting", "warn");
            return;
        }
        try {
            const doc = await Admin.readJson(PATH);
            const source = doc && typeof doc === "object" ? doc : {};
            model.mode = MODES.some(mode => mode.id === source.mode) ? source.mode : "bars";
            model.rotate = Boolean(source.rotate);
            model.loaded = true;
            render();
            Admin.log(`Visualizer loaded: ${model.mode}${model.rotate ? " (cycling)" : ""}.`);
        } catch (error) {
            Admin.log(`Could not load ${PATH}: ${error.message}`);
            say("Load failed", "error");
        }
    }

    function build() {
        if (!MODES.some(mode => mode.id === model.mode)) throw new Error("Choose a visualizer style");
        const body = `${JSON.stringify({ mode: model.mode, rotate: Boolean(model.rotate) }, null, 2)}\n`;
        return {
            writes: [{ path: PATH, kind: "visualizer settings", text: body }],
            warnings: [],
            totalBytes: body.length
        };
    }

    function wire() {
        $("visualizer-list").addEventListener("change", event => {
            const radio = event.target.closest('input[name="visualizer-mode"]');
            if (!radio) return;
            model.mode = radio.value;
            render();
        });

        $("visualizer-rotate").addEventListener("change", event => {
            model.rotate = event.target.checked;
            const label = (MODES.find(mode => mode.id === model.mode) || MODES[0]).label;
            say(`${label}${model.rotate ? " - cycling" : ""}`, "ok");
        });

        $("visualizer-load").addEventListener("click", () => {
            model.loaded = false;
            load(true);
        });

        $("visualizer-plan").addEventListener("click", () => {
            try {
                const plan = build();
                Admin.renderPlan("visualizer-output", plan, [
                    ["mode", model.mode],
                    ["cycle", model.rotate ? "on" : "off"]
                ]);
            } catch (error) {
                Admin.log(`Plan failed: ${error.message}`);
            }
        });

        $("visualizer-publish").addEventListener("click", async () => {
            const sha = await Admin.publish({
                prefix: "visualizer",
                outputId: "visualizer-output",
                build,
                defaultMessage: "Set the player visualizer",
                stats: () => [
                    ["mode", model.mode],
                    ["cycle", model.rotate ? "on" : "off"]
                ]
            });
            if (sha) {
                model.loaded = true;
                say("Published", "ok");
            }
        });
    }

    function boot() {
        if (!window.Admin || !document.querySelector(".admin-main")) return;
        if ($("view-visualizer")) return;
        mount();
        wire();
        render();
        Admin.registerView("visualizer", () => load(false));
    }

    window.VisualizerTool = { model, load, render, build };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }
})();
