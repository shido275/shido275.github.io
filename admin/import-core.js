/* ==========================================================================
   Release importer core - pure functions. No DOM, no network.
   Shared by the browser app (window.ReleaseImport) and the Node tests.
   Mirrors generate-manifest.js so an imported release and a scanned release
   produce the same manifest entries.
   ========================================================================== */
(function (global, factory) {
    "use strict";
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    if (global) global.ReleaseImport = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    const AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a", ".flac"];
    const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
    const CATEGORIES = ["Singles", "EPs", "Albums and Mixtapes", "Compilations"];
    const MANIFEST_PATH = "music-manifest.json";
    // GitHub rejects very large base64 blob payloads; warn well before that.
    const MAX_FILE_BYTES = 45 * 1024 * 1024;
    const DEFAULT_ARTIST = "X/i\\D";

    function ext(name) {
        const i = String(name).lastIndexOf(".");
        return i <= 0 ? "" : String(name).slice(i).toLowerCase();
    }

    function baseName(name) {
        const i = String(name).lastIndexOf(".");
        return i <= 0 ? String(name) : String(name).slice(0, i);
    }

    function isAudio(name) {
        return AUDIO_EXTENSIONS.includes(ext(name));
    }

    function isImage(name) {
        return IMAGE_EXTENSIONS.includes(ext(name));
    }

    function prettyName(fileName) {
        return baseName(fileName).replace(/[-_]+/g, " ").replace(/\b\w/g, letter => letter.toUpperCase()).trim();
    }

    function slugify(value) {
        const slug = String(value || "")
            .normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^\w\s-]/g, "")
            .trim()
            .replace(/\s+/g, "-")
            .toLowerCase()
            .slice(0, 48);
        return slug || "release";
    }

    // Keep folder and file names usable on Windows, macOS and in URLs.
    function safeSegment(name) {
        const cleaned = String(name == null ? "" : name)
            .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
            .replace(/\s+/g, " ")
            .trim();
        if (!cleaned || cleaned === "." || cleaned === ".." || cleaned.includes("..")) {
            throw new Error(`Unsafe name: "${name}"`);
        }
        return cleaned;
    }

    // Every path this app writes must stay inside the repo.
    function assertRepoPath(path) {
        const parts = String(path || "").split("/");
        const unsafe = !path || path.startsWith("/") || path.includes("\\") || parts.some(part => part === "" || part === "." || part === "..");
        if (unsafe) throw new Error(`Refusing to write outside the repo: "${path}"`);
        return path;
    }

    function releaseFolder(category, release) {
        if (!CATEGORIES.includes(category)) throw new Error(`Unknown category: "${category}"`);
        return `Music/${safeSegment(category)}/${safeSegment(release)}`;
    }

    function naturalCompare(a, b) {
        return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
    }

    function buildEntries(options) {
        const { category, release, album, artist, date, tracks, coverName } = options;
        if (!tracks || !tracks.length) throw new Error("Add at least one audio file.");

        const folder = releaseFolder(category, release);
        const releaseDate = date || new Date().toISOString().slice(0, 10);
        const albumName = album && album.trim() ? album.trim() : (category === "Singles" ? "Single" : release);
        const year = /^\d{4}/.test(releaseDate) ? releaseDate.slice(0, 4) : undefined;
        const coverUrl = coverName ? `${folder}/${safeSegment(coverName)}` : "";

        return tracks.map((track, index) => {
            const fileName = safeSegment(track.fileName);
            const audioPath = `${folder}/${fileName}`;
            const entry = {
                title: (track.title || "").trim() || prettyName(fileName),
                artist: (artist || "").trim() || DEFAULT_ARTIST,
                album: albumName,
                category,
                audioUrl: audioPath,
                coverUrl,
                path: audioPath,
                date: releaseDate,
                year
            };
            if (category !== "Singles") {
                entry.trackNumber = Number(track.trackNumber) || index + 1;
            }
            return entry;
        });
    }

    function sortManifest(manifest) {
        const categoryRank = item => {
            const index = CATEGORIES.indexOf(item.category);
            return index === -1 ? CATEGORIES.length : index;
        };
        return [...manifest].sort((a, b) => {
            const rankA = categoryRank(a);
            const rankB = categoryRank(b);
            if (rankA !== rankB) return rankA - rankB;

            const albumA = String(a.album || "");
            const albumB = String(b.album || "");
            if (albumA !== albumB) return albumA.localeCompare(albumB);

            const numA = Number(a.trackNumber || 0);
            const numB = Number(b.trackNumber || 0);
            if (numA !== numB) return numA - numB;

            return String(a.title || "").localeCompare(String(b.title || ""));
        });
    }

    // Same files replaced in place, duplicates collapsed, catalogue order kept.
    function mergeManifest(existing, entries) {
        const incoming = new Set(entries.map(entry => entry.path.toLowerCase()));
        const kept = (existing || []).filter(item => !incoming.has(String(item.path || "").toLowerCase()));
        return {
            manifest: sortManifest([...kept, ...entries]),
            added: entries.length,
            replaced: (existing || []).length - kept.length
        };
    }

    function listReleases(manifest) {
        const map = new Map();
        (manifest || []).forEach(item => {
            const parts = String(item.path || "").split("/");
            if (parts[0] !== "Music" || parts.length < 4) return;
            const key = `${parts[1]}::${parts[2]}`;
            if (!map.has(key)) map.set(key, { category: parts[1], release: parts[2], tracks: [] });
            map.get(key).tracks.push(item);
        });
        return [...map.values()].sort((a, b) => naturalCompare(a.release, b.release));
    }

    function nextTrackNumber(manifest, folder) {
        const used = (manifest || [])
            .filter(item => String(item.path || "").startsWith(`${folder}/`))
            .map(item => Number(item.trackNumber) || 0);
        return used.length ? Math.max(...used) + 1 : 1;
    }

    function formatBytes(bytes) {
        const value = Number(bytes) || 0;
        if (value < 1024) return `${value} B`;
        if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
        return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    }

    /* Build everything the import needs: file writes, manifest, warnings.
       Deliberately side-effect free so it can be tested and previewed. */
    function planImport(options) {
        const { files, coverFile, form, existingManifest } = options;
        const audioFiles = [...(files || [])].filter(file => isAudio(file.name)).sort((a, b) => naturalCompare(a.name, b.name));
        if (!audioFiles.length) throw new Error("No audio files (.mp3, .wav, .m4a, .flac) selected.");
        if (!form || !form.release) throw new Error("Release name is required.");

        const warnings = [];
        const tracks = audioFiles.map((file, index) => ({
            fileName: file.name,
            title: (form.titles && form.titles[file.name]) || prettyName(file.name),
            trackNumber: Number(form.trackNumbers && form.trackNumbers[file.name]) || index + 1
        }));

        const coverName = coverFile ? coverFile.name : "";
        if (!coverName) warnings.push("No cover art selected - cards will render without artwork.");

        const entries = buildEntries({
            category: form.category,
            release: form.release,
            album: form.album,
            artist: form.artist,
            date: form.date,
            tracks,
            coverName
        });
        const folder = releaseFolder(form.category, form.release);

        const writes = [];
        audioFiles.forEach((file, index) => {
            const path = assertRepoPath(`${folder}/${safeSegment(file.name)}`);
            writes.push({ path, kind: "audio", file, description: tracks[index].title });
            const metaPath = assertRepoPath(`${folder}/${safeSegment(baseName(safeSegment(file.name)))}.json`);
            writes.push({
                path: metaPath,
                kind: "metadata",
                text: `${JSON.stringify({
                    title: entries[index].title,
                    artist: entries[index].artist,
                    album: entries[index].album,
                    trackNumber: entries[index].trackNumber,
                    date: entries[index].date,
                    year: entries[index].year,
                    cover: coverName || undefined
                }, null, 2)}\n`
            });
        });
        if (coverFile) {
            writes.push({ path: assertRepoPath(`${folder}/${safeSegment(coverFile.name)}`), kind: "cover", file: coverFile });
        }

        const merged = mergeManifest(existingManifest, entries);
        writes.push({
            path: MANIFEST_PATH,
            kind: "manifest",
            text: `${JSON.stringify(merged.manifest, null, 2)}\n`
        });

        const seen = new Set();
        writes.forEach(write => {
            if (seen.has(write.path.toLowerCase())) warnings.push(`Duplicate path in this import: ${write.path}`);
            seen.add(write.path.toLowerCase());
            if (write.file && write.file.size > MAX_FILE_BYTES) {
                warnings.push(`${write.file.name} is ${formatBytes(write.file.size)} - GitHub may reject blobs over 45 MB. Export a smaller master first.`);
            }
        });

        const existingInFolder = (existingManifest || []).filter(item => String(item.path || "").startsWith(`${folder}/`));
        if (existingInFolder.length && form.category !== "Singles") {
            warnings.push(`"${form.release}" already has ${existingInFolder.length} track(s); files with the same name will be replaced and its metadata JSON rewritten.`);
        }

        const totalBytes = writes.reduce((sum, write) => sum + (write.file ? write.file.size : (write.text ? write.text.length : 0)), 0);

        return {
            folder,
            entries,
            writes,
            manifest: merged.manifest,
            added: merged.added,
            replaced: merged.replaced,
            warnings,
            totalBytes,
            trackCount: entries.length,
            coverName
        };
    }

    function suggestBranchName(release) {
        const stamp = new Date().toISOString().slice(0, 10);
        return `imports/${slugify(release)}-${stamp}`;
    }

    function commitMessage(form, trackCount) {
        const label = form.category === "Singles" ? "single" : "release";
        return `Import ${label} "${form.release}" (${trackCount} track${trackCount === 1 ? "" : "s"})`;
    }

    return {
        AUDIO_EXTENSIONS,
        IMAGE_EXTENSIONS,
        CATEGORIES,
        MANIFEST_PATH,
        MAX_FILE_BYTES,
        DEFAULT_ARTIST,
        ext,
        baseName,
        isAudio,
        isImage,
        prettyName,
        slugify,
        safeSegment,
        assertRepoPath,
        releaseFolder,
        naturalCompare,
        buildEntries,
        sortManifest,
        mergeManifest,
        listReleases,
        nextTrackNumber,
        formatBytes,
        planImport,
        suggestBranchName,
        commitMessage
    };
});
