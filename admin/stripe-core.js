/* ==========================================================================
   Stripe core - pure functions behind beat checkout.

   A beat is sold at whichever of the six fixed tiers it can actually deliver:
   an untagged cut is needed for any licence, trackout stems for the last three.
   This decides the tiers, builds the Payment Links request and reads Stripe's
   answer. No DOM, no network, no key storage - the dashboard owns those.
   ========================================================================== */
(function (global, factory) {
    "use strict";
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    if (global) global.StripeCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    const ENDPOINT = "https://api.stripe.com/v1/payment_links";
    const CURRENCY = "usd";
    const CHECKOUT_PREFIX = "https://buy.stripe.com/";
    const CONTACT_EMAIL = "shidomusic275@gmail.com";

    // Prices are the fixed six from the licence section, in cents.
    const TIERS = [
        { id: "mp3-lease", name: "MP3 Lease", cents: 1499, needs: ["clean"], delivers: "Untagged MP3, 320 kbps" },
        { id: "wav-lease", name: "WAV Lease", cents: 2499, needs: ["clean"], delivers: "Untagged WAV + MP3" },
        { id: "premium-lease", name: "Premium Lease", cents: 5999, needs: ["clean"], delivers: "Untagged WAV + MP3, no stream ceiling" },
        { id: "trackout", name: "Unlimited Trackout Release", cents: 7999, needs: ["clean", "stems"], delivers: "Untagged WAV + MP3 and every stem" },
        { id: "complete", name: "Complete Package", cents: 12599, needs: ["clean", "stems"], delivers: "Stems plus a mix and master" },
        { id: "r3bound", name: "R3B0UND", cents: 15999, needs: ["clean", "stems"], delivers: "Stems, mix, master and artwork" }
    ];

    const DELIVERABLES = {
        preview: "tagged preview",
        clean: "untagged audio",
        stems: "stems ZIP",
        extras: "extra content"
    };

    function clean(value) {
        return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
    }

    function truncate(value, max) {
        const text = clean(value);
        return text.length > max ? `${text.slice(0, max - 1)}…` : text;
    }

    function money(cents) {
        return `$${(Number(cents) / 100).toFixed(2)}`;
    }

    function tierById(id) {
        return TIERS.find(tier => tier.id === id) || null;
    }

    /* What the beat can hand over, judged from the files on the row. */
    function deliverablesOf(beat) {
        const item = beat || {};
        return {
            preview: Boolean(item.taggedUrl || item.audioUrl || item.file || item.untaggedFile),
            clean: Boolean(clean(item.cleanUrl) || item.untaggedFile || item.cleanFile),
            stems: Boolean(clean(item.stemsUrl) || item.stemsFile),
            extras: Boolean(clean(item.extrasUrl) || item.extrasFile)
        };
    }

    function eligibleTiers(beat) {
        const have = deliverablesOf(beat);
        return TIERS.filter(tier => tier.needs.every(need => have[need]));
    }

    /* The cheapest tier it can deliver - the one the site's Buy button uses. */
    function primaryTier(beat) {
        return eligibleTiers(beat)[0] || null;
    }

    function pendingTiers(beat) {
        const links = (beat && beat.paymentUrls) || {};
        return eligibleTiers(beat).filter(tier => !links[tier.id]);
    }

    function summary(beat) {
        const eligible = eligibleTiers(beat);
        return `${eligible.length} of ${TIERS.length} tiers`;
    }

    function slugOf(beat) {
        const source = clean(beat && beat.folder) || clean(beat && beat.title) || "beat";
        const slug = source
            .normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^\w\s-]/g, "")
            .trim()
            .replace(/\s+/g, "-")
            .replace(/-+/g, "-")
            .toLowerCase()
            .slice(0, 48);
        return slug || "beat";
    }

    /* Body for POST /v1/payment_links. Keys keep their brackets, values are
       encoded, which is the shape Stripe documents and parses. */
    function paymentLinkBody(tier, beat) {
        const chosen = tier && tierById(tier.id) ? tierById(tier.id) : (tier && tier.cents ? tier : null);
        if (!chosen) throw new Error("Unknown licence tier.");
        const item = beat || {};
        const title = clean(item.title);
        if (!title) throw new Error("A beat needs a title before it can be sold.");

        const description = [
            chosen.delivers,
            item.bpm ? `${clean(item.bpm)} BPM` : "",
            clean(item.key)
        ].filter(Boolean).join(" · ");

        const params = {
            "line_items[0][price_data][currency]": CURRENCY,
            "line_items[0][price_data][unit_amount]": String(chosen.cents),
            "line_items[0][price_data][product_data][name]": truncate(`${title} - ${chosen.name}`, 240),
            "line_items[0][price_data][product_data][description]": truncate(description, 240),
            "line_items[0][quantity]": "1",
            "metadata[beat]": slugOf(item),
            "metadata[tier]": chosen.id,
            "after_completion[type]": "hosted_confirmation",
            "after_completion[hosted_confirmation][custom_message]":
                `Licence: ${chosen.name}. Files and paperwork are sent to ${CONTACT_EMAIL} within 24 hours.`
        };

        const artist = clean(item.artist);
        if (artist) params["metadata[artist]"] = truncate(artist, 240);

        return Object.keys(params)
            .map(key => `${key}=${encodeURIComponent(params[key])}`)
            .join("&");
    }

    function headers(key) {
        return {
            Authorization: `Bearer ${clean(key)}`,
            "Content-Type": "application/x-www-form-urlencoded"
        };
    }

    /* Stripe answers with the link object; anything else is a failure. */
    function parsePaymentLink(payload) {
        const url = clean(payload && payload.url);
        if (!isPaymentLink(url)) throw new Error("Stripe did not return a payment link.");
        return {
            id: clean(payload.id),
            url,
            active: payload.active !== false,
            mode: /\/test_/.test(url) ? "test" : "live"
        };
    }

    function isPaymentLink(url) {
        return new RegExp(`^${CHECKOUT_PREFIX.replace(/\./g, "\\.")}[A-Za-z0-9_]+$`).test(clean(url));
    }

    /* rk_/sk_ plus live/test, then a key. Restricted keys are the safe ones. */
    function isStripeKey(value) {
        return /^(rk|sk)_(live|test)_[A-Za-z0-9]{8,}$/.test(clean(value));
    }

    function isRestricted(value) {
        return clean(value).startsWith("rk_");
    }

    function keyMode(value) {
        const match = /^(?:rk|sk)_(live|test)_/.exec(clean(value));
        return match ? match[1] : "";
    }

    return {
        ENDPOINT,
        CURRENCY,
        CHECKOUT_PREFIX,
        CONTACT_EMAIL,
        TIERS,
        DELIVERABLES,
        clean,
        truncate,
        money,
        tierById,
        deliverablesOf,
        eligibleTiers,
        primaryTier,
        pendingTiers,
        summary,
        slugOf,
        paymentLinkBody,
        headers,
        parsePaymentLink,
        isPaymentLink,
        isStripeKey,
        isRestricted,
        keyMode
    };
});
