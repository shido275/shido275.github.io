/* Pure-function checks for the background and beat store planners.
   Run: node admin/background-beat.test.js */
const assert = require("assert");
const path = require("path");
const B = require(path.join(__dirname, "background-core.js"));
const K = require(path.join(__dirname, "beat-core.js"));

let pass = 0;
const fails = [];
function test(name, fn) {
    try {
        fn();
        pass += 1;
        console.log(`  ok - ${name}`);
    } catch (error) {
        fails.push(`${name}: ${error.message}`);
        console.log(`  FAIL - ${name}\n      ${error.message}`);
    }
}

const file = (name, size = 1024) => ({ name, size });

/* --------------------------------------------------------------- background */

test("background: uploads go to assets/backgrounds and the registry lists them", () => {
    const plan = B.planBackground({
        items: [{ file: file("Auckland Skyline.JPG") }, { src: "https://cdn.example.com/loop.mp4", kind: "video" }],
        settings: { interval: 12, transition: "cut", dim: 0.4, blur: 6 },
        existing: null
    });
    const paths = plan.writes.map(write => write.path);
    assert(paths.includes("assets/backgrounds/auckland-skyline.jpg"), paths.join(","));
    assert(paths.includes("backgrounds.json"));
    assert.equal(plan.doc.items.length, 2);
    assert.equal(plan.doc.items[0].kind, "image");
    assert.equal(plan.doc.items[1].kind, "video");
    assert.equal(plan.doc.interval, 12);
    assert.equal(plan.doc.transition, "cut");
    assert.equal(plan.doc.dim, 0.4);
    assert.deepEqual(JSON.parse(plan.writes.find(write => write.path === "backgrounds.json").text), plan.doc);
});

test("background: two files with the same name get distinct paths", () => {
    const plan = B.planBackground({ items: [{ file: file("bg.jpg") }, { file: file("BG.jpg") }], settings: {} });
    const names = plan.writes.filter(write => write.file).map(write => write.path);
    assert.equal(names.length, 2);
    assert.notEqual(names[0], names[1]);
});

test("background: javascript:, plain http:// and unknown files are refused", () => {
    const plan = B.planBackground({
        items: [
            { src: "javascript:alert(1)" },
            { src: "http://insecure.example.com/a.jpg" },
            { file: file("notes.txt") }
        ],
        settings: {}
    });
    assert.equal(plan.doc.items.length, 0);
    assert.equal(plan.warnings.filter(warning => /not an image|plain http|not a usable background/.test(warning)).length, 3);
});

test("background: a removed upload is deleted in the same commit", () => {
    const plan = B.planBackground({
        items: [{ src: "assets/backgrounds/b.jpg" }],
        settings: {},
        existing: { items: [{ src: "assets/backgrounds/a.jpg" }, { src: "https://elsewhere.com/x.jpg" }] }
    });
    assert.deepEqual(plan.writes.filter(write => write.delete).map(write => write.path), ["assets/backgrounds/a.jpg"]);
});

test("background: settings are clamped and read back", () => {
    const plan = B.planBackground({ items: [], settings: { interval: 900, dim: 5, blur: -3 } });
    assert.equal(plan.doc.interval, 120);
    assert.equal(plan.doc.dim, 0.95);
    assert.equal(plan.doc.blur, 0);
    const read = B.readBackground({ enabled: false, interval: "15", items: [{ src: "assets/backgrounds/x.gif" }, { nope: true }] });
    assert.equal(read.enabled, false);
    assert.equal(read.interval, 15);
    assert.equal(read.items.length, 1);
    assert.equal(read.items[0].kind, "image");
    assert.equal(B.kindOf("clip.MOV"), "video");
    assert.equal(B.kindOf("pic.WEBP"), "image");
});

test("background: a disabled list still publishes the setting", () => {
    const plan = B.planBackground({ items: [{ src: "https://x.test/a.jpg" }], settings: { enabled: false } });
    assert.equal(plan.doc.enabled, false);
    assert.equal(plan.doc.items.length, 1);
});

/* -------------------------------------------------------------------- beats */

