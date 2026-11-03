#!/usr/bin/env node
/* ==========================================================================
   Rumble live status poller.

   Reads the public channel page and writes the sanitised live.json the site
   already fetches. Two things make this shape necessary:

     1. The page cannot ask Rumble itself: rumble.com sends no CORS headers, so
        a fetch from shido275.github.io is blocked.
     2. Rumble's iframe embed is not usable: rumble.com/embed/<id>/ answers
        410 Gone without a publisher id, and the channel page never exposes
        one. The stream's HLS playlist, by contrast, is served with
        `access-control-allow-origin: *`, so the site plays it in a <video>.

   The channel page embeds its state as JSON, including a video object with
   live/permalink/hls fields. That object is what this reads; nothing is
   scraped from rendered markup, and no API key or stream key is involved.

   Rumble's edge refuses datacenter networks: GitHub's runners get HTTP 403.
   On that response the poller skips the run quietly rather than failing, so
   live.json simply stays as it was.

   Usage:
     node scripts/rumble-live.js                    # fetch the channel page
     node scripts/rumble-live.js --input page.html  # parse a saved page
     node scripts/rumble-live.js --channel <url>    # another channel
   ========================================================================== */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const OUT_PATH = path.join(ROOT, "live.json");
const DEFAULT_CHANNEL = "https://rumble.com/user/yaboishido";
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function parseArgs(argv) {
    const args = { input: "", channel: "" };
    for (let index = 0; index < argv.length; index += 1) {
        if (argv[index] === "--input") args.input = argv[index + 1] || "";
        if (argv[index] === "--channel") args.channel = argv[index + 1] || "";
    }
    return args;
}

async function readPage(args) {
    if (args.input) return fs.readFileSync(args.input, "utf8");

    const url = args.channel || process.env.RUMBLE_CHANNEL || DEFAULT_CHANNEL;
    const response = await fetch(url, {
        headers: { Accept: "text/html", "User-Agent": USER_AGENT }
    });

    /* Rumble's edge refuses datacenter IPs: GitHub's runners get 403 from both
       the channel page and the API. That is a property of where this runs, not
       a broken poll, so it exits cleanly instead of failing every five minutes.
       Run it from a residential network (or a host Rumble accepts) and it works. */
    if (response.status === 403 || response.status === 401 || response.status === 429) {
        const error = new Error(`Rumble refused this network (HTTP ${response.status})`);
        error.blocked = true;
        throw error;
    }
    if (!response.ok) throw new Error(`Rumble channel page returned ${response.status}`);
    return response.text();
}

/* Walk the page text from `start` to the brace that closes it, ignoring braces
   inside string literals so a title such as `{live}` cannot unbalance the scan. */
function matchBrace(text, start) {
    let depth = 0;
    let quote = null;
    let escaped = false;

    for (let index = start; index < text.length; index += 1) {
        const character = text[index];

        if (quote) {
            if (escaped) escaped = false;
            else if (character === "\\") escaped = true;
            else if (character === quote) quote = null;
            continue;
        }

        if (character === '"') {
            quote = character;
            continue;
        }

        if (character === "{") depth += 1;
        else if (character === "}") {
            depth -= 1;
            if (depth === 0) return index;
        }
    }

    return -1;
}

/* Every video object the page embeds, as parsed data. */
function videoObjects(html) {
    const marker = '"object_type":"video"';
    const objects = [];
    let at = html.indexOf(marker);

    while (at !== -1) {
        const start = html.lastIndexOf("{", at);
        if (start === -1) break;

        const end = matchBrace(html, start);
        if (end === -1) {
            at = html.indexOf(marker, at + marker.length);
            continue;
        }

        try {
            const value = JSON.parse(html.slice(start, end + 1));
            if (value && typeof value === "object" && value.object_type === "video") objects.push(value);
        } catch {
            // Not a JSON block we can read; try the next one.
        }
        at = html.indexOf(marker, end);
    }

    return objects;
}

function text(value, max) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);
}

function hlsOf(entry) {
    const videos = Array.isArray(entry.videos) ? entry.videos : [];
    const match = videos.find(video => video && typeof video.url === "string" && /\.m3u8(\?|$)/.test(video.url));
    return match ? match.url : "";
}

function toStream(entry) {
    const permalink = text(entry.permalink_id, 48);
    const pageUrl = text(entry.url, 240) || (permalink ? `https://rumble.com/${permalink}.html` : "");

    return {
        id: text(entry.id, 48),
        title: text(entry.title, 120),
        hlsUrl: hlsOf(entry),
        pageUrl,
        thumb: text(entry.thumb, 240),
        startedAt: text(entry.live_streamed_on, 40)
    };
}

/* Newest upload at or below the live one, used for the offline card. */
function newestVideo(objects) {
    const dated = objects
        .filter(entry => entry && entry.title && (entry.url || entry.permalink_id))
        .map(entry => ({ entry, at: text(entry.upload_date || entry.live_streamed_on, 40) }))
        .sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return dated.length ? dated[0].entry : null;
}

function buildDoc(objects, previous) {
    const previousDoc = previous && typeof previous === "object" ? previous : {};
    const channel = text(previousDoc.channel, 200) || DEFAULT_CHANNEL;
    const liveEntry = objects.find(entry => entry.live === true && hlsOf(entry)) || null;

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

    // Off air: the most recent broadcast we know about becomes the "last" card.
    const fallback = newestVideo(objects);
    return {
        channel,
        live: false,
        stream: null,
        lastStream: previousStream || previousLast || (fallback ? toStream(fallback) : null)
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

    let html;
    try {
        html = await readPage(args);
    } catch (error) {
        if (error.blocked) {
            console.log(`Skipping this run: ${error.message}.`);
            console.log("live.json is unchanged. Update it from a network Rumble accepts, or edit it by hand.");
            return;
        }
        console.error(`Could not read the Rumble channel page: ${error.message}`);
        process.exitCode = 1;
        return;
    }

    const objects = videoObjects(html);
    if (!objects.length) {
        console.error("No video data found on the channel page; leaving live.json alone.");
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

    const next = buildDoc(objects, previous);

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
