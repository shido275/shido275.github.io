# Beat Store Uploads

Add MP3, WAV, M4A, or FLAC files here. The beat store scans this folder recursively.

Optional metadata can be placed next to the beat as either `metadata.json` or `beat-file-name.json`. This metadata will be loaded dynamically into the beat store's **Info** modal.

### Metadata Schema Example:

```json
{
  "title": "New Jazz + West Coast Type Beat - s0l0",
  "producer": "X/i\\D, andrzxz",
  "bpm": 94,
  "key": "D minor",
  "price": "$30",
  "license": "Non-exclusive MP3/WAV",
  "paymentUrl": "https://paypal.me/YOURNAME/30",
  "cover": "New Jazz + West Coast Type Beat - s0l0.jpg"
}
```

### Features Enabled by Metadata:
- **Buy Button**: Directly uses the `paymentUrl` (PayPal, Stripe, BeatStars, Gumroad, Ko-fi, etc.) and displays the `price`. If no URL is provided, falls back to a booking email form.
- **Download Tagged**: Automatically generates a download link for the associated audio file.
- **Info Button**: Displays all metadata properties (BPM, Key, License, Price, Producer) in a popout modal.
- **Cover Art**: Uses the `cover` property to load the beat's custom artwork (falls back to a matching image filename or the first image in the folder).
