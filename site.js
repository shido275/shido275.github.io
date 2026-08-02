const SITE_CONFIG = {
    owner: "shido275",
    repo: "shido275.github.io",
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

// Audio State
let allMusicTracks = [];
let playbackQueue = [];
let currentQueueIndex = -1;
let shuffleQueue = [];
let isShuffle = false;
let repeatMode = "none"; // "none" | "all" | "one"
let currentTracksInView = [];
let currentPlayingTrack = null;
let playbackHistory = [];
let isAutoplayRandom = false;

// Audio Context Web Audio State
let audioContext = null;
let analyserNode = null;
let dataArray = null;
let sourceNode = null;
let isAudioContextInitialized = false;
let isMuted = false;
let currentVolume = 0.7;

// DOM Elements cache
let audioEl = null;

document.addEventListener("DOMContentLoaded", () => {
    audioEl = document.querySelector("#main-audio");
    
    // Set Year in Footer
    const year = document.querySelector("#year");
    if (year) year.textContent = new Date().getFullYear();

    // Initialize systems
    initSPA();
    initMobileNav();
    initGlobalPlayerControls();
    initInfoModal();
    initAudioSystemOverlay();

    // Load data
    loadMusicLibrary();
    loadBeatStore();
    loadLiveSection();
});

// ==============================================
// SINGLE PAGE APPLICATION ROUTER (SPA)
// ==============================================
function initSPA() {
    window.addEventListener("hashchange", routePage);
    routePage(); // trigger initial routing
}

function routePage() {
    const rawHash = window.location.hash || "#/home";
    const parts = rawHash.split("#"); // split hash routing and anchor scrolling
    
    // Main routing path, e.g. "#/home"
    let route = parts[1] || "/home";
    if (route.startsWith("/")) {
        route = route.slice(1);
    }
    
    // Scroll target if present, e.g. "music" in "#/home#music"
    const scrollTarget = parts[2] || null;

    // View mappings
    const views = {
        "home": "view-home",
        "links": "view-links",
        "epk": "view-epk",
        "beats": "view-beats",
        "portfolio": "view-portfolio"
    };

    const targetViewId = views[route] || "view-home";

    // Toggle view visibility
    document.querySelectorAll(".view-section").forEach(view => {
        if (view.id === targetViewId) {
            view.classList.add("active");
        } else {
            view.classList.remove("active");
        }
    });

    // Update nav link active state
    document.querySelectorAll(".site-nav a").forEach(link => {
        if (link.dataset.route === route) {
            link.classList.add("active");
            link.setAttribute("aria-current", "page");
        } else {
            link.classList.remove("active");
            link.removeAttribute("aria-current");
        }
    });

    // Handle smooth scrolling to internal anchors if specified
    if (scrollTarget) {
        setTimeout(() => {
            const targetEl = document.getElementById(scrollTarget);
            if (targetEl) {
                targetEl.scrollIntoView({ behavior: "smooth" });
            }
        }, 150);
    } else {
        window.scrollTo({ top: 0, behavior: "smooth" });
    }
}

// ==============================================
// MOBILE NAVIGATION HAMBURGER MENU
// ==============================================
function initMobileNav() {
    const toggle = document.querySelector(".nav-mobile-toggle");
    const nav = document.querySelector(".site-nav");

    if (toggle && nav) {
        toggle.addEventListener("click", () => {
            const isOpen = nav.classList.toggle("open");
            toggle.setAttribute("aria-expanded", isOpen);
        });

        // Close nav menu when clicking any nav link
        nav.querySelectorAll("a").forEach(link => {
            link.addEventListener("click", () => {
                nav.classList.remove("open");
                toggle.setAttribute("aria-expanded", "false");
            });
        });
    }
}

// ==============================================
// SYSTEM HUD & AUDIO CONTEXT INITIALIZATION
// ==============================================
function initAudioSystemOverlay() {
    const overlay = document.querySelector("#audio-init-overlay");
    const initBtn = document.querySelector("#audio-init-btn");

    if (initBtn && overlay) {
        initBtn.addEventListener("click", () => {
            initializeAudioContext();
            overlay.classList.add("hidden");
            setTimeout(() => overlay.remove(), 600); // Cleanup from DOM
        });
    }
}

function initializeAudioContext() {
    if (isAudioContextInitialized) return;

    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        audioContext = new AudioContextClass();
        analyserNode = audioContext.createAnalyser();
        analyserNode.fftSize = 256;
        
        const bufferLength = analyserNode.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);

        // Connect media source
        if (audioEl) {
            sourceNode = audioContext.createMediaElementSource(audioEl);
            sourceNode.connect(analyserNode);
            analyserNode.connect(audioContext.destination);
        }

        isAudioContextInitialized = true;
        startVisualizerPaintLoop();
    } catch (e) {
        console.error("Failed to initialize Web Audio context:", e);
    }
}

