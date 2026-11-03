/* ==========================================================================
   Manage - delete what is already published.

   Reads the branch once (catalogue, EPK media, links and every blob path),
   stages deletions in this browser, then commits them together: tree entries
   with a null sha remove the files while the indexes that pointed at them are
   rewritten in the same commit. Nothing leaves the site until that commit
   lands, and Reset throws the staged deletions away.

   Deleting is the one thing the shared publisher cannot do, so this tool
   builds its own tree -> commit -> ref sequence through Admin.gh.
   ========================================================================== */
(function () {
    "use strict";

    const CORE = window.ReleaseImport;
    const Admin = window.Admin;
    const $ = id => document.getElementById(id);
    const esc = Admin.escapeHtml;

    const GROUPS = [...CORE.LINK_GROUPS, "quickSocials"];
    const GROUP_LABELS = {
        featured: "Featured",
        platforms: "Platforms",
        socials: "Socials",
        business: "Business",
        quickSocials: "Hero socials"
    };

    /* Only release folders and EPK uploads may be removed. Static assets the
       hand-written pages still point at are never touched, so deleting a photo
       cannot leave a broken image behind in the fallback markup. */
    const DELETABLE_DIRS = ["Music", `${CORE.PHOTO_DIR}`, `${CORE.VIDEO_DIR}`];

    const manage = {
        loaded: false,
        paths: [],
        manifest: [],
        media: { photos: [], videos: [], slideshow: null },
        links: {},
        trash: [],
        dirty: { manifest: false, media: false, links: false }
    };

    const note = message => Admin.log(message);

    function status(text, tone) {
        const node = $("manage-count");
        if (!node) return;
        node.textContent = text;
        node.dataset.tone = tone || "";
    }

    function encodeRef(branch) {
        return String(branch).split("/").map(encodeURIComponent).join("/");
    }

    // Repo-relative, no traversal, inside a folder this tool is allowed to empty.
    function isDeletablePath(path) {
        const value = String(path == null ? "" : path).trim();
        if (!value || value.startsWith("/") || value.includes("\\")) return false;
        if (value.split("/").some(part => !part || part === "." || part === "..")) return false;
        return DELETABLE_DIRS.some(dir => value.startsWith(`${dir}/`));
    }

    function isUploadPath(path) {
        const value = String(path == null ? "" : path).trim();
        return value.startsWith(`${CORE.PHOTO_DIR}/`) || value.startsWith(`${CORE.VIDEO_DIR}/`);
    }

    function metadataPathOf(filePath) {
        return `${String(filePath).replace(/\.[^./]*$/, "")}.json`;
    }

    /* ------------------------------------------------------------------ load */

    async function listRepoPaths() {
        const branch = Admin.state.config.branch;
        const ref = await Admin.gh(`/git/ref/heads/${encodeRef(branch)}`);
        const commit = await Admin.gh(`/git/commits/${ref.object.sha}`);
        const tree = await Admin.gh(`/git/trees/${commit.tree.sha}?recursive=1`);
        return (tree.tree || []).filter(item => item.type === "blob").map(item => item.path);
    }

    async function loadAll(force) {
        if (manage.loaded && !force) return;
        if (!Admin.state.config.token) {
            note("Connect a token to manage what is already published.");
            return;
        }
        try {
            const [paths, manifest, media, links] = await Promise.all([
                listRepoPaths(),
                Admin.readJson(CORE.MANIFEST_PATH).catch(() => []),
                Admin.readJson(CORE.MEDIA_PATH).catch(() => null),
                Admin.readJson(CORE.LINKS_PATH).catch(() => null)
            ]);

            manage.paths = Array.isArray(paths) ? paths : [];
            manage.manifest = Array.isArray(manifest) ? manifest.map(item => ({ ...item })) : [];
            manage.media = media && typeof media === "object"
                ? {
                    ...media,
                    photos: Array.isArray(media.photos) ? media.photos.map(photo => ({ ...photo })) : [],
                    videos: Array.isArray(media.videos) ? media.videos.map(video => ({ ...video })) : []
                }
                : { photos: [], videos: [], slideshow: null };
            manage.links = links && typeof links === "object" ? { ...links } : {};
            manage.trash = [];
            manage.dirty = { manifest: false, media: false, links: false };
            manage.loaded = true;

            render();
            note(`Loaded ${manage.manifest.length} catalogue entry(ies) and ${manage.paths.length} repository file(s).`);
        } catch (error) {
            note(`Could not read the published site: ${error.message}`);
            status("Load failed", "error");
        }
    }

    /* --------------------------------------------------------------- staging */

    function stage(path) {
        const value = String(path || "").trim();
        if (!value || !isDeletablePath(value)) return false;
        if (!manage.trash.includes(value)) manage.trash.push(value);
        return true;
    }

    function folderOf(item) {
        try {
            return CORE.releaseFolder(item.category, item.release);
        } catch {
            return "";
        }
    }

    function deleteRelease(item) {
        const folder = folderOf(item);
        if (!folder) {
            note(`Cannot work out the folder for "${item.release}".`);
            return;
        }

        const files = manage.paths.filter(path => path.startsWith(`${folder}/`));
        const entries = manage.manifest.filter(entry => String(entry.path || "").startsWith(`${folder}/`));
        if (!files.length && !entries.length) {
            note(`Nothing on this branch belongs to "${item.release}".`);
            return;
        }

        const question = `Delete the release "${item.release}"?\n\n${files.length} file(s) and ${entries.length} catalogue entry(ies) leave the site.`;
        if (!window.confirm(question)) return;

        files.forEach(stage);
        manage.manifest = manage.manifest.filter(entry => !String(entry.path || "").startsWith(`${folder}/`));
        manage.dirty.manifest = true;
        render();
        note(`Staged "${item.release}": ${files.length} file(s), ${entries.length} entry(ies).`);
    }

    function deleteTrack(item, track) {
        const path = String(track.path || "");
        if (!path) return;
        const label = track.title || CORE.baseName(path);
        if (!window.confirm(`Delete "${label}" from "${item.release}"?\n\nThe audio file and its metadata leave the site.`)) return;

        stage(path);
        const metaPath = metadataPathOf(path);
        if (manage.paths.includes(metaPath)) stage(metaPath);

        manage.manifest = manage.manifest.filter(entry => entry !== track && String(entry.path || "") !== path);
        manage.dirty.manifest = true;
        render();
        note(`Staged "${label}" for deletion.`);
    }

    function deletePhoto(index) {
        const photo = manage.media.photos[index];
        if (!photo) return;

        const removable = Boolean(photo.src && isUploadPath(photo.src));
        const detail = removable
            ? `It also deletes ${photo.src} from the repository.`
            : photo.src
                ? `${photo.src} stays, because the page's hand-written fallback still points at it.`
                : "";
        if (!window.confirm(`Remove this photo from the EPK slideshow?\n\n${detail}`)) return;

        manage.media.photos.splice(index, 1);
        if (removable) stage(photo.src);
        manage.dirty.media = true;
        render();
    }

    function deleteVideo(index) {
        const video = manage.media.videos[index];
        if (!video) return;

        const localFile = video.source === "file" && video.url ? video.url : "";
        const removable = Boolean(localFile && isUploadPath(localFile));
        const detail = removable
            ? `It also deletes ${localFile} from the repository.`
            : "A hosted link is only removed from the EPK; the video itself is untouched.";
        if (!window.confirm(`Remove "${video.title || "this video"}" from the EPK?\n\n${detail}`)) return;

        manage.media.videos.splice(index, 1);
        if (removable) stage(localFile);
        manage.dirty.media = true;
        render();
    }

    function deleteLink(group, index) {
        const list = manage.links[group];
        if (!Array.isArray(list)) return;
        const item = list[index];
        if (!item) return;
        if (!window.confirm(`Remove "${item.label || item.url}" from ${GROUP_LABELS[group] || group}?`)) return;

        list.splice(index, 1);
        manage.dirty.links = true;
        render();
        note(`${item.label || item.url} removed from the plan.`);
    }

    /* ---------------------------------------------------------------- render */

    function fileBadge(path) {
        if (!path) return "";
        return isDeletablePath(path)
            ? `<code class="manage-path">${esc(path)}</code>`
            : `<code class="manage-path manage-path--keep" title="The page's fallback markup still points at this file">${esc(path)} - kept</code>`;
    }

    function renderReleases() {
        const container = $("manage-releases");
        const releases = CORE.listReleases(manage.manifest);
        if (!releases.length) {
            container.innerHTML = `<p class="muted">No releases on this branch.</p>`;
            return;
        }

        container.innerHTML = `<div class="manage-list">${releases.map((item, index) => `
            <article class="manage-card">
                <div class="manage-card__head">
                    <div class="manage-card__title">
                        <strong>${esc(item.release)}</strong>
                        <small>${esc(item.category)} - ${item.tracks.length} track${item.tracks.length === 1 ? "" : "s"}</small>
                    </div>
                    <button class="button danger" type="button" data-release-delete="${index}">Delete release</button>
                </div>
                <details>
                    <summary>Tracks</summary>
                    <ul class="manage-tracks">
                        ${item.tracks.map((track, position) => `
                            <li>
                                <span class="manage-tracks__num">${esc(track.trackNumber || position + 1)}</span>
                                <span class="manage-tracks__title">${esc(track.title || CORE.baseName(track.path || ""))}</span>
                                ${fileBadge(track.path)}
                                <button class="button ghost" type="button" data-track-delete="${index}:${position}"
                                    aria-label="Delete ${esc(track.title || track.path || "")}">Delete</button>
                            </li>
                        `).join("")}
                    </ul>
                </details>
            </article>
        `).join("")}</div>`;
    }

    function renderPhotos() {
        const container = $("manage-photos");
        const photos = manage.media.photos;
        if (!photos.length) {
            container.innerHTML = `<p class="muted">No photos in epk-media.json.</p>`;
            return;
        }

        container.innerHTML = `<div class="manage-list">${photos.map((photo, index) => `
            <div class="manage-row">
                ${photo.src
                    ? `<img class="media-row__thumb" alt="" src="../${esc(photo.src)}" loading="lazy">`
                    : `<span class="media-row__thumb">${index + 1}</span>`}
                <div class="manage-row__text">
                    <strong>${esc(photo.caption || CORE.baseName(photo.src || "") || `Photo ${index + 1}`)}</strong>
                    ${fileBadge(photo.src)}
                </div>
                <button class="button danger" type="button" data-photo-delete="${index}">Delete</button>
            </div>
        `).join("")}</div>`;
    }

    function renderVideos() {
        const container = $("manage-videos");
        const videos = manage.media.videos;
        if (!videos.length) {
            container.innerHTML = `<p class="muted">No videos in epk-media.json.</p>`;
            return;
        }

        container.innerHTML = `<div class="manage-list">${videos.map((video, index) => `
            <div class="manage-row">
                <span class="media-row__badge">${esc(video.source || "video")}</span>
                <div class="manage-row__text">
                    <strong>${esc(video.title || `Video ${index + 1}`)}</strong>
                    <small>${esc([video.kind, video.venue, video.date].filter(Boolean).join(" - "))}</small>
                    ${video.url ? `<code class="manage-path">${esc(video.url)}</code>` : ""}
                </div>
                <button class="button danger" type="button" data-video-delete="${index}">Delete</button>
            </div>
        `).join("")}</div>`;
    }

    function renderLinks() {
        const container = $("manage-links");
        const blocks = GROUPS
            .filter(group => Array.isArray(manage.links[group]) && manage.links[group].length)
            .map(group => `
                <article class="manage-card">
                    <div class="manage-card__head">
                        <div class="manage-card__title">
                            <strong>${esc(GROUP_LABELS[group] || group)}</strong>
                            <small>${manage.links[group].length} link${manage.links[group].length === 1 ? "" : "s"}</small>
                        </div>
                    </div>
                    <ul class="manage-tracks">
                        ${manage.links[group].map((item, index) => `
                            <li>
                                <span class="manage-tracks__num">&nbsp;</span>
                                <span class="manage-tracks__title">${esc(item.label || "")}</span>
                                <code class="manage-path">${esc(item.url || "")}</code>
                                <button class="button ghost" type="button" data-link-delete="${group}:${index}"
                                    aria-label="Delete ${esc(item.label || item.url || "")}">Delete</button>
                            </li>
                        `).join("")}
                    </ul>
                </article>
            `);

        container.innerHTML = blocks.length
            ? `<div class="manage-list">${blocks.join("")}</div>`
            : `<p class="muted">No links in links.json.</p>`;
    }

    function summary() {
        const files = manage.trash.length;
        const lists = Object.keys(manage.dirty).filter(key => manage.dirty[key]).length;
        if (!files && !lists) return "Nothing marked";
        return `${files} file(s), ${lists} list(s) to change`;
    }

    function render() {
        if (!manage.loaded) {
            ["manage-releases", "manage-photos", "manage-videos", "manage-links"].forEach(id => {
                $(id).innerHTML = `<p class="muted">Load the published items to see what can be deleted.</p>`;
            });
            status("Not loaded");
            return;
        }
        renderReleases();
        renderPhotos();
        renderVideos();
        renderLinks();
        status(summary(), manage.trash.length || Object.values(manage.dirty).some(Boolean) ? "warn" : "ok");
    }

    /* --------------------------------------------------------------- publish */

    function buildPlan() {
        const writes = [];
        const seen = new Set();

        manage.trash.forEach(raw => {
            const path = String(raw || "").trim();
            if (!isDeletablePath(path)) throw new Error(`Refusing to delete ${path}.`);
            if (seen.has(path)) return;
            seen.add(path);
            writes.push({ path, kind: "delete", delete: true });
        });

        if (manage.dirty.manifest) {
            writes.push({
                path: CORE.MANIFEST_PATH,
                kind: "manifest",
                text: `${JSON.stringify(CORE.sortManifest(manage.manifest), null, 2)}\n`
            });
        }
        if (manage.dirty.media) {
            writes.push({
                path: CORE.MEDIA_PATH,
                kind: "media-index",
                text: `${JSON.stringify(manage.media, null, 2)}\n`
            });
        }
        if (manage.dirty.links) {
            writes.push({
                path: CORE.LINKS_PATH,
                kind: "links",
                text: `${JSON.stringify(manage.links, null, 2)}\n`
            });
        }

        if (!writes.length) throw new Error("Nothing is marked for deletion yet - use a Delete button above first.");

        return {
            writes,
            warnings: [],
            totalBytes: writes.reduce((sum, write) => sum + (write.text ? write.text.length : 0), 0),
            deletedFiles: writes.filter(write => write.delete).length,
            listCount: writes.filter(write => !write.delete).length
        };
    }

    function renderPlan(plan) {
        const rows = plan.writes.map(write => `
            <tr>
                <td><code>${esc(write.path)}</code></td>
                <td>${write.delete ? "delete" : esc(write.kind)}</td>
                <td>${write.delete ? "removed" : `${String(write.text || "").length} B`}</td>
            </tr>
        `).join("");

        $("manage-output").innerHTML = `
            <div class="plan-summary">
                <span><strong>${plan.deletedFiles}</strong> file(s) deleted</span>
                <span><strong>${plan.listCount}</strong> list(s) rewritten</span>
            </div>
            <p class="ok-line">Nothing leaves the site until this commit lands.</p>
            <details class="plan-files" open>
                <summary>Changes</summary>
                <table class="track-table">
                    <thead><tr><th>Path</th><th>Kind</th><th>Size</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </details>
        `;
    }

    function defaultMessage() {
        const files = manage.trash.length;
        const lists = Object.keys(manage.dirty).filter(key => manage.dirty[key]).length;
        const parts = [];
        if (files) parts.push(`${files} file${files === 1 ? "" : "s"}`);
        if (lists) parts.push(`${lists} list${lists === 1 ? "" : "s"}`);
        return parts.length ? `Remove ${parts.join(" and ")} from the site` : "Prune site content";
    }

    // Blobs -> tree (null sha for deletions) -> commit -> ref, as one commit.
    async function commitChanges(writes, options) {
        const gh = Admin.gh;
        const branch = options.branch;

        note(`Reading ${Admin.state.config.branch} head...`);
        const baseRef = await gh(`/git/ref/heads/${encodeRef(Admin.state.config.branch)}`);
        const baseSha = baseRef.object.sha;
        const baseCommit = await gh(`/git/commits/${baseSha}`);

        const tree = [];
        for (const write of writes) {
            if (write.delete) {
                if (options.dryRun) {
                    note(`[dry run] would delete ${write.path}`);
                    continue;
                }
                tree.push({ path: write.path, mode: "100644", type: "blob", sha: null });
                note(`Deleted ${write.path}`);
                continue;
            }
            if (options.dryRun) {
                note(`[dry run] would write ${write.path}`);
                continue;
            }
            const blob = await gh("/git/blobs", {
                method: "POST",
                body: JSON.stringify({ content: write.text, encoding: "utf-8" })
            });
            tree.push({ path: write.path, mode: "100644", type: "blob", sha: blob.sha });
            note(`Wrote ${write.path}`);
        }

        if (options.dryRun) {
            note(`[dry run] would commit "${options.message}" on ${branch}`);
            return null;
        }

        const newTree = await gh("/git/trees", {
            method: "POST",
            body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree })
        });
        const newCommit = await gh("/git/commits", {
            method: "POST",
            body: JSON.stringify({ message: options.message, tree: newTree.sha, parents: [baseSha] })
        });
        note(`Commit ${newCommit.sha.slice(0, 7)} created`);

        const target = await Admin.ghOrNull(`/git/ref/heads/${encodeRef(branch)}`);
        if (target) {
            await gh(`/git/refs/heads/${encodeRef(branch)}`, {
                method: "PATCH",
                body: JSON.stringify({ sha: newCommit.sha, force: false })
            });
        } else {
            await gh("/git/refs", {
                method: "POST",
                body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: newCommit.sha })
            });
        }
        note(`Updated branch "${branch}".`);

        return newCommit.sha;
    }

    async function publish() {
        if (!Admin.state.config.token) {
            note("Connect a token first - opening Connect.");
            Admin.switchView("settings");
            return null;
        }

        let plan;
        try {
            plan = buildPlan();
        } catch (error) {
            note(`Delete plan failed: ${error.message}`);
            $("manage-output").innerHTML = `<p class="warn-list">${esc(error.message)}</p>`;
            return null;
        }

        renderPlan(plan);
        const settings = Admin.publishSettings("manage");
        const message = settings.message || defaultMessage();

        if (!settings.dryRun && !window.confirm(`Delete ${plan.deletedFiles} file(s) and rewrite ${plan.listCount} list(s) on ${Admin.state.config.owner}/${Admin.state.config.repo} branch "${settings.branch}"?`)) {
            note("Deletion cancelled.");
            return null;
        }

        Admin.setBusy(true);
        try {
            const sha = await commitChanges(plan.writes, { branch: settings.branch, message, dryRun: settings.dryRun });
            if (sha) {
                const url = `https://github.com/${Admin.state.config.owner}/${Admin.state.config.repo}/commit/${sha}`;
                $("manage-output").insertAdjacentHTML("beforeend", `<p class="ok-line">Committed to <strong>${esc(settings.branch)}</strong> - <a href="${url}" target="_blank" rel="noopener">view commit</a></p>`);
                await loadAll(true);
                await Admin.refreshOverview();
            }
            return sha;
        } catch (error) {
            note(`Delete failed: ${error.message}`);
            $("manage-output").insertAdjacentHTML("beforeend", `<p class="warn-list">${esc(error.message)}</p>`);
            return null;
        } finally {
            Admin.setBusy(false);
        }
    }

    /* ---------------------------------------------------------------- wiring */

    function wire() {
        $("manage-load").addEventListener("click", () => loadAll(true));

        $("manage-reset").addEventListener("click", async () => {
            if (!manage.loaded) return;
            if (!window.confirm("Discard the deletions staged in this browser?")) return;
            await loadAll(true);
            note("Staged deletions discarded.");
        });

        $("manage-releases").addEventListener("click", event => {
            const releaseButton = event.target.closest("[data-release-delete]");
            if (releaseButton) {
                const item = CORE.listReleases(manage.manifest)[Number(releaseButton.dataset.releaseDelete)];
                if (item) deleteRelease(item);
                return;
            }
            const trackButton = event.target.closest("[data-track-delete]");
            if (trackButton) {
                const [releaseIndex, trackIndex] = String(trackButton.dataset.trackDelete).split(":").map(Number);
                const item = CORE.listReleases(manage.manifest)[releaseIndex];
                const track = item && item.tracks[trackIndex];
                if (item && track) deleteTrack(item, track);
            }
        });

        $("manage-photos").addEventListener("click", event => {
            const button = event.target.closest("[data-photo-delete]");
            if (button) deletePhoto(Number(button.dataset.photoDelete));
        });

        $("manage-videos").addEventListener("click", event => {
            const button = event.target.closest("[data-video-delete]");
            if (button) deleteVideo(Number(button.dataset.videoDelete));
        });

        $("manage-links").addEventListener("click", event => {
            const button = event.target.closest("[data-link-delete]");
            if (!button) return;
            const [group, index] = String(button.dataset.linkDelete).split(":");
            deleteLink(group, Number(index));
        });

        $("manage-plan").addEventListener("click", () => {
            try {
                renderPlan(buildPlan());
            } catch (error) {
                note(`Delete plan failed: ${error.message}`);
                $("manage-output").innerHTML = `<p class="warn-list">${esc(error.message)}</p>`;
            }
        });

        $("manage-publish").addEventListener("click", () => publish());
    }

    function init() {
        wire();
        render();
        Admin.registerView("manage", () => loadAll(false));
    }

    document.addEventListener("DOMContentLoaded", init);
})();
