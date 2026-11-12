/* ==========================================================================
   Release downloads - hand a visitor the files.

   One song is saved as itself. An EP, album, mixtape or compilation is written
   into a single ZIP in the browser, in track order, so there is one file to
   keep. No dependency, no build step: the ZIP is written by hand with stored
   (uncompressed) entries, because audio is already compressed and the point is
   to bundle, not to shrink.

   fetch() is used for every file so the saved name is ours rather than the
   server's, and so progress can be reported.
   ========================================================================== */
(function (global, factory) {
    "use strict";
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    if (global) global.ReleaseDownload = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    const MAX_ZIP_BYTES = 3.5 * 1024 * 1024 * 1024;

    /* ------------------------------------------------------------ checksums */

    let crcTable = null;

    function buildCrcTable() {
        const table = new Uint32Array(256);
        for (let i = 0; i < 256; i += 1) {
            let value = i;
            for (let bit = 0; bit < 8; bit += 1) {
                value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
            }
            table[i] = value >>> 0;
        }
        return table;
    }

    function crc32(bytes) {
        if (!crcTable) crcTable = buildCrcTable();
        let crc = 0xFFFFFFFF;
        for (let i = 0; i < bytes.length; i += 1) {
            crc = crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
        }
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    /* ------------------------------------------------------------------ ZIP */

    function dosDateTime(date) {
        const when = date instanceof Date ? date : new Date();
        const time = ((when.getHours() & 0x1F) << 11) | ((when.getMinutes() & 0x3F) << 5) | (Math.floor(when.getSeconds() / 2) & 0x1F);
        const day = (((when.getFullYear() - 1980) & 0x7F) << 9) | (((when.getMonth() + 1) & 0x0F) << 5) | (when.getDate() & 0x1F);
        return { time, day };
    }

    function utf8(text) {
        if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text);
        const bytes = [];
        for (let i = 0; i < text.length; i += 1) {
            const code = text.charCodeAt(i);
            if (code < 0x80) bytes.push(code);
            else if (code < 0x800) bytes.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F));
            else bytes.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
        }
        return new Uint8Array(bytes);
    }

    function writeUint32(view, offset, value) {
        view.setUint32(offset, value >>> 0, true);
    }

    function writeUint16(view, offset, value) {
        view.setUint16(offset, value & 0xFFFF, true);
    }

    /* Stored entry: local header, the bytes, and later a central record. */
    function localHeader(record) {
        const nameBytes = utf8(record.name);
        const buffer = new ArrayBuffer(30 + nameBytes.length);
        const view = new DataView(buffer);
        writeUint32(view, 0, 0x04034B50);
        writeUint16(view, 4, 20);
        writeUint16(view, 6, 0x0800); // UTF-8 names
        writeUint16(view, 8, 0); // stored
        writeUint16(view, 10, record.time);
        writeUint16(view, 12, record.day);
        writeUint32(view, 14, record.crc);
        writeUint32(view, 18, record.size);
        writeUint32(view, 22, record.size);
        writeUint16(view, 26, nameBytes.length);
        writeUint16(view, 28, 0);
        new Uint8Array(buffer, 30).set(nameBytes);
        return new Uint8Array(buffer);
    }

    function centralRecord(record) {
        const nameBytes = utf8(record.name);
        const buffer = new ArrayBuffer(46 + nameBytes.length);
        const view = new DataView(buffer);
        writeUint32(view, 0, 0x02014B50);
        writeUint16(view, 4, 20);
        writeUint16(view, 6, 20);
        writeUint16(view, 8, 0x0800);
        writeUint16(view, 10, 0);
        writeUint16(view, 12, record.time);
        writeUint16(view, 14, record.day);
        writeUint32(view, 16, record.crc);
        writeUint32(view, 20, record.size);
        writeUint32(view, 24, record.size);
        writeUint16(view, 28, nameBytes.length);
        writeUint16(view, 30, 0);
        writeUint16(view, 32, 0);
        writeUint16(view, 34, 0);
        writeUint16(view, 36, 0);
        writeUint32(view, 38, 0);
        writeUint32(view, 42, record.offset);
        new Uint8Array(buffer, 46).set(nameBytes);
        return new Uint8Array(buffer);
    }

    function endRecord(count, size, offset) {
        const buffer = new ArrayBuffer(22);
        const view = new DataView(buffer);
        writeUint32(view, 0, 0x06054B50);
        writeUint16(view, 4, 0);
        writeUint16(view, 6, 0);
        writeUint16(view, 8, count);
        writeUint16(view, 10, count);
        writeUint32(view, 12, size);
        writeUint32(view, 16, offset);
        writeUint16(view, 20, 0);
        return new Uint8Array(buffer);
    }

    /* --------------------------------------------------------------- saving */

    function saveBlob(blob, fileName) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        link.rel = "noopener";
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
    }

    async function fetchBytes(url, onProgress) {
        /* Same-origin credentials so a signed-in host (a preview, a private
           deploy) can send its own files; cross-origin raw GitHub ignores them. */
        const response = await fetch(url, { mode: "cors", credentials: "same-origin" });
        if (!response.ok) throw new Error(`${url} answered ${response.status}`);
        const total = Number(response.headers.get("content-length")) || 0;
        if (!response.body || typeof response.body.getReader !== "function") {
            return { bytes: new Uint8Array(await response.arrayBuffer()), total };
        }
        const reader = response.body.getReader();
        const chunks = [];
        let received = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;
            if (typeof onProgress === "function") onProgress(received, total);
        }
        const bytes = new Uint8Array(received);
        let offset = 0;
        chunks.forEach(chunk => {
            bytes.set(chunk, offset);
            offset += chunk.length;
        });
        return { bytes, total: total || received };
    }

    /* Builds the ZIP and hands it to the browser. `files` is
       [{ name, url }] as produced by release-core's zipPlan. */
    async function downloadZip(files, zipName, options) {
        const list = Array.isArray(files) ? files.filter(item => item && item.url) : [];
        if (!list.length) throw new Error("Nothing to download.");
        if (typeof Blob === "undefined") throw new Error("This browser cannot build a ZIP.");

        const opts = options || {};
        const stamp = dosDateTime(new Date());
        const parts = [];
        const records = [];
        let offset = 0;
        let totalBytes = 0;
        let done = 0;

        for (const item of list) {
            if (typeof opts.onFile === "function") opts.onFile(done, list.length, item.name);
            const { bytes } = await fetchBytes(item.url, (received, total) => {
                if (typeof opts.onProgress === "function") opts.onProgress(done, list.length, item.name, received, total);
            });
            totalBytes += bytes.length;
            if (totalBytes > MAX_ZIP_BYTES) throw new Error("That release is too large to bundle in a browser.");

            const record = {
                name: item.name,
                crc: crc32(bytes),
                size: bytes.length,
                offset,
                time: stamp.time,
                day: stamp.day
            };
            const header = localHeader(record);
            parts.push(header, bytes);
            records.push(record);
            offset += header.length + bytes.length;
            done += 1;
        }

        const centralStart = offset;
        let centralSize = 0;
        records.forEach(record => {
            const data = centralRecord(record);
            parts.push(data);
            centralSize += data.length;
        });
        parts.push(endRecord(records.length, centralSize, centralStart));

        const blob = new Blob(parts, { type: "application/zip" });
        saveBlob(blob, zipName || "release.zip");
        return { files: records.length, bytes: blob.size };
    }

    /* Saves one file, named by us rather than by the server. */
    async function downloadFile(url, fileName, options) {
        const opts = options || {};
        const { bytes } = await fetchBytes(url, (received, total) => {
            if (typeof opts.onProgress === "function") opts.onProgress(0, 1, fileName, received, total);
        });
        saveBlob(new Blob([bytes], { type: "application/octet-stream" }), fileName || "audio");
        return { files: 1, bytes: bytes.length };
    }

    /* The single entry point the site uses: one file, or one ZIP. */
    async function deliver(plan, zipName, options) {
        const list = Array.isArray(plan) ? plan : [];
        if (!list.length) throw new Error("Nothing to download.");
        if (list.length === 1) return downloadFile(list[0].url, list[0].name.split("/").pop(), options);
        return downloadZip(list, zipName, options);
    }

    return {
        MAX_ZIP_BYTES,
        crc32,
        utf8,
        localHeader,
        centralRecord,
        endRecord,
        saveBlob,
        fetchBytes,
        downloadZip,
        downloadFile,
        deliver
    };
});
