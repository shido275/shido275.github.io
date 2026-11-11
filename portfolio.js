/* ==========================================================================
   portfolio.js - paints #/portfolio from the GitHub API.

   The cards are the public repositories of the account named in
   portfolio.json, read straight from api.github.com in the visitor's browser,
   so pushing a repo updates the page without a redeploy. GitHub allows sixty
   anonymous calls an hour per address, so the answer is kept in localStorage
   for the window portfolio.json names (ten minutes by default).

   Three answers are painted, in order of preference: the live list, the last
   list this browser saved, and the snapshot committed beside the page. The
   status line says which one is on screen, so a stale copy is never passed off
   as live.

   The ages are recomputed on a timer as well as on load, so a tab left open
   overnight still says "yesterday" in the morning rather than lying about it.
   ========================================================================== */
(function () {
    "use strict";

    const DATA = "portfolio.json";
    const CACHE = "xid-portfolio-repos";
    const TTL = 10 * 60000;
    const MINUTE = 60000;
    const REFRESH = 60000;

    const Core = window.PortfolioCore;
    const grid = document.getElementById("portfolio-grid");
    if (!Core || !grid) return;

    const status = document.getElementById("portfolio-status");
    const buttons = Array.from(document.querySelectorAll("[data-portfolio-filter]"));

    let projects = [];
    let mode = "all";
    let source = { kind: "none", at: 0 };
    let trouble = "";

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
            : '<span class="project-age">No push yet</span>';

        const external = /^https?:/i.test(project.link);
        const link = project.link
            ? `<a class="project-link" href="${escapeHtml(project.link)}"${external ? ' target="_blank" rel="noreferrer noopener"' : ""}>${escapeHtml(project.linkLabel)} &rarr;</a>`
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

    function minutesAgo(at) {
        const minutes = Math.max(0, Math.round((Date.now() - at) / MINUTE));
        if (minutes < 1) return "moments ago";
        if (minutes === 1) return "1 min ago";
        if (minutes < 60) return `${minutes} mins ago`;
        const hours = Math.round(minutes / 60);
        return hours === 1 ? "1 hr ago" : `${hours} hrs ago`;
    }

    function sourceLabel() {
        if (source.kind === "live") return "live from GitHub";
        if (source.kind === "cache") return `GitHub copy, ${minutesAgo(source.at)}`;
        if (source.kind === "stale") return `GitHub unreachable, copy ${minutesAgo(source.at)} old`;
        if (source.kind === "snapshot") return "saved list";
        if (source.kind === "offline") return "saved list, GitHub unreachable";
        return "";
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
            const message = trouble || (counts.all === 0
                ? "No public repositories yet."
                : `Nothing ${mode === "archived" ? "archived" : "active"} right now.`);
            grid.innerHTML = `<p class="muted portfolio-empty">${escapeHtml(message)}</p>`;
        } else {
            grid.innerHTML = shown.map(card).join("");
        }

        if (status) {
            if (!counts.all) {
                status.textContent = trouble ? "" : "No repositories listed";
            } else {
                const parts = [`${counts.active} active`];
                if (counts.archived) parts.push(`${counts.archived} archived`);
                const tail = sourceLabel();
                status.textContent = `${counts.all} repo${counts.all === 1 ? "" : "s"} - ${parts.join(", ")}${tail ? ` - ${tail}` : ""}`;
            }
        }
    }

    /* ----------------------------------------------------------- cache */

    function readCache() {
        try {
            const raw = window.localStorage.getItem(CACHE);
            if (!raw) return null;
            const saved = JSON.parse(raw);
            if (!saved || !Array.isArray(saved.repos) || !(saved.at > 0)) return null;
            return saved;
        } catch (error) {
            return null;
        }
    }

    function writeCache(repos) {
        try {
            window.localStorage.setItem(CACHE, JSON.stringify({ at: Date.now(), repos }));
        } catch (error) {
            /* private mode or a full quota: the page still works, it just asks
               GitHub again next time */
        }
    }

    /* ------------------------------------------------------------ load */

    function showSnapshot(doc) {
        projects = Core.normalise(doc, new Date());
        source = { kind: "snapshot", at: 0 };
    }

    async function load() {
        let doc = null;
        try {
            doc = window.XIDFeed && typeof window.XIDFeed.json === "function"
                ? await window.XIDFeed.json(DATA, { fallback: null })
                : await (await fetch(`${DATA}?v=${Date.now()}`, { cache: "no-store" })).json();
        } catch (error) {
            doc = null;
        }

        if (!doc || typeof doc !== "object") {
            projects = [];
            source = { kind: "none", at: 0 };
            trouble = "The portfolio could not be loaded.";
            paint();
            return;
        }

        const api = Core.apiUrl(doc);
        if (!api) {
            showSnapshot(doc);
            if (!projects.length) trouble = "No repositories have been listed yet.";
            paint();
            return;
        }

        const wanted = Number((doc.source || {}).cacheMinutes);
        const ttl = wanted > 0 ? wanted * MINUTE : TTL;
        const saved = readCache();

        if (saved && Core.isFresh(saved.at, ttl, new Date())) {
            projects = Core.repoProjects(doc, saved.repos, new Date());
            source = { kind: "cache", at: saved.at };
            paint();
            return;
        }

        /* Paint what is already known while GitHub is asked, so the page is
           never blank on the way in. */
        if (saved) {
            projects = Core.repoProjects(doc, saved.repos, new Date());
            source = { kind: "stale", at: saved.at };
        } else {
            showSnapshot(doc);
        }
        if (projects.length) paint();

        try {
            const response = await fetch(api, {
                cache: "no-store",
                headers: { Accept: "application/vnd.github+json" }
            });
            if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
            const repos = await response.json();
            if (!Array.isArray(repos)) throw new Error("GitHub sent no repository list");

            writeCache(repos);
            projects = Core.repoProjects(doc, repos, new Date());
            source = { kind: "live", at: Date.now() };
            trouble = "";
            paint();
        } catch (error) {
            if (!projects.length) {
                trouble = "GitHub could not be reached and there is no saved list yet.";
            } else if (source.kind === "snapshot") {
                source = { kind: "offline", at: 0 };
            }
            paint();
            if (window.console && console.warn) console.warn(`portfolio: ${error.message}`);
        }
    }

    function redate() {
        if (!projects.length) return;
        projects = Core.normalise({ projects }, new Date());
        paint();
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
