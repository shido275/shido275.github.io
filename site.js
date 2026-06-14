const SITE_CONFIG = {
    owner: "PolynesianPvnk",
    repo: "shido.github.io",
    branch: "main",
    contactEmail: "shidomusic275@gmail.com",
    live: {
        playerEmbed: "",
        chatEmbed: "",
        vods: [
            {
                title: "VOD archive placeholder",
                date: "Add date",
                url: "#"
            }
        ]
    }
};

const AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a", ".flac"];
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
const MUSIC_MANIFEST = "music-manifest.json";
const MUSIC_FOLDERS = [
    { label: "Singles", path: "Music/Singles" },
    { label: "EPs", path: "Music/EPs" },
    { label: "Albums and Mixtapes", path: "Music/Albums and Mixtapes", fallbackPath: "Music/Albums and Mixtales" },
    { label: "Compilations", path: "Music/Compilations" }
];

let allMusicTracks = [];
let currentMusicCategory = "All";
let currentMusicSearch = "";

let playbackQueue = [];
let currentQueueIndex = -1;
let shuffleQueue = [];
let isShuffle = false;
let repeatMode = "none"; // "none" | "all" | "one"
let currentTracksInView = [];
let currentPlayingTrack = null;
let playbackHistory = [];
let isAutoplayRandom = false;

document.addEventListener("DOMContentLoaded", () => {
    const year = document.querySelector("#year");
    if (year) year.textContent = new Date().getFullYear();

    initInfoModal();
    loadMusicLibrary();
    loadBeatStore();
    loadLiveSection();

    const audio = document.querySelector("#main-audio");
    if (audio) {
        audio.addEventListener("ended", playNextTrack);
    }
    initPlayerControls();
});

function initInfoModal() {
    if (document.querySelector("#info-modal-overlay")) return;
    const modalHtml = `
        <div id="info-modal-overlay" class="info-modal-overlay" hidden>
            <div class="info-modal">
                <button id="info-modal-close" class="info-modal-close" type="button">&times;</button>
                <div class="info-modal-content">
                    <h2 id="modal-project-title">Release Title</h2>
                    <p class="modal-project-meta" id="modal-project-meta">Artist / Category</p>
                    <div id="modal-loading" class="muted">Loading database...</div>
                    <div id="modal-body" style="display: none;">
                        <p class="modal-description" id="modal-description"></p>
                        <div class="modal-specs">
                            <div><strong>Release Date:</strong> <span id="modal-date"></span></div>
                            <div><strong>Performers:</strong> <span id="modal-performers"></span></div>
                            <div><strong>Producers:</strong> <span id="modal-producers"></span></div>
                            <div><strong>Writers:</strong> <span id="modal-writers"></span></div>
                        </div>
                        <p class="modal-label-credit" id="modal-label-credit"></p>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML("beforeend", modalHtml);

    const overlay = document.querySelector("#info-modal-overlay");
    const closeBtn = document.querySelector("#info-modal-close");

    closeBtn.addEventListener("click", () => {
        overlay.hidden = true;
    });

    overlay.addEventListener("click", (event) => {
        if (event.target === overlay) {
            overlay.hidden = true;
        }
    });
}

function getInfoJsonUrl(track) {
    const lastSlash = track.path.lastIndexOf("/");
    const folderPath = track.path.substring(0, lastSlash);
    const infoPath = `${folderPath}/info.json`;
    const isLocalPreview = ["", "localhost", "127.0.0.1"].includes(window.location.hostname);
    if (isLocalPreview) {
        return infoPath;
    } else {
        return `https://raw.githubusercontent.com/${SITE_CONFIG.owner}/${SITE_CONFIG.repo}/${SITE_CONFIG.branch}/${infoPath}`;
    }
}

