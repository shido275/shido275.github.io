# Control Room (`/admin/`)

A static dashboard for this repository. No build step, no server: plain HTML,
CSS and JavaScript served by GitHub Pages that talks straight to
`api.github.com` and commits through the REST API.

Live at **https://shido275.github.io/admin/**

## Tools

| Section | Writes | Shows up on |
| --- | --- | --- |
| **Releases** | `Music/<Category>/<Release>/…`, `music-manifest.json` | Home music player, Credits modal |
| **Photos** | `assets/photos/*`, `epk-media.json` | EPK → Photos slideshow |
| **Videos** | `assets/videos/*`, `epk-media.json` | EPK → Music Videos and Performances |
| **All Links** | `links.json` | `#/links` directory |
| **Manage** | deletes releases, tracks, EPK media, links | everything above |

Every tool previews its plan first (files, sizes, warnings) and then commits
blobs → tree → commit → ref in one atomic commit. A failure leaves the branch
untouched.

## Setup

1. Create a fine-grained personal access token on GitHub:
   **Settings → Developer settings → Fine-grained tokens → Generate new token**.
2. Scope it to `shido275/shido275.github.io` only, with
   **Repository permissions → Contents: Read and write**.
3. Open `/admin/`, go to **Connect**, paste the token and press **Save & verify**.

The token is stored in this browser's `localStorage` and sent only to
`api.github.com`. **Forget token** wipes it. `/admin/` is public but does
nothing without a token — never commit one to the repo.

## Releases

Pick a category, type a release folder (or pick an existing one to add tracks),
fill album, artist, date and cover, then queue audio. Titles and track numbers
are editable inline.

The **Credits and description** block is written to
`Music/<Category>/<Release>/info.json`, which is the file the site's Credits
panel reads: description, performers, producers, writers, label, genre and the
explicit flag. Lists are comma-separated; the site joins them back with commas.

Leave *Commit to a new branch* checked to review an import before it reaches
`main`; uncheck it to publish straight away. **Dry run** logs the whole plan
without uploading. Files over ~45 MB are flagged because GitHub rejects very
large base64 blobs.

## Photos and videos

Both edit the same `epk-media.json`, so each tool loads the current file when it
opens and carries the other collection through unchanged. Order in the list is
the order the slideshow plays.

- Photos: `.jpg`, `.png`, `.webp`, `.svg`, uploaded to `assets/photos/`, with
  caption, alt text and credit per image.
- Videos: paste a YouTube video, YouTube playlist or Vimeo link, or upload a
  short clip to `assets/videos/`. Type is Music Video, Performance, Behind the
  Scenes or Interview; venue, date and note are optional.

The site's EPK keeps its hand-written markup as a fallback: if a data file is
missing or a list is empty, the old markup stays on screen.

## All Links

Five groups — Featured, Platforms, Socials, Business and Hero socials — rendered
into `#/links`. Empty groups keep the built-in markup for that section. Only
`https://`, `mailto:`, `tel:`, `#` routes and relative paths are accepted;
`javascript:` links are dropped with a warning.

## Manage and delete

The **Manage** tool lists everything already published — releases, their
tracks, EPK photos, EPK videos and every link group — and deletes it. It reads
the branch once (catalogue, `epk-media.json`, `links.json` and the full file
tree), so a deletion also removes the files, not just the index entry.

Deletions are **staged**: nothing is removed until **Delete & publish**
commits them, and **Preview plan** shows exactly which files go. One commit can
carry several deletions at once. **Reset** throws the staged changes away and
re-reads the branch.

- **Release** — every file under `Music/<Category>/<Release>/` plus its
  catalogue entries.
- **Track** — the audio file, its metadata JSON, and its catalogue entry; other
  tracks keep their numbers.
- **Photo / video** — the entry in `epk-media.json`, and the file itself when it
  was uploaded to `assets/photos/` or `assets/videos/`.
- **Link** — the entry in `links.json`. Emptying a group hands that section back
  to the site's built-in list.

Deletion is restricted to `Music/`, `assets/photos/` and `assets/videos/`. A
photo or video whose file sits somewhere else (for example the hand-written
`assets/press-photo-1.svg` fallbacks) is dropped from the slideshow but its file
is kept, because the static markup still points at it; the tool marks those
rows *kept*.

## Tests

```bash
node admin/import-core.test.js
```

Covers catalogue entries and order, `info.json` credits, path safety, media
planning (including YouTube/Vimeo parsing) and link validation.
