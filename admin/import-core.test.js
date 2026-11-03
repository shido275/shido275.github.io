/* Node tests for the admin core. Run: node admin/import-core.test.js */
const assert = require("node:assert");
const core = require("./import-core.js");

let count = 0;

function test(name, fn) {
    fn();
    count += 1;
    console.log(`ok ${count} - ${name}`);
}

const form = {
    category: "EPs",
    release: "Test EP",
    album: "",
    artist: "X/i\\D",
    date: "2026-11-03",
    titles: {},
    trackNumbers: {}
};

const audioFiles = [
    { name: "02 Second.wav", size: 2048 },
    { name: "01 First.wav", size: 1024 }
];
const coverFile = { name: "cover.jpg", size: 4096 };

/* ------------------------------------------------------------------ releases */

test("buildEntries fills album, order, cover and year", () => {
    const entries = core.buildEntries({
        ...form,
        tracks: [
            { fileName: "01 First.wav", title: "First", trackNumber: 1 },
            { fileName: "02 Second.wav", title: "Second", trackNumber: 2 }
        ],
        coverName: "cover.jpg"
    });
    assert.equal(entries.length, 2);
    assert.equal(entries[0].album, "Test EP");
    assert.equal(entries[0].category, "EPs");
    assert.equal(entries[0].trackNumber, 1);
    assert.equal(entries[1].trackNumber, 2);
    assert.equal(entries[0].coverUrl, "Music/EPs/Test EP/cover.jpg");
    assert.equal(entries[0].path, "Music/EPs/Test EP/01 First.wav");
    assert.equal(entries[0].year, "2026");
});

test("singles get a Single album and no track number", () => {
    const entries = core.buildEntries({
        ...form,
        category: "Singles",
        release: "Loose Track",
        tracks: [{ fileName: "Loose Track.wav", title: "Loose Track", trackNumber: 1 }],
        coverName: ""
    });
    assert.equal(entries[0].album, "Single");
    assert.equal("trackNumber" in entries[0], false);
});

test("sortManifest puts singles first then release order", () => {
    const sorted = core.sortManifest([
        { category: "EPs", album: "B", title: "b", trackNumber: 1 },
        { category: "Singles", album: "Single", title: "s" },
        { category: "EPs", album: "B", title: "a", trackNumber: 2 },
        { category: "Albums and Mixtapes", album: "A", title: "x", trackNumber: 1 }
    ]);
    assert.deepEqual(sorted.map(item => item.title), ["s", "b", "a", "x"]);
});

test("mergeManifest replaces duplicate paths without duplicating", () => {
    const existing = [
        { path: "Music/EPs/Test EP/01 First.wav", title: "Old", category: "EPs", album: "Test EP", trackNumber: 1 },
        { path: "Music/Singles/Keep.wav", title: "Keep", category: "Singles", album: "Single" }
    ];
    const incoming = [{ path: "Music/EPs/Test EP/01 First.wav", title: "New", category: "EPs", album: "Test EP", trackNumber: 1 }];
    const result = core.mergeManifest(existing, incoming);
    assert.equal(result.manifest.length, 2);
    assert.equal(result.added, 1);
    assert.equal(result.replaced, 1);
    assert.equal(result.manifest.find(item => item.title === "New").title, "New");
});

test("repo paths outside Music/ or with traversal are rejected", () => {
    assert.throws(() => core.assertRepoPath("../evil.wav"));
    assert.throws(() => core.assertRepoPath("/etc/passwd"));
    assert.throws(() => core.assertRepoPath("Music//evil.wav"));
    assert.doesNotThrow(() => core.assertRepoPath("Music/EPs/Test EP/01 First.wav"));
});

