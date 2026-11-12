#!/usr/bin/env node
/* Rewrites music-manifest.json for the published site.
 *
 * The audio library is not part of the Pages artifact (Music/ is ~967 MB, which
 * made every deploy time out), but the manifest is still what the catalogue
 * falls back to when the GitHub API is rate limited. Its entries carry repo
 * relative paths, so they are turned into raw.githubusercontent URLs - the same
 * host the site uses for the files when the API answers.
 *
 * Usage: node scripts/pages-manifest.js _site/music-manifest.json
 */

const fs = require("node:fs");

const RAW = "https://raw.githubusercontent.com/shido275/shido275.github.io/main/";

const file = process.argv[2];
if (!file) {
    console.error("Usage: node scripts/pages-manifest.js <music-manifest.json>");
    process.exit(1);
}

const tracks = JSON.parse(fs.readFileSync(file, "utf8"));
if (!Array.isArray(tracks)) {
    console.error(`${file} is not a manifest array.`);
    process.exit(1);
}

/* Absolute URLs (someone may have edited one by hand) and empty covers are left
   exactly as they are. */
function absolute(value) {
    if (!value || /^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
    return encodeURI(RAW + value.replace(/^\/+/, ""));
}

const rewritten = tracks.map(track => ({
    ...track,
    audioUrl: absolute(track.audioUrl),
    coverUrl: absolute(track.coverUrl)
}));

fs.writeFileSync(file, `${JSON.stringify(rewritten, null, 2)}\n`);
console.log(`Rewrote ${rewritten.length} manifest entries to raw GitHub URLs.`);