// ==============================================
// CANVAS FREQUENCY WAVEFORM VISUALIZER
// ==============================================
function startVisualizerPaintLoop() {
    const canvas = document.querySelector("#global-visualizer-canvas");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    
    // Make canvas responsive
    function resizeCanvas() {
        canvas.width = canvas.parentElement.clientWidth;
        canvas.height = canvas.parentElement.clientHeight;
    }
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    function paint() {
        requestAnimationFrame(paint);

        if (!isAudioContextInitialized || !analyserNode) return;

        const width = canvas.width;
        const height = canvas.height;
        
        ctx.clearRect(0, 0, width, height);
        
        analyserNode.getByteFrequencyData(dataArray);

        // Draw cyberpunk visualizer bars
        const barWidth = (width / dataArray.length) * 1.5;
        let x = 0;

        for (let i = 0; i < dataArray.length; i++) {
            const percent = dataArray[i] / 255;
            const barHeight = percent * height * 0.9;
            
            // Draw neon gradients
            const gradient = ctx.createLinearGradient(0, height, 0, height - barHeight);
            gradient.addColorStop(0, "rgba(0, 240, 255, 0.1)");
            gradient.addColorStop(0.5, "rgba(0, 240, 255, 0.7)");
            gradient.addColorStop(1, "rgba(255, 0, 85, 0.95)");

            ctx.fillStyle = gradient;
            ctx.shadowBlur = 4;
            ctx.shadowColor = "#00f0ff";
            
            ctx.fillRect(x, height - barHeight, barWidth - 2, barHeight);
            x += barWidth;
        }
    }
    
    paint();
}

