/* ==========================================================================
   Release Importer - browser app that commits releases to the repo through
   the GitHub REST API. No server, no build step, no dependencies.
   ========================================================================== */
(function () {
    "use strict";

    const CORE = window.ReleaseImport;
    const CONFIG_KEY = "xid.importer.config.v1";
    const API = "https://api.github.com";
    const $ = id => document.getElementById(id);

    const state = {
        config: { owner: "shido275", repo: "shido275.github.io", branch: "main", token: "" },
        manifest: [],
        files: [], // { file, name, title, trackNumber }
        coverFile: null,
        plan: null,
        busy: false
    };

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

    function log(message) {
        const box = $("log");
        const line = `[${new Date().toLocaleTimeString()}] ${message}`;
        box.textContent += (box.textContent ? "\n" : "") + line;
        box.scrollTop = box.scrollHeight;
    }

    function setStatus(text, tone) {
        const node = $("conn-status");
        node.textContent = text;
        node.dataset.tone = tone || "";
    }

    function setBusy(busy) {
        state.busy = busy;
        $("btn-import").disabled = busy || !state.plan;
        $("btn-plan").disabled = busy;
        $("btn-connect").disabled = busy;
        document.body.classList.toggle("is-busy", busy);
    }

    /* ------------------------------------------------------------ github api */

    function encodeRef(branch) {
        return String(branch).split("/").map(encodeURIComponent).join("/");
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
            setStatus(`${user.login} - ${repo.full_name}`, "ok");
            log(`Connected as ${user.login} to ${repo.full_name} (${state.config.branch}).`);
            return true;
        } catch (error) {
            setStatus(error.message, "error");
            log(`Connection failed: ${error.message}`);
            return false;
        }
    }

    async function loadManifest() {
        const url = `${API}/repos/${state.config.owner}/${state.config.repo}/contents/${CORE.MANIFEST_PATH}?ref=${encodeURIComponent(state.config.branch)}`;
        const response = await fetch(url, { headers: authHeaders({ Accept: "application/vnd.github.raw+json" }) });
        if (response.status === 404) {
            log("No music-manifest.json on this branch yet; starting a fresh catalogue.");
            return [];
        }
        if (!response.ok) throw new Error(`Could not read manifest (${response.status})`);
        const text = await response.text();
        const parsed = JSON.parse(text);
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

    /* ----------------------------------------------------------- release form */

    function renderReleaseOptions() {
        const list = $("release-list");
        const releases = CORE.listReleases(state.manifest);
        list.innerHTML = releases.map(item => `<option value="${escapeAttr(item.release)}">${escapeAttr(item.category)} - ${item.tracks.length} track(s)</option>`).join("");
    }

    function escapeAttr(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
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
        const next = CORE.nextTrackNumber(state.manifest, `Music/${match.category}/${match.release}`);
        state.files.forEach((row, index) => {
            row.trackNumber = next + index;
        });
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
                <td class="cell-title"><input data-index="${index}" data-field="title" value="${escapeAttr(row.title)}" aria-label="Track title"></td>
                <td class="cell-file">${escapeAttr(row.name)}<small>${CORE.formatBytes(row.file.size)}</small></td>
                <td class="cell-num"><input type="number" min="1" data-index="${index}" data-field="trackNumber" value="${row.trackNumber}" aria-label="Track number"></td>
                <td><button class="button ghost" type="button" data-remove="${index}" aria-label="Remove ${escapeAttr(row.name)}">Remove</button></td>
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
            titles: Object.fromEntries(state.files.map(row => [row.name, row.title])),
            trackNumbers: Object.fromEntries(state.files.map(row => [row.name, row.trackNumber]))
        };
    }

    function buildPlan() {
        const plan = CORE.planImport({
            files: state.files.map(row => row.file),
            coverFile: state.coverFile,
            form: currentForm(),
            existingManifest: state.manifest
        });
        state.plan = plan;
        renderPlan(plan);
        $("btn-import").disabled = state.busy;
        if (!$("opt-branchname").value.trim()) $("opt-branchname").value = CORE.suggestBranchName(currentForm().release || "release");
        if (!$("opt-message").value.trim()) $("opt-message").value = CORE.commitMessage(currentForm(), plan.trackCount);
        return plan;
    }

    function renderPlan(plan) {
        const rows = plan.writes.map(write => `
            <tr>
                <td><code>${escapeAttr(write.path)}</code></td>
                <td>${write.kind}</td>
                <td>${write.file ? CORE.formatBytes(write.file.size) : `${write.text.length} B`}</td>
            </tr>
        `).join("");

        const warnings = plan.warnings.length
            ? `<ul class="warn-list">${plan.warnings.map(warning => `<li>${escapeAttr(warning)}</li>`).join("")}</ul>`
            : `<p class="ok-line">No warnings.</p>`;

        $("plan-output").innerHTML = `
            <div class="plan-summary">
                <span><strong>${plan.trackCount}</strong> track(s)</span>
                <span><strong>${plan.writes.length}</strong> file(s)</span>
                <span><strong>${CORE.formatBytes(plan.totalBytes)}</strong> total</span>
                <span><strong>+${plan.added}</strong> catalogue entries${plan.replaced ? `, <strong>${plan.replaced}</strong> replaced` : ""}</span>
            </div>
            ${warnings}
            <details class="plan-files">
                <summary>Files to write</summary>
                <table class="track-table"><thead><tr><th>Path</th><th>Kind</th><th>Size</th></tr></thead><tbody>${rows}</tbody></table>
            </details>
        `;
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

    async function commitPlan(plan, options) {
        const branch = options.branch;
        const message = options.message;
        const dryRun = options.dryRun;

        log(`Reading ${state.config.branch} head...`);
        const baseRef = await gh(`/git/ref/heads/${encodeRef(state.config.branch)}`);
        const baseSha = baseRef.object.sha;
        const baseCommit = await gh(`/git/commits/${baseSha}`);

        const tree = [];
        for (const write of plan.writes) {
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
        $("plan-output").insertAdjacentHTML("beforeend", `<p class="ok-line">Committed to <strong>${escapeAttr(branch)}</strong> - <a href="${url}" target="_blank" rel="noopener">view commit</a></p>`);
        return newCommit.sha;
    }

    async function runImport() {
        const plan = state.plan || buildPlan();
        if (!plan) return;
        if (!state.config.token) {
            log("Connect a token before importing.");
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
            await commitPlan(plan, { branch: targetBranch, message, dryRun });
            if (!dryRun) {
                state.plan = null;
                await refreshCatalogue();
            }
        } catch (error) {
            log(`Import failed: ${error.message}`);
        }
        setBusy(false);
    }

    /* ------------------------------------------------------------------ wiring */

    function init() {
        loadConfig();
        fillConfigInputs();
        $("form-date").value = new Date().toISOString().slice(0, 10);
        $("form-category").innerHTML = CORE.CATEGORIES.map(category => `<option value="${escapeAttr(category)}">${escapeAttr(category)}</option>`).join("");
        $("opt-branchname").value = CORE.suggestBranchName("release");
        renderTracks();
        wireTrackRows();

        $("btn-connect").addEventListener("click", async () => {
            saveConfig();
            const ok = await verifyConnection();
            if (ok) await refreshCatalogue();
        });

        $("btn-forget").addEventListener("click", () => {
            state.config.token = "";
            $("cfg-token").value = "";
            try {
                window.localStorage.removeItem(CONFIG_KEY);
            } catch {
                /* ignore */
            }
            setStatus("Token removed from this browser");
            log("Token forgotten.");
        });

        ["form-category", "form-release", "form-album", "form-artist", "form-date"].forEach(id => {
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
            const dropped = Array.from(event.dataTransfer.files || []);
            addFiles(dropped);
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

        log("Importer ready. Connect a token to load the catalogue.");
    }

    document.addEventListener("DOMContentLoaded", init);
})();
