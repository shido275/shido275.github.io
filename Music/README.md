# Music Library Uploads

The music player scans these folders:

- `Music/Singles`
- `Music/EPs`
- `Music/Albums and Mixtapes`
- `Music/Compilations`

Each release can be a folder containing audio, cover art, and metadata:

```text
Music/Singles/My Song/
  my-song.mp3
  cover.jpg
  metadata.json
```

Example metadata for Singles:

```json
{
  "title": "My Song",
  "artist": "X/i\\D",
  "album": "Single",
  "cover": "cover.jpg",
  "year": "2026"
}
```

Example metadata for EPs

{
  "title": "My Song",
  "artist": "X/i\\D",
  "album": "Project Name",
  "cover": "cover.jpg",
  "trackNumber": 1,
}

Example metadata for EPs, Albums, and Compilations:

```json
{
  "title": "My Song",
  "artist": "X/i\\D",
  "album": "Project Name",
  "cover": "cover.jpg",
  "trackNumber": 1,
  "year": "2026"
}
```

Example info.json config (placed in the release folder for the credits pop-out):

```json
{
  "description": "A brief description of the single, EP, album, or mixtape.",
  "releaseDate": "June 12, 2026",
  "producers": ["Producer A", "Producer B"],
  "writers": ["Writer A"],
  "performers": ["Main Artist", "Featured Artist"],
  "label": "FAKE Entertainment"
}
```

Supported audio formats: MP3, WAV, M4A, FLAC.
