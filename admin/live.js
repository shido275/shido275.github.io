/* ==========================================================================
   live.js - publish once, see it on the site in seconds.

   Three jobs, all wrapped around the dashboard rather than buried inside it:

     1. Every tool publishes to the branch the site actually reads. The Photo,
        Video and Link tools used to pre-fill their Branch field with a fresh
        "admin/<tool>-<date>" side branch, so those commits landed where the
        site never looked and nothing appeared to happen. This repairs that and
        keeps the field honest.

     2. Removals actually remove. A plan can carry writes marked `delete`, but
        the commit builder in app.js uploads a blob for every write, so a
        deletion turned into an empty file. Here those paths are dropped from
        the tree and deleted through the contents API after the commit lands -
        the index is updated first, so a failed delete leaves an unused file
        rather than an entry pointing at something already gone.

     3. After a publish that reached the base branch, this waits for the exact
        bytes it just wrote to answer on the commit and reports how long it
        took, instead of leaving "did it work?" to guesswork.

   The site reads content from the commit (see ../feed.js), so this is the same
   path visitors take - if it answers here, it is on the site.
   ========================================================================== */
(function () {
    "use strict";

    const Admin = window.Admin;
    const $ = id => document.getElementById(id);
    const SIDE_BRANCH_TOOLS = ["photos", "videos", "links"];

    function baseBranch() {
        return (Admin.state.config.branch || "main").trim() || "main";
    }

    function targetBranch(prefix) {
        const input = prefix ? $(`${prefix}-branch`) : null;
        return (input && input.value.trim()) || baseBranch();
    }

    /* A side branch is not the site; the field now says what it will do. */
    function fixBranchDefaults() {
        SIDE_BRANCH_TOOLS.forEach(prefix => {
            const input = $(`${prefix}-branch`);
            if (!input) return;
            const value = input.value.trim();
            if (!value || /^admin\//i.test(value)) input.value = baseBranch();
        });
    }

    function encodePath(path) {
        return String(path).split("/").map(encodeURIComponent).join("/");
    }

    function rawUrl(path) {
        const { owner, repo } = Admin.state.config;
        return `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(baseBranch())}/${encodePath(path)}`;
    }

    /* ------------------------------------------------------------- deletions */

    function apiHeaders() {
        return {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${Admin.state.config.token}`,
            "X-GitHub-Api-Version": "2022-11-28"
        };
    }

    /* The contents API deletes one path per commit, so this walks the removals
       in the order the plan lists them and reports anything that failed. */
    async function deletePaths(paths, message) {
        const { owner, repo } = Admin.state.config;
        const root = `https://api.github.com/repos/${owner}/${repo}/contents/`;
        const removed = [];
        const failed = [];

        for (const path of paths) {
            const url = `${root}${encodePath(path)}`;
            try {
                const current = await fetch(`${url}?ref=${encodeURIComponent(baseBranch())}`, {
                    headers: apiHeaders(),
                    cache: "no-store"
                });
                if (current.status === 404) continue;
                if (!current.ok) throw new Error(`read failed (${current.status})`);
                const info = await current.json();
                if (!info || !info.sha) continue;

                const response = await fetch(url, {
                    method: "DELETE",
                    headers: { ...apiHeaders(), "Content-Type": "application/json" },
                    body: JSON.stringify({
                        message: message || `Remove ${path}`,
                        sha: info.sha,
                        branch: baseBranch()
                    })
                });
                if (!response.ok) throw new Error(`delete failed (${response.status})`);
                Admin.log(`Removed ${path}.`);
                removed.push(path);
            } catch (error) {
                Admin.log(`Could not remove ${path}: ${error.message}`);
                failed.push(path);
            }
        }

        return { removed, failed };
    }

    /* ------------------------------------------------------------- live check */

    async function waitForLive(writes, options) {
        const opts = options || {};
        const started = Date.now();
        const deadline = started + (opts.timeout || 60000);
        const pending = new Map(
            (writes || [])
                .filter(write => !write.delete)
                .map(write => [write.path, write])
        );

        while (pending.size && Date.now() < deadline) {
            for (const [path, write] of [...pending]) {
                const url = `${rawUrl(path)}?v=${Date.now()}`;
                try {
                    if (write.text !== undefined) {
                        const response = await fetch(url, { cache: "no-store" });
                        if (!response.ok) continue;
                        if ((await response.text()) === write.text) pending.delete(path);
                    } else if (write.file) {
                        const response = await fetch(url, { method: "HEAD", cache: "no-store" });
                        if (!response.ok) continue;
                        if (Number(response.headers.get("content-length")) === write.file.size) pending.delete(path);
                    } else {
                        pending.delete(path);
                    }
                } catch {
                    /* the branch may still be propagating; try again */
                }
            }
            if (pending.size) await new Promise(resolve => setTimeout(resolve, 1200));
        }

        return { seconds: Math.round((Date.now() - started) / 100) / 10, pending: [...pending.keys()] };
    }

    function note(outputId, text, tone) {
        const box = outputId ? $(outputId) : null;
        if (!box) return null;
        const line = document.createElement("p");
        line.className = tone === "error" ? "warn-list" : "hint";
        line.textContent = text;
        box.appendChild(line);
        return line;
    }

    async function announceLive(outputId, writes) {
        if (!outputId || !$(outputId)) return;
        const line = note(outputId, "Checking the site for the new files...");
        const result = await waitForLive(writes);
        const live = (writes || []).filter(write => !write.delete).length - result.pending.length;
        if (!line) return;
        if (!result.pending.length) {
            line.className = "ok-line";
            line.textContent = `Live on the site after ${result.seconds}s - no Pages rebuild needed.`;
        } else {
            line.className = "warn-list";
            line.textContent = `${live} file(s) live after ${result.seconds}s; still propagating: ${result.pending.slice(0, 4).join(", ")}${result.pending.length > 4 ? "..." : ""}`;
        }
        Admin.log(line.textContent);
    }

    /* Every tool goes through Admin.publish, so one wrapper covers them all. */
    function wrapPublish() {
        const original = Admin.publish;
        if (typeof original !== "function" || original.__xidLive) return;

        const wrapped = async function (options) {
            const opts = options || {};
            let plan = null;
            try {
                plan = typeof opts.build === "function" ? opts.build() : null;
            } catch {
                plan = null;
            }

            const dryRun = Boolean(opts.prefix && $(`${opts.prefix}-dryrun`) && $(`${opts.prefix}-dryrun`).checked);
            const writes = plan && Array.isArray(plan.writes) ? plan.writes : [];
            const removals = writes.filter(write => write.delete).map(write => write.path);

            // The commit builder only knows how to upload, so removals are kept
            // out of the tree and handled straight after the commit.
            const patched = removals.length
                ? {
                    ...opts,
                    build: () => {
                        const next = typeof opts.build === "function" ? opts.build() : { writes: [] };
                        return { ...next, writes: (next.writes || []).filter(write => !write.delete) };
                    }
                }
                : opts;

            const sha = await original.call(Admin, patched);
            if (!sha || !plan || !Array.isArray(plan.writes)) return sha;
            if (dryRun) return sha;

            if (targetBranch(opts.prefix) !== baseBranch()) {
                note(
                    opts.outputId,
                    `That commit went to ${targetBranch(opts.prefix)}, not ${baseBranch()} - the site will not show it until it is merged.`,
                    "error"
                );
                return sha;
            }

            if (removals.length) {
                const result = await deletePaths(removals, opts.message || null);
                if (result.failed.length) {
                    note(opts.outputId, `Committed, but ${result.failed.length} file(s) could not be removed: ${result.failed.join(", ")}`, "error");
                }
            }

            await announceLive(opts.outputId, writes);
            return sha;
        };

        wrapped.__xidLive = true;
        Admin.publish = wrapped;
    }

    function boot() {
        if (!Admin || !Admin.state) return;
        fixBranchDefaults();
        wrapPublish();
        Admin.waitForLive = waitForLive;
        Admin.announceLive = announceLive;
        Admin.deletePaths = deletePaths;
        Admin.rawUrl = rawUrl;

        const connect = $("btn-connect");
        if (connect) {
            connect.addEventListener("click", () => {
                window.setTimeout(fixBranchDefaults, 600);
            });
        }
        document.querySelectorAll(".admin-nav__item").forEach(item => {
            if (item.dataset.view === "photos" || item.dataset.view === "videos" || item.dataset.view === "links") {
                item.addEventListener("click", () => window.setTimeout(fixBranchDefaults, 50));
            }
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }
})();