async function openInfoModal(track) {
    const overlay = document.querySelector("#info-modal-overlay");
    const loading = document.querySelector("#modal-loading");
    const modalBody = document.querySelector("#modal-body");
    const modalTitle = document.querySelector("#modal-project-title");
    const modalMeta = document.querySelector("#modal-project-meta");

    if (!overlay || !loading || !modalBody) return;

    modalTitle.textContent = track.album || track.title;
    modalMeta.textContent = `${track.artist} / ${track.category}`;

    loading.style.display = "block";
    modalBody.style.display = "none";
    overlay.hidden = false;

    const infoUrl = getInfoJsonUrl(track);

    try {
        const response = await fetch(infoUrl + "?v=" + Date.now());
        if (!response.ok) throw new Error("File not found");
        const info = await response.json();

        document.querySelector("#modal-description").textContent = info.description || "No description provided.";
        document.querySelector("#modal-date").textContent = info.releaseDate || info.release_date || "Unknown";

        const performersText = Array.isArray(info.performers) ? info.performers.join(", ") : (info.performers || info.performer || "N/A");
        const producersText = Array.isArray(info.producers) ? info.producers.join(", ") : (info.producers || "N/A");
        const writersText = Array.isArray(info.writers) ? info.writers.join(", ") : (info.writers || "N/A");

        document.querySelector("#modal-performers").textContent = performersText;
        document.querySelector("#modal-producers").textContent = producersText;
        document.querySelector("#modal-writers").textContent = writersText;

        const labelName = info.label || "Independent";
        document.querySelector("#modal-label-credit").textContent = `Provided by ${labelName}.`;

        loading.style.display = "none";
        modalBody.style.display = "block";
    } catch (error) {
        document.querySelector("#modal-description").textContent = "Release database entry offline or info.json missing for this project.";
        document.querySelector("#modal-date").textContent = "N/A";
        document.querySelector("#modal-performers").textContent = "N/A";
        document.querySelector("#modal-producers").textContent = "N/A";
        document.querySelector("#modal-writers").textContent = "N/A";
        document.querySelector("#modal-label-credit").textContent = "";

        loading.style.display = "none";
        modalBody.style.display = "block";
    }
}

async function githubContents(path) {
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    const url = `https://api.github.com/repos/${SITE_CONFIG.owner}/${SITE_CONFIG.repo}/contents/${encodedPath}?ref=${SITE_CONFIG.branch}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load ${path}`);
    return response.json();
}

async function listFilesRecursive(path) {
    const items = await githubContents(path);
    const files = [];
    for (const item of items) {
        if (item.type === "file") files.push(item);
        if (item.type === "dir") {
            const nested = await listFilesRecursive(item.path);
            files.push(...nested);
        }
    }
    return files;
}

async function loadFolderWithFallback(folder) {
    try {
        return await listFilesRecursive(folder.path);
    } catch (error) {
        if (!folder.fallbackPath) return [];
        try {
            return await listFilesRecursive(folder.fallbackPath);
        } catch {
            return [];
        }
    }
}

function hasExtension(file, extensions) {
    return extensions.some(ext => file.name.toLowerCase().endsWith(ext));
}

function basename(fileName) {
    return fileName.replace(/\.[^/.]+$/, "");
}

