/* ==========================================================================
   Control Room shell - config, GitHub REST plumbing, routing and the release
   importer. No server, no build step, no dependencies.

   window.Admin is the shared API the photo, video and link tools build on:
     Admin.state, Admin.log, Admin.setStatus, Admin.gh, Admin.readJson,
     Admin.commitWrites, Admin.publish, Admin.renderPlan, Admin.registerView
   ========================================================================== */
(function () {
    "use strict";

    const CORE = window.ReleaseImport;
    const Release = window.ReleaseCore;
    const CONFIG_KEY = "xid.admin.config.v2";
    /* The same key the Beat Store saves, so one saved Stripe key serves both. */
    const STRIPE_KEY_STORE = "xid.admin.stripe.v1";
    const STRIPE_LINKS = "https://api.stripe.com/v1/payment_links";
    const API = "https://api.github.com";
    const $ = id => document.getElementById(id);

    const state = {
        config: { owner: "shido275", repo: "shido275.github.io", branch: "main", token: "" },
        manifest: [],
        files: [],
        coverFile: null,
        plan: null,
        busy: false,
        view: "overview",
        connected: false,
        trackPaymentUrls: {}
    };

    const viewHooks = {};

    /* ---------------------------------------------------------------- helpers */

    function escapeHtml(value) {
        return String(value == null ? "" : value).replace(/[&<>"']/g, character => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        }[character]));
    }

    function log(message) {
        const box = $("log");
        if (!box) return;
        const line = `[${new Date().toLocaleTimeString()}] ${message}`;
        box.textContent += (box.textContent ? "\n" : "") + line;
        box.scrollTop = box.scrollHeight;
    }

    function setStatus(text, tone) {
        document.querySelectorAll("#conn-status, #conn-status-settings").forEach(node => {
            node.textContent = text;
            node.dataset.tone = tone || "";
        });
    }

    function setBusy(busy) {
        state.busy = busy;
        document.body.classList.toggle("is-busy", busy);
        document.querySelectorAll("button").forEach(button => {
            if (button.dataset.alwaysOn === "true") return;
            button.disabled = busy;
        });
        if (!busy && $("btn-import")) $("btn-import").disabled = !state.plan;
    }

    /* ---------------------------------------------------------------- config */

    function loadConfig() {
        try {
            const raw = window.localStorage.getItem(CONFIG_KEY);
            if (!raw) return;
            const saved = JSON.parse(raw);
            Object.keys(state.config).forEach(key => {
                if (typeof saved[key] === "string" && saved[key]) state.config[key] = saved[key];
            });
        } catch {
            /* corrupt config is not fatal */
        }
    }

    function saveConfig() {
        state.config = {
            owner: $("cfg-owner").value.trim(),
            repo: $("cfg-repo").value.trim(),
            branch: $("cfg-branch").value.trim() || "main",
            token: $("cfg-token").value.trim()
        };
        try {
            window.localStorage.setItem(CONFIG_KEY, JSON.stringify(state.config));
        } catch {
            log("Could not persist the token in this browser; it stays in memory for this tab.");
        }
    }

    function fillConfigInputs() {
        $("cfg-owner").value = state.config.owner || "";
        $("cfg-repo").value = state.config.repo || "";
        $("cfg-branch").value = state.config.branch || "main";
        $("cfg-token").value = state.config.token || "";
    }

    /* ------------------------------------------------------------ github api */

    function encodeRef(branch) {
        return String(branch).split("/").map(encodeURIComponent).join("/");
    }

    function encodePath(path) {
        return String(path).split("/").map(encodeURIComponent).join("/");
    }

    function authHeaders(extra) {
        const headers = {
            Authorization: `Bearer ${state.config.token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28"
        };
        return Object.assign(headers, extra || {});
    }

    async function gh(path, options) {
        const opts = options || {};
        const response = await fetch(`${API}/repos/${state.config.owner}/${state.config.repo}${path}`, {
            method: opts.method || "GET",
            headers: authHeaders(opts.headers),
            body: opts.body
        });
        if (!response.ok) {
            let detail = "";
            try {
                const payload = await response.json();
                detail = payload.message || "";
            } catch {
                detail = response.statusText;
            }
            throw new Error(`${response.status} ${detail || response.statusText}`);
        }
        return response.status === 204 ? null : response.json();
    }

    async function ghOrNull(path, options) {
        try {
            return await gh(path, options);
        } catch (error) {
            if (/^404/.test(error.message)) return null;
            throw error;
        }
    }

    // Read a committed JSON file straight off the configured branch.
    async function readJson(path) {
        if (!state.config.token) return null;
        const url = `${API}/repos/${state.config.owner}/${state.config.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(state.config.branch)}`;
        const response = await fetch(url, { headers: authHeaders({ Accept: "application/vnd.github.raw+json" }) });
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`Could not read ${path} (${response.status})`);
        const text = await response.text();
        try {
            return JSON.parse(text);
        } catch {
            throw new Error(`${path} on ${state.config.branch} is not valid JSON`);
        }
    }

    async function verifyConnection() {
        if (!state.config.token) {
            setStatus("Add a token first", "warn");
            return false;
        }
        try {
            setStatus("Checking...");
            const user = await fetch(`${API}/user`, { headers: authHeaders() }).then(response => {
                if (!response.ok) throw new Error(`${response.status} token rejected`);
                return response.json();
            });
            const repo = await ghOrNull("");
            if (!repo) throw new Error("Token cannot see this repository");
            const push = repo.permissions && repo.permissions.push;
            if (!push) {
                setStatus(`Signed in as ${user.login}, but no write access`, "warn");
                log(`Token for ${user.login} lacks Contents: write on ${state.config.owner}/${state.config.repo}.`);
                return false;
            }
            state.connected = true;
            setStatus(`${user.login} - ${repo.full_name}`, "ok");
            log(`Connected as ${user.login} to ${repo.full_name} (${state.config.branch}).`);
            return true;
        } catch (error) {
            state.connected = false;
            setStatus(error.message, "error");
            log(`Connection failed: ${error.message}`);
            return false;
        }
    }

    async function loadManifest() {
        if (!state.config.token) return [];
        const url = `${API}/repos/${state.config.owner}/${state.config.repo}/contents/${CORE.MANIFEST_PATH}?ref=${encodeURIComponent(state.config.branch)}`;
        const response = await fetch(url, { headers: authHeaders({ Accept: "application/vnd.github.raw+json" }) });
        if (response.status === 404) {
            log("No music-manifest.json on this branch yet; starting a fresh catalogue.");
            return [];
        }
        if (!response.ok) throw new Error(`Could not read manifest (${response.status})`);
        const parsed = JSON.parse(await response.text());
        return Array.isArray(parsed) ? parsed : [];
    }

    async function refreshCatalogue() {
        if (!state.config.token) return;
        try {
            state.manifest = await loadManifest();
            log(`Catalogue loaded: ${state.manifest.length} track(s), ${CORE.listReleases(state.manifest).length} release(s).`);
            renderReleaseOptions();
        } catch (error) {
            log(`Catalogue read failed: ${error.message}`);
        }
    }

    /* ------------------------------------------------------------- committing */

    function bytesToBase64(bytes) {
        let binary = "";
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return window.btoa(binary);
    }

    async function writeToBlobContent(write) {
        if (write.text !== undefined) return bytesToBase64(new TextEncoder().encode(write.text));
        const buffer = await write.file.arrayBuffer();
        return bytesToBase64(new Uint8Array(buffer));
    }

    /* Atomic commit: blobs -> tree -> commit -> ref. A failure leaves the branch
       exactly as it was. Shared by every tool. */
    async function commitWrites(writes, options) {
        const branch = options.branch;
        const message = options.message;
        const dryRun = options.dryRun;

        log(`Reading ${state.config.branch} head...`);
        const baseRef = await gh(`/git/ref/heads/${encodeRef(state.config.branch)}`);
        const baseSha = baseRef.object.sha;
        const baseCommit = await gh(`/git/commits/${baseSha}`);

        const tree = [];
        for (const write of writes) {
            if (dryRun) {
                log(`[dry run] would write ${write.path}`);
                continue;
            }
            const content = await writeToBlobContent(write);
            const blob = await gh("/git/blobs", {
                method: "POST",
                body: JSON.stringify({ content, encoding: "base64" })
            });
            tree.push({ path: write.path, mode: "100644", type: "blob", sha: blob.sha });
            log(`Uploaded ${write.path} -> ${blob.sha.slice(0, 7)}`);
        }

        if (dryRun) {
            log(`[dry run] would commit "${message}" on ${branch}`);
            return null;
        }

        const newTree = await gh("/git/trees", {
            method: "POST",
            body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree })
        });
        const newCommit = await gh("/git/commits", {
            method: "POST",
            body: JSON.stringify({ message, tree: newTree.sha, parents: [baseSha] })
        });
        log(`Commit ${newCommit.sha.slice(0, 7)} created`);

        const target = await ghOrNull(`/git/ref/heads/${encodeRef(branch)}`);
        if (target) {
            await gh(`/git/refs/heads/${encodeRef(branch)}`, {
                method: "PATCH",
                body: JSON.stringify({ sha: newCommit.sha, force: false })
            });
            log(`Updated branch "${branch}".`);
        } else {
            await gh("/git/refs", {
                method: "POST",
                body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: newCommit.sha })
            });
            log(`Created branch "${branch}".`);
        }

        const url = `https://github.com/${state.config.owner}/${state.config.repo}/commit/${newCommit.sha}`;
        log(`Done -> ${url}`);
        return newCommit.sha;
    }

    /* ------------------------------------------------------------- plan output */

    function renderPlan(outputId, plan, stats) {
        const rows = plan.writes.map(write => `
            <tr>
                <td><code>${escapeHtml(write.path)}</code></td>
                <td>${escapeHtml(write.kind)}</td>
                <td>${write.file ? CORE.formatBytes(write.file.size) : `${write.text.length} B`}</td>
            </tr>
        `).join("");

        const warnings = plan.warnings && plan.warnings.length
            ? `<ul class="warn-list">${plan.warnings.map(warning => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>`
            : `<p class="ok-line">No warnings.</p>`;

        const summary = (stats || [])
            .map(item => `<span><strong>${escapeHtml(item[0])}</strong> ${escapeHtml(item[1])}</span>`)
            .join("");

        $(outputId).innerHTML = `
            <div class="plan-summary">
                <span><strong>${plan.writes.length}</strong> file(s)</span>
                <span><strong>${CORE.formatBytes(plan.totalBytes || 0)}</strong> total</span>
                ${summary}
            </div>
            ${warnings}
            <details class="plan-files">
                <summary>Files to write</summary>
                <table class="track-table"><thead><tr><th>Path</th><th>Kind</th><th>Size</th></tr></thead><tbody>${rows}</tbody></table>
            </details>
        `;
    }

    function publishSettings(prefix) {
        return {
            dryRun: Boolean($(`${prefix}-dryrun`) && $(`${prefix}-dryrun`).checked),
            branch: ($(`${prefix}-branch`) && $(`${prefix}-branch`).value.trim()) || state.config.branch,
            message: $(`${prefix}-message`) && $(`${prefix}-message`).value.trim()
        };
    }

    function defaultBranchField(prefix, tool) {
        const input = $(`${prefix}-branch`);
        if (input && !input.value.trim()) input.value = CORE.suggestToolBranch(tool);
    }

    /* Preview + publish in one place so every tool behaves the same. */
    async function publish(options) {
        const { prefix, outputId, build, defaultMessage, stats } = options;
        if (!state.config.token) {
            log("Connect a token first - opening Connect.");
            switchView("settings");
            return null;
        }

        let plan;
        try {
            plan = build();
        } catch (error) {
            log(`Plan failed: ${error.message}`);
            $(outputId).innerHTML = `<p class="warn-list">${escapeHtml(error.message)}</p>`;
            return null;
        }

        renderPlan(outputId, plan, stats ? stats(plan) : []);
        const settings = publishSettings(prefix);
        const message = settings.message || defaultMessage;

        if (!settings.dryRun && !window.confirm(`Write ${plan.writes.length} file(s) to ${state.config.owner}/${state.config.repo} on "${settings.branch}"?`)) {
            log("Publish cancelled.");
            return null;
        }

        setBusy(true);
        try {
            const sha = await commitWrites(plan.writes, { branch: settings.branch, message, dryRun: settings.dryRun });
            if (sha) {
                const url = `https://github.com/${state.config.owner}/${state.config.repo}/commit/${sha}`;
                $(outputId).insertAdjacentHTML("beforeend", `<p class="ok-line">Committed to <strong>${escapeHtml(settings.branch)}</strong> - <a href="${url}" target="_blank" rel="noopener">view commit</a></p>`);
                await refreshOverview();
            }
            return sha;
        } catch (error) {
            log(`Publish failed: ${error.message}`);
            $(outputId).insertAdjacentHTML("beforeend", `<p class="warn-list">${escapeHtml(error.message)}</p>`);
            return null;
        } finally {
            setBusy(false);
        }
    }

    /* ------------------------------------------------------------- release form */

    function renderReleaseOptions() {
        const list = $("release-list");
        const releases = CORE.listReleases(state.manifest);
        list.innerHTML = releases
            .map(item => `<option value="${escapeHtml(item.release)}">${escapeHtml(item.category)} - ${item.tracks.length} track(s)</option>`)
            .join("");
    }

    // Choosing an existing release fills the form from the catalogue.
    function applyExistingRelease() {
        const name = $("form-release").value.trim();
        if (!name) return;
        const match = CORE.listReleases(state.manifest).find(item => item.release.toLowerCase() === name.toLowerCase());
        if (!match) return;
        $("form-category").value = match.category;
        const first = match.tracks[0] || {};
        if (first.album) $("form-album").value = first.album;
        if (first.artist) $("form-artist").value = first.artist;
        if (first.date) $("form-date").value = first.date;
        if (!$("form-label").value.trim()) $("form-label").value = CORE.DEFAULT_LABEL;
        const next = CORE.nextTrackNumber(state.manifest, `Music/${match.category}/${match.release}`);
        state.files.forEach((row, index) => {
            row.trackNumber = next + index;
        });

        /* Carry the release's existing delivery settings back into the form, so
           re-publishing a release does not silently reset it to stream only. */
        if (Release) {
            state.trackPaymentUrls = {};
            match.tracks.forEach(track => {
                if (track.trackPaymentUrl && track.trackNumber) {
                    state.trackPaymentUrls[`track-${track.trackNumber}`] = track.trackPaymentUrl;
                }
            });
            $("form-distribution").value = Release.normalizeMode(first.distribution);
            if (first.price) {
                $("form-price").value = (Number(first.price) / 100).toFixed(2);
                $("form-price").dataset.touched = "true";
            }
            $("form-payment-url").value = first.paymentUrl || "";
            $("form-access").value = first.access || "";
            syncDistributionUi();
        }
        renderTracks();
        log(`Filling into existing release "${match.release}" from track ${next}.`);
    }

    function addFiles(fileList) {
        const incoming = Array.from(fileList || []);
        let audioAdded = 0;
        incoming.forEach(file => {
            if (CORE.isAudio(file.name)) {
                if (state.files.some(row => row.name === file.name && row.file.size === file.size)) return;
                state.files.push({ file, name: file.name, title: CORE.prettyName(file.name), trackNumber: state.files.length + 1 });
                audioAdded += 1;
            } else if (CORE.isImage(file.name) && !state.coverFile) {
                state.coverFile = file;
                log(`Cover art: ${file.name} (${CORE.formatBytes(file.size)})`);
            } else if (!CORE.isImage(file.name)) {
                log(`Skipped unsupported file: ${file.name}`);
            }
        });
        state.files.sort((a, b) => CORE.naturalCompare(a.name, b.name));
        state.files.forEach((row, index) => {
            if (!row.trackNumber || row.trackNumber <= 0) row.trackNumber = index + 1;
        });
        if (audioAdded) log(`${audioAdded} audio file(s) queued.`);
        renderTracks();
    }

    function renderTracks() {
        const body = $("track-rows");
        body.innerHTML = state.files.map((row, index) => `
            <tr>
                <td>${index + 1}</td>
                <td class="cell-title"><input data-index="${index}" data-field="title" value="${escapeHtml(row.title)}" aria-label="Track title"></td>
                <td class="cell-file">${escapeHtml(row.name)}<small>${CORE.formatBytes(row.file.size)}</small></td>
                <td class="cell-num"><input type="number" min="1" data-index="${index}" data-field="trackNumber" value="${row.trackNumber}" aria-label="Track number"></td>
                <td><button class="button ghost" type="button" data-remove="${index}" aria-label="Remove ${escapeHtml(row.name)}">Remove</button></td>
            </tr>
        `).join("");
        $("track-empty").hidden = state.files.length > 0;
        const folder = $("form-category").value && $("form-release").value.trim()
            ? `Music/${$("form-category").value}/${$("form-release").value.trim()}`
            : "-";
        $("target-folder").textContent = folder;
        state.plan = null;
        $("btn-import").disabled = true;
        $("plan-output").innerHTML = "";
    }

    function wireTrackRows() {
        $("track-rows").addEventListener("input", event => {
            const input = event.target.closest("input[data-field]");
            if (!input) return;
            const row = state.files[Number(input.dataset.index)];
            if (!row) return;
            if (input.dataset.field === "title") row.title = input.value;
            if (input.dataset.field === "trackNumber") row.trackNumber = Number(input.value) || 0;
        });
        $("track-rows").addEventListener("click", event => {
            const button = event.target.closest("[data-remove]");
            if (!button) return;
            state.files.splice(Number(button.dataset.remove), 1);
            state.files.forEach((row, index) => {
                row.trackNumber = index + 1;
            });
            renderTracks();
        });
    }

    function currentForm() {
        return {
            category: $("form-category").value,
            release: $("form-release").value.trim(),
            album: $("form-album").value.trim(),
            artist: $("form-artist").value.trim() || CORE.DEFAULT_ARTIST,
            date: $("form-date").value || new Date().toISOString().slice(0, 10),
            description: $("form-description").value.trim(),
            performers: $("form-performers").value.trim(),
            producers: $("form-producers").value.trim(),
            writers: $("form-writers").value.trim(),
            label: $("form-label").value.trim(),
            genre: $("form-genre").value.trim(),
            explicit: $("form-explicit").checked,
            distribution: distributionValue(),
            price: $("form-price").value,
            paymentUrl: $("form-payment-url").value.trim(),
            access: $("form-access").value.trim(),
            titles: Object.fromEntries(state.files.map(row => [row.name, row.title])),
            trackNumbers: Object.fromEntries(state.files.map(row => [row.name, row.trackNumber]))
        };
    }

    function buildPlan() {
        const plan = CORE.planImport({
            files: state.files.map(row => row.file),
            coverFile: state.coverFile,
            form: currentForm(),
            existingManifest: state.manifest,
            meta: releaseMeta()
        });
        state.plan = plan;
        renderPlan("plan-output", plan, [
            [`${plan.trackCount}`, "track(s)"],
            [`+${plan.added}`, `catalogue entries${plan.replaced ? `, ${plan.replaced} replaced` : ""}`]
        ]);
        $("btn-import").disabled = state.busy;
        if (!$("opt-branchname").value.trim()) $("opt-branchname").value = CORE.suggestBranchName(currentForm().release || "release");
        if (!$("opt-message").value.trim()) $("opt-message").value = CORE.commitMessage(currentForm(), plan.trackCount);
        return plan;
    }

    async function runImport() {
        const plan = state.plan || buildPlan();
        if (!plan) return;
        if (!state.config.token) {
            log("Connect a token before importing.");
            switchView("settings");
            return;
        }
        const dryRun = $("opt-dryrun").checked;
        const useNewBranch = $("opt-newbranch").checked;
        const targetBranch = useNewBranch ? ($("opt-branchname").value.trim() || CORE.suggestBranchName(currentForm().release)) : state.config.branch;
        const message = $("opt-message").value.trim() || CORE.commitMessage(currentForm(), plan.trackCount);

        if (!dryRun && !window.confirm(`Write ${plan.writes.length} file(s) to ${state.config.owner}/${state.config.repo} on "${targetBranch}"?`)) {
            log("Import cancelled.");
            return;
        }

        setBusy(true);
        try {
            const sha = await commitWrites(plan.writes, { branch: targetBranch, message, dryRun });
            if (!dryRun) {
                state.plan = null;
                await refreshCatalogue();
                await refreshOverview();
                if (sha) {
                    const url = `https://github.com/${state.config.owner}/${state.config.repo}/commit/${sha}`;
                    $("plan-output").insertAdjacentHTML("beforeend", `<p class="ok-line">Committed to <strong>${escapeHtml(targetBranch)}</strong> - <a href="${url}" target="_blank" rel="noopener">view commit</a></p>`);
                }
            }
        } catch (error) {
            log(`Import failed: ${error.message}`);
        } finally {
            setBusy(false);
        }
    }

    /* ------------------------------------------------------------------ views */

    function switchView(name) {
        state.view = name;
        document.querySelectorAll(".admin-nav__item").forEach(item => {
            item.classList.toggle("is-active", item.dataset.view === name);
        });
        document.querySelectorAll(".admin-view").forEach(view => {
            view.classList.toggle("is-active", view.id === `view-${name}`);
        });
        if (name === "overview") refreshOverview();
        if (viewHooks[name]) viewHooks[name]();
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function registerView(name, fn) {
        viewHooks[name] = fn;
    }

    async function refreshOverview() {
        if (!state.config.token) {
            ["ov-tracks", "ov-releases", "ov-photos", "ov-videos", "ov-links"].forEach(id => {
                if ($(id)) $(id).textContent = "-";
            });
            if ($("overview-status")) $("overview-status").textContent = "Connect a token to read the live catalogue.";
            return;
        }
        try {
            const [manifest, media, links] = await Promise.all([
                readJson(CORE.MANIFEST_PATH).catch(() => []),
                readJson(CORE.MEDIA_PATH).catch(() => null),
                readJson(CORE.LINKS_PATH).catch(() => null)
            ]);
            const tracks = Array.isArray(manifest) ? manifest : [];
            const photoCount = media && Array.isArray(media.photos) ? media.photos.length : 0;
            const videoCount = media && Array.isArray(media.videos) ? media.videos.length : 0;
            const linkCount = links
                ? CORE.LINK_GROUPS.reduce((sum, group) => sum + (Array.isArray(links[group]) ? links[group].length : 0), 0)
                    + (Array.isArray(links.quickSocials) ? links.quickSocials.length : 0)
                : 0;

            $("ov-tracks").textContent = tracks.length;
            $("ov-releases").textContent = CORE.listReleases(tracks).length;
            $("ov-photos").textContent = photoCount;
            $("ov-videos").textContent = videoCount;
            $("ov-links").textContent = linkCount;
            if ($("overview-status")) {
                $("overview-status").textContent = `Reading ${state.config.owner}/${state.config.repo} on ${state.config.branch}.`;
            }
        } catch (error) {
            if ($("overview-status")) $("overview-status").textContent = `Could not read counts: ${error.message}`;
        }
    }

    /* ---------------------------------------------------------------- wiring */

    function wireShell() {
        document.querySelectorAll(".admin-nav__item").forEach(item => {
            item.addEventListener("click", () => switchView(item.dataset.view));
        });
        document.querySelectorAll("[data-goto]").forEach(button => {
            button.addEventListener("click", () => switchView(button.dataset.goto));
        });

        $("btn-log-toggle").addEventListener("click", event => {
            const bar = $("logbar");
            bar.hidden = !bar.hidden;
            event.currentTarget.setAttribute("aria-expanded", String(!bar.hidden));
        });
        $("log-clear").addEventListener("click", () => {
            $("log").textContent = "";
        });
        $("btn-refresh").addEventListener("click", () => {
            refreshOverview();
            refreshCatalogue();
        });

        $("btn-connect").addEventListener("click", async () => {
            saveConfig();
            const ok = await verifyConnection();
            if (ok) {
                await refreshCatalogue();
                await refreshOverview();
            }
        });

        $("btn-forget").addEventListener("click", () => {
            state.config.token = "";
            state.connected = false;
            $("cfg-token").value = "";
            try {
                window.localStorage.removeItem(CONFIG_KEY);
            } catch {
                /* ignore */
            }
            setStatus("Token removed from this browser");
            log("Token forgotten.");
        });
    }

    /* ------------------------------------------------- release distribution */

    function siteOrigin() {
        return `${window.location.origin}/`;
    }

    function distributionValue() {
        return Release ? Release.normalizeMode($("form-distribution").value) : "stream";
    }

    /* Price defaults come from the category, but stay editable: a release can be
       priced by hand without touching the code. */
    function syncDistributionUi() {
        const mode = distributionValue();
        const category = $("form-category").value;
        const priceField = $("form-price");

        if (Release && !priceField.dataset.touched) {
            priceField.value = (Release.releasePrice(category) / 100).toFixed(2);
        }
        priceField.disabled = mode !== "paid";
        $("form-payment-url").disabled = mode !== "paid";
        $("form-access").disabled = mode !== "exclusive";
        $("access-row").hidden = mode !== "exclusive";
        $("extras-block").hidden = mode !== "exclusive";
        $("distribution-note").textContent = Release ? Release.modeById(mode).note : "";

        if (mode === "exclusive") {
            if (Release && !Release.isAccessToken($("form-access").value)) {
                $("form-access").value = Release.randomToken();
            }
            renderAccessLink();
        } else {
            $("access-link").value = "";
        }

        state.plan = null;
        if ($("btn-import")) $("btn-import").disabled = true;
    }

    function renderAccessLink() {
        if (!Release) return;
        const token = $("form-access").value.trim();
        $("access-link").value = Release.shareUrl(siteOrigin(), token);
    }

    /* "Label | https://link" per line, which is the least fiddly thing to type. */
    function parseExtras(text) {
        return String(text || "")
            .split("\n")
            .map(line => line.trim())
            .filter(Boolean)
            .map(line => {
                const [label, ...rest] = line.split("|");
                return { label: (label || "").trim(), url: rest.join("|").trim(), kind: "link" };
            })
            .filter(entry => entry.label && entry.url);
    }

    /* Everything the catalogue and info.json need about delivery, built once. */
    function releaseMeta() {
        if (!Release) return {};
        const mode = distributionValue();
        const meta = Release.metaFor({
            distribution: mode,
            category: $("form-category").value,
            price: Math.round(Number($("form-price").value || 0) * 100),
            paymentUrl: $("form-payment-url").value.trim(),
            access: $("form-access").value.trim(),
            trackPaymentUrls: state.trackPaymentUrls
        });
        if (mode === "exclusive") {
            const extras = Release.normalizeExtras(parseExtras($("form-extras").value));
            if (extras.length) meta.extras = extras;
            if (meta.access) $("form-access").value = meta.access;
        }
        return meta;
    }

    /* ------------------------------------------------------- Stripe links */

    function stripeKey() {
        try {
            return window.localStorage.getItem(STRIPE_KEY_STORE) || "";
        } catch {
            return "";
        }
    }

    function stripeStatus(text, tone) {
        const node = $("row-stripe-status");
        if (!node) return;
        node.textContent = text;
        node.dataset.tone = tone || "";
    }

    function stripeKeyStatus() {
        const key = stripeKey();
        if (!key) return "No key saved - links cannot be created yet.";
        if (!/^(rk|sk)_(live|test)_[A-Za-z0-9]{8,}$/.test(key)) return "Saved key does not look like a Stripe key.";
        return /^[a-z]+_(live)_/.test(key) ? "Live key saved." : "Test key saved.";
    }

    async function stripeLink(product, release, redirect) {
        const response = await fetch(STRIPE_LINKS, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${stripeKey()}`,
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: Release.paymentLinkBody(product, release, redirect)
        });
        if (!response.ok) {
            const detail = await response.text().catch(() => "");
            throw new Error(`Stripe answered ${response.status}${detail ? ` - ${detail.slice(0, 160)}` : ""}`);
        }
        return Release.parsePaymentLink(await response.json());
    }

    async function createReleaseLinks() {
        if (!Release) return 0;
        if (distributionValue() !== "paid") {
            stripeStatus("Pick Paid first - links are only for paid releases.", "warn");
            return 0;
        }
        const key = stripeKey();
        if (!/^(rk|sk)_(live|test)_[A-Za-z0-9]{8,}$/.test(key)) {
            stripeStatus("Save a Stripe restricted key first.", "warn");
            return 0;
        }

        const title = $("form-album").value.trim() || $("form-release").value.trim();
        if (!title) {
            stripeStatus("Name the release first.", "warn");
            return 0;
        }

        const category = $("form-category").value;
        const price = Math.round(Number($("form-price").value || 0) * 100) || Release.releasePrice(category);
        const tracks = state.files.map((row, index) => ({ title: row.title, trackNumber: Number(row.trackNumber) || index + 1 }));
        const release = { title, category, price };
        const redirect = `${siteOrigin()}purchase.html?release=${encodeURIComponent(title)}&s={CHECKOUT_SESSION_ID}`;

        setBusy(true);
        let made = 0;
        try {
            const products = Release.productsFor(release, tracks);
            for (const product of products) {
                stripeStatus(`Creating ${product.name}…`, "warn");
                try {
                    const link = await stripeLink(product, release, redirect);
                    if (product.kind === "release") {
                        $("form-payment-url").value = link.url;
                    } else {
                        state.trackPaymentUrls[product.key] = link.url;
                    }
                    made += 1;
                    log(`Stripe link for ${product.name}: ${link.url}`);
                } catch (error) {
                    log(`Stripe refused ${product.name}: ${error.message}`);
                }
            }
            stripeStatus(made ? `${made} link(s) ready - publish to put them on the site.` : "No links were created.", made ? "ok" : "warn");
            renderLinkOutput(products);
            state.plan = null;
            if ($("btn-import")) $("btn-import").disabled = true;
        } finally {
            setBusy(false);
        }
        return made;
    }

    function renderLinkOutput(products) {
        const box = $("row-links-output");
        if (!box) return;
        const rows = (products || []).map(product => {
            const url = product.kind === "release" ? $("form-payment-url").value.trim() : state.trackPaymentUrls[product.key] || "";
            if (!url) return "";
            return `<p class="muted">${escapeHtml(product.name)} · <a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a></p>`;
        }).filter(Boolean);
        box.innerHTML = rows.join("") || "";
    }

    function wireDelivery() {
        if (!Release) {
            log("release-core.js did not load - releases will publish as stream only.");
            return;
        }
        $("form-distribution").innerHTML = Release.MODES
            .map(mode => `<option value="${mode.id}">${escapeHtml(mode.label)}</option>`)
            .join("");
        $("form-distribution").value = Release.DEFAULT_MODE;

        $("form-distribution").addEventListener("change", syncDistributionUi);
        $("form-category").addEventListener("change", () => {
            delete $("form-price").dataset.touched;
            syncDistributionUi();
        });
        $("form-price").addEventListener("input", () => {
            $("form-price").dataset.touched = "true";
        });
        $("form-access").addEventListener("input", renderAccessLink);
        $("btn-access-token").addEventListener("click", () => {
            $("form-access").value = Release.randomToken();
            renderAccessLink();
        });
        $("access-link").addEventListener("focus", event => event.target.select());

        $("form-stripe-key").value = stripeKey();
        stripeStatus(stripeKeyStatus());
        $("row-stripe-save").addEventListener("click", () => {
            const value = $("form-stripe-key").value.trim();
            if (!/^(rk|sk)_(live|test)_[A-Za-z0-9]{8,}$/.test(value)) {
                stripeStatus("That does not look like a Stripe restricted key.", "warn");
                return;
            }
            try {
                window.localStorage.setItem(STRIPE_KEY_STORE, value);
                stripeStatus(stripeKeyStatus(), "ok");
                log("Stripe key saved in this browser.");
            } catch {
                stripeStatus("This browser refused to store the key.", "warn");
            }
        });
        $("row-stripe-forget").addEventListener("click", () => {
            try {
                window.localStorage.removeItem(STRIPE_KEY_STORE);
            } catch {
                /* ignore */
            }
            $("form-stripe-key").value = "";
            stripeStatus(stripeKeyStatus());
            log("Stripe key forgotten.");
        });
        $("row-stripe-links").addEventListener("click", createReleaseLinks);

        syncDistributionUi();
    }

    function wireReleaseForm() {
        $("form-date").value = new Date().toISOString().slice(0, 10);
        $("form-category").innerHTML = CORE.CATEGORIES
            .map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
            .join("");
        $("form-label").value = CORE.DEFAULT_LABEL;
        $("opt-branchname").value = CORE.suggestBranchName("release");
        wireDelivery();
        renderTracks();
        wireTrackRows();

        ["form-category", "form-release", "form-album", "form-artist", "form-date", "form-label", "form-description", "form-performers", "form-producers", "form-writers", "form-genre"].forEach(id => {
            $(id).addEventListener("change", () => {
                state.plan = null;
                $("btn-import").disabled = true;
            });
        });
        $("form-release").addEventListener("change", applyExistingRelease);
        $("form-category").addEventListener("change", renderTracks);

        $("form-audio").addEventListener("change", event => {
            addFiles(event.target.files);
            event.target.value = "";
        });
        $("form-cover").addEventListener("change", event => {
            const file = event.target.files && event.target.files[0];
            if (file && !CORE.isImage(file.name)) {
                log(`Cover must be .jpg, .jpeg, .png or .webp - got ${file.name}`);
                return;
            }
            state.coverFile = file || null;
            if (file) log(`Cover art: ${file.name} (${CORE.formatBytes(file.size)})`);
        });

        const dropzone = $("dropzone");
        ["dragenter", "dragover"].forEach(name => {
            dropzone.addEventListener(name, event => {
                event.preventDefault();
                dropzone.classList.add("is-hot");
            });
        });
        ["dragleave", "drop"].forEach(name => {
            dropzone.addEventListener(name, event => {
                event.preventDefault();
                dropzone.classList.remove("is-hot");
            });
        });
        dropzone.addEventListener("drop", event => {
            addFiles(event.dataTransfer.files);
        });

        $("btn-plan").addEventListener("click", () => {
            try {
                buildPlan();
                log("Plan ready.");
            } catch (error) {
                log(`Plan failed: ${error.message}`);
            }
        });

        $("btn-import").addEventListener("click", runImport);
    }

    function init() {
        loadConfig();
        fillConfigInputs();
        wireShell();
        wireReleaseForm();
        defaultBranchField("photos", "epk-photos");
        defaultBranchField("videos", "epk-videos");
        defaultBranchField("links", "all-links");
        log("Control Room ready. Connect a token to load the live data.");
        switchView("overview");
    }

    window.Admin = {
        state,
        log,
        setStatus,
        setBusy,
        gh,
        ghOrNull,
        readJson,
        commitWrites,
        publish,
        publishSettings,
        renderPlan,
        registerView,
        switchView,
        refreshOverview,
        escapeHtml
    };

    document.addEventListener("DOMContentLoaded", init);
})();
