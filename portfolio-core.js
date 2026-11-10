/* ==========================================================================
   portfolio-core.js - the arithmetic behind the portfolio, kept out of the DOM.

   portfolio.json lists the projects that are not music. Each one carries the
   day it was last touched and whether it has been put away, so the page can say
   "Updated 4 days ago" and stamp an Active or Archived badge on the card.

   Nothing here touches the document, so the date maths, the ordering and the
   filters can be tested with plain node (see admin/portfolio-core.test.js).
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

    const Core = { DAY, parseDay, daysSince, timeAgo, normalise, counts, filter };

    if (typeof window !== "undefined") window.PortfolioCore = Core;
    if (typeof module !== "undefined" && module.exports) module.exports = Core;
})();
