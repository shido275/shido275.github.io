/* Checks for the browser ZIP writer: the bytes it produces must be a real ZIP.
   The archive is parsed back here in plain JavaScript - local headers, stored
   data, central directory and EOCD - so the test needs nothing but Node.
   Run: node admin/download.test.js */
const assert = require("assert");
const path = require("path");
const D = require(path.join(__dirname, "..", "download.js"));

let count = 0;
function test(name, fn) {
    fn();
    count += 1;
    console.log(`ok ${count} - ${name}`);
}

const enc = (text) => new Uint8Array(Buffer.from(text, "utf8"));

/* Mirrors what downloadZip does, minus the DOM, so the archive can be checked. */
function buildZip(entries) {
    const stamp = { time: 0, day: 0x51 << 5 };
    const parts = [];
    const records = [];
    let offset = 0;
    entries.forEach(entry => {
        const bytes = enc(entry.body);
        const record = {
            name: entry.name,
            crc: D.crc32(bytes),
            size: bytes.length,
            offset,
            time: stamp.time,
            day: stamp.day
        };
        const header = D.localHeader(record);
        parts.push(header, bytes);
        records.push(record);
        offset += header.length + bytes.length;
    });
    const centralStart = offset;
    let centralSize = 0;
    records.forEach(record => {
        const data = D.centralRecord(record);
        parts.push(data);
        centralSize += data.length;
    });
    parts.push(D.endRecord(records.length, centralSize, centralStart));
    return Buffer.concat(parts.map(part => Buffer.from(part)));
}

/* Walk the archive the way a reader would, so a header that lies is caught. */
function readZip(zip) {
    const eocd = zip.length - 22;
    assert.equal(zip.readUInt32LE(eocd), 0x06054B50, "end of central directory signature");
    const entries = zip.readUInt16LE(eocd + 8);
    const centralSize = zip.readUInt32LE(eocd + 12);
    const centralStart = zip.readUInt32LE(eocd + 16);
    assert.equal(centralStart + centralSize, eocd, "central directory reaches the EOCD");

    const files = [];
    let cursor = centralStart;
    for (let index = 0; index < entries; index += 1) {
        assert.equal(zip.readUInt32LE(cursor), 0x02014B50, "central record signature");
        const crc = zip.readUInt32LE(cursor + 16);
        const size = zip.readUInt32LE(cursor + 24);
        const nameLength = zip.readUInt16LE(cursor + 28);
        const extraLength = zip.readUInt16LE(cursor + 30);
        const commentLength = zip.readUInt16LE(cursor + 32);
        const localOffset = zip.readUInt32LE(cursor + 42);
        const name = zip.slice(cursor + 46, cursor + 46 + nameLength).toString("utf8");

        assert.equal(zip.readUInt32LE(localOffset), 0x04034B50, "local header signature");
        const localName = zip.readUInt16LE(localOffset + 26);
        const localExtra = zip.readUInt16LE(localOffset + 28);
        const start = localOffset + 30 + localName + localExtra;
        const body = zip.slice(start, start + size);
        assert.equal(body.length, size, "stored data is all there");
        assert.equal(D.crc32(new Uint8Array(body)), crc, "stored data matches its CRC");

        files.push({ name, body: body.toString("utf8"), offset: localOffset });
        cursor += 46 + nameLength + extraLength + commentLength;
    }
    assert.equal(cursor, eocd, "every central record was walked");
    return files;
}

test("crc32 matches the reference vector", () => {
    assert.equal(D.crc32(enc("123456789")), 0xCBF43926);
    assert.equal(D.crc32(enc("")), 0);
});

test("a two-entry archive is a valid ZIP", () => {
    const zip = buildZip([
        { name: "STUNTIN SZN/01 - BETTR DAYZZ.mp3", body: "first track bytes" },
        { name: "STUNTIN SZN/02 - BANKKROLLL.wav", body: "second track bytes, longer" }
    ]);
    assert.equal(zip.readUInt32LE(0), 0x04034B50, "local header signature");
    const files = readZip(zip);
    assert.deepEqual(files.map(file => file.name), [
        "STUNTIN SZN/01 - BETTR DAYZZ.mp3",
        "STUNTIN SZN/02 - BANKKROLLL.wav"
    ]);
    assert.equal(files[0].body, "first track bytes");
    assert.equal(files[1].body, "second track bytes, longer");
});

test("UTF-8 names survive the round trip", () => {
    /* Escaped, not literal, so this file stays plain ASCII like its siblings. */
    const accented = "ST\u00dc\u00d1T\u012aN SZN/03 - B\u00c5\u00d1KKR\u00d8LLL.wav";
    const zip = buildZip([{ name: accented, body: "x" }]);
    const files = readZip(zip);
    assert.equal(files[0].name, accented);
    assert.equal(files[0].body, "x");
    const nameLength = zip.readUInt16LE(26);
    assert.equal(zip.slice(30, 30 + nameLength).toString("utf8"), accented);
});

test("zipPlan and zipName agree with the archive writer", () => {
    const R = require(path.join(__dirname, "..", "release-core.js"));
    const plan = R.zipPlan([
        { title: "BettR Dayzz", artist: "X/i\\D", audioUrl: "Music/Singles/4LLR1Z3/a.wav", trackNumber: 1 },
        { title: "Bankkrolll", artist: "X/i\\D", audioUrl: "Music/Singles/4LLR1Z3/b.wav", trackNumber: 2 }
    ], "4LLR1Z3");
    assert.equal(plan.length, 2);
    const files = readZip(buildZip(plan.map(item => ({ name: item.name, body: item.name }))));
    assert.deepEqual(files.map(file => file.name), plan.map(item => item.name));
    assert.ok(/^4LLR1Z3.*\.zip$/i.test(R.zipName("4LLR1Z3")), R.zipName("4LLR1Z3"));
});

console.log(`\n${count} checks passed.`);
