/* ==========================================================================
   Beat core - pure functions for the beat store.

   The dashboard edits a list; this turns it into the writes one commit needs:
   audio, a metadata JSON beside each uploaded beat, cover art, the manifest the
   site reads, and the files a removed beat no longer needs. No DOM, no network.
   ========================================================================== */
(function (global, factory) {
    "use strict";
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    if (global) global.BeatCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    const BEATS_PATH = "beats-manifest.json";
    const BEAT_DIR = "Beats";
    const AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a", ".flac"];
    const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
    const DEFAULT_ARTIST = "X/i\\D";
    const DEFAULT_LICENSE = "Lease";
    const MAX_FILE_BYTES = 45 * 1024 * 1024;

    function ext(name) {
        const index = String(name).lastIndexOf(".");
        return index <= 0 ? "" : String(name).slice(index).toLowerCase();
    }

    function baseName(name) {
        const index = String(name).lastIndexOf(".");
        return index <= 0 ? String(name) : String(name).slice(0, index);
    }

    function isAudio(name) {
        return AUDIO_EXTENSIONS.includes(ext(name));
    }

    function isImage(name) {
        return IMAGE_EXTENSIONS.includes(ext(name));
    }

    function clean(value) {
        return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
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
        return slug || "beat";
    }

    function safeSegment(name) {
        const cleaned = clean(name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-");
        if (!cleaned || cleaned === "." || cleaned === ".." || cleaned.includes("..")) {
            throw new Error(`Unsafe name: "${name}"`);
        }
        return cleaned;
    }

    function formatBytes(bytes) {
        const value = Number(bytes) || 0;
        if (value < 1024) return `${value} B`;
        if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
        return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    }

    function normalizeBpm(value) {
        const number = Number(String(value == null ? "" : value).replace(/[^\d.]/g, ""));
        return Number.isFinite(number) && number > 0 ? Math.round(number) : "";
    }

    function folderOf(path) {
        const parts = String(path || "").split("/");
        return parts.length >= 3 && parts[0] === BEAT_DIR ? parts[1] : "";
    }

    /* beats: [{ file?, coverFile?, title, folder?, artist, bpm, key, price,
                license, paymentUrl, audioUrl?, coverUrl?, path? }]
       existing: the beats-manifest.json currently on the branch */
    function planBeats(options) {
        const opts = options || {};
        const warnings = [];
        const writes = [];
        const entries = [];
        const used = new Set();

        const uniquePath = candidate => {
            let path = candidate;
            let counter = 2;
            while (used.has(path.toLowerCase())) {
                path = `${baseName(candidate)}-${counter}${ext(candidate)}`;
                counter += 1;
            }
            used.add(path.toLowerCase());
            return path;
        };

        (opts.beats || []).forEach((beat, index) => {
            if (!beat) return;
            const title = clean(beat.title);
            if (!title) {
                warnings.push(`Beat ${index + 1} has no title - skipped.`);
                return;
            }

            const folder = safeSegment(clean(beat.folder) || slugify(title));
            let audioPath = clean(beat.audioUrl || beat.path);
            let coverPath = clean(beat.coverUrl);
            let metaPath = "";

            if (beat.file) {
                if (!isAudio(beat.file.name)) {
                    warnings.push(`${beat.file.name} is not audio (.mp3, .wav, .m4a, .flac) - skipped.`);
                    return;
                }
                if (beat.file.size > MAX_FILE_BYTES) {
                    warnings.push(`${beat.file.name} is ${formatBytes(beat.file.size)} - GitHub may reject blobs over 45 MB.`);
                }
                audioPath = uniquePath(`${BEAT_DIR}/${folder}/${safeSegment(beat.file.name)}`);
                writes.push({ path: audioPath, kind: "beat", file: beat.file });
                metaPath = `${baseName(audioPath)}.json`;
            }

            if (!audioPath) {
                warnings.push(`"${title}" has no audio file or link - skipped.`);
                return;
            }

            if (beat.coverFile && isImage(beat.coverFile.name)) {
                coverPath = uniquePath(`${BEAT_DIR}/${folder}/cover${ext(beat.coverFile.name)}`);
                writes.push({ path: coverPath, kind: "beat-cover", file: beat.coverFile });
            } else if (beat.coverFile) {
                warnings.push(`${beat.coverFile.name} is not an image (.jpg, .png, .webp) - cover skipped.`);
            }

            const entry = {
                title,
                artist: clean(beat.artist) || DEFAULT_ARTIST,
                bpm: normalizeBpm(beat.bpm),
                key: clean(beat.key),
                price: clean(beat.price),
                license: clean(beat.license) || DEFAULT_LICENSE,
                paymentUrl: clean(beat.paymentUrl),
                coverUrl: coverPath,
                audioUrl: audioPath,
                path: audioPath
            };
            entries.push(entry);

            if (metaPath) {
                writes.push({
                    path: metaPath,
                    kind: "beat-metadata",
                    text: `${JSON.stringify({
                        title: entry.title,
                        artist: entry.artist,
                        bpm: entry.bpm,
                        key: entry.key,
                        price: entry.price,
                        license: entry.license,
                        paymentUrl: entry.paymentUrl,
                        cover: entry.coverUrl ? entry.coverUrl.split("/").pop() : undefined
                    }, null, 2)}\n`
                });
            }
        });

        const keptAudio = new Set(entries.map(entry => entry.audioUrl.toLowerCase()));
        const keptCover = new Set(entries.map(entry => entry.coverUrl.toLowerCase()).filter(Boolean));
        const deleting = new Set();

        // A beat dropped from the list takes its uploads with it, in this commit.
        (Array.isArray(opts.existing) ? opts.existing : []).forEach(item => {
            const path = clean(item && (item.path || item.audioUrl));
            if (!path || !path.startsWith(`${BEAT_DIR}/`) || keptAudio.has(path.toLowerCase())) return;
            const paths = [path, path.replace(/\.[^./]+$/, ".json")];
            const cover = clean(item && item.coverUrl);
            if (cover && cover.startsWith(`${BEAT_DIR}/`) && !keptCover.has(cover.toLowerCase())) paths.push(cover);
            paths.forEach(candidate => {
                if (deleting.has(candidate)) return;
                deleting.add(candidate);
                writes.push({ path: candidate, kind: "delete", delete: true });
            });
        });

        writes.push({
            path: BEATS_PATH,
            kind: "beats-index",
            text: `${JSON.stringify(entries, null, 2)}\n`
        });

        if (!entries.length) warnings.push("No beats left - the store keeps its built-in fallback.");

        const totalBytes = writes.reduce((sum, write) => (
            sum + (write.file ? write.file.size : (write.text ? write.text.length : 0))
        ), 0);

        return { writes, entries, warnings, totalBytes, count: entries.length };
    }

    /* Everything the editor needs to show what is already published. */
    function readBeats(source) {
        return (Array.isArray(source) ? source : [])
            .filter(beat => beat && (beat.title || beat.path || beat.audioUrl))
            .map(beat => ({
                title: clean(beat.title),
                folder: folderOf(beat.path || beat.audioUrl),
                artist: clean(beat.artist) || DEFAULT_ARTIST,
                bpm: beat.bpm == null ? "" : beat.bpm,
                key: clean(beat.key),
                price: clean(beat.price),
                license: clean(beat.license),
                paymentUrl: clean(beat.paymentUrl),
                coverUrl: clean(beat.coverUrl),
                audioUrl: clean(beat.audioUrl || beat.path),
                path: clean(beat.path || beat.audioUrl)
            }));
    }

    return {
        BEATS_PATH,
        BEAT_DIR,
        AUDIO_EXTENSIONS,
        IMAGE_EXTENSIONS,
        DEFAULT_ARTIST,
        DEFAULT_LICENSE,
        MAX_FILE_BYTES,
        ext,
        baseName,
        isAudio,
        isImage,
        clean,
        slugify,
        safeSegment,
        formatBytes,
        normalizeBpm,
        folderOf,
        planBeats,
        readBeats
    };
});
