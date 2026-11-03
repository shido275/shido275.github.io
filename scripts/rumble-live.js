#!/usr/bin/env node
/* ==========================================================================
   Rumble live status poller.

   Rumble's Live Stream API answers only to direct HTTP requests: it sends no
   CORS headers, so a page on shido275.github.io cannot fetch it, and its
   payload contains `stream_key` (the RTMP ingest secret). That is why this
   runs in a GitHub Action instead of the browser:

     API (secret) -> this script -> live.json (public, sanitised) -> site

   Only whitelisted fields are copied out. `stream_key`, chat messages,
   follower names and subscriber details never reach the repo.

   Usage:
     node scripts/rumble-live.js                  # fetch RUMBLE_LIVE_API
     node scripts/rumble-live.js --input file.json # parse a saved payload
   ========================================================================== */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const OUT_PATH = path.join(ROOT, "live.json");
const DEFAULT_CHANNEL = "https://rumble.com/user/yaboishido";

function parseArgs(argv) {
    const args = { input: "" };
    for (let index = 0; index < argv.length; index += 1) {
        if (argv[index] === "--input") args.input = argv[index + 1] || "";
    }
    return args;
}

async function readPayload(inputFile) {
    if (inputFile) {
        return JSON.parse(fs.readFileSync(inputFile, "utf8"));
    }
    const url = process.env.RUMBLE_LIVE_API;
    const response = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "shido275-site-live-status" }
    });
    if (!response.ok) throw new Error(`Rumble API returned ${response.status}`);
    return response.json();
}

function text(value, max) {
    return String(value == null ? "" : value)
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max);
}

/* Whitelist, deliberately. Anything not named here is dropped, including the
   stream key and everything under `chat`. */
function toStream(entry) {
    const id = text(entry && entry.id, 48);
    const categories = (entry && entry.categories) || {};
    const primary = categories.primary || {};
    return {
        id,
        title: text(entry && entry.title, 120),
        createdOn: text(entry && entry.created_on, 40),
        embedUrl: id ? `https://rumble.com/embed/${encodeURIComponent(id)}/` : "",
        pageUrl: id ? `https://rumble.com/${encodeURIComponent(id)}.html` : "",
        category: text(primary.title, 40)
    };
}

function buildDoc(payload, previous) {
    const previousDoc = previous && typeof previous === "object" ? previous : {};
    const channel = text(previousDoc.channel, 200) || DEFAULT_CHANNEL;
    const streams = Array.isArray(payload && payload.livestreams) ? payload.livestreams : [];
    const liveEntry = streams.find(entry => entry && entry.is_live) || null;

    const previousStream = previousDoc.stream && previousDoc.stream.id ? previousDoc.stream : null;
    const previousLast = previousDoc.lastStream && previousDoc.lastStream.id ? previousDoc.lastStream : null;

    if (liveEntry) {
        const stream = toStream(liveEntry);
        return {
            channel,
            live: true,
            stream,
            // Remember what was on air before this broadcast, not the same one twice.
            lastStream: previousStream && previousStream.id !== stream.id ? previousStream : previousLast
        };
    }

    // Off air: the newest thing we know about becomes the "last stream" card.
    return {
        channel,
        live: false,
        stream: null,
        lastStream: previousStream || previousLast
    };
}

// Everything that should trigger a commit. Volatile fields stay out of it.
function stateOf(doc) {
    return JSON.stringify({
        channel: doc.channel || "",
        live: Boolean(doc.live),
        stream: doc.stream || null,
        lastStream: doc.lastStream || null
    });
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    if (!args.input && !process.env.RUMBLE_LIVE_API) {
        console.log("RUMBLE_LIVE_API is not configured, so there is nothing to poll.");
        console.log("Add it under Settings -> Secrets and variables -> Actions -> New repository secret.");
        return;
    }

    let payload;
    try {
        payload = await readPayload(args.input);
    } catch (error) {
        console.error(`Could not read the Rumble live API: ${error.message}`);
        process.exitCode = 1;
        return;
    }

    let previous = null;
    if (fs.existsSync(OUT_PATH)) {
        try {
            previous = JSON.parse(fs.readFileSync(OUT_PATH, "utf8"));
        } catch {
            console.warn("live.json was not valid JSON; rebuilding it from scratch.");
        }
    }

    const next = buildDoc(payload, previous);

    if (previous && stateOf(previous) === stateOf(next)) {
        console.log("Live status unchanged; live.json left alone.");
        return;
    }

    const output = Object.assign(next, {
        updatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z")
    });

    fs.writeFileSync(OUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
    console.log(`live.json updated: ${output.live ? "live" : "offline"}${output.stream ? ` - ${output.stream.title}` : ""}`);
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
