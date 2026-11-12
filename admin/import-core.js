/* ==========================================================================
   Admin core - pure functions. No DOM, no network.
   Shared by the browser dashboard (window.ReleaseImport) and the Node tests.
   Covers three tools: release import, EPK media (photos + videos) and the
   All Links directory. Mirrors generate-manifest.js for catalogue entries.
   ========================================================================== */
(function (global, factory) {
    "use strict";
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    if (global) global.ReleaseImport = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    const AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a", ".flac"];
    const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".svg"];
    const VIDEO_EXTENSIONS = [".mp4", ".webm", ".mov", ".m4v"];
    const CATEGORIES = ["Singles", "EPs", "Albums and Mixtapes", "Compilations"];
    const MANIFEST_PATH = "music-manifest.json";
    const MEDIA_PATH = "epk-media.json";
    const LINKS_PATH = "links.json";
    const PHOTO_DIR = "assets/photos";
    const VIDEO_DIR = "assets/videos";
    const DEFAULT_ARTIST = "X/i\\D";
    const DEFAULT_LABEL = "FAKE Entertainment";
    const VIDEO_KINDS = ["Music Video", "Performance", "Behind the Scenes", "Interview"];
    const LINK_GROUPS = ["featured", "platforms", "socials", "business"];
    // GitHub rejects very large base64 blob payloads; warn well before that.
    const MAX_FILE_BYTES = 45 * 1024 * 1024;
    // Pages is not a video host; keep uploads for short clips only.
    const MAX_VIDEO_BYTES = 90 * 1024 * 1024;

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

    function isVideo(name) {
        return VIDEO_EXTENSIONS.includes(ext(name));
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

    function formatBytes(bytes) {
        const value = Number(bytes) || 0;
        if (value < 1024) return `${value} B`;
        if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
        return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    }

    function clean(value) {
        return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
    }

    // "Me, You; Them" -> ["Me", "You", "Them"] so the site can join it back.
    function creditList(value) {
        if (Array.isArray(value)) return value.map(clean).filter(Boolean);
        return String(value == null ? "" : value)
            .split(/[,;\n]/)
            .map(clean)
            .filter(Boolean);
    }

    /* ------------------------------------------------------------------ links */

    // Only links that cannot execute script are accepted.
    function isSafeUrl(value) {
        const url = clean(value);
        if (!url) return false;
        if (/^(https?:|mailto:|tel:)/i.test(url)) return true;
        if (url.startsWith("#") || url.startsWith("/") || url.startsWith("./")) return true;
        // Bare domains like example.com/artist are common in hand-typed links.
        return /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(url) && !/^\s*javascript:/i.test(url);
    }

    function normalizeUrl(value) {
        const url = clean(value);
        if (!url) return "";
        if (/^(https?:|mailto:|tel:)/i.test(url) || url.startsWith("#") || url.startsWith("/") || url.startsWith("./")) return url;
        if (/^[\w-]+(\.[\w-]+)+/.test(url)) return `https://${url}`;
        return url;
    }

    /* ------------------------------------------------------------ release data */

    function yearOf(date) {
        const value = String(date || "");
        return /^\d{4}/.test(value) ? value.slice(0, 4) : undefined;
    }

    function albumLabel(category, release, album) {
        if (album && album.trim()) return album.trim();
        return category === "Singles" ? "Single" : release;
    }

    /* Album-level credits. The site's release modal reads exactly these keys
       from <release>/info.json, so the importer now writes that file too. */
    /* The release metadata the catalogue and the site both carry: how the
       release is handed out, and what that mode needs (a price and a Stripe
       link, or an access token for an unlisted release). Built by release-core
       and passed in, so this file stays free of pricing rules. */
    function releaseMetaFields(meta) {
        const source = meta || {};
        const out = {};
        if (source.distribution) out.distribution = source.distribution;
        if (Number(source.price) > 0) out.price = Number(source.price);
        if (Number(source.trackPrice) > 0) out.trackPrice = Number(source.trackPrice);
        if (clean(source.paymentUrl)) out.paymentUrl = clean(source.paymentUrl);
        if (source.trackPaymentUrls && typeof source.trackPaymentUrls === "object") {
            const links = {};
            Object.keys(source.trackPaymentUrls).forEach(key => {
                if (clean(source.trackPaymentUrls[key])) links[key] = clean(source.trackPaymentUrls[key]);
            });
            if (Object.keys(links).length) out.trackPaymentUrls = links;
        }
        if (clean(source.access)) out.access = clean(source.access);
        if (Array.isArray(source.extras) && source.extras.length) {
            out.extras = source.extras
                .map(item => ({ label: clean(item && item.label), url: clean(item && item.url), kind: clean(item && item.kind) || "link" }))
                .filter(item => item.label && item.url);
            if (!out.extras.length) delete out.extras;
        }
        return out;
    }

    function buildReleaseInfo(form, coverName, meta) {
        const releaseDate = form.date || new Date().toISOString().slice(0, 10);
        const info = {
            title: albumLabel(form.category, form.release, form.album),
            artist: clean(form.artist) || DEFAULT_ARTIST,
            album: albumLabel(form.category, form.release, form.album),
            category: form.category,
            releaseDate,
            year: yearOf(releaseDate),
            description: clean(form.description),
            performers: creditList(form.performers),
            producers: creditList(form.producers),
            writers: creditList(form.writers),
            label: clean(form.label) || DEFAULT_LABEL,
            genre: clean(form.genre)
        };
        if (form.explicit) info.explicit = true;
        if (coverName) info.cover = coverName;
        Object.assign(info, releaseMetaFields(meta));
        return info;
    }

    function buildEntries(options) {
        const { category, release, album, artist, date, tracks, coverName } = options;
        if (!tracks || !tracks.length) throw new Error("Add at least one audio file.");

        const folder = releaseFolder(category, release);
        const releaseDate = date || new Date().toISOString().slice(0, 10);
        const albumName = albumLabel(category, release, album);
        const year = yearOf(releaseDate);
        const coverUrl = coverName ? `${folder}/${safeSegment(coverName)}` : "";
        const meta = options.meta || {};
        const mode = clean(meta.distribution);

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
            /* The site draws the buttons from these, so every track of a release
               carries the same answer. */
            if (mode) {
                entry.distribution = mode;
                if (mode === "paid") {
                    entry.price = Number(meta.price) || 0;
                    if (clean(meta.trackPrice)) entry.trackPrice = Number(meta.trackPrice);
                    if (clean(meta.paymentUrl)) entry.paymentUrl = clean(meta.paymentUrl);
                    const perSong = meta.trackPaymentUrls && meta.trackPaymentUrls[`track-${entry.trackNumber}`];
                    if (clean(perSong)) entry.trackPaymentUrl = clean(perSong);
                }
                if (mode === "exclusive" && clean(meta.access)) entry.access = clean(meta.access);
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

    /* Build everything the import needs: file writes, manifest, credits, warnings.
       Deliberately side-effect free so it can be tested and previewed. */
    function planImport(options) {
        const { files, coverFile, form, existingManifest } = options;
        const audioFiles = [...(files || [])].filter(file => isAudio(file.name)).sort((a, b) => naturalCompare(a.name, b.name));
        if (!audioFiles.length) throw new Error("No audio files (.mp3, .wav, .m4a, .flac) selected.");
        if (!form || !form.release) throw new Error("Release name is required.");

        const warnings = [];
        const meta = options.meta || {};
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
            coverName,
            meta
        });
        const folder = releaseFolder(form.category, form.release);
        const info = buildReleaseInfo(form, coverName, meta);

        if (!info.description) warnings.push("No release description - the site's Credits panel will read as empty.");
        if (!info.performers.length && !info.producers.length && !info.writers.length) {
            warnings.push("No credits filled in - the site will show N/A for performers, producers and writers.");
        }
        if (meta.distribution === "paid" && !info.paymentUrl) {
            warnings.push("Paid release without a Stripe payment link - the Buy button stays hidden until a link is made in Release sales.");
        }
        if (meta.distribution === "exclusive" && !info.access) {
            warnings.push("Exclusive release without an access token - the shareable link cannot be made.");
        }

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
                    cover: coverName || undefined,
                    /* The site reads a folder by walking it, so the delivery
                       mode has to live beside each track as well as in
                       info.json and the catalogue. */
                    distribution: entries[index].distribution,
                    price: entries[index].price,
                    trackPaymentUrl: entries[index].trackPaymentUrl,
                    access: entries[index].access
                }, null, 2)}\n`
            });
        });
        if (coverFile) {
            writes.push({ path: assertRepoPath(`${folder}/${safeSegment(coverFile.name)}`), kind: "cover", file: coverFile });
        }
        writes.push({
            path: assertRepoPath(`${folder}/info.json`),
            kind: "info",
            text: `${JSON.stringify(info, null, 2)}\n`
        });

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
            info,
            writes,
            manifest: merged.manifest,
            added: merged.added,
            replaced: merged.replaced,
            warnings,
            totalBytes,
            trackCount: entries.length,
            coverName,
            distribution: meta.distribution || ""
        };
    }

    /* ----------------------------------------------------------------- media */

    /* Pull a YouTube playlist or video id out of any URL shape people paste. */
    function parseYouTube(url) {
        const value = clean(url);
        if (!value) return null;
        let list = "";
        let id = "";
        const listMatch = value.match(/[?&]list=([\w-]+)/);
        if (listMatch) list = listMatch[1];
        const idMatch = value.match(/(?:v=|\/embed\/|youtu\.be\/|\/shorts\/|\/live\/)([\w-]{11})/);
        if (idMatch) id = idMatch[1];
        if (!id && /^[\w-]{11}$/.test(value)) id = value;
        if (!list && !id) return null;
        return list && (!id || value.includes("playlist") || /[?&]list=/.test(value)) ? { playlist: list, id } : { id, playlist: "" };
    }

    function parseVimeo(url) {
        const value = clean(url);
        const match = value.match(/vimeo\.com\/(?:video\/)?(\d+)/);
        return match ? match[1] : "";
    }

    /* Photos and videos for the EPK. Uploads go under assets/, everything is
       indexed in one epk-media.json the site reads at runtime. */
    function planMedia(options) {
        const { photos, videos, existing } = options || {};
        const previous = existing && typeof existing === "object" ? existing : {};
        const warnings = [];
        const usedNames = new Set();
        const writes = [];

        const uniqueName = (file, dir, prefix) => {
            const name = `${prefix ? `${prefix}-` : ""}${slugify(baseName(file.name))}${ext(file.name)}`;
            let candidate = name;
            let counter = 2;
            while (usedNames.has(`${dir}/${candidate}`.toLowerCase())) {
                candidate = `${prefix ? `${prefix}-` : ""}${slugify(baseName(file.name))}-${counter}${ext(file.name)}`;
                counter += 1;
            }
            usedNames.add(`${dir}/${candidate}`.toLowerCase());
            return candidate;
        };

        const photoList = [];
        (photos || []).forEach((photo, index) => {
            let src = clean(photo.src || photo.url || "");
            if (photo.file) {
                if (!isImage(photo.file.name) && ext(photo.file.name) !== ".svg") {
                    warnings.push(`${photo.file.name} is not an image (.jpg, .png, .webp, .svg).`);
                    return;
                }
                if (photo.file.size > MAX_FILE_BYTES) {
                    warnings.push(`${photo.file.name} is ${formatBytes(photo.file.size)} - too large for GitHub.`);
                    return;
                }
                const name = uniqueName(photo.file, PHOTO_DIR, "photo");
                const path = assertRepoPath(`${PHOTO_DIR}/${name}`);
                writes.push({ path, kind: "photo", file: photo.file });
                src = path;
            }
            if (!src) return;
            const caption = clean(photo.caption);
            photoList.push({
                src,
                caption,
                alt: clean(photo.alt) || caption || `X/i\\D photo ${index + 1}`,
                credit: clean(photo.credit)
            });
        });

        const videoList = [];
        (videos || []).forEach((video, index) => {
            const title = clean(video.title) || `Video ${index + 1}`;
            const kind = VIDEO_KINDS.includes(video.kind) ? video.kind : VIDEO_KINDS[0];
            const entry = {
                title,
                kind,
                venue: clean(video.venue),
                date: clean(video.date),
                note: clean(video.note)
            };

            if (video.file) {
                if (!isVideo(video.file.name)) {
                    warnings.push(`${video.file.name} is not a video (.mp4, .webm, .mov).`);
                    return;
                }
                if (video.file.size > MAX_VIDEO_BYTES) {
                    warnings.push(`${video.file.name} is ${formatBytes(video.file.size)} - GitHub Pages is not a good host for videos this big. Upload to YouTube and paste the link instead.`);
                }
                const name = uniqueName(video.file, VIDEO_DIR, "video");
                const path = assertRepoPath(`${VIDEO_DIR}/${name}`);
                writes.push({ path, kind: "video", file: video.file });
                entry.source = "file";
                entry.url = path;
                videoList.push(entry);
                return;
            }

            const url = clean(video.url);
            if (!url) {
                warnings.push(`"${title}" has no video URL or file.`);
                return;
            }
            const youtube = parseYouTube(url);
            if (youtube || /youtube\.com|youtu\.be/i.test(url)) {
                if (!youtube) {
                    warnings.push(`Could not read a video or playlist id from "${url}".`);
                    return;
                }
                entry.source = youtube.playlist ? "youtube-playlist" : "youtube";
                if (youtube.playlist) entry.playlist = youtube.playlist;
                if (youtube.id) entry.videoId = youtube.id;
                entry.url = url;
                videoList.push(entry);
                return;
            }
            const vimeo = parseVimeo(url);
            if (vimeo) {
                entry.source = "vimeo";
                entry.videoId = vimeo;
                entry.url = url;
                videoList.push(entry);
                return;
            }
            warnings.push(`"${title}" is not a YouTube or Vimeo link - paste a hosted link or choose a file.`);
        });

        const slideshow = {
            autoplay: previous.slideshow && previous.slideshow.autoplay === false ? false : true,
            interval: Number(previous.slideshow && previous.slideshow.interval) || 6000
        };

        const doc = { photos: photoList, videos: videoList, slideshow };
        writes.push({ path: MEDIA_PATH, kind: "media-index", text: `${JSON.stringify(doc, null, 2)}\n` });

        if (!photoList.length) warnings.push("No photos queued - the EPK photo slideshow will keep its built-in fallback.");
        if (!videoList.length) warnings.push("No videos queued - the EPK video slideshow will keep its built-in fallback.");

        return {
            writes,
            doc,
            photoCount: photoList.length,
            videoCount: videoList.length,
            warnings,
            totalBytes: writes.reduce((sum, write) => sum + (write.file ? write.file.size : (write.text ? write.text.length : 0)), 0)
        };
    }

    function readMedia(source) {
        if (!source || typeof source !== "object") return { photos: [], videos: [], slideshow: null };
        return {
            photos: Array.isArray(source.photos) ? source.photos : [],
            videos: Array.isArray(source.videos) ? source.videos : [],
            slideshow: source.slideshow || null
        };
    }

    /* ------------------------------------------------------------ link tools */

    const ACCENTS = ["cyan", "gold", "rose", "green"];

    function buildLinksDoc(input) {
        const source = input || {};
        const doc = {};
        const warnings = [];

        const take = (list, mapper, group) => {
            const out = [];
            (Array.isArray(list) ? list : []).forEach((item, index) => {
                const label = clean(item && item.label);
                const url = clean(item && item.url);
                if (!label && !url) return;
                if (!label) {
                    warnings.push(`${group} entry ${index + 1} has a URL but no label - dropped.`);
                    return;
                }
                if (!url) {
                    warnings.push(`"${label}" has no URL - dropped.`);
                    return;
                }
                if (!isSafeUrl(url)) {
                    warnings.push(`"${label}" points at an unsupported URL (${url}) - dropped. Only http(s), mailto:, #routes and relative paths are allowed.`);
                    return;
                }
                out.push(mapper(item, label, normalizeUrl(url)));
            });
            return out;
        };

        doc.featured = take(source.featured, (item, label, url) => {
            const entry = { label, url, description: clean(item.description) };
            const accent = clean(item.accent).toLowerCase();
            if (ACCENTS.includes(accent)) entry.accent = accent;
            return entry;
        }, "Featured");

        doc.platforms = take(source.platforms, (item, label, url) => ({ label, url }), "Platforms");

        doc.socials = take(source.socials, (item, label, url) => {
            const entry = { label, url };
            const handle = clean(item.handle);
            if (handle) entry.handle = handle;
            return entry;
        }, "Socials");

        doc.business = take(source.business, (item, label, url) => ({ label, url }), "Business");

        doc.quickSocials = take(source.quickSocials, (item, label, url) => ({ label, url }), "Quick socials");

        return { doc, warnings };
    }

    function planLinks(options) {
        const { doc } = options || {};
        const built = buildLinksDoc(doc || {});
        const total = LINK_GROUPS.reduce((sum, group) => sum + built.doc[group].length, 0) + built.doc.quickSocials.length;
        const warnings = [...built.warnings];
        if (!LINK_GROUPS.some(group => built.doc[group].length)) {
            warnings.push("Every group is empty - the All Links page will keep its built-in fallback list.");
        }
        return {
            writes: [{ path: LINKS_PATH, kind: "links", text: `${JSON.stringify(built.doc, null, 2)}\n` }],
            doc: built.doc,
            linkCount: total,
            warnings,
            totalBytes: JSON.stringify(built.doc, null, 2).length + 1
        };
    }

    /* --------------------------------------------------------------- git bits */

    function suggestBranchName(release) {
        const stamp = new Date().toISOString().slice(0, 10);
        return `imports/${slugify(release)}-${stamp}`;
    }

    function suggestToolBranch(tool) {
        const stamp = new Date().toISOString().slice(0, 10);
        return `admin/${slugify(tool)}-${stamp}`;
    }

    function commitMessage(form, trackCount) {
        const label = form.category === "Singles" ? "single" : "release";
        return `Import ${label} "${form.release}" (${trackCount} track${trackCount === 1 ? "" : "s"})`;
    }

    return {
        AUDIO_EXTENSIONS,
        IMAGE_EXTENSIONS,
        VIDEO_EXTENSIONS,
        CATEGORIES,
        MANIFEST_PATH,
        MEDIA_PATH,
        LINKS_PATH,
        PHOTO_DIR,
        VIDEO_DIR,
        MAX_FILE_BYTES,
        MAX_VIDEO_BYTES,
        DEFAULT_ARTIST,
        DEFAULT_LABEL,
        VIDEO_KINDS,
        LINK_GROUPS,
        ACCENTS,
        ext,
        baseName,
        isAudio,
        isImage,
        isVideo,
        prettyName,
        slugify,
        safeSegment,
        assertRepoPath,
        releaseFolder,
        naturalCompare,
        formatBytes,
        clean,
        creditList,
        isSafeUrl,
        normalizeUrl,
        yearOf,
        albumLabel,
        buildReleaseInfo,
        buildEntries,
        sortManifest,
        mergeManifest,
        listReleases,
        nextTrackNumber,
        planImport,
        parseYouTube,
        parseVimeo,
        planMedia,
        readMedia,
        buildLinksDoc,
        planLinks,
        suggestBranchName,
        suggestToolBranch,
        commitMessage
    };
});
