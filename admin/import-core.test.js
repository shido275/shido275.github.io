/* Node test for the importer core. Run: node admin/import-core.test.js */
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

test("planImport writes audio, metadata, cover and manifest", () => {
    const plan = core.planImport({ files: audioFiles, coverFile, form, existingManifest: [] });
    assert.equal(plan.trackCount, 2);
    assert.equal(plan.writes.length, 6);
    assert.equal(plan.warnings.length, 0);

    const kinds = plan.writes.map(write => write.kind).sort();
    assert.deepEqual(kinds, ["audio", "audio", "cover", "manifest", "metadata", "metadata"]);

    const manifestWrite = plan.writes.find(write => write.kind === "manifest");
    const parsed = JSON.parse(manifestWrite.text);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[1].title, "02 Second");

    plan.writes.forEach(write => {
        assert.equal(write.path.startsWith("Music/EPs/Test EP/") || write.path === "music-manifest.json", true);
    });
});

test("planImport warns when no cover art is supplied", () => {
    const plan = core.planImport({ files: audioFiles, coverFile: null, form, existingManifest: [] });
    assert.equal(plan.warnings.some(warning => warning.includes("No cover art")), true);
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
});

console.log(`\n${count} checks passed.`);