// ==============================================
// CUSTOM GLOBAL PERSISTENT PLAYER MODULE
// ==============================================
function initGlobalPlayerControls() {
    const playBtn = document.querySelector("#global-player-play");
    const prevBtn = document.querySelector("#global-player-prev");
    const nextBtn = document.querySelector("#global-player-next");
    const shuffleBtn = document.querySelector("#global-player-shuffle");
    const repeatBtn = document.querySelector("#global-player-repeat");
    const muteBtn = document.querySelector("#global-player-mute");
    const queueBtn = document.querySelector("#global-player-queue-toggle");
    
    const timeline = document.querySelector("#player-timeline");
    const timelineFill = document.querySelector("#player-timeline-fill");
    const volumeSlider = document.querySelector("#player-volume");
    const volumeFill = document.querySelector("#player-volume-fill");

    const visToggle = document.querySelector("#global-player-visualizer-toggle");
    const visWrapper = document.querySelector("#visualizer-wrapper");
    const queueDrawer = document.querySelector("#queue-drawer");
    const queueClose = document.querySelector("#queue-close");

    if (audioEl) {
        audioEl.addEventListener("ended", playNextTrack);
        audioEl.addEventListener("timeupdate", () => {
            updatePlayerTimeline(timeline, timelineFill);
        });
        audioEl.addEventListener("durationchange", () => {
            if (timeline) timeline.max = audioEl.duration || 100;
        });
        audioEl.addEventListener("play", () => {
            if (playBtn) playBtn.textContent = "PAUSE";
            if (playBtn) playBtn.title = "Pause Track";
        });
        audioEl.addEventListener("pause", () => {
            if (playBtn) playBtn.textContent = "PLAY";
            if (playBtn) playBtn.title = "Play Track";
        });
    }

    if (playBtn) {
        playBtn.addEventListener("click", () => {
            if (!isAudioContextInitialized) {
                initializeAudioContext();
            }
            togglePlayState();
        });
    }

    if (prevBtn) prevBtn.addEventListener("click", playPrevTrack);
    if (nextBtn) nextBtn.addEventListener("click", playNextTrack);
    
    if (shuffleBtn) {
        shuffleBtn.addEventListener("click", () => {
            isShuffle = !isShuffle;
            if (isShuffle) {
                shuffleBtn.classList.add("active");
                shuffleBtn.textContent = "SHUF (ON)";
                shuffleBtn.title = "Shuffle (On)";
                if (playbackQueue.length > 0 && currentQueueIndex !== -1) {
                    generateShuffleQueue(currentQueueIndex);
                }
            } else {
                shuffleBtn.classList.remove("active");
                shuffleBtn.textContent = "SHUF";
                shuffleBtn.title = "Shuffle (Off)";
            }
            renderQueueItems();
        });
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

    if (muteBtn) {
        muteBtn.addEventListener("click", toggleMute);
    }

    if (timeline) {
        timeline.addEventListener("input", () => {
            if (audioEl) {
                audioEl.currentTime = timeline.value;
                if (timelineFill) {
                    const pct = (audioEl.currentTime / audioEl.duration) * 100;
                    timelineFill.style.width = `${pct}%`;
                }
            }
        });
    }

    if (volumeSlider) {
        volumeSlider.addEventListener("input", () => {
            currentVolume = volumeSlider.value / 100;
            if (audioEl) {
                audioEl.volume = currentVolume;
                audioEl.muted = false;
            }
            isMuted = false;
            if (muteBtn) muteBtn.textContent = currentVolume === 0 ? "MUTED" : "VOL";
            if (volumeFill) volumeFill.style.width = `${volumeSlider.value}%`;
        });
    }

    if (visToggle && visWrapper) {
        visToggle.addEventListener("click", () => {
            if (!isAudioContextInitialized) {
                initializeAudioContext();
            }
            const isHidden = visWrapper.hidden;
            visWrapper.hidden = !isHidden;
            visToggle.classList.toggle("active", isHidden);
        });
    }

    if (queueBtn && queueDrawer) {
        queueBtn.addEventListener("click", () => {
            const isHidden = queueDrawer.hidden;
            queueDrawer.hidden = !isHidden;
            queueBtn.classList.toggle("active", isHidden);
            if (isHidden) {
                renderQueueItems();
            }
        });
    }

    if (queueClose && queueDrawer) {
        queueClose.addEventListener("click", () => {
            queueDrawer.hidden = true;
            if (queueBtn) queueBtn.classList.remove("active");
        });
    }

    // Home view Featured play button click binding
    const featuredPlay = document.querySelector("#featured-play-btn");
    if (featuredPlay) {
        featuredPlay.addEventListener("click", () => {
            if (allMusicTracks.length > 0) {
                // Find latest dropped track based on chronologic setup
                const latest = getLatestTrack(allMusicTracks);
                playTrackFromCatalog(latest);
            }
        });
    }
}

function togglePlayState() {
    if (!audioEl || !currentPlayingTrack) return;
    if (audioEl.paused) {
        audioEl.play().catch(() => {});
    } else {
        audioEl.pause();
    }
}

function updatePlayerTimeline(slider, fill) {
    if (!audioEl || !slider) return;
    slider.value = audioEl.currentTime;
    
    if (fill && audioEl.duration) {
        const pct = (audioEl.currentTime / audioEl.duration) * 100;
        fill.style.width = `${pct}%`;
    }

    const curTimeLabel = document.querySelector("#player-time-current");
    const totalTimeLabel = document.querySelector("#player-time-total");

    if (curTimeLabel) curTimeLabel.textContent = formatTime(audioEl.currentTime);
    if (totalTimeLabel && audioEl.duration) totalTimeLabel.textContent = formatTime(audioEl.duration);
}

function toggleMute() {
    const muteBtn = document.querySelector("#global-player-mute");
    const volumeSlider = document.querySelector("#player-volume");
    const volumeFill = document.querySelector("#player-volume-fill");

    if (!audioEl) return;

    isMuted = !isMuted;
    audioEl.muted = isMuted;

    if (muteBtn) muteBtn.textContent = isMuted ? "MUTED" : "VOL";
    
    if (volumeSlider && volumeFill) {
        if (isMuted) {
            volumeFill.style.width = "0%";
            volumeSlider.value = 0;
        } else {
            volumeFill.style.width = `${currentVolume * 100}%`;
            volumeSlider.value = currentVolume * 100;
        }
    }
}

function formatTime(secs) {
    if (isNaN(secs)) return "0:00";
    const minutes = Math.floor(secs / 60);
    const seconds = Math.floor(secs % 60);
    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
}

// ==============================================
// PLAYBACK QUEUE LOGIC
// ==============================================
function playTrackFromCatalog(track) {
    // Look up visual index or path match in view list
    const index = currentTracksInView.findIndex(t => t.path === track.path);
    if (index !== -1) {
        playTrackFromQueue(index);
    } else {
        // Fallback: direct set track if not found in current view index
        playbackQueue = [track];
        currentQueueIndex = 0;
        setPlayerTrack(track);
    }
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
    if (isShuffle && shuffleQueue.length > 0) {
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
    renderQueueItems();
}

function setPlayerTrack(track) {
    const globalPlayerBar = document.querySelector("#global-player-bar");
    const art = document.querySelector("#global-player-art");
    const title = document.querySelector("#global-player-title");
    const artist = document.querySelector("#global-player-artist");

    if (!audioEl) return;

    // Show persistent player
    if (globalPlayerBar) {
        globalPlayerBar.style.transform = "translateY(0)";
    }

    // Set element properties
    audioEl.src = track.audioUrl;
    
    // Force browser play context trigger
    if (isAudioContextInitialized && audioContext.state === "suspended") {
        audioContext.resume();
    }

    audioEl.play().catch(e => {
        console.log("Audio play request failed due to user-interaction security limits:", e);
    });

    if (title) title.textContent = track.title;
    if (artist) artist.textContent = [track.artist, track.album, track.category].filter(Boolean).join(" / ");
    
    if (art) {
        art.src = track.coverUrl || "assets/profile-avatar.png";
        art.alt = `${track.title} cover art`;
    }
}

function playNextTrack() {
    if (!audioEl) return;

    if (repeatMode === "one") {
        audioEl.currentTime = 0;
        audioEl.play().catch(() => {});
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
    if (!audioEl) return;

    if (audioEl.currentTime > 3) {
        audioEl.currentTime = 0;
        audioEl.play().catch(() => {});
        return;
    }

    if (isAutoplayRandom) {
        if (playbackHistory.length > 0) {
            const prevTrack = playbackHistory.pop();
            currentPlayingTrack = prevTrack;
            setPlayerTrack(prevTrack);
        } else {
            audioEl.currentTime = 0;
            audioEl.play().catch(() => {});
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
            audioEl.currentTime = 0;
            audioEl.play().catch(() => {});
        }
    }
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

function getProjectKey(track) {
    if (!track) return "";
    if (track.category === "Singles") {
        return `Singles-${track.path}-${track.title}`;
    }
    return `${track.category}-${releaseNameFromPath(track)}`;
}

function releaseNameFromPath(track) {
    if (track.album) return track.album;
    const parts = String(track.path || "").split("/");
    if (track.category === "EPs") return parts[2] || track.category;
    if (track.category === "Albums and Mixtapes") return parts[2] || track.category;
    if (track.category === "Compilations") return parts[2] || track.category;
    return track.category;
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

function renderQueueItems() {
    const listItems = document.querySelector("#queue-list-items");
    if (!listItems) return;

    if (playbackQueue.length === 0) {
        listItems.innerHTML = "<p class='muted' style='padding: 1rem; text-align: center;'>Queue is empty</p>";
        return;
    }

    listItems.innerHTML = playbackQueue.map((track, index) => {
        let actualIndex = index;
        if (isShuffle && shuffleQueue.length > 0) {
            actualIndex = shuffleQueue[index];
        }
        
        const isCurrent = currentPlayingTrack && currentPlayingTrack.path === playbackQueue[actualIndex].path;

        return `
            <div class="queue-item ${isCurrent ? 'active' : ''}" onclick="playQueueTrackAtIndex(${index})">
                <img src="${playbackQueue[actualIndex].coverUrl || 'assets/profile-avatar.png'}" alt="cover">
                <div class="queue-item-meta">
                    <span class="queue-item-title">${escapeHtml(playbackQueue[actualIndex].title)}</span>
                    <span class="queue-item-artist">${escapeHtml(playbackQueue[actualIndex].artist)}</span>
                </div>
            </div>
        `;
    }).join("");
}

// Globally bindable helper function for onclick triggers
window.playQueueTrackAtIndex = function(index) {
    currentQueueIndex = index;
    playCurrentTrack();
};

// ==============================================
// DATA FETCHING & RENDERING (MUSIC & BEATS)
// ==============================================
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
        try {
            const allGroups = await Promise.all(MUSIC_FOLDERS.map(buildTracks));
            tracks = allGroups.flat();
        } catch (e) {
            console.warn("GitHub fetch failed, loading manifest instead.");
        }
        if (!tracks.length) tracks = await loadMusicManifest();
    }

    if (!tracks.length) {
        library.innerHTML = "<p class=\"muted\">No music files found. Please scan or generate manifest.</p>";
        return;
    }

    allMusicTracks = tracks;
    setupTabs();
    setupSearch();
    filterAndRenderMusic();

    // Populate the latest drop featured card
    const latest = getLatestTrack(tracks);
    setupFeatured(latest);
}

function getLatestTrack(tracks) {
    if (!tracks.length) return null;
    const sortedByDate = [...tracks].sort((a, b) => {
        const timeA = a.date ? new Date(a.date).getTime() : 0;
        const timeB = b.date ? new Date(b.date).getTime() : 0;
        return timeB - timeA;
    });
    return sortedByDate[0];
}

function setupFeatured(track) {
    const featuredTitle = document.querySelector("#featured-title");
    if (featuredTitle && track) {
        featuredTitle.textContent = `${track.title} - ${track.artist}`;
    }
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
        
        // Dynamic filter
        const category = button.dataset.category;
        filterMusicCategory(category);
    });
}

let currentMusicCategory = "All";
let currentMusicSearch = "";

function setupSearch() {
    const searchInput = document.querySelector("#music-search");
    if (!searchInput) return;

    searchInput.addEventListener("input", event => {
        currentMusicSearch = event.target.value;
        filterAndRenderMusic();
    });
}

function filterMusicCategory(category) {
    currentMusicCategory = category;
    filterAndRenderMusic();
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

    // Apply limit if defined (e.g. limit for EPK view check)
    const limit = Number(library.dataset.limit || 0);
    const visibleTracks = limit ? filtered.slice(0, limit) : filtered;

    renderTracks(visibleTracks, library);
}

function renderTracks(tracks, container) {
    if (!tracks.length) {
        container.innerHTML = `<p class="muted" style="grid-column: 1 / -1; text-align: center; padding: 2.5rem; font-family: 'Share Tech Mono', monospace; letter-spacing: 0.05em; text-transform: uppercase;">No matching tracks found.</p>`;
        return;
    }

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

    // Sort tracks inside folders by trackNumber
    releaseGroups.forEach(group => {
        group.tracks.sort((a, b) => {
            const numA = Number(a.trackNumber || 0);
            const numB = Number(b.trackNumber || 0);
            if (numA !== numB) return numA - numB;
            return a.title.localeCompare(b.title);
        });
    });

    // Chronology sorting helper
    const sortByChronology = (a, b) => {
        const yearA = a.year || (a.date ? a.date.split('-')[0] : "");
        const yearB = b.year || (b.date ? b.date.split('-')[0] : "");
        if (yearA !== yearB) {
            return yearB.localeCompare(yearA);
        }
        return b.date.localeCompare(a.date);
    };

    const sortedSingles = [...singles].sort(sortByChronology);
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

    // Formordered linear index mapping
    const orderedTracks = [];
    sortedSingles.forEach(track => orderedTracks.push(track));
    sortedGroups.forEach(group => {
        group.tracks.forEach(track => orderedTracks.push(track));
    });

    orderedTracks.forEach((track, index) => {
        track.visualIndex = index;
    });

    currentTracksInView = orderedTracks;

    const singlesHtml = sortedSingles.map(track => renderSingleTrackCard(track)).join("");
    const groupHtml = sortedGroups.map(group => renderReleaseFolder(group)).join("");
    container.innerHTML = singlesHtml + groupHtml;

    // Bind event listeners on rendering
    container.querySelectorAll("[data-track-index]").forEach(button => {
        button.addEventListener("click", () => {
            const index = Number(button.dataset.trackIndex);
            playTrackFromQueue(index);
        });
    });

    container.querySelectorAll(".info-button").forEach(button => {
        button.addEventListener("click", (event) => {
            event.stopPropagation();
            event.preventDefault();
            const trackIndex = Number(button.dataset.infoTrack);
            openInfoModal(currentTracksInView[trackIndex]);
        });
    });
}

function renderSingleTrackCard(track) {
    const metaParts = [track.artist, track.album, track.category ? `${track.category}${track.year ? ` (${track.year})` : ""}` : track.year].filter(Boolean);
    return `
        <article class="release-card">
            ${track.coverUrl ? `<img src="${track.coverUrl}" alt="${escapeHtml(track.title)} cover art">` : ""}
            <div class="card-body">
                <h3>${escapeHtml(track.title)}</h3>
                <p class="card-meta">${escapeHtml(metaParts.join(" / "))}</p>
                <div class="card-actions" style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
                    <button class="button primary" type="button" data-track-index="${track.visualIndex}">Play</button>
                    <button class="button info-button" type="button" data-info-track="${track.visualIndex}">Info</button>
                </div>
            </div>
        </article>
    `;
}

function renderReleaseFolder(group) {
    const groupYear = group.tracks.find(t => t.year)?.year || (group.tracks.find(t => t.date && /\b\d{4}\b/.test(t.date))?.date.match(/\b\d{4}\b/)?.[0] || "");
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
                        <button class="button primary" type="button" data-track-index="${track.visualIndex}">Play</button>
                    </div>
                `).join("")}
            </div>
        </details>
    `;
}

// INFO MODAL ACTIONS
function initInfoModal() {
    const overlay = document.querySelector("#info-modal-overlay");
    const closeBtn = document.querySelector("#info-modal-close");

    if (closeBtn && overlay) {
        closeBtn.addEventListener("click", () => {
            overlay.hidden = true;
        });

        overlay.addEventListener("click", (event) => {
            if (event.target === overlay) {
                overlay.hidden = true;
            }
        });
    }
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

// ==============================================
// BEAT STORE LOADERS
// ==============================================
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
        container.innerHTML = `<p class="muted">Loading beats...</p>`;
    });

    let beats = [];
    if (isLocalPreview) {
        beats = await loadBeatsManifest();
    } else {
        try {
            const files = await listFilesRecursive("Beats");
            const audioFiles = files.filter(file => hasExtension(file, AUDIO_EXTENSIONS));
            beats = await Promise.all(audioFiles.map(file => metadataFor(file, files)));
        } catch (e) {
            console.warn("Failed fetching beats from GitHub contents, loading manifest.");
        }
        if (!beats.length) beats = await loadBeatsManifest();
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
        container.innerHTML = "<p class=\"muted\">No beats found.</p>";
        return;
    }

    container.innerHTML = beats.map((beat, index) => {
        const beatObjString = encodeURIComponent(JSON.stringify(beat));
        return `
            <article class="beat-card">
                ${beat.coverUrl ? `<img src="${beat.coverUrl}" alt="${escapeHtml(beat.title)} cover art">` : ""}
                <div class="card-body">
                    <h3>${escapeHtml(beat.title)}</h3>
                    <p class="card-meta">${[beat.bpm && `${beat.bpm} BPM`, beat.key, beat.license].filter(Boolean).join(" / ") || "License details coming soon"}</p>
                    <div class="card-actions" style="display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.75rem;">
                        <button class="button primary" onclick="playBeatPreview('${beatObjString}')">Listen Preview</button>
                        <a class="button" href="${beat.paymentUrl || `mailto:${SITE_CONFIG.contactEmail}?subject=Beat license: ${encodeURIComponent(beat.title)}`}">${beat.price ? `Buy ${beat.price}` : "Request License"}</a>
                        <div style="display: flex; gap: 0.5rem; width: 100%;">
                            <a class="button" href="${beat.audioUrl}" download style="flex: 1; min-height: 2.2rem; padding: 0.2rem 0.5rem; font-size: 0.85rem; display: inline-flex; align-items: center; justify-content: center;">Download</a>
                            <button class="button beat-info-btn" type="button" data-beat-index="${index}" style="flex: 1; min-height: 2.2rem; padding: 0.2rem 0.5rem; font-size: 0.85rem; display: inline-flex; align-items: center; justify-content: center;">Info</button>
                        </div>
                    </div>
                </div>
            </article>
        `;
    }).join("");

    container.querySelectorAll(".beat-info-btn").forEach(button => {
        button.addEventListener("click", () => {
            const index = Number(button.dataset.beatIndex);
            openBeatInfoModal(beats[index]);
        });
    });
}

