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
    // Where the clean cut of a tagged beat is kept. Outside Beats/ on purpose:
    // the site lists every audio file it finds in there, so a second copy in
    // the same folder would show up as a second beat.
    const CLEAN_DIR = "Beats-clean";
    const AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a", ".flac"];
    const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
    const DEFAULT_ARTIST = "X/i\\D";
    const DEFAULT_LICENSE = "Lease";
    const MAX_FILE_BYTES = 45 * 1024 * 1024;
    const ZIP_EXTENSIONS = [".zip"];
    // Only links the site can actually send a buyer to are kept.
    const CHECKOUT_PREFIX = "https://buy.stripe.com/";

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

    function isZip(name) {
        return ZIP_EXTENSIONS.includes(ext(name));
    }

    /* A per-tier map of Stripe links, with anything unexpected dropped. */
    function checkoutLinks(source) {
        const links = {};
        if (!source || typeof source !== "object") return links;
        Object.keys(source).forEach(tier => {
            const url = clean(source[tier]);
            if (url && url.startsWith(CHECKOUT_PREFIX)) links[tier] = url;
        });
        return links;
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

    /* beats: [{ file?, coverFile?, stemsFile?, extrasFile?, title, folder?,
                artist, bpm, key, price, license, paymentUrl, paymentUrls,
                audioUrl?, coverUrl?, path? }]
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
            let taggedPath = clean(beat.taggedUrl);
            let cleanPath = clean(beat.cleanUrl);
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
                taggedPath = uniquePath(`${BEAT_DIR}/${folder}/${safeSegment(beat.file.name)}`);
                writes.push({ path: taggedPath, kind: "beat", file: beat.file });
                metaPath = `${baseName(taggedPath)}.json`;
            }

            if (beat.untaggedFile) {
                if (!isAudio(beat.untaggedFile.name)) {
                    warnings.push(`${beat.untaggedFile.name} is not audio - untagged version ignored.`);
                } else if (beat.untaggedFile.size > MAX_FILE_BYTES) {
                    warnings.push(`${beat.untaggedFile.name} is ${formatBytes(beat.untaggedFile.size)} - GitHub may reject blobs over 45 MB.`);
                } else if (taggedPath) {
                    // A tagged file plays, so the clean cut waits beside it and
                    // is listed for licensing without becoming a second beat.
                    cleanPath = uniquePath(`${CLEAN_DIR}/${folder}/${safeSegment(beat.untaggedFile.name)}`);
                    writes.push({ path: cleanPath, kind: "beat-clean", file: beat.untaggedFile });
                } else {
                    // Nothing tagged exists, so this is the version that plays.
                    audioPath = uniquePath(`${BEAT_DIR}/${folder}/${safeSegment(beat.untaggedFile.name)}`);
                    writes.push({ path: audioPath, kind: "beat", file: beat.untaggedFile });
                    metaPath = `${baseName(audioPath)}.json`;
                }
            }

            // The tagged cut always wins; a beat without one plays its clean cut.
            if (taggedPath) audioPath = taggedPath;

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

            // Trackout stems and any extra content ride along beside the audio;
            // they are what make the higher licence tiers deliverable. The site
            // only lists audio in Beats/, so a ZIP never shows up as a beat.
            let stemsPath = clean(beat.stemsUrl);
            let extrasPath = clean(beat.extrasUrl);
            const archives = [
                { file: beat.stemsFile, kind: "beat-stems", set: path => { stemsPath = path; } },
                { file: beat.extrasFile, kind: "beat-extras", set: path => { extrasPath = path; } }
            ];
            archives.forEach(archive => {
                if (!archive.file) return;
                if (!isZip(archive.file.name)) {
                    warnings.push(`${archive.file.name} is not a .zip - ignored.`);
                    return;
                }
                if (archive.file.size > MAX_FILE_BYTES) {
                    warnings.push(`${archive.file.name} is ${formatBytes(archive.file.size)} - GitHub may reject blobs over 45 MB.`);
                }
                const target = uniquePath(`${BEAT_DIR}/${folder}/${safeSegment(archive.file.name)}`);
                archive.set(target);
                writes.push({ path: target, kind: archive.kind, file: archive.file });
            });

            const entry = {
                title,
                artist: clean(beat.artist) || DEFAULT_ARTIST,
                bpm: normalizeBpm(beat.bpm),
                key: clean(beat.key),
                price: clean(beat.price),
                license: clean(beat.license) || DEFAULT_LICENSE,
                paymentUrl: clean(beat.paymentUrl),
                paymentUrls: checkoutLinks(beat.paymentUrls),
                stemsUrl: stemsPath,
                extrasUrl: extrasPath,
                coverUrl: coverPath,
                audioUrl: audioPath,
                tagged: Boolean(taggedPath),
                taggedUrl: taggedPath,
                cleanUrl: cleanPath || (taggedPath ? "" : audioPath),
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
                        paymentUrls: entry.paymentUrls,
                        stemsUrl: entry.stemsUrl,
                        extrasUrl: entry.extrasUrl,
                        tagged: entry.tagged,
                        clean: entry.cleanUrl ? entry.cleanUrl.split("/").pop() : undefined,
                        cover: entry.coverUrl ? entry.coverUrl.split("/").pop() : undefined
                    }, null, 2)}\n`
                });
            }
        });

        const keptAudio = new Set(entries.map(entry => entry.audioUrl.toLowerCase()));
        const keptCover = new Set(entries.map(entry => entry.coverUrl.toLowerCase()).filter(Boolean));
        const keptClean = new Set(entries.map(entry => entry.cleanUrl.toLowerCase()).filter(Boolean));
        const keptStems = new Set(entries.map(entry => entry.stemsUrl.toLowerCase()).filter(Boolean));
        const keptExtras = new Set(entries.map(entry => entry.extrasUrl.toLowerCase()).filter(Boolean));
        const deleting = new Set();
        const removable = path => String(path || "").startsWith(`${BEAT_DIR}/`) || String(path || "").startsWith(`${CLEAN_DIR}/`);

        // A beat dropped from the list takes its uploads with it, in this commit.
        (Array.isArray(opts.existing) ? opts.existing : []).forEach(item => {
            const path = clean(item && (item.path || item.audioUrl));
            if (!path || !removable(path) || keptAudio.has(path.toLowerCase())) return;
            const paths = [path, path.replace(/\.[^./]+$/, ".json")];
            const cover = clean(item && item.coverUrl);
            if (cover && removable(cover) && !keptCover.has(cover.toLowerCase())) paths.push(cover);
            const cleanCopy = clean(item && item.cleanUrl);
            if (cleanCopy && removable(cleanCopy) && !keptClean.has(cleanCopy.toLowerCase())) paths.push(cleanCopy);
            const stemsCopy = clean(item && item.stemsUrl);
            if (stemsCopy && removable(stemsCopy) && !keptStems.has(stemsCopy.toLowerCase())) paths.push(stemsCopy);
            const extrasCopy = clean(item && item.extrasUrl);
            if (extrasCopy && removable(extrasCopy) && !keptExtras.has(extrasCopy.toLowerCase())) paths.push(extrasCopy);
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
                paymentUrls: checkoutLinks(beat.paymentUrls),
                stemsUrl: clean(beat.stemsUrl),
                extrasUrl: clean(beat.extrasUrl),
                coverUrl: clean(beat.coverUrl),
                audioUrl: clean(beat.audioUrl || beat.path),
                tagged: beat.tagged === true,
                taggedUrl: clean(beat.taggedUrl),
                cleanUrl: clean(beat.cleanUrl),
                path: clean(beat.path || beat.audioUrl)
            }));
    }

    return {
        BEATS_PATH,
        BEAT_DIR,
        CLEAN_DIR,
        AUDIO_EXTENSIONS,
        IMAGE_EXTENSIONS,
        DEFAULT_ARTIST,
        DEFAULT_LICENSE,
        MAX_FILE_BYTES,
        ZIP_EXTENSIONS,
        CHECKOUT_PREFIX,
        ext,
        baseName,
        isAudio,
        isImage,
        isZip,
        checkoutLinks,
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
