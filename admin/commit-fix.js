/* ==========================================================================
   commit-fix.js - makes a dashboard publish tell the truth.

   Loaded last, after live.js, because it wraps Admin.publish again. Three
   things it fixes, all of which let the dashboard report "Committed" while the
   branch, and so the site, stayed exactly as it was:

     1. A publish whose files already match the branch made an empty commit and
        reported success. That is now stopped before anything is written.
     2. The theme panel is read off the page at publish time, so the palette and
        the reload rotation ticked on screen are what actually get written,
        whatever the panel had in memory.
     3. After a media publish the panel re-reads its own document, so a second
        publish in the same tab is not built on the state from before.
   ========================================================================== */
(function () {
    "use strict";

    const Admin = window.Admin;
    if (!Admin || typeof Admin.publish !== "function") return;

    const $ = id => document.getElementById(id);
    const MEDIA_PREFIXES = ["photos", "videos", "backgrounds", "beats"];

    function note(outputId, text, tone) {
        Admin.log(text);
        const box = outputId ? $(outputId) : null;
        if (!box) return;
        const line = document.createElement("p");
        line.className = tone === "ok" ? "ok-line" : tone === "error" ? "warn-list" : "hint";
        line.textContent = text;
        box.appendChild(line);
    }

    function isDryRun(prefix) {
        const box = prefix ? $(`${prefix}-dryrun`) : null;
        return Boolean(box && box.checked);
    }

    /* 2. What is on screen is what gets committed. */
    function fromPanel(options) {
        const opts = options || {};
        if (opts.prefix !== "themes" || typeof opts.build !== "function") return opts;
        const rotate = $("themes-rotate");
        const picked = document.querySelector('#themes-list input[name="theme-default"]:checked');
        return {
            ...opts,
            build: () => {
                const plan = opts.build();
                const writes = Array.isArray(plan.writes) ? plan.writes : [];
                const write = writes.find(item => /(^|\/)themes\.json$/.test(item.path));
                if (!write || write.text === undefined) return plan;
                let doc;
                try {
                    doc = JSON.parse(write.text);
                } catch {
                    return plan;
                }
                if (rotate) doc.rotate = Boolean(rotate.checked);
                if (picked && picked.value) doc.default = picked.value;
                const text = `${JSON.stringify(doc, null, 2)}\n`;
                if (text === write.text) return plan;
                const next = writes.map(item => (item === write ? { ...item, text } : item));
                return {
                    ...plan,
                    writes: next,
                    totalBytes: next.reduce((sum, item) => sum + (item.file ? item.file.size : String(item.text || "").length), 0)
                };
            }
        };
    }

    /* 1. A branch that already has these bytes cannot take the change. */
    async function nothingToSend(writes) {
        const list = (writes || []).filter(write => !write.delete);
        if (!list.length) return false;
        if (list.some(write => write.file || write.text === undefined)) return false;
        for (const write of list) {
            let base = "";
            try {
                const response = await fetch(`${Admin.rawUrl(write.path)}?v=${Date.now()}`, { cache: "no-store" });
                if (!response.ok) return false;
                base = await response.text();
            } catch {
                return false;
            }
            if (base !== write.text) return false;
        }
        return true;
    }

    const live = Admin.publish;

    Admin.publish = async function (options) {
        const opts = fromPanel(options);

        // The theme document only exists once the panel has read it.
        if (opts.prefix === "themes" && !document.querySelector('#themes-list input[name="theme-default"]')) {
            note(opts.outputId, "Load the themes first, change what you want, then publish - nothing was sent.", "error");
            return null;
        }

        let plan = null;
        try {
            plan = typeof opts.build === "function" ? opts.build() : null;
        } catch {
            plan = null;
        }
        const writes = plan && Array.isArray(plan.writes) ? plan.writes : [];

        if (writes.length && !isDryRun(opts.prefix) && await nothingToSend(writes)) {
            note(
                opts.outputId,
                "Nothing to send: those files already match the branch, so no commit was made and the site is unchanged.",
                "error"
            );
            return null;
        }

        const sha = await live.call(Admin, opts);

        if (sha && MEDIA_PREFIXES.includes(opts.prefix)) {
            const reload = $(`${opts.prefix}-load`);
            if (reload) window.setTimeout(() => reload.click(), 500);
        }

        if (sha && opts.prefix === "themes") {
            const rotate = $("themes-rotate");
            note(
                opts.outputId,
                rotate && rotate.checked
                    ? "Rotation is on: every page load now deals a different palette."
                    : "Saved. Rotation is off, so every visit gets the default palette.",
                "ok"
            );
        }

        return sha;
    };

    Admin.publishCommitFixes = true;
})();
