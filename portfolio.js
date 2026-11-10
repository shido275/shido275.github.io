/* ==========================================================================
   portfolio.js - paints #/portfolio from portfolio.json.

   The data file is the source of truth, exactly like links.json and
   music-manifest.json: add a project there and it appears on the page. Each
   card carries the day it was last touched, turned into "Updated 4 days ago"
   by portfolio-core.js, and an Active or Archived stamp.

   The labels are recomputed on a timer as well as on load, so a tab left open
   overnight still says "yesterday" in the morning rather than lying about it.
   ========================================================================== */
(function () {
    "use strict";

    const DATA = "portfolio.json";
    const REFRESH = 60000;

    const Core = window.PortfolioCore;
    const grid = document.getElementById("portfolio-grid");
    if (!Core || !grid) return;

    const status = document.getElementById("portfolio-status");
    const buttons = Array.from(document.querySelectorAll("[data-portfolio-filter]"));

    let projects = [];
    let mode = "all";

    function escapeHtml(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function card(project) {
        const badge = project.archived
            ? '<span class="status-badge is-archived">Archived</span>'
            : '<span class="status-badge is-active">Active</span>';

        const image = project.image
            ? `<img src="${escapeHtml(project.image)}" alt="" loading="lazy" decoding="async">`
            : "";

        const tags = project.tags.length
            ? `<ul class="project-tags">${project.tags.map(tag => `<li>${escapeHtml(tag)}</li>`).join("")}</ul>`
            : "";

        const age = project.updated
            ? `<span class="project-age">Updated <time datetime="${escapeHtml(project.updated)}">${escapeHtml(project.age || project.updated)}</time></span>`
            : '<span class="project-age">No update logged</span>';

        const link = project.link
            ? `<a class="project-link" href="${escapeHtml(project.link)}">${escapeHtml(project.linkLabel)} &rarr;</a>`
            : "";

        return `
            <article class="project-card" data-archived="${project.archived ? "true" : "false"}">
                ${image}
                <div class="project-body">
                    <div class="project-headline">
                        <h2>${escapeHtml(project.title)}</h2>
                        ${badge}
                    </div>
                    ${project.blurb ? `<p class="project-blurb">${escapeHtml(project.blurb)}</p>` : ""}
                    ${tags}
                    <div class="project-foot">
                        ${age}
                        ${link}
                    </div>
                </div>
            </article>
        `;
    }

    function paint() {
        const shown = Core.filter(projects, mode);
        const counts = Core.counts(projects);

        buttons.forEach(button => {
            const key = button.getAttribute("data-portfolio-filter");
            const count = button.querySelector("[data-portfolio-count]");
            if (count) count.textContent = String(counts[key] == null ? counts.all : counts[key]);
            button.setAttribute("aria-pressed", key === mode ? "true" : "false");
            button.classList.toggle("primary", key === mode);
        });

        if (!shown.length) {
            const message = counts.all === 0
                ? "No projects yet. Add one to portfolio.json."
                : `Nothing ${mode === "archived" ? "archived" : "active"} right now.`;
            grid.innerHTML = `<p class="muted portfolio-empty">${escapeHtml(message)}</p>`;
        } else {
            grid.innerHTML = shown.map(card).join("");
        }

        if (status) {
            const parts = [`${counts.active} active`];
            if (counts.archived) parts.push(`${counts.archived} archived`);
            status.textContent = counts.all ? `${counts.all} project${counts.all === 1 ? "" : "s"} - ${parts.join(", ")}` : "";
        }
    }

    function redate() {
        if (!projects.length) return;
        projects = Core.normalise({ projects }, new Date());
        paint();
    }

    async function load() {
        try {
            const doc = window.XIDFeed && typeof window.XIDFeed.json === "function"
                ? await window.XIDFeed.json(DATA, { fallback: null })
                : await (await fetch(`${DATA}?v=${Date.now()}`, { cache: "no-store" })).json();

            if (!doc) throw new Error("portfolio.json could not be read");
            projects = Core.normalise(doc, new Date());
            paint();
        } catch (error) {
            grid.innerHTML = `<p class="muted portfolio-empty">Projects could not be loaded right now.</p>`;
            if (status) status.textContent = "";
            if (window.console && console.warn) console.warn(`portfolio: ${error.message}`);
        }
    }

    buttons.forEach(button => {
        button.addEventListener("click", () => {
            mode = button.getAttribute("data-portfolio-filter") || "all";
            paint();
        });
    });

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", load);
    } else {
        load();
    }

    window.setInterval(redate, REFRESH);
})();