test("beat: audio, metadata, cover and manifest are all written", () => {
    const plan = K.planBeats({
        beats: [{
            file: file("New Jazz - s0l0.mp3", 5 * 1024 * 1024),
            coverFile: file("art.png"),
            title: "New Jazz + West Coast Type Beat - s0l0",
            artist: "X/i\\D, andrzxz",
            bpm: "94 bpm",
            key: "D minor",
            price: "$30",
            license: "Non-exclusive MP3/WAV",
            paymentUrl: "https://paypal.me/YOURNAME/30",
            folder: "s0l0"
        }],
        existing: []
    });
    const paths = plan.writes.map(write => write.path);
    assert(paths.includes("Beats/s0l0/New Jazz - s0l0.mp3"), paths.join(","));
    assert(paths.includes("Beats/s0l0/New Jazz - s0l0.json"), paths.join(","));
    assert(paths.includes("Beats/s0l0/cover.png"), paths.join(","));
    assert(paths.includes("beats-manifest.json"));

    const manifest = JSON.parse(plan.writes.find(write => write.path === "beats-manifest.json").text);
    assert.equal(manifest.length, 1);
    assert.equal(manifest[0].bpm, 94);
    assert.equal(manifest[0].audioUrl, "Beats/s0l0/New Jazz - s0l0.mp3");
    assert.equal(manifest[0].path, manifest[0].audioUrl);
    assert.equal(manifest[0].coverUrl, "Beats/s0l0/cover.png");
    assert.equal(manifest[0].paymentUrl, "https://paypal.me/YOURNAME/30");
    assert.equal(manifest[0].license, "Non-exclusive MP3/WAV");
});

test("beat: order is the array order and the folder defaults to the title", () => {
    const plan = K.planBeats({
        beats: [
            { file: file("b.mp3"), title: "Second One" },
            { file: file("a.mp3"), title: "First One" }
        ],
        existing: []
    });
    assert.deepEqual(plan.entries.map(entry => entry.title), ["Second One", "First One"]);
    assert(plan.entries[0].audioUrl.startsWith("Beats/second-one/"), plan.entries[0].audioUrl);
});

test("beat: removing a published beat deletes its files", () => {
    const plan = K.planBeats({
        beats: [],
        existing: [{
            title: "Old",
            audioUrl: "Beats/old/Old.mp3",
            path: "Beats/old/Old.mp3",
            coverUrl: "Beats/old/cover.jpg"
        }]
    });
    assert.deepEqual(
        plan.writes.filter(write => write.delete).map(write => write.path).sort(),
        ["Beats/old/Old.json", "Beats/old/Old.mp3", "Beats/old/cover.jpg"]
    );
});

test("beat: a beat without a title or audio is refused", () => {
    const plan = K.planBeats({ beats: [{ file: file("x.mp3") }, { title: "No audio" }], existing: [] });
    assert.equal(plan.entries.length, 0);
    assert.equal(plan.warnings.filter(warning => /no title|no audio/i.test(warning)).length, 2);
});

test("beat: a non-audio file is reported, not uploaded", () => {
    const plan = K.planBeats({ beats: [{ file: file("cover.jpg"), title: "Wrong" }], existing: [] });
    assert.equal(plan.entries.length, 0);
    assert.match(plan.warnings[0], /not audio/);
});

test("beat: an existing beat keeps its files and order", () => {
    const existing = [{ title: "Kept", path: "Beats/kept/Kept.mp3", audioUrl: "Beats/kept/Kept.mp3", bpm: 90 }];
    const read = K.readBeats(existing);
    const plan = K.planBeats({ beats: read, existing });
    assert.equal(plan.writes.filter(write => write.delete).length, 0);
    assert.equal(plan.entries[0].audioUrl, "Beats/kept/Kept.mp3");
    assert.equal(plan.entries[0].folder, undefined);
    assert.equal(plan.entries[0].bpm, 90);
});

test("beat: published entries read back with their folder", () => {
    const read = K.readBeats([{ title: "B", path: "Beats/s0l0/B.mp3", bpm: 94, price: "$30" }]);
    assert.equal(read[0].folder, "s0l0");
    assert.equal(K.folderOf("Beats/x/y.mp3"), "x");
    assert.equal(K.folderOf("Music/x/y.mp3"), "");
    assert.equal(K.normalizeBpm("1,000"), 1000);
    assert.equal(K.normalizeBpm(""), "");
});

console.log(`\n${fails.length ? "FAILED" : "all passed"}: ${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
