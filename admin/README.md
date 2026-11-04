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
| **Beat Store** | `Beats/<folder>/…`, `beats-manifest.json` | `#/beats` store |
| **Background** | `assets/backgrounds/*`, `backgrounds.json` | the cycled backdrop on every page |
| **Manage** | reorders and deletes releases, tracks, EPK media, links | everything above |

Every tool previews its plan first (files, sizes, warnings) and then commits
blobs → tree → commit → ref in one atomic commit. A failure leaves the branch
untouched.

**A publish is live in seconds, not minutes.** The site reads its data files and
media straight from the commit (`feed.js` → `raw.githubusercontent.com`, cache
busted), so it does not wait for a GitHub Pages build and does not sit behind
the ten-minute cache Pages sets on its own JSON. After every publish the
dashboard waits for the exact bytes it just wrote to answer on the branch and
reports *Live on the site after Ns*. If a tool ever commits to a branch other
than the base branch, the dashboard says plainly that the site will not show it
until it is merged.

Only markup, stylesheet and script changes need a Pages build; content, audio,
images and the background do not.

## Setup

1. Create a fine-grained personal access token on GitHub:
   **Settings → Developer settings → Fine-grained tokens → Generate new token**.
2. Scope it to `shido275/shido275.github.io` only, with
   **Repository permissions → Contents: Read and write**.
3. Open `/admin/`, choose a passcode, then go to **Connect**, paste the token and
   press **Save & verify**.

The token is stored in this browser's `localStorage` and sent only to
`api.github.com`. **Forget token** wipes it. `/admin/` is public but does
nothing without a token — never commit one to the repo.

## Passcode

The dashboard opens behind a passcode. On the first visit you choose one (at
least six characters) and are let in; after that the page starts locked, and
**Lock** in the header closes it again — as does twenty minutes of inactivity.

The passcode is not just a curtain: it is the key to the token. The token is
encrypted with AES-GCM under a PBKDF2 key derived from the passcode, so
`localStorage` holds a cipher rather than a credential, and the dashboard cannot
read the token until the passcode is entered. A token saved later through
**Connect** is intercepted and sealed the same way.

Change the passcode in **Connect → Change the passcode**. Changing it re-seals
the token you are signed in with, so the old one is not needed.

There is no recovery: losing the passcode means **Forgot it - reset the vault**,
which deletes the sealed token, then pasting a new token in Connect. Because
`/admin/` is a public page, treat the passcode as a lock on this browser rather
than a server secret — the token's own scope is still the real protection.

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

## Beat Store

The **Beat Store** tool manages the beats under `#/beats` the same way Releases
manages music. Add a beat with its audio, cover art, title, folder, BPM, key,
price, licence and payment link, or load the published store and edit those
fields inline. The arrows reorder the store; **Remove** drops the beat, its
audio, its metadata JSON and its cover from the repository in the same commit.

Uploads go to `Beats/<folder>/` (the folder defaults to the title). Every beat
is mirrored into `beats-manifest.json`, which is what the site reads; the
per-beat JSON beside the audio is kept for anything that scans the folders.

## Background

The **Background** tool feeds `backgrounds.json`, and the site's `background.js`
cycles whatever it lists behind every page: images, GIFs and short video clips,
crossfading in the order shown. Uploads go to `assets/backgrounds/`; a link can
be pasted instead.

- **Seconds per item** — how long each one holds before the next fades in.
- **Transition** — crossfade or hard cut.
- **Dim** — strength of the vignette that keeps text readable over the image.
- **Blur** — softens the image so it sits behind the content.

With the list empty, or the *Show the background on the site* box cleared, the
layer stands down and the stylesheet's own backdrop returns untouched. Visitors
who ask for reduced motion see the first item only, and the cycle pauses while
the tab is hidden.

A theme with its own artwork (Auckland 2077) paints in `body::before`; a chosen
background replaces that artwork rather than fighting it.

## Manage: reorder and delete

The **Manage** tool lists everything already published — releases, their
tracks, EPK photos, EPK videos and every link group — and reorders or deletes
it. It reads the branch once (catalogue, `epk-media.json`, `links.json` and the
full file tree), so a deletion also removes the files, not just the index entry.

The arrows reorder content the way the site reads it:

- **Tracks** — the whole release is renumbered, because `site.js` sorts a
  release by `trackNumber`. Singles have no track number, so their arrows are
  disabled.
- **Photos and videos** — the order in `epk-media.json`, which is the order the
  EPK slideshow plays.
- **Links** — the order inside each group in `links.json`.

Release order on the site comes from the release dates (newest first), not from
the catalogue file, so releases themselves are not draggable — change a release
date to move it.

Deletions are **staged**: nothing is removed until **Publish changes** commits
them, and **Preview plan** shows exactly which files go. One commit can carry
several changes at once. **Reset** throws the staged changes away and re-reads
the branch.

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
