/* ==========================================================================
   All Links tool - edits links.json, which the site renders into the
   #/links view. Groups mirror the page sections; order is display order.
   ========================================================================== */
(function () {
    "use strict";

    const CORE = window.ReleaseImport;
    const Admin = window.Admin;
    const $ = id => document.getElementById(id);
    const esc = Admin.escapeHtml;

    const GROUPS = [
        { key: "featured", label: "Featured", fields: ["label", "url", "description", "accent"] },
        { key: "platforms", label: "Platforms", fields: ["label", "url"] },
        { key: "socials", label: "Socials", fields: ["label", "url", "handle"] },
        { key: "business", label: "Business", fields: ["label", "url"] },
        { key: "quickSocials", label: "Hero socials", fields: ["label", "url"] }
    ];

    const links = {
        loaded: false,
        groups: {
            featured: [],
            platforms: [],
            socials: [],
            business: [],
            quickSocials: []
        }
    };

    function status(text, tone) {
        const node = $("links-count");
        if (!node) return;
        node.textContent = text;
        node.dataset.tone = tone || "";
    }

    function totalLinks() {
        return GROUPS.reduce((sum, group) => sum + links.groups[group.key].length, 0);
    }

    async function loadLinks(force) {
        if (links.loaded && !force) return;
        if (!Admin.state.config.token) {
            Admin.log("Connect a token to load the current links.");
            return;
        }
        try {
            const doc = await Admin.readJson(CORE.LINKS_PATH);
            GROUPS.forEach(group => {
                links.groups[group.key] = doc && Array.isArray(doc[group.key])
                    ? doc[group.key].map(item => ({ ...item }))
                    : [];
            });
            links.loaded = true;
            Admin.log(`Links loaded: ${totalLinks()} entr${totalLinks() === 1 ? "y" : "ies"}.`);
            renderAll();
        } catch (error) {
            Admin.log(`Could not load ${CORE.LINKS_PATH}: ${error.message}`);
            status("Load failed", "error");
        }
    }

    function rowFields(group, item, index) {
        const parts = [];
        if (group.fields.includes("label")) {
            parts.push(`<input data-field="label" data-group="${group.key}" data-index="${index}" value="${esc(item.label || "")}" placeholder="Label" aria-label="Label">`);
        }
        if (group.fields.includes("url")) {
            parts.push(`<input data-field="url" data-group="${group.key}" data-index="${index}" value="${esc(item.url || "")}" placeholder="https://..." aria-label="URL">`);
        }
        if (group.fields.includes("description")) {
            parts.push(`<input data-field="description" data-group="${group.key}" data-index="${index}" value="${esc(item.description || "")}" placeholder="Description" aria-label="Description">`);
        }
        if (group.fields.includes("handle")) {
            parts.push(`<input data-field="handle" data-group="${group.key}" data-index="${index}" value="${esc(item.handle || "")}" placeholder="@handle" aria-label="Handle">`);
        }
        if (group.fields.includes("accent")) {
            const accents = ["", ...CORE.ACCENTS];
            parts.push(`<select data-field="accent" data-group="${group.key}" data-index="${index}" aria-label="Accent">
                ${accents.map(accent => `<option value="${esc(accent)}"${(item.accent || "") === accent ? " selected" : ""}>${accent || "no accent"}</option>`).join("")}
            </select>`);
        }
        return parts.join("");
    }

    function renderGroup(group) {
        const container = $(`rows-${group.key}`);
        const rows = links.groups[group.key];
        if (!rows.length) {
            container.innerHTML = `<p class="muted">Nothing here - the site keeps its built-in list for this group.</p>`;
            return;
        }
        container.innerHTML = rows.map((item, index) => `
            <div class="link-row">
                ${rowFields(group, item, index)}
                <div class="media-row__actions">
                    <button class="button ghost" type="button" data-link-move="-1" data-group="${group.key}" data-index="${index}" aria-label="Move up">&uarr;</button>
                    <button class="button ghost" type="button" data-link-move="1" data-group="${group.key}" data-index="${index}" aria-label="Move down">&darr;</button>
                    <button class="button ghost" type="button" data-link-remove data-group="${group.key}" data-index="${index}" aria-label="Remove link">Remove</button>
                </div>
            </div>
        `).join("");
    }

    function refreshCount() {
        const total = totalLinks();
        status(`${total} link${total === 1 ? "" : "s"}`, "ok");
    }

    function renderAll() {
        GROUPS.forEach(renderGroup);
        refreshCount();
    }

    function addRow(key) {
        links.groups[key].push({ label: "", url: "" });
        renderGroup(GROUPS.find(group => group.key === key));
        refreshCount();
    }

    function wire() {
        document.querySelectorAll("[data-add]").forEach(button => {
            button.addEventListener("click", () => addRow(button.dataset.add));
        });

        document.querySelectorAll(".link-rows").forEach(container => {
            container.addEventListener("input", event => {
                const input = event.target.closest("[data-field]");
                if (!input) return;
                const item = links.groups[input.dataset.group][Number(input.dataset.index)];
                if (!item) return;
                item[input.dataset.field] = input.value;
            });
            container.addEventListener("change", event => {
                const input = event.target.closest("[data-field]");
                if (!input) return;
                const item = links.groups[input.dataset.group][Number(input.dataset.index)];
                if (!item) return;
                item[input.dataset.field] = input.value;
            });
            container.addEventListener("click", event => {
                const move = event.target.closest("[data-link-move]");
                const remove = event.target.closest("[data-link-remove]");
                const group = (move || remove) && links.groups[(move || remove).dataset.group];
                if (!group) return;
                const index = Number((move || remove).dataset.index);
                if (move) {
                    const to = index + Number(move.dataset.linkMove);
                    if (to < 0 || to >= group.length) return;
                    const [item] = group.splice(index, 1);
                    group.splice(to, 0, item);
                    renderGroup(GROUPS.find(entry => entry.key === (move || remove).dataset.group));
                    refreshCount();
                    return;
                }
                group.splice(index, 1);
                renderGroup(GROUPS.find(entry => entry.key === (move || remove).dataset.group));
                refreshCount();
            });
        });

        $("links-load").addEventListener("click", () => loadLinks(true));

        $("links-plan").addEventListener("click", () => {
            try {
                Admin.renderPlan("links-output", buildPlan(), stats);
            } catch (error) {
                Admin.log(`Link plan failed: ${error.message}`);
            }
        });

        $("links-publish").addEventListener("click", () => {
            Admin.publish({
                prefix: "links",
                outputId: "links-output",
                build: buildPlan,
                defaultMessage: `Update the All Links directory (${totalLinks()} link${totalLinks() === 1 ? "" : "s"})`,
                stats
            });
        });
    }

    function stats(plan) {
        return GROUPS.map(group => [`${links.groups[group.key].length}`, group.label.toLowerCase()]);
    }

    function buildPlan() {
        return CORE.planLinks({ doc: links.groups });
    }

    function init() {
        wire();
        renderAll();
        Admin.registerView("links", () => loadLinks(false));
    }

    document.addEventListener("DOMContentLoaded", init);
})();
