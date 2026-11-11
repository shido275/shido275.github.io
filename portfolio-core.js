/* ==========================================================================
   portfolio-core.js - the arithmetic behind the portfolio, kept out of the DOM.

   The cards are my public GitHub repositories, read live. GitHub already
   answers both questions the page asks: pushed_at is when the repository was
   last touched, and archived is GitHub's own flag, so there is no second list
   to keep in step. portfolio.json holds the account to read, any repos to
   leave out, and a snapshot to fall back on when api.github.com cannot be
   reached or its anonymous hourly limit is spent.

   This file turns that payload into the same card shape the snapshot uses, so
   the renderer has one path and the date maths, the ordering and the filters
   can be tested with plain node (see admin/portfolio-core.test.js).
   ========================================================================== */
(function () {
    "use strict";

    const DAY = 86400000;
    const YEAR = 365;
    const MONTH = 30.44;

    /* A project date is either a plain day ("2026-11-06") or a full timestamp.
       A plain day is read as midnight UTC so a timezone west of GMT cannot turn
       "today" into "yesterday" on the card. */
    function parseDay(value) {
        const text = String(value == null ? "" : value).trim();
        if (!text) return null;
        const date = new Date(text.length === 10 ? `${text}T00:00:00Z` : text);
        if (Number.isNaN(date.getTime())) return null;
        return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    }

    function todayStamp(now) {
        const stamp = now instanceof Date ? now.getTime() : Date.now();
        const date = new Date(stamp);
        return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    }

    /* Whole days between the project's last update and now. A future date reads
       as 0 rather than a negative age, and an unusable date reads as null. */
    function daysSince(value, now) {
        const day = parseDay(value);
        if (day === null) return null;
        return Math.max(0, Math.round((todayStamp(now) - day) / DAY));
    }

    /* Short, human age. No "just now" noise: a project is touched in days. */
    function timeAgo(value, now) {
        const days = daysSince(value, now);
        if (days === null) return "";
        if (days === 0) return "today";
        if (days === 1) return "1 day ago";
        if (days < 30) return `${days} days ago`;
        const months = Math.max(1, Math.round(days / MONTH));
        if (days < YEAR) return months === 1 ? "1 month ago" : `${months} months ago`;
        const years = Math.max(1, Math.round(days / YEAR));
        return years === 1 ? "1 year ago" : `${years} years ago`;
    }

    function tagsOf(value) {
        if (!Array.isArray(value)) return [];
        return value
            .map(tag => String(tag == null ? "" : tag).trim())
            .filter(Boolean)
            .slice(0, 6);
    }

    /* The document is either { projects: [...] } or the bare array. Entries
       without a title cannot be a card, so they are dropped rather than
       rendered blank. */
    function entries(doc) {
        if (Array.isArray(doc)) return doc;
        if (doc && Array.isArray(doc.projects)) return doc.projects;
        return [];
    }

    /* Active work first, newest first; archived work after it, also newest
       first. Undated projects sit at the bottom of their group. */
    function normalise(doc, now) {
        return entries(doc)
            .filter(project => project && typeof project === "object")
            .map(project => {
                const title = String(project.title == null ? "" : project.title).trim();
                if (!title) return null;
                const updated = String(project.updated == null ? "" : project.updated).trim();
                const day = parseDay(updated);
                const archived = project.archived === true;
                return {
                    id: String(project.id || title).trim(),
                    title,
                    blurb: String(project.blurb || "").trim(),
                    tags: tagsOf(project.tags),
                    link: String(project.link || "").trim(),
                    linkLabel: String(project.linkLabel || "Open").trim(),
                    image: String(project.image || "").trim(),
                    updated,
                    day,
                    age: timeAgo(updated, now),
                    archived
                };
            })
            .filter(Boolean)
            .sort((a, b) => {
                if (a.archived !== b.archived) return a.archived ? 1 : -1;
                if (a.day !== b.day) {
                    if (a.day === null) return 1;
                    if (b.day === null) return -1;
                    return b.day - a.day;
                }
                return a.title.localeCompare(b.title);
            });
    }

    function counts(list) {
        const items = Array.isArray(list) ? list : [];
        const archived = items.filter(project => project.archived).length;
        return { all: items.length, active: items.length - archived, archived };
    }

    function filter(list, mode) {
        const items = Array.isArray(list) ? list : [];
        if (mode === "active") return items.filter(project => !project.archived);
        if (mode === "archived") return items.filter(project => project.archived);
        return items.slice();
    }

    /* ------------------------------------------------------- GitHub payloads */

    /* Every public repository, newest push first: one page is a hundred, which
       is the API's maximum and more than this account has. */
    function apiUrl(doc) {
        const source = (doc && doc.source) || {};
        const user = String(source.user || "").trim();
        if (!user) return "";
        return `https://api.github.com/users/${encodeURIComponent(user)}/repos`
            + "?per_page=100&sort=pushed&direction=desc&type=owner";
    }

    /* A cache written in a previous visit is only worth painting while it is
       inside the window: GitHub allows sixty anonymous calls an hour. A clock
       that has jumped backwards is not trusted either. */
    function isFresh(savedAt, ttl, now) {
        const at = Number(savedAt);
        const life = Number(ttl);
        if (!Number.isFinite(at) || at <= 0) return false;
        if (!Number.isFinite(life) || life <= 0) return false;
        const stamp = now instanceof Date ? now.getTime() : Number.isFinite(now) ? now : Date.now();
        const age = stamp - at;
        return age >= 0 && age < life;
    }

    function repoKey(repo) {
        const full = String((repo && repo.full_name) || "").trim();
        if (full) return full;
        const name = String((repo && repo.name) || "").trim();
        const owner = String((repo && repo.owner && repo.owner.login) || "").trim();
        return owner && name ? `${owner}/${name}` : name;
    }

    /* GitHub timestamps: pushed_at is the real "last touched", but a fresh repo
       with no push yet only carries the other two. */
    function repoDay(repo) {
        const value = repo && (repo.pushed_at || repo.updated_at || repo.created_at);
        return String(value == null ? "" : value).trim();
    }

    /* Language first, then the repository's own topics: the useful signal on a
       card is what it is built with, not a star count. */
    function repoTags(repo) {
        const language = String((repo && repo.language) || "").trim();
        const topics = repo && Array.isArray(repo.topics) ? repo.topics : [];
        return tagsOf([language].concat(topics));
    }

    function repoProject(repo) {
        return {
            id: repoKey(repo),
            title: String((repo && repo.name) || "").trim(),
            blurb: String((repo && repo.description) || "").trim(),
            tags: repoTags(repo),
            link: String((repo && repo.html_url) || "").trim(),
            linkLabel: "Open on GitHub",
            updated: repoDay(repo),
            archived: repo && repo.archived === true
        };
    }

    function namesOf(value) {
        if (!Array.isArray(value)) return [];
        return value
            .map(item => String(item == null ? "" : item).trim().toLowerCase())
            .filter(Boolean);
    }

    /* A fork is somebody else's project, so it stays off the page unless the
       data file opts in. A private repository should never arrive here, but it
       is dropped rather than trusted. */
    function fromRepos(doc, payload) {
        const source = (doc && doc.source) || {};
        const skip = namesOf(source.exclude);
        const includeForks = source.includeForks === true;
        const list = Array.isArray(payload) ? payload : [];
        const seen = new Set();
        const out = [];

        list.forEach(repo => {
            if (!repo || typeof repo !== "object") return;
            if (repo.fork === true && !includeForks) return;
            if (repo.private === true) return;

            const key = repoKey(repo);
            if (!key) return;
            const name = String(repo.name || "").trim().toLowerCase();
            const lower = key.toLowerCase();
            if (skip.indexOf(lower) !== -1) return;
            if (name && skip.indexOf(name) !== -1) return;
            if (seen.has(lower)) return;
            seen.add(lower);

            if (!String(repo.name || "").trim()) return;
            out.push(repoProject(repo));
        });

        return out;
    }

    function repoProjects(doc, payload, now) {
        return normalise({ projects: fromRepos(doc, payload) }, now);
    }

    const Core = {
        DAY,
        parseDay,
        daysSince,
        timeAgo,
        normalise,
        counts,
        filter,
        apiUrl,
        isFresh,
        fromRepos,
        repoProjects
    };

    if (typeof window !== "undefined") window.PortfolioCore = Core;
    if (typeof module !== "undefined" && module.exports) module.exports = Core;
})();
