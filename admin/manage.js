/* ==========================================================================
   Manage - reorder and delete what is already published.

   Reads the branch once (catalogue, EPK media, links and every blob path),
   stages the changes in this browser, then commits them together: tree entries
   with a null sha remove files while the indexes that pointed at them are
   rewritten in the same commit. Nothing leaves the site until that commit
   lands, and Reset throws the staged changes away.

   Reordering follows what the site actually reads:
     - tracks  -> music-manifest.json trackNumber (site.js sorts by it)
     - photos  -> epk-media.json photos order (the slideshow plays in order)
     - videos  -> epk-media.json videos order
     - links   -> links.json order inside each group
   Release order on the site comes from release dates, not the manifest, so
   releases are not draggable here.
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

    // The order site.js itself uses: trackNumber, then title.
    function orderedTracks(item) {
        return [...item.tracks].sort((a, b) => {
            const numA = Number(a.trackNumber || 0);
            const numB = Number(b.trackNumber || 0);
            if (numA !== numB) return numA - numB;
            return String(a.title || "").localeCompare(String(b.title || ""));
        });
    }

    function moveWithin(list, from, to) {
        if (!Array.isArray(list)) return false;
        if (to < 0 || to >= list.length || from === to) return false;
        const [item] = list.splice(from, 1);
        list.splice(to, 0, item);
        return true;
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
            note("Unlock the dashboard and connect a token to manage what is already published.");
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

    function moveTrack(releaseIndex, position, offset) {
        const item = CORE.listReleases(manage.manifest)[releaseIndex];
        if (!item) return;

        const tracks = orderedTracks(item);
        const to = position + offset;
        if (to < 0 || to >= tracks.length) return;
        if (!moveWithin(tracks, position, to)) return;

        // site.js orders a release by trackNumber, so the numbers are the order.
        if (item.category !== "Singles") {
            tracks.forEach((track, index) => {
                track.trackNumber = index + 1;
            });
        }
        manage.dirty.manifest = true;
        render();
        note(`Moved "${tracks[to].title || CORE.baseName(tracks[to].path || "")}" to ${to + 1} of ${tracks.length}.`);
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

    function movePhoto(index, offset) {
        if (!moveWithin(manage.media.photos, index, index + offset)) return;
        manage.dirty.media = true;
        render();
        note(`Photo moved to position ${index + offset + 1}.`);
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

    function moveVideo(index, offset) {
        if (!moveWithin(manage.media.videos, index, index + offset)) return;
        manage.dirty.media = true;
        render();
        note(`Video moved to position ${index + offset + 1}.`);
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

    function moveLink(group, index, offset) {
        const list = manage.links[group];
        if (!moveWithin(list, index, index + offset)) return;
        manage.dirty.links = true;
        render();
        note(`${GROUP_LABELS[group] || group}: "${list[index + offset].label || ""}" moved to ${index + offset + 1}.`);
    }

    /* ---------------------------------------------------------------- render */

    function fileBadge(path) {
        if (!path) return "";
        return isDeletablePath(path)
            ? `<code class="manage-path">${esc(path)}</code>`
            : `<code class="manage-path manage-path--keep" title="The page's fallback markup still points at this file">${esc(path)} - kept</code>`;
    }

    function actions(buttons) {
        return `<span class="manage-actions">${buttons.join("")}</span>`;
    }

    function arrowButtons(collection, index, disabled) {
        const attr = disabled ? " disabled" : "";
        const up = `<button class="button ghost" type="button" data-${collection}-move="-1" data-index="${index}"
            aria-label="Move up" title="Move up"${attr}>&uarr;</button>`;
        const down = `<button class="button ghost" type="button" data-${collection}-move="1" data-index="${index}"
            aria-label="Move down" title="Move down"${attr}>&darr;</button>`;
        return [up, down];
    }

    function renderReleases() {
        const container = $("manage-releases");
        const releases = CORE.listReleases(manage.manifest);
        if (!releases.length) {
            container.innerHTML = `<p class="muted">No releases on this branch.</p>`;
            return;
        }

        container.innerHTML = `<div class="manage-list">${releases.map((item, index) => {
            const tracks = orderedTracks(item);
            const single = item.category === "Singles" || tracks.length < 2;
            return `
            <article class="manage-card">
                <div class="manage-card__head">
                    <div class="manage-card__title">
                        <strong>${esc(item.release)}</strong>
                        <small>${esc(item.category)} - ${tracks.length} track${tracks.length === 1 ? "" : "s"}</small>
                    </div>
                    <button class="button danger" type="button" data-release-delete="${index}">Delete release</button>
                </div>
                <details>
                    <summary>Tracks</summary>
                    <ul class="manage-tracks">
                        ${tracks.map((track, position) => `
                            <li>
                                <span class="manage-tracks__num">${esc(single ? position + 1 : track.trackNumber || position + 1)}</span>
                                <span class="manage-tracks__title">${esc(track.title || CORE.baseName(track.path || ""))}</span>
                                ${fileBadge(track.path)}
                                ${actions([
                                    `<button class="button ghost" type="button" data-track-move="-1" data-release="${index}" data-position="${position}"
                                        aria-label="Move up" title="Move up"${single ? " disabled" : ""}>&uarr;</button>`,
                                    `<button class="button ghost" type="button" data-track-move="1" data-release="${index}" data-position="${position}"
                                        aria-label="Move down" title="Move down"${single ? " disabled" : ""}>&darr;</button>`,
                                    `<button class="button ghost" type="button" data-track-delete="${index}:${position}"
                                        aria-label="Delete ${esc(track.title || track.path || "")}">Delete</button>`
                                ])}
                            </li>
                        `).join("")}
                    </ul>
                </details>
                ${single ? `<p class="muted manage-note">Track order follows the track numbers; a single has nothing to reorder.</p>` : ""}
            </article>
        `;
        }).join("")}</div>`;
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
                ${actions([
                    ...arrowButtons("photo", index, photos.length < 2),
                    `<button class="button danger" type="button" data-photo-delete="${index}">Delete</button>`
                ])}
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
                ${actions([
                    ...arrowButtons("video", index, videos.length < 2),
                    `<button class="button danger" type="button" data-video-delete="${index}">Delete</button>`
                ])}
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
                                <span class="manage-tracks__num">${index + 1}</span>
                                <span class="manage-tracks__title">${esc(item.label || "")}</span>
                                <code class="manage-path">${esc(item.url || "")}</code>
                                ${actions([
                                    `<button class="button ghost" type="button" data-link-move="-1" data-group="${group}" data-index="${index}"
                                        aria-label="Move up" title="Move up"${manage.links[group].length < 2 ? " disabled" : ""}>&uarr;</button>`,
                                    `<button class="button ghost" type="button" data-link-move="1" data-group="${group}" data-index="${index}"
                                        aria-label="Move down" title="Move down"${manage.links[group].length < 2 ? " disabled" : ""}>&darr;</button>`,
                                    `<button class="button ghost" type="button" data-link-delete="${group}:${index}"
                                        aria-label="Delete ${esc(item.label || item.url || "")}">Delete</button>`
                                ])}
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
        const parts = [];
        if (lists) parts.push(`${lists} list(s) changed`);
        if (files) parts.push(`${files} file(s) deleted`);
        return parts.join(", ");
    }

    function render() {
        if (!manage.loaded) {
            ["manage-releases", "manage-photos", "manage-videos", "manage-links"].forEach(id => {
                $(id).innerHTML = `<p class="muted">Load the published items to reorder or delete them.</p>`;
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
            // Written in the order held here; the site sorts releases and tracks.
            writes.push({
                path: CORE.MANIFEST_PATH,
                kind: "manifest",
                text: `${JSON.stringify(manage.manifest, null, 2)}\n`
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

        if (!writes.length) throw new Error("Nothing is marked yet - reorder or delete something above first.");

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
                <span><strong>${plan.listCount}</strong> list(s) rewritten</span>
                <span><strong>${plan.deletedFiles}</strong> file(s) deleted</span>
            </div>
            <p class="ok-line">Nothing changes on the site until this commit lands.</p>
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
        return parts.length ? `Update ${parts.join(" and ")} in the site` : "Update site content";
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
            note("Unlock the dashboard and connect a token first.");
            Admin.switchView("settings");
            return null;
        }

        let plan;
        try {
            plan = buildPlan();
        } catch (error) {
            note(`Plan failed: ${error.message}`);
            $("manage-output").innerHTML = `<p class="warn-list">${esc(error.message)}</p>`;
            return null;
        }

        renderPlan(plan);
        const settings = Admin.publishSettings("manage");
        const message = settings.message || defaultMessage();

        if (!settings.dryRun && !window.confirm(`Commit ${plan.writes.length} change(s) to ${Admin.state.config.owner}/${Admin.state.config.repo} branch "${settings.branch}"?`)) {
            note("Publish cancelled.");
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
            note(`Publish failed: ${error.message}`);
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
            if (!window.confirm("Discard the reordering and deletions staged in this browser?")) return;
            await loadAll(true);
            note("Staged changes discarded.");
        });

        $("manage-releases").addEventListener("click", event => {
            const releaseButton = event.target.closest("[data-release-delete]");
            if (releaseButton) {
                const item = CORE.listReleases(manage.manifest)[Number(releaseButton.dataset.releaseDelete)];
                if (item) deleteRelease(item);
                return;
            }
            const trackMove = event.target.closest("[data-track-move]");
            if (trackMove) {
                moveTrack(Number(trackMove.dataset.release), Number(trackMove.dataset.position), Number(trackMove.dataset.trackMove));
                return;
            }
            const trackButton = event.target.closest("[data-track-delete]");
            if (trackButton) {
                const [releaseIndex, trackIndex] = String(trackButton.dataset.trackDelete).split(":").map(Number);
                const item = CORE.listReleases(manage.manifest)[releaseIndex];
                const track = item && orderedTracks(item)[trackIndex];
                if (item && track) deleteTrack(item, track);
            }
        });

        $("manage-photos").addEventListener("click", event => {
            const move = event.target.closest("[data-photo-move]");
            if (move) {
                movePhoto(Number(move.dataset.index), Number(move.dataset.photoMove));
                return;
            }
            const button = event.target.closest("[data-photo-delete]");
            if (button) deletePhoto(Number(button.dataset.photoDelete));
        });

        $("manage-videos").addEventListener("click", event => {
            const move = event.target.closest("[data-video-move]");
            if (move) {
                moveVideo(Number(move.dataset.index), Number(move.dataset.videoMove));
                return;
            }
            const button = event.target.closest("[data-video-delete]");
            if (button) deleteVideo(Number(button.dataset.videoDelete));
        });

        $("manage-links").addEventListener("click", event => {
            const move = event.target.closest("[data-link-move]");
            if (move) {
                moveLink(move.dataset.group, Number(move.dataset.index), Number(move.dataset.linkMove));
                return;
            }
            const button = event.target.closest("[data-link-delete]");
            if (!button) return;
            const [group, index] = String(button.dataset.linkDelete).split(":");
            deleteLink(group, Number(index));
        });

        $("manage-plan").addEventListener("click", () => {
            try {
                renderPlan(buildPlan());
            } catch (error) {
                note(`Plan failed: ${error.message}`);
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
