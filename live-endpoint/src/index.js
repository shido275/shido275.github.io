/* ==========================================================================
   Rumble live status endpoint (Cloudflare Worker)

   GET /            -> the live state, same shape as the site's live.json
   GET /health       -> liveness probe

   Why this exists: rumble.com sends no CORS headers, so a page on
   shido275.github.io cannot read the channel itself, and Rumble refuses
   datacenter networks (GitHub Actions gets 403). A Worker runs on Cloudflare's
   own network, which Rumble answers, and adds the CORS header the browser needs.

   The response is public, read-only and sanitised: only the fields the player
   uses leave this function. No API key, stream key or chat data is involved.
   ========================================================================== */

const CHANNEL = "https://rumble.com/user/yaboishido";
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const CACHE_SECONDS = 45;

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
};

function reply(body, status = 200, extra = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": `public, max-age=${CACHE_SECONDS}`,
            ...CORS,
            ...extra
        }
    });
}

/* Walk from `start` to its closing brace, skipping string literals, so a title
   containing braces cannot unbalance the scan. */
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
            if (value && value.object_type === "video") objects.push(value);
        } catch {
            // Not a block we can read; try the next one.
        }
        at = html.indexOf(marker, end);
    }

    return objects;
}

const text = (value, max) => String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);

function hlsOf(entry) {
    const videos = Array.isArray(entry.videos) ? entry.videos : [];
    const match = videos.find(video => video && typeof video.url === "string" && /\.m3u8(\?|$)/.test(video.url));
    return match ? match.url : "";
}

function toStream(entry) {
    const pageUrl = text(entry.url, 240) || (entry.permalink_id ? `https://rumble.com/${text(entry.permalink_id, 48)}.html` : "");
    return {
        id: text(entry.id, 48),
        title: text(entry.title, 120),
        hlsUrl: hlsOf(entry),
        pageUrl,
        thumb: text(entry.thumb, 240),
        startedAt: text(entry.live_streamed_on, 40)
    };
}

function buildState(objects) {
    const liveEntry = objects.find(entry => entry.live === true && hlsOf(entry)) || null;
    const newest = objects
        .filter(entry => entry.title && (entry.url || entry.permalink_id))
        .map(entry => ({ entry, at: text(entry.upload_date || entry.live_streamed_on, 40) }))
        .sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];

    return {
        channel: CHANNEL,
        live: Boolean(liveEntry),
        stream: liveEntry ? toStream(liveEntry) : null,
        lastStream: newest ? toStream(newest.entry) : null,
        updatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
        source: "rumble"
    };
}

async function readChannel() {
    const response = await fetch(CHANNEL, {
        headers: { Accept: "text/html", "User-Agent": USER_AGENT },
        cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
        signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) {
        const error = new Error(`Rumble answered ${response.status}`);
        error.status = response.status === 403 || response.status === 429 ? 503 : 502;
        throw error;
    }

    const html = await response.text();
    const objects = videoObjects(html);
    if (!objects.length) {
        const error = new Error("No video data on the channel page");
        error.status = 502;
        throw error;
    }
    return buildState(objects);
}

export default {
    async fetch(request) {
        if (request.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: CORS });
        }
        if (request.method !== "GET" && request.method !== "HEAD") {
            return reply({ error: "method not allowed" }, 405);
        }

        const { pathname } = new URL(request.url);
        if (pathname === "/health") {
            return reply({ ok: true, checkedAt: new Date().toISOString() });
        }
        if (pathname !== "/" && pathname !== "/live" && pathname !== "/live.json") {
            return reply({ error: "not found", hint: "GET / for the live state" }, 404);
        }

        try {
            return reply(await readChannel(), 200, { "X-Live-Source": "rumble.com" });
        } catch (error) {
            // The site treats any non-200 as "keep the state I already have".
            return reply(
                { error: error.message || "could not read the channel", channel: CHANNEL },
                error.status || 502,
                { "Cache-Control": "no-store", "X-Live-Source": "error" }
            );
        }
    }
};
