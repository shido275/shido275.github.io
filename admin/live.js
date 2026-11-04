/* ==========================================================================
   live.js - publish once, see it on the site in seconds.

   Two jobs, both wrapped around the dashboard rather than buried inside it:

     1. Every tool publishes to the branch the site actually reads. The Photo,
        Video and Link tools used to pre-fill their Branch field with a fresh
        "admin/<tool>-<date>" side branch, so those commits landed where the
        site never looked and nothing appeared to happen. This repairs that and
        keeps the field honest.

     2. After a publish that reached the base branch, this waits for the exact
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

    function rawUrl(path) {
        return `https://raw.githubusercontent.com/${Admin.state.config.owner}/${Admin.state.config.repo}/${encodeURIComponent(baseBranch())}/${String(path).split("/").map(encodeURIComponent).join("/")}`;
    }

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

    async function announceLive(outputId, writes) {
        const box = $(outputId);
        if (!box) return;
        const note = document.createElement("p");
        note.className = "hint";
        note.textContent = "Checking the site for the new files...";
        box.appendChild(note);

        const result = await waitForLive(writes);
        const live = (writes || []).filter(write => !write.delete).length - result.pending.length;
        if (!result.pending.length) {
            note.className = "ok-line";
            note.textContent = `Live on the site after ${result.seconds}s - no Pages rebuild needed.`;
        } else {
            note.className = "warn-list";
            note.textContent = `${live} file(s) live after ${result.seconds}s; still propagating: ${result.pending.slice(0, 4).join(", ")}${result.pending.length > 4 ? "..." : ""}`;
        }
        Admin.log(note.textContent);
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
            const sha = await original.call(Admin, opts);
            if (!sha || !plan || !Array.isArray(plan.writes)) return sha;

            if (dryRun) return sha;

            if (targetBranch(opts.prefix) !== baseBranch()) {
                const box = $(opts.outputId);
                if (box) {
                    box.insertAdjacentHTML("beforeend", `<p class="warn-list">That commit went to <strong>${Admin.escapeHtml(targetBranch(opts.prefix))}</strong>, not <strong>${Admin.escapeHtml(baseBranch())}</strong> - the site will not show it until it is merged.</p>`);
                }
                return sha;
            }

            await announceLive(opts.outputId, plan.writes);
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
