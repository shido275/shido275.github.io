const fs = require('fs');
const path = require('path');

const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.flac'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

const MUSIC_DIR = path.join(__dirname, 'Music');
const MANIFEST_PATH = path.join(__dirname, 'music-manifest.json');

const CATEGORIES = ['Singles', 'EPs', 'Albums and Mixtapes', 'Albums and Mixtales', 'Compilations'];

function prettyName(fileName) {
    const ext = path.extname(fileName);
    const base = path.basename(fileName, ext);
    return base
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, letter => letter.toUpperCase());
}

function scanMusic() {
    const tracks = [];

    if (!fs.existsSync(MUSIC_DIR)) {
        console.error('Music directory does not exist!');
        return;
    }

    const categoryDirs = fs.readdirSync(MUSIC_DIR).filter(item => {
        const itemPath = path.join(MUSIC_DIR, item);
        return fs.statSync(itemPath).isDirectory() && CATEGORIES.includes(item);
    });

    for (const cat of categoryDirs) {
        // Map category to standard name if needed (e.g. Albums and Mixtales -> Albums and Mixtapes)
        const displayCategory = cat === 'Albums and Mixtales' ? 'Albums and Mixtapes' : cat;
        const catPath = path.join(MUSIC_DIR, cat);
        const releaseDirs = fs.readdirSync(catPath).filter(item => {
            return fs.statSync(path.join(catPath, item)).isDirectory();
        });

        for (const release of releaseDirs) {
            const releasePath = path.join(catPath, release);
            const files = fs.readdirSync(releasePath);

            const audioFiles = files.filter(f => AUDIO_EXTENSIONS.includes(path.extname(f).toLowerCase()));
            const imageFiles = files.filter(f => IMAGE_EXTENSIONS.includes(path.extname(f).toLowerCase()));

            for (const audio of audioFiles) {
                const audioBase = path.basename(audio, path.extname(audio));
                
                // Look for matching json or fallback metadata.json
                let metadata = {};
                const specificJson = `${audioBase}.json`;
                const genericJson = 'metadata.json';
                
                let jsonFile = null;
                if (files.includes(specificJson)) {
                    jsonFile = specificJson;
                } else if (files.includes(genericJson)) {
                    jsonFile = genericJson;
                }

                if (jsonFile) {
                    try {
                        const jsonContent = fs.readFileSync(path.join(releasePath, jsonFile), 'utf8');
                        metadata = JSON.parse(jsonContent);
                    } catch (e) {
                        console.warn(`Error parsing JSON for ${audio} in ${releasePath}:`, e.message);
                    }
                }

                // Determine cover art
                let coverFile = null;
                if (metadata.cover) {
                    const candidate = files.find(f => f.toLowerCase() === metadata.cover.toLowerCase());
                    if (candidate) coverFile = candidate;
                }
                
                if (!coverFile) {
                    // Try to find image with matching basename
                    coverFile = imageFiles.find(f => path.basename(f, path.extname(f)).toLowerCase() === audioBase.toLowerCase());
                }
                if (!coverFile) {
                    // Try to find image containing "cover"
                    coverFile = imageFiles.find(f => f.toLowerCase().includes('cover'));
                }
                if (!coverFile) {
                    // Just take the first image if any
                    coverFile = imageFiles[0] || null;
                }

                const relAudioPath = `Music/${cat}/${release}/${audio}`;
                const relCoverPath = coverFile ? `Music/${cat}/${release}/${coverFile}` : '';

                const audioStats = fs.statSync(path.join(releasePath, audio));
                const defaultDate = audioStats.mtime.toISOString().split('T')[0];

                tracks.push({
                    title: metadata.title || prettyName(audio),
                    artist: metadata.artist || metadata.producer || 'X/i\\D',
                    album: metadata.album || (displayCategory === 'Singles' ? 'Single' : release),
                    category: displayCategory,
                    audioUrl: relAudioPath,
                    coverUrl: relCoverPath,
                    path: relAudioPath,
                    date: metadata.date || defaultDate,
                    year: metadata.year || metadata.releaseYear || undefined,
                    ...(displayCategory !== 'Singles' && { trackNumber: metadata.trackNumber || metadata.track || 0 })
                });
            }
        }
    }

    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(tracks, null, 2), 'utf8');
    console.log(`Generated manifest at ${MANIFEST_PATH} with ${tracks.length} tracks.`);
}

scanMusic();
