# Release Importer (`/admin/`)

A static webapp that imports a release into this repository without a laptop-side
script. Drop the audio and a cover in, confirm the plan, and it commits
`Music/<Category>/<Release>/...`, per-track metadata JSON and an updated
`music-manifest.json` through the GitHub API in a single atomic commit.

There is no build step and no server: it is plain HTML, CSS and JavaScript served
by GitHub Pages, and it talks directly to `api.github.com`.

Live at **https://shido275.github.io/admin/** once this branch is merged and Pages
has rebuilt.

## Setup

1. Create a fine-grained personal access token on GitHub:
   **Settings -> Developer settings -> Fine-grained tokens -> Generate new token**.
2. Scope it to `shido275/shido275.github.io` only, with
   **Repository permissions -> Contents: Read and write**.
3. Open `/admin/`, paste the token into the Connect panel and press
   **Save & verify**. It should read back your login and the repo with write
   access.

The token is stored in this browser's `localStorage` and sent only to
`api.github.com`. **Forget token** wipes it. Use a private browsing window on a
machine you do not own.

## Workflow

1. **Release** - pick a category, type the release folder name (or pick an
   existing release from the datalist to add tracks to it), fill album, artist and
   date, choose the cover.
2. **Drop audio** - `.mp3`, `.wav`, `.m4a`, `.flac`. Titles default to the file
   name and can be edited inline; track numbers are editable too.
3. **Commit** - **Preview plan** lists every file that will be written plus
   warnings. **Import release** writes it.

Leave *Commit to a new branch* checked if you want to review the import on a
branch before it reaches `main`; uncheck it to publish straight away (Pages
redeploys automatically).

**Dry run** builds and logs the whole plan without uploading anything.

## What gets written

```
Music/<Category>/<Release>/<track>.wav        original audio, unchanged
Music/<Category>/<Release>/<track>.json       title, artist, album, track, date, cover
Music/<Category>/<Release>/cover.jpg          cover art, if supplied
music-manifest.json                           merged, sorted catalogue
```

The JSON files use the same keys `generate-manifest.js` reads, so a later
`node generate-manifest.js` run reproduces the same entries.

## Limits and safety

- Files over ~45 MB are flagged: GitHub rejects very large base64 blobs. Export a
  smaller master for anything huge.
- All paths are validated - traversal (`..`), absolute paths and Windows-reserved
  characters are rejected before anything is sent.
- Existing catalogue entries with the same path are replaced, not duplicated.
- The commit is atomic: blobs -> tree -> commit -> ref update, so a failure leaves
  the branch untouched.
- `/admin/` is `noindex` and does nothing without a token, but it is public. Never
  commit a token to the repo.

## Tests

```bash
node admin/import-core.test.js
```

Covers entry building, catalogue merging and order, path safety and the import
plan itself.