// Play Beat Preview dynamically through the main player
window.playBeatPreview = function(beatObjString) {
    const beat = JSON.parse(decodeURIComponent(beatObjString));
    
    // Convert beat object style to match track catalog
    const track = {
        title: beat.title,
        artist: beat.artist || "X/i\\D",
        album: "Beat Catalog",
        category: "Beats",
        audioUrl: beat.audioUrl,
        coverUrl: beat.coverUrl,
        path: beat.path
    };

    currentTracksInView = [track];
    playbackQueue = [track];
    currentQueueIndex = 0;
    
    setPlayerTrack(track);
};

// ==============================================
// LIVE SECTIONS ARCHIVES
// ==============================================
function loadLiveSection() {
    const player = document.querySelector("#live-player");
    const chat = document.querySelector("#live-chat");
    const vods = document.querySelector("#vod-archives");

    if (player && SITE_CONFIG.live.playerEmbed) player.innerHTML = SITE_CONFIG.live.playerEmbed;
    if (chat && SITE_CONFIG.live.chatEmbed) chat.innerHTML = SITE_CONFIG.live.chatEmbed;
    if (vods) {
        vods.innerHTML = SITE_CONFIG.live.vods.map(vod => `
            <a class="link-tile" href="${vod.url}">
                <strong>${escapeHtml(vod.title)}</strong>
                <span class="muted">${escapeHtml(vod.date)}</span>
            </a>
        `).join("");
    }
}