function prettyName(fileName) {
    return basename(fileName).replace(/[-_]+/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function releaseNameFromPath(track) {
    if (track.album) return track.album;
    const parts = String(track.path || "").split("/");
    if (track.category === "EPs") return parts[2] || track.category;
    if (track.category === "Albums and Mixtapes") return parts[2] || track.category;
    if (track.category === "Compilations") return parts[2] || track.category;
    return track.category;
}

async function metadataFor(audioFile, files) {
    const audioBase = basename(audioFile.name).toLowerCase();
    const folderFiles = files.filter(file => file.path.substring(0, file.path.lastIndexOf("/")) === audioFile.path.substring(0, audioFile.path.lastIndexOf("/")));
    const jsonFile = folderFiles.find(file => file.name.toLowerCase() === `${audioBase}.json`) || folderFiles.find(file => file.name.toLowerCase() === "metadata.json");
    let metadata = {};

    if (jsonFile) {
        try {
            const response = await fetch(jsonFile.download_url);
            metadata = await response.json();
        } catch {
            metadata = {};
        }
    }

    const coverName = metadata.cover ? metadata.cover.toLowerCase() : "";
    const coverFile = folderFiles.find(file => coverName && file.name.toLowerCase() === coverName)
        || folderFiles.find(file => hasExtension(file, IMAGE_EXTENSIONS) && basename(file.name).toLowerCase() === audioBase)
        || folderFiles.find(file => hasExtension(file, IMAGE_EXTENSIONS) && file.name.toLowerCase().includes("cover"))
        || folderFiles.find(file => hasExtension(file, IMAGE_EXTENSIONS));

    return {
        title: metadata.title || prettyName(audioFile.name),
        artist: metadata.artist || metadata.producer || "X/i\\D",
        album: metadata.album || "",
        bpm: metadata.bpm || "",
        key: metadata.key || "",
        price: metadata.price || "",
        license: metadata.license || "",
        paymentUrl: metadata.paymentUrl || metadata.paypal || metadata.stripe || "",
        audioUrl: audioFile.download_url,
        coverUrl: coverFile ? coverFile.download_url : "",
        path: audioFile.path,
        trackNumber: metadata.trackNumber || metadata.track || 0,
        date: metadata.date || "",
        year: metadata.year || metadata.releaseYear || ""
    };
}

async function buildTracks(folder) {
    const files = await loadFolderWithFallback(folder);
    const audioFiles = files.filter(file => hasExtension(file, AUDIO_EXTENSIONS));
    const tracks = await Promise.all(audioFiles.map(file => metadataFor(file, files)));
    return tracks.map(track => ({ ...track, category: folder.label }));
}

async function loadMusicManifest() {
    try {
        const response = await fetch(`${MUSIC_MANIFEST}?v=${Date.now()}`);
        if (!response.ok) return [];
        const tracks = await response.json();
        return tracks.map(track => ({
            ...track,
            audioUrl: encodeURI(track.audioUrl),
            coverUrl: track.coverUrl ? encodeURI(track.coverUrl) : ""
        }));
    } catch {
        return [];
    }
}

async function loadMusicLibrary() {
    const library = document.querySelector("#music-library");
    if (!library) return;

    const isLocalPreview = ["", "localhost", "127.0.0.1"].includes(window.location.hostname);
    library.innerHTML = `<p class="muted">Loading music from ${isLocalPreview ? "local manifest" : "GitHub"}...</p>`;

    let tracks = [];
    if (isLocalPreview) {
        tracks = await loadMusicManifest();
    } else {
        const allGroups = await Promise.all(MUSIC_FOLDERS.map(buildTracks));
        tracks = allGroups.flat();
        if (!tracks.length) tracks = await loadMusicManifest();
    }

    if (!tracks.length) {
        library.innerHTML = "<p class=\"muted\">No music files found yet. Upload audio files and cover art to the Music folders, then publish the repo.</p>";
        return;
    }

    allMusicTracks = tracks;
    setupTabs();
    setupSearch();
    filterAndRenderMusic();

    // Find the latest drop based on date
    let latestTrack = tracks[0];
    if (tracks.length > 0) {
        const sortedByDate = [...tracks].sort((a, b) => {
            const timeA = a.date ? new Date(a.date).getTime() : 0;
            const timeB = b.date ? new Date(b.date).getTime() : 0;
            return timeB - timeA;
        });
        latestTrack = sortedByDate[0];
    }
    setupFeatured(latestTrack);
}

function setupTabs() {
    const tabs = document.querySelector("#music-tabs");
    if (!tabs) return;

    const categories = ["All", "Singles", "EPs", "Albums and Mixtapes", "Compilations"];
    tabs.innerHTML = categories.map((category, index) => `<button class="button ${index === 0 ? "active" : ""}" type="button" data-category="${category}">${category}</button>`).join("");

    tabs.addEventListener("click", event => {
        const button = event.target.closest("button");
        if (!button) return;
        tabs.querySelectorAll("button").forEach(tab => tab.classList.remove("active"));
        button.classList.add("active");
        currentMusicCategory = button.dataset.category;
        filterAndRenderMusic();
    });
}

function setupSearch() {
    const searchInput = document.querySelector("#music-search");
    if (!searchInput) return;

    searchInput.addEventListener("input", event => {
        currentMusicSearch = event.target.value;
        filterAndRenderMusic();
    });
}

function filterAndRenderMusic() {
    const library = document.querySelector("#music-library");
    if (!library) return;

    let filtered = allMusicTracks;

    // Apply category filter
    if (currentMusicCategory !== "All") {
        filtered = filtered.filter(track => track.category === currentMusicCategory);
    }

    // Apply search query filter
    if (currentMusicSearch) {
        const query = currentMusicSearch.toLowerCase().trim();
        filtered = filtered.filter(track => {
            const titleMatch = (track.title || "").toLowerCase().includes(query);
            const artistMatch = (track.artist || "").toLowerCase().includes(query);
            const albumMatch = (track.album || "").toLowerCase().includes(query);
            return titleMatch || artistMatch || albumMatch;
        });
    }

    // Apply limit if defined
    const limit = Number(library.dataset.limit || 0);
    const visibleTracks = limit ? filtered.slice(0, limit) : filtered;

    renderTracks(visibleTracks, library);
}

function renderTracks(tracks, container) {
    if (!tracks.length) {
        container.innerHTML = `<p class="muted" style="grid-column: 1 / -1; text-align: center; padding: 2.5rem; font-family: 'Share Tech Mono', monospace; letter-spacing: 0.05em; text-transform: uppercase;">No matching tracks found.</p>`;
        return;
    }
    const hasDockedPlayer = Boolean(document.querySelector("#main-audio"));
    const singles = tracks.filter(track => track.category === "Singles");
    const groupedTracks = tracks.filter(track => track.category !== "Singles");
    const releaseGroups = new Map();

    groupedTracks.forEach(track => {
        const releaseName = releaseNameFromPath(track);
        const key = `${track.category}-${releaseName}`;
        if (!releaseGroups.has(key)) {
            releaseGroups.set(key, {
                title: releaseName,
                category: track.category,
                coverUrl: track.coverUrl,
                tracks: []
            });
        }
        const group = releaseGroups.get(key);
        const isMainCover = track.coverUrl && /\/cover\.(jpg|jpeg|png|webp|gif)/i.test(track.coverUrl.split('?')[0]);
        if (isMainCover || (!group.coverUrl && track.coverUrl)) {
            group.coverUrl = track.coverUrl;
        }
        group.tracks.push(track);
    });

    // Sort tracks inside EPs, Albums, and Compilations by trackNumber (lowest to highest)
    releaseGroups.forEach(group => {
        group.tracks.sort((a, b) => {
            const numA = Number(a.trackNumber || 0);
            const numB = Number(b.trackNumber || 0);
            if (numA !== numB) return numA - numB;
            return a.title.localeCompare(b.title);
        });
    });

    // Sort function for chronology
    const sortByChronology = (a, b) => {
        const yearA = a.year || (a.date ? a.date.split('-')[0] : "");
        const yearB = b.year || (b.date ? b.date.split('-')[0] : "");
        if (yearA !== yearB) {
            return yearB.localeCompare(yearA);
        }
        return b.date.localeCompare(a.date);
    };

    // Sort Singles chronologically
    const sortedSingles = [...singles].sort(sortByChronology);

    // Sort Folder releases chronologically
    const sortedGroups = [...releaseGroups.values()];
    const getGroupChronologyKey = (group) => {
        const groupDates = group.tracks.map(t => t.date).filter(Boolean);
        const latestDate = groupDates.length > 0 ? [...groupDates].sort().reverse()[0] : "";
        const groupYear = group.tracks.find(t => t.year)?.year || "";
        return { year: groupYear, date: latestDate };
    };

    sortedGroups.sort((a, b) => {
        const keyA = getGroupChronologyKey(a);
        const keyB = getGroupChronologyKey(b);
        const yearA = keyA.year || (keyA.date ? keyA.date.split('-')[0] : "");
        const yearB = keyB.year || (keyB.date ? keyB.date.split('-')[0] : "");
        if (yearA !== yearB) {
            return yearB.localeCompare(yearA);
        }
        return keyB.date.localeCompare(keyA.date);
    });

    // Create the visual ordered tracks array
    const orderedTracks = [];
    sortedSingles.forEach(track => {
        orderedTracks.push(track);
    });
    sortedGroups.forEach(group => {
        group.tracks.forEach(track => {
            orderedTracks.push(track);
        });
    });

    // Assign visualIndex to tracks
    orderedTracks.forEach((track, index) => {
        track.visualIndex = index;
    });

    currentTracksInView = orderedTracks;

    // Render singles and folder cards in HTML
    const singlesHtml = sortedSingles.map(track => renderSingleTrackCard(track, hasDockedPlayer)).join("");
    const groupHtml = sortedGroups.map(group => renderReleaseFolder(group, hasDockedPlayer)).join("");
    container.innerHTML = singlesHtml + groupHtml;

    container.querySelectorAll("[data-track-index]").forEach(button => {
        button.addEventListener("click", () => {
            const index = Number(button.dataset.trackIndex);
            playTrackFromQueue(index);
        });
    });

    // Info buttons click handler
    container.querySelectorAll(".info-button").forEach(button => {
        button.addEventListener("click", (event) => {
            event.stopPropagation();
            event.preventDefault();
            const trackIndex = Number(button.dataset.infoTrack);
            openInfoModal(currentTracksInView[trackIndex]);
        });
    });
}

function renderSingleTrackCard(track, hasDockedPlayer) {
    const metaParts = [track.artist, track.album, track.category ? `${track.category}${track.year ? ` (${track.year})` : ""}` : track.year].filter(Boolean);
    return `
        <article class="release-card">
            ${track.coverUrl ? `<img src="${track.coverUrl}" alt="${escapeHtml(track.title)} cover art">` : ""}
            <div class="card-body">
                <h3>${escapeHtml(track.title)}</h3>
                <p class="card-meta">${escapeHtml(metaParts.join(" / "))}</p>
                <div class="card-actions" style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
                    ${hasDockedPlayer ? `<button class="button primary" type="button" data-track-index="${track.visualIndex}">Play</button>` : `<audio controls controlsList="nodownload" oncontextmenu="return false;" preload="metadata" src="${track.audioUrl}"></audio>`}
                    <button class="button info-button" type="button" data-info-track="${track.visualIndex}">Info</button>
                </div>
            </div>
        </article>
    `;
}

function renderReleaseFolder(group, hasDockedPlayer) {
    const groupYear = group.tracks.find(t => t.year)?.year || group.tracks.find(t => t.date && /\b\d{4}\b/.test(t.date))?.date.match(/\b\d{4}\b/)[0];
    const metaParts = [group.category ? `${group.category}${groupYear ? ` (${groupYear})` : ""}` : groupYear, `${group.tracks.length} song${group.tracks.length === 1 ? "" : "s"}`].filter(Boolean);
    return `
        <details class="music-folder">
            <summary>
                ${group.coverUrl ? `<img src="${group.coverUrl}" alt="${escapeHtml(group.title)} cover art">` : `<span class="folder-art"></span>`}
                <span class="folder-copy">
                    <strong>${escapeHtml(group.title)}</strong>
                    <small>${escapeHtml(metaParts.join(" / "))}</small>
                </span>
                <span class="folder-actions" style="display: flex; align-items: center; gap: 0.5rem; z-index: 2;">
                    <button class="button info-button" type="button" data-info-track="${group.tracks[0].visualIndex}" style="min-height: 2.2rem; padding: 0.2rem 0.6rem; font-size: 0.8rem;">Info</button>
                    <span class="folder-toggle">Open</span>
                </span>
            </summary>
            <div class="folder-tracks">
                ${group.tracks.map(track => `
                    <div class="folder-track-row">
                        <span>
                            <strong>${escapeHtml(track.title)}</strong>
                            <small>${escapeHtml(track.artist || "X/i\\D")}</small>
                        </span>
                        ${hasDockedPlayer ? `<button class="button primary" type="button" data-track-index="${track.visualIndex}">Play</button>` : `<audio controls controlsList="nodownload" oncontextmenu="return false;" preload="metadata" src="${track.audioUrl}"></audio>`}
                    </div>
                `).join("")}
            </div>
        </details>
    `;
}

function setupFeatured(track) {
    const featuredPlayer = document.querySelector("#featured-player");
    const featuredTitle = document.querySelector("#featured-title");
    if (!featuredPlayer || !track) return;
    featuredPlayer.src = track.audioUrl;
    if (featuredTitle) featuredTitle.textContent = `${track.title} - ${track.artist}`;
}

function setPlayerTrack(track) {
    const audio = document.querySelector("#main-audio");
    const title = document.querySelector("#player-title");
    const meta = document.querySelector("#player-meta");
    const art = document.querySelector("#player-art");
    if (!audio) return;

    audio.src = track.audioUrl;
    audio.play().catch(() => { });
    if (title) title.textContent = track.title;
    if (meta) meta.textContent = [track.artist, track.album, track.category].filter(Boolean).join(" / ");
    if (art && track.coverUrl) {
        art.src = track.coverUrl;
        art.alt = `${track.title} cover art`;
        art.hidden = false;
    }
}

async function loadBeatsManifest() {
    try {
        const response = await fetch(`beats-manifest.json?v=${Date.now()}`);
        if (!response.ok) return [];
        const beats = await response.json();
        return beats.map(beat => ({
            ...beat,
            audioUrl: encodeURI(beat.audioUrl),
            coverUrl: beat.coverUrl ? encodeURI(beat.coverUrl) : ""
        }));
    } catch {
        return [];
    }
}

async function loadBeatStore() {
    const containers = [document.querySelector("#beat-store"), document.querySelector("#beats-preview")].filter(Boolean);
    if (!containers.length) return;

    const isLocalPreview = ["", "localhost", "127.0.0.1"].includes(window.location.hostname);
    containers.forEach(container => {
        container.innerHTML = `<p class="muted">Loading beats from ${isLocalPreview ? "local manifest" : "GitHub"}...</p>`;
    });

    let beats = [];
    if (isLocalPreview) {
        beats = await loadBeatsManifest();
    } else {
        let files = [];
        try {
            files = await listFilesRecursive("Beats");
        } catch {
            files = [];
        }

        const audioFiles = files.filter(file => hasExtension(file, AUDIO_EXTENSIONS));
        beats = await Promise.all(audioFiles.map(file => metadataFor(file, files)));

        if (!beats.length) {
            beats = await loadBeatsManifest();
        }
    }

    containers.forEach(container => {
        const list = container.id === "beats-preview" ? beats.slice(0, 4) : beats;
        renderBeats(list, container);
    });
}

function openBeatInfoModal(beat) {
    const overlay = document.querySelector("#info-modal-overlay");
    const loading = document.querySelector("#modal-loading");
    const modalBody = document.querySelector("#modal-body");
    const modalTitle = document.querySelector("#modal-project-title");
    const modalMeta = document.querySelector("#modal-project-meta");

    if (!overlay || !loading || !modalBody) return;

    modalTitle.textContent = beat.title;
    modalMeta.textContent = `${beat.artist} / Beat`;

    loading.style.display = "none";
    modalBody.style.display = "block";

    document.querySelector("#modal-description").textContent = `Beat details and licensing information.`;
    document.querySelector("#modal-date").textContent = "N/A";
    document.querySelector("#modal-performers").textContent = beat.artist || "N/A";
    document.querySelector("#modal-producers").textContent = beat.artist || "N/A";
    document.querySelector("#modal-writers").textContent = "N/A";
    document.querySelector("#modal-label-credit").textContent = [
        beat.bpm && `${beat.bpm} BPM`,
        beat.key && `Key: ${beat.key}`,
        beat.license && `License: ${beat.license}`,
        beat.price && `Price: ${beat.price}`
    ].filter(Boolean).join(" | ");

    overlay.hidden = false;
}

function renderBeats(beats, container) {
    if (!beats.length) {
        container.innerHTML = "<p class=\"muted\">No beats found yet. Add audio files to the Beats folder and publish the repo.</p>";
        return;
    }

    container.innerHTML = beats.map((beat, index) => `
        <article class="beat-card">
            ${beat.coverUrl ? `<img src="${beat.coverUrl}" alt="${beat.title} cover art">` : ""}
            <div class="card-body">
                <h3>${beat.title}</h3>
                <p class="card-meta">${[beat.bpm && `${beat.bpm} BPM`, beat.key, beat.license].filter(Boolean).join(" / ") || "License details coming soon"}</p>
                <audio controls controlsList="nodownload" oncontextmenu="return false;" preload="metadata" src="${beat.audioUrl}"></audio>
                <div class="card-actions" style="display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.75rem;">
                    <a class="button primary" href="${beat.paymentUrl || `mailto:${SITE_CONFIG.contactEmail}?subject=Beat license: ${encodeURIComponent(beat.title)}`}">${beat.price ? `Buy ${beat.price}` : "Request License"}</a>
                    <div style="display: flex; gap: 0.5rem; width: 100%;">
                        <a class="button" href="${beat.audioUrl}" download style="flex: 1; min-height: 2.2rem; padding: 0.2rem 0.5rem; font-size: 0.85rem; display: inline-flex; align-items: center; justify-content: center;">Download</a>
                        <button class="button beat-info-btn" type="button" data-beat-index="${index}" style="flex: 1; min-height: 2.2rem; padding: 0.2rem 0.5rem; font-size: 0.85rem; display: inline-flex; align-items: center; justify-content: center;">Info</button>
                    </div>
                </div>
            </div>
        </article>
    `).join("");

    container.querySelectorAll(".beat-info-btn").forEach(button => {
        button.addEventListener("click", () => {
            const index = Number(button.dataset.beatIndex);
            openBeatInfoModal(beats[index]);
        });
    });
}

function loadLiveSection() {
    const player = document.querySelector("#live-player");
    const chat = document.querySelector("#live-chat");
    const vods = document.querySelector("#vod-archives");

    if (player && SITE_CONFIG.live.playerEmbed) player.innerHTML = SITE_CONFIG.live.playerEmbed;
    if (chat && SITE_CONFIG.live.chatEmbed) chat.innerHTML = SITE_CONFIG.live.chatEmbed;
    if (vods) {
        vods.innerHTML = SITE_CONFIG.live.vods.map(vod => `
            <a class="link-tile" href="${vod.url}">
                <strong>${vod.title}</strong>
                <span class="muted">${vod.date}</span>
            </a>
        `).join("");
    }
}

function getProjectKey(track) {
    if (!track) return "";
    if (track.category === "Singles") {
        return `Singles-${track.path}-${track.title}`;
    }
    return `${track.category}-${releaseNameFromPath(track)}`;
}

function playTrackFromQueue(index) {
    if (index < 0 || index >= currentTracksInView.length) return;

    playbackQueue = [...currentTracksInView];
    currentQueueIndex = index;
    isAutoplayRandom = false;
    playbackHistory = [];

    if (isShuffle) {
        generateShuffleQueue(index);
    }

    playCurrentTrack();
}

function generateShuffleQueue(startIndex) {
    const indices = Array.from({ length: playbackQueue.length }, (_, i) => i);
    const filteredIndices = indices.filter(idx => idx !== startIndex);

    for (let i = filteredIndices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [filteredIndices[i], filteredIndices[j]] = [filteredIndices[j], filteredIndices[i]];
    }

    shuffleQueue = [startIndex, ...filteredIndices];
    currentQueueIndex = 0;
}

function playCurrentTrack() {
    let trackIndex = currentQueueIndex;
    if (isShuffle) {
        trackIndex = shuffleQueue[currentQueueIndex];
    }

    if (trackIndex < 0 || trackIndex >= playbackQueue.length) return;

    const track = playbackQueue[trackIndex];

    if (currentPlayingTrack && currentPlayingTrack !== track) {
        playbackHistory.push(currentPlayingTrack);
        if (playbackHistory.length > 50) playbackHistory.shift();
    }
    currentPlayingTrack = track;

    setPlayerTrack(track);
}

function playRandomAutoplayTrack() {
    if (!allMusicTracks.length) return;

    const randomIndex = Math.floor(Math.random() * allMusicTracks.length);
    const randomTrack = allMusicTracks[randomIndex];

    if (currentPlayingTrack) {
        playbackHistory.push(currentPlayingTrack);
        if (playbackHistory.length > 50) playbackHistory.shift();
    }
    currentPlayingTrack = randomTrack;
    setPlayerTrack(randomTrack);
}

function playNextTrack() {
    const audio = document.querySelector("#main-audio");
    if (!audio) return;

    if (repeatMode === "one") {
        audio.currentTime = 0;
        audio.play().catch(() => {});
        return;
    }

    if (isAutoplayRandom) {
        playRandomAutoplayTrack();
        return;
    }

    if (currentPlayingTrack && !isShuffle) {
        const currentProjectKey = getProjectKey(currentPlayingTrack);
        const projectTracks = playbackQueue.filter(t => getProjectKey(t) === currentProjectKey);
        const isFinalSong = projectTracks.length === 0 || currentPlayingTrack.path === projectTracks[projectTracks.length - 1].path;

        if (isFinalSong && repeatMode !== "all") {
            isAutoplayRandom = true;
            playRandomAutoplayTrack();
            return;
        }
    }

    const queueLength = isShuffle ? shuffleQueue.length : playbackQueue.length;
    if (queueLength === 0) return;

    if (currentQueueIndex < queueLength - 1) {
        currentQueueIndex++;
        playCurrentTrack();
    } else {
        if (repeatMode === "all") {
            currentQueueIndex = 0;
            playCurrentTrack();
        } else {
            isAutoplayRandom = true;
            playRandomAutoplayTrack();
        }
    }
}

function playPrevTrack() {
    const audio = document.querySelector("#main-audio");
    if (!audio) return;

    if (audio.currentTime > 3) {
        audio.currentTime = 0;
        audio.play().catch(() => {});
        return;
    }

    if (isAutoplayRandom) {
        if (playbackHistory.length > 0) {
            const prevTrack = playbackHistory.pop();
            currentPlayingTrack = prevTrack;
            setPlayerTrack(prevTrack);
        } else {
            audio.currentTime = 0;
            audio.play().catch(() => {});
        }
        return;
    }

    const queueLength = isShuffle ? shuffleQueue.length : playbackQueue.length;
    if (queueLength === 0) return;

    if (currentQueueIndex > 0) {
        currentQueueIndex--;
        playCurrentTrack();
    } else {
        if (repeatMode === "all") {
            currentQueueIndex = queueLength - 1;
            playCurrentTrack();
        } else {
            audio.currentTime = 0;
            audio.play().catch(() => {});
        }
    }
}

function initPlayerControls() {
    const shuffleBtn = document.querySelector("#player-shuffle");
    const prevBtn = document.querySelector("#player-prev");
    const nextBtn = document.querySelector("#player-next");
    const repeatBtn = document.querySelector("#player-repeat");

    if (shuffleBtn) {
        shuffleBtn.addEventListener("click", () => {
            isShuffle = !isShuffle;
            if (isShuffle) {
                shuffleBtn.classList.add("active");
                shuffleBtn.textContent = "SHUF (ON)";
                shuffleBtn.title = "Shuffle (On)";

                if (playbackQueue.length > 0 && currentQueueIndex !== -1) {
                    let activeTrackIndex = currentQueueIndex;
                    if (shuffleQueue.length > 0) {
                        activeTrackIndex = shuffleQueue[currentQueueIndex];
                    }
                    generateShuffleQueue(activeTrackIndex);
                }
            } else {
                shuffleBtn.classList.remove("active");
                shuffleBtn.textContent = "SHUF";
                shuffleBtn.title = "Shuffle (Off)";

                if (playbackQueue.length > 0 && currentQueueIndex !== -1 && shuffleQueue.length > 0) {
                    currentQueueIndex = shuffleQueue[currentQueueIndex];
                }
                shuffleQueue = [];
            }
        });
    }

    if (prevBtn) {
        prevBtn.addEventListener("click", playPrevTrack);
    }

    if (nextBtn) {
        nextBtn.addEventListener("click", playNextTrack);
    }

    if (repeatBtn) {
        repeatBtn.addEventListener("click", () => {
            if (repeatMode === "none") {
                repeatMode = "all";
                repeatBtn.classList.add("active");
                repeatBtn.textContent = "REP (ALL)";
                repeatBtn.title = "Repeat (All)";
            } else if (repeatMode === "all") {
                repeatMode = "one";
                repeatBtn.classList.add("active");
                repeatBtn.textContent = "REP (ONE)";
                repeatBtn.title = "Repeat (One)";
            } else {
                repeatMode = "none";
                repeatBtn.classList.remove("active");
                repeatBtn.textContent = "REP";
                repeatBtn.title = "Repeat (Off)";
            }
        });
    }
}