test("unsafe file name characters are stripped", () => {
    const cleaned = core.safeSegment('bad/name:with*chars?"<>|.wav');
    assert.equal(/[\\/:*?"<>|]/.test(cleaned), false);
    assert.throws(() => core.safeSegment(".."));
});

test("planImport writes audio, metadata, cover, credits and manifest", () => {
    const completeForm = { ...form, description: "Late night tape.", performers: "X/i\\D", producers: "X/i\\D", writers: "X/i\\D" };
    const plan = core.planImport({ files: audioFiles, coverFile, form: completeForm, existingManifest: [] });
    assert.equal(plan.trackCount, 2);
    assert.equal(plan.writes.length, 7);
    assert.equal(plan.warnings.length, 0);

    const kinds = plan.writes.map(write => write.kind).sort();
    assert.deepEqual(kinds, ["audio", "audio", "cover", "info", "manifest", "metadata", "metadata"]);

    const manifestWrite = plan.writes.find(write => write.kind === "manifest");
    const parsed = JSON.parse(manifestWrite.text);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[1].title, "02 Second");

    plan.writes.forEach(write => {
        assert.equal(write.path.startsWith("Music/EPs/Test EP/") || write.path === "music-manifest.json", true);
    });
});

test("planImport writes info.json with the keys the site modal reads", () => {
    const plan = core.planImport({
        files: audioFiles,
        coverFile,
        form: {
            ...form,
            description: "Late night tape.",
            performers: "X/i\\D, T Swerve",
            producers: "X/i\\D; Kyo",
            writers: "X/i\\D",
            label: "FAKE Entertainment",
            genre: "Alternative hip-hop",
            explicit: true
        },
        existingManifest: []
    });

    const infoWrite = plan.writes.find(write => write.kind === "info");
    assert.equal(infoWrite.path, "Music/EPs/Test EP/info.json");

    const info = JSON.parse(infoWrite.text);
    assert.equal(info.description, "Late night tape.");
    assert.deepEqual(info.performers, ["X/i\\D", "T Swerve"]);
    assert.deepEqual(info.producers, ["X/i\\D", "Kyo"]);
    assert.deepEqual(info.writers, ["X/i\\D"]);
    assert.equal(info.label, "FAKE Entertainment");
    assert.equal(info.releaseDate, "2026-11-03");
    assert.equal(info.explicit, true);
    assert.equal(info.cover, "cover.jpg");
});

test("planImport warns when description and credits are empty", () => {
    const plan = core.planImport({ files: audioFiles, coverFile: null, form, existingManifest: [] });
    assert.equal(plan.warnings.some(warning => warning.includes("No cover art")), true);
    assert.equal(plan.warnings.some(warning => warning.includes("No release description")), true);
    assert.equal(plan.warnings.some(warning => warning.includes("No credits")), true);
    assert.equal(plan.entries[0].coverUrl, "");
});

test("planImport refuses an empty selection", () => {
    assert.throws(() => core.planImport({ files: [], coverFile: null, form, existingManifest: [] }), /No audio files/);
});

test("nextTrackNumber continues an existing release", () => {
    const manifest = [
        { path: "Music/EPs/Test EP/a.wav", trackNumber: 4 },
        { path: "Music/EPs/Test EP/b.wav", trackNumber: 5 }
    ];
    assert.equal(core.nextTrackNumber(manifest, "Music/EPs/Test EP"), 6);
    assert.equal(core.nextTrackNumber([], "Music/EPs/Nothing"), 1);
});

test("branch and commit labels are readable", () => {
    assert.equal(core.suggestBranchName("STUNTIN SZN"), `imports/stuntin-szn-${new Date().toISOString().slice(0, 10)}`);
    assert.equal(core.commitMessage({ category: "Singles", release: "Loose Track" }, 1), 'Import single "Loose Track" (1 track)');
    assert.equal(core.formatBytes(2048), "2.0 KB");
    assert.equal(core.suggestToolBranch("EPK Photos"), `admin/epk-photos-${new Date().toISOString().slice(0, 10)}`);
});

/* --------------------------------------------------------------------- media */

test("parseYouTube reads watch, short, embed and playlist links", () => {
    assert.equal(core.parseYouTube("https://www.youtube.com/watch?v=dQw4w9WgXcQ").id, "dQw4w9WgXcQ");
    assert.equal(core.parseYouTube("https://youtu.be/dQw4w9WgXcQ").id, "dQw4w9WgXcQ");
    assert.equal(core.parseYouTube("https://www.youtube.com/embed/dQw4w9WgXcQ").id, "dQw4w9WgXcQ");
    assert.equal(core.parseYouTube("https://www.youtube.com/shorts/dQw4w9WgXcQ").id, "dQw4w9WgXcQ");
    assert.equal(core.parseYouTube("https://www.youtube.com/playlist?list=PL_JkO-8YJpHzbTLOgN46q0W_3Z6D7hFvB").playlist, "PL_JkO-8YJpHzbTLOgN46q0W_3Z6D7hFvB");
    assert.equal(core.parseYouTube("not a link"), null);
    assert.equal(core.parseVimeo("https://vimeo.com/123456789"), "123456789");
});

test("planMedia files uploads under assets and indexes them", () => {
    const plan = core.planMedia({
        photos: [
            { file: { name: "Press Shot 1.JPG", size: 5000 }, caption: "Studio", credit: "Photo: Kyo" },
            { src: "assets/press-photo-2.svg", caption: "Live" }
        ],
        videos: [
            { title: "4LLR1Z3", kind: "Music Video", url: "https://youtu.be/dQw4w9WgXcQ", date: "2026-01-02" },
            { title: "Cyberia set", kind: "Performance", url: "https://vimeo.com/123456789" }
        ],
        existing: null
    });

    assert.equal(plan.photoCount, 2);
    assert.equal(plan.videoCount, 2);

    const photoWrite = plan.writes.find(write => write.kind === "photo");
    assert.equal(photoWrite.path, "assets/photos/photo-press-shot-1.jpg");

    const doc = plan.doc;
    assert.equal(doc.photos[0].src, "assets/photos/photo-press-shot-1.jpg");
    assert.equal(doc.photos[0].caption, "Studio");
    assert.equal(doc.photos[1].src, "assets/press-photo-2.svg");
    assert.equal(doc.videos[0].source, "youtube");
    assert.equal(doc.videos[0].videoId, "dQw4w9WgXcQ");
    assert.equal(doc.videos[1].source, "vimeo");
    assert.equal(doc.slideshow.autoplay, true);

    const indexWrite = plan.writes.find(write => write.kind === "media-index");
    assert.equal(indexWrite.path, "epk-media.json");
    assert.equal(JSON.parse(indexWrite.text).videos.length, 2);
});

test("planMedia keeps a playlist entry and warns about bad video links", () => {
    const plan = core.planMedia({
        photos: [],
        videos: [
            { title: "Everything", url: "https://www.youtube.com/playlist?list=PL_JkO-8YJpHzbTLOgN46q0W_3Z6D7hFvB" },
            { title: "Broken", url: "https://example.com/not-a-video" }
        ],
        existing: null
    });
    assert.equal(plan.doc.videos.length, 1);
    assert.equal(plan.doc.videos[0].source, "youtube-playlist");
    assert.equal(plan.doc.videos[0].playlist, "PL_JkO-8YJpHzbTLOgN46q0W_3Z6D7hFvB");
    assert.equal(plan.warnings.some(warning => warning.includes("not a YouTube or Vimeo link")), true);
    assert.equal(plan.warnings.some(warning => warning.includes("No photos queued")), true);
});

test("planMedia survives an empty EPK and keeps autoplay preference", () => {
    const plan = core.planMedia({ photos: [], videos: [], existing: { slideshow: { autoplay: false, interval: 4000 } } });
    assert.deepEqual(plan.doc.photos, []);
    assert.deepEqual(plan.doc.videos, []);
    assert.equal(plan.doc.slideshow.autoplay, false);
    assert.equal(plan.doc.slideshow.interval, 4000);
    assert.equal(plan.writes.length, 1);
});

/* --------------------------------------------------------------------- links */

test("link URLs are normalised and unsafe ones dropped", () => {
    assert.equal(core.isSafeUrl("javascript:alert(1)"), false);
    assert.equal(core.isSafeUrl("https://spotify.com"), true);
    assert.equal(core.isSafeUrl("#/epk"), true);
    assert.equal(core.isSafeUrl("mailto:a@b.com"), true);
    assert.equal(core.normalizeUrl("example.com/artist"), "https://example.com/artist");
    assert.equal(core.normalizeUrl("#/beats"), "#/beats");
});

test("planLinks builds the four groups plus quick socials", () => {
    const plan = core.planLinks({
        doc: {
            featured: [{ label: "Listen Now", url: "#/home#music", description: "Catalog", accent: "cyan" }],
            platforms: [{ label: "Spotify", url: "open.spotify.com/artist/x" }],
            socials: [{ label: "Instagram", url: "https://instagram.com/x", handle: "@x" }],
            business: [{ label: "Booking", url: "mailto:shidomusic275@gmail.com" }],
            quickSocials: [{ label: "YouTube", url: "https://youtube.com/@xidmusic" }]
        }
    });

    const doc = JSON.parse(plan.writes[0].text);
    assert.equal(doc.featured[0].accent, "cyan");
    assert.equal(doc.platforms[0].url, "https://open.spotify.com/artist/x");
    assert.equal(doc.socials[0].handle, "@x");
    assert.equal(doc.business[0].url, "mailto:shidomusic275@gmail.com");
    assert.equal(doc.quickSocials.length, 1);
    assert.equal(plan.linkCount, 5);
    assert.equal(plan.warns === undefined, true);
});

test("planLinks drops javascript links and blank rows with warnings", () => {
    const plan = core.planLinks({
        doc: {
            featured: [{ label: "Bad", url: "javascript:alert(1)" }, { label: "", url: "https://x.com" }],
            platforms: [],
            socials: [],
            business: [{ label: "No url", url: "" }]
        }
    });
    assert.equal(plan.doc.featured.length, 0);
    assert.equal(plan.doc.business.length, 0);
    assert.equal(plan.warnings.length >= 3, true);
    assert.equal(plan.warnings.some(warning => warning.includes("unsupported URL")), true);
    assert.equal(plan.warnings.some(warning => warning.includes("Every group is empty")), true);
});

console.log(`\n${count} checks passed.`);
