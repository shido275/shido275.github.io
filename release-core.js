/* ==========================================================================
   Release core - pure functions behind how a release is sold or handed out.

   Four modes, chosen per release in the dashboard and carried on every
   catalogue entry:

     downloadable  files are free, a button hands them over
     paid          fixed price, Stripe takes the money, the file follows
     exclusive     unlisted: only a shareable link shows it, extras allowed
     stream        listed and listenable, nothing to download

   No DOM, no network, no key storage. The dashboard writes the metadata, the
   site reads it, and both agree because this file is the only place the rules
   live.
   ========================================================================== */
(function (global, factory) {
    "use strict";
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    if (global) global.ReleaseCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    const CURRENCY = "usd";
    const CHECKOUT_PREFIX = "https://buy.stripe.com/";
    const CLAIM_PATH = "claim";

    /* Singles and single songs are the same money; the rest is typed. */
    const TRACK_PRICE = 299;

    const PRICES = {
        "Singles": 299,
        "EPs": 699,
        "Albums and Mixtapes": 1399,
        "Compilations": 1399
    };

    const MODES = [
        {
            id: "downloadable",
            label: "Downloadable",
            action: "Download",
            note: "Anyone can play it and download the audio. A single hands over the file; an EP, album, mixtape or compilation is delivered as one ZIP."
        },
        {
            id: "paid",
            label: "Paid",
            action: "Buy",
            note: "Listed and playable, but the files cost money: $2.99 a song, $6.99 an EP, $13.99 an album, mixtape or compilation. Stripe takes the payment and the buyer gets the file or the ZIP."
        },
        {
            id: "exclusive",
            label: "Exclusive",
            action: "Unlock",
            note: "Unlisted: it stays off the site until someone opens its shareable link. The link allows listening, downloading - single file or ZIP - and any extra content such as deconstructed videos."
        },
        {
            id: "stream",
            label: "Stream Only",
            action: "Listen",
            note: "Listed and playable, nothing more. No download button and no files leave the site, whether the release is a single, an EP, an album, a mixtape or a compilation."
        }
    ];

    const DEFAULT_MODE = "stream";
    const ACCESS_LENGTH = 12;

    function clean(value) {
        return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
    }

    function modeById(id) {
        return MODES.find(mode => mode.id === id) || null;
    }

    function isMode(value) {
        return Boolean(modeById(clean(value)));
    }

    /* Anything unrecognised is treated as stream only: the safe default is to
       hand nothing over. */
    function normalizeMode(value) {
        const id = clean(value).toLowerCase();
        return isMode(id) ? id : DEFAULT_MODE;
    }

    function modeLabel(value) {
        const mode = modeById(normalizeMode(value));
        return mode ? mode.label : "Stream Only";
    }

    function allowsDownload(value) {
        return normalizeMode(value) !== "stream";
    }

    function requiresPayment(value) {
        return normalizeMode(value) === "paid";
    }

    function isUnlisted(value) {
        return normalizeMode(value) === "exclusive";
    }

    function allowsExtras(value) {
        return normalizeMode(value) === "exclusive";
    }

    /* The price of a whole release, in cents. Unknown categories are priced as
       an album so a typo can never accidentally sell short. */
    function releasePrice(category) {
        const key = clean(category);
        return Object.prototype.hasOwnProperty.call(PRICES, key) ? PRICES[key] : PRICES["Albums and Mixtapes"];
    }

    function trackPrice() {
        return TRACK_PRICE;
    }

    function money(cents) {
        const value = Number(cents);
        if (!Number.isFinite(value) || value < 0) return "$0.00";
        return `$${(value / 100).toFixed(2)}`;
    }

    function priceLabel(category) {
        return money(releasePrice(category));
    }

    /* What the card or folder shows beside the release name. */
    function badge(value, options) {
        const mode = normalizeMode(value);
        const opts = options || {};
        if (mode === "paid") return { id: mode, text: `Buy ${money(opts.cents || releasePrice(opts.category))}`, tone: "paid" };
        if (mode === "downloadable") return { id: mode, text: "Free download", tone: "free" };
        if (mode === "exclusive") return { id: mode, text: "Exclusive", tone: "exclusive" };
        return { id: mode, text: "Stream only", tone: "stream" };
    }

    /* A multi-track release is delivered as one ZIP; anything else is the file
       itself. This is the rule the site and the docs both quote. */
    function deliversZip(trackCount) {
        return Number(trackCount) > 1;
    }

    /* Letters that do not decompose under NFKD and so would survive as-is and
       confuse a ZIP on some machines. */
    const TRANSLITERATE = {
        "\u00d8": "O", "\u00f8": "o", "\u0110": "D", "\u0111": "d", "\u00d0": "D", "\u00f0": "d",
        "\u00de": "Th", "\u00fe": "th", "\u00c6": "AE", "\u00e6": "ae", "\u0152": "OE", "\u0153": "oe",
        "\u0141": "L", "\u0142": "l", "\u0126": "H", "\u0127": "h", "\u014a": "N", "\u014b": "n", "\u0131": "i"
    };

    function safeFileName(value, fallback) {
        const name = clean(value)
            .normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[\u00d8\u00f8\u0110\u0111\u00d0\u00f0\u00de\u00fe\u00c6\u00e6\u0152\u0153\u0141\u0142\u0126\u0127\u014a\u014b\u0131]/g, letter => TRANSLITERATE[letter] || letter)
            .replace(/[\\/:*?"<>|]+/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 80);
        return name || fallback || "release";
    }

    function zipName(release) {
        return `${safeFileName(release, "release")}.zip`;
    }

    function extensionOf(url) {
        const match = /\.([a-z0-9]{2,5})(?:\?|#|$)/i.exec(String(url || ""));
        return match ? match[1].toLowerCase() : "";
    }

    /* The files a ZIP has to hold, numbered so the folder sorts like the
       release: "01 - Title.wav". */
    function zipPlan(tracks, releaseName) {
        const prefix = safeFileName(releaseName, "release");
        const list = Array.isArray(tracks) ? tracks : [];
        return list.map((track, index) => {
            const number = Number(track.trackNumber) || index + 1;
            const pad = String(number).padStart(2, "0");
            const ext = extensionOf(track.audioUrl || track.path) || "mp3";
            const title = safeFileName(track.title, `Track ${pad}`);
            return {
                name: `${prefix}/${pad} - ${title}.${ext}`,
                url: track.audioUrl || track.path || ""
            };
        }).filter(item => item.url);
    }

    /* ------------------------------------------------------------ access links */

    function randomToken(length, random) {
        const size = Number(length) > 0 ? Number(length) : ACCESS_LENGTH;
        const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
        const next = typeof random === "function" ? random : defaultRandom;
        let out = "";
        for (let i = 0; i < size; i += 1) {
            out += alphabet[Math.floor(next() * alphabet.length) % alphabet.length];
        }
        return out;
    }

    function defaultRandom() {
        const cryptoApi = typeof crypto !== "undefined" ? crypto : null;
        if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
            const buffer = new Uint32Array(1);
            cryptoApi.getRandomValues(buffer);
            return buffer[0] / 4294967296;
        }
        return Math.random();
    }

    function isAccessToken(value) {
        return /^[A-Za-z0-9_-]{8,40}$/.test(clean(value));
    }

    /* The link that unlocks an exclusive release. It is the whole secret, so it
       is long enough not to be guessed and short enough to paste. */
    function shareUrl(origin, token) {
        const base = clean(origin).replace(/\/+$/, "");
        const key = clean(token);
        if (!isAccessToken(key)) return "";
        return `${base}/?r=${encodeURIComponent(key)}`;
    }

    /* ------------------------------------------------------------- metadata */

    /* Strips the mode-specific fields that do not belong to the chosen mode, so
       a release switched from paid to stream does not keep a stale price or a
       dead Stripe link in its info.json. */
    function metaFor(input) {
        const form = input || {};
        const mode = normalizeMode(form.distribution);
        const category = clean(form.category);
        const meta = { distribution: mode };

        if (mode === "paid") {
            meta.price = Number(form.price) > 0 ? Math.round(Number(form.price)) : releasePrice(category);
            meta.trackPrice = TRACK_PRICE;
            const link = clean(form.paymentUrl);
            if (isPaymentLink(link)) meta.paymentUrl = link;
            /* One link per song, keyed by track number, so a buyer can take a
               single song out of an album at the single price. */
            const trackLinks = {};
            const source = form.trackPaymentUrls && typeof form.trackPaymentUrls === "object" ? form.trackPaymentUrls : {};
            Object.keys(source).forEach(key => {
                const value = clean(source[key]);
                if (isPaymentLink(value)) trackLinks[key] = value;
            });
            if (Object.keys(trackLinks).length) meta.trackPaymentUrls = trackLinks;
        }

        if (mode === "exclusive") {
            const token = clean(form.access || form.accessToken);
            meta.access = isAccessToken(token) ? token : randomToken();
        }

        return meta;
    }

    /* Extra content is an exclusive-only list of labelled links or uploads. */
    function normalizeExtras(value) {
        const list = Array.isArray(value) ? value : [];
        return list.map(item => ({
            label: clean(item && item.label),
            url: clean(item && item.url),
            kind: clean(item && item.kind) || "link"
        })).filter(item => item.label && item.url);
    }

    /* Writes the release metadata onto every catalogue entry, which is what the
       site reads without a second request. */
    function applyToEntries(entries, meta) {
        const info = meta || {};
        const mode = normalizeMode(info.distribution);
        return (Array.isArray(entries) ? entries : []).map(entry => {
            const out = Object.assign({}, entry, { distribution: mode });
            delete out.price;
            delete out.paymentUrl;
            delete out.access;
            if (mode === "paid") {
                out.price = Number(info.price) || releasePrice(entry && entry.category);
                if (info.paymentUrl) out.paymentUrl = info.paymentUrl;
                const number = Number(entry && entry.trackNumber);
                const perSong = info.trackPaymentUrls && info.trackPaymentUrls[`track-${number}`];
                if (perSong) out.trackPaymentUrl = perSong;
            }
            if (mode === "exclusive" && info.access) out.access = info.access;
            return out;
        });
    }

    /* The release a catalogue entry belongs to: category plus folder. */
    function releaseKey(entry) {
        const item = entry || {};
        const path = clean(item.path);
        const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : clean(item.category);
        return `${clean(item.category)}::${folder || clean(item.album) || clean(item.title)}`;
    }

    function releaseNameOf(entry) {
        const item = entry || {};
        const path = clean(item.path);
        if (path.includes("/")) {
            const parts = path.split("/");
            if (parts.length >= 3) return parts[parts.length - 2];
        }
        return clean(item.album) || clean(item.title);
    }

    /* Folds catalogue entries into releases carrying their mode and price, the
       way the site's library draws them. */
    function foldReleases(entries, options) {
        const opts = options || {};
        const map = new Map();
        (Array.isArray(entries) ? entries : []).forEach(entry => {
            const key = releaseKey(entry);
            if (!map.has(key)) {
                map.set(key, {
                    key,
                    title: releaseNameOf(entry),
                    category: clean(entry.category),
                    distribution: normalizeMode(entry.distribution),
                    price: Number(entry.price) || 0,
                    paymentUrl: clean(entry.paymentUrl),
                    access: clean(entry.access),
                    tracks: []
                });
            }
            const release = map.get(key);
            const mode = normalizeMode(entry.distribution);
            if (mode !== "stream" || release.distribution === "stream") release.distribution = mode;
            if (entry.price && !release.price) release.price = Number(entry.price);
            if (entry.paymentUrl && !release.paymentUrl) release.paymentUrl = clean(entry.paymentUrl);
            if (entry.access && !release.access) release.access = clean(entry.access);
            release.tracks.push(entry);
        });
        const releases = [...map.values()];
        if (opts.includeUnlisted) return releases;
        return releases.filter(release => !isUnlisted(release.distribution));
    }

    /* An exclusive release answers only to its own token. */
    function matchesAccess(release, token) {
        const wanted = clean(token);
        if (!isAccessToken(wanted)) return false;
        return clean(release && release.access) === wanted;
    }

    /* --------------------------------------------------------------- Stripe */

    /* Both things for sale on a release: the release itself at its typed price,
       and, when it holds more than one song, each song at the single price. */
    function productsFor(release, tracks) {
        const item = release || {};
        const list = Array.isArray(tracks) ? tracks : [];
        const products = [{
            kind: "release",
            key: "release",
            cents: Number(item.price) || releasePrice(item.category),
            name: `${clean(item.title) || "Release"} - full release`
        }];
        if (deliversZip(list.length)) {
            list.forEach((track, index) => {
                const number = Number(track && track.trackNumber) || index + 1;
                products.push({
                    kind: "track",
                    key: `track-${number}`,
                    cents: TRACK_PRICE,
                    name: `${clean(track && track.title) || "Track"} - single song`
                });
            });
        }
        return products;
    }

    function truncate(value, max) {
        const text = clean(value);
        return text.length > max ? `${text.slice(0, max - 1)}\u2026` : text;
    }

    /* Body for POST /v1/payment_links, the same bracketed shape stripe-core
       uses for beats. `redirect` is where Stripe sends the buyer afterwards,
       with {CHECKOUT_SESSION_ID} left for Stripe to fill in. */
    function paymentLinkBody(product, release, redirect) {
        const chosen = product || {};
        const item = release || {};
        const cents = Math.round(Number(chosen.cents));
        if (!(cents > 0)) throw new Error("A price is needed before a link can be made.");
        const name = clean(chosen.name) || clean(item.title);
        if (!name) throw new Error("A release needs a title before it can be sold.");

        const params = {
            "line_items[0][price_data][currency]": CURRENCY,
            "line_items[0][price_data][unit_amount]": String(cents),
            "line_items[0][price_data][product_data][name]": truncate(name, 240),
            "line_items[0][quantity]": "1",
            "metadata[release]": truncate(clean(item.title), 200),
            "metadata[category]": truncate(clean(item.category), 200),
            "metadata[product]": truncate(clean(chosen.key), 200),
            "after_completion[type]": "redirect"
        };
        const target = clean(redirect);
        if (target) params["after_completion[redirect][url]"] = target;
        return Object.keys(params)
            .map(key => `${key}=${encodeURIComponent(params[key])}`)
            .join("&");
    }

    function isPaymentLink(url) {
        return new RegExp(`^${CHECKOUT_PREFIX.replace(/\./g, "\\.")}[A-Za-z0-9_]+$`).test(clean(url));
    }

    function parsePaymentLink(payload) {
        const url = clean(payload && payload.url);
        if (!isPaymentLink(url)) throw new Error("Stripe did not return a payment link.");
        return { id: clean(payload.id), url, active: payload.active !== false };
    }

    return {
        CURRENCY,
        CHECKOUT_PREFIX,
        CLAIM_PATH,
        TRACK_PRICE,
        PRICES,
        MODES,
        DEFAULT_MODE,
        ACCESS_LENGTH,
        clean,
        modeById,
        isMode,
        normalizeMode,
        modeLabel,
        allowsDownload,
        requiresPayment,
        isUnlisted,
        allowsExtras,
        releasePrice,
        trackPrice,
        money,
        priceLabel,
        badge,
        deliversZip,
        safeFileName,
        zipName,
        zipPlan,
        randomToken,
        isAccessToken,
        shareUrl,
        metaFor,
        normalizeExtras,
        applyToEntries,
        releaseKey,
        releaseNameOf,
        foldReleases,
        matchesAccess,
        productsFor,
        truncate,
        paymentLinkBody,
        isPaymentLink,
        parsePaymentLink
    };
});
