/* ==========================================================================
   Beat Store tool - manage the beats under #/beats next to the releases.
   Mounts its own nav item and section, reads beats-manifest.json, adds beats
   with audio and cover art, edits BPM / key / price / licence inline,
   reorders, removes, and publishes one atomic commit.
   ========================================================================== */
(function () {
    "use strict";

    const Core = window.BeatCore;
    const Admin = window.Admin;
    const $ = id => document.getElementById(id);
    const esc = Admin.escapeHtml;
    const Stripe = window.StripeCore;
    // The restricted key lives in this browser only; it never reaches a commit.
    const KEY_STORE = "xid.admin.stripe.v1";

    const model = {
        loaded: false,
        existing: [],
        items: []
    };

    const MARKUP = `
        <div class="panel-head">
            <p class="eyebrow">Beat Store</p>
            <h1 id="beats-heading">Beat Store</h1>
            <p class="hint">The catalogue behind <code>#/beats</code>, managed next to the releases. Audio and cover
                art upload to <code>Beats/&lt;folder&gt;/</code>; the order below is the order the store lists them.
                A <strong>tagged</strong> beat always plays on the site; the <strong>untagged</strong> cut is kept
                beside it and only plays when that beat has no tagged version. The untagged cut and the
                stems decide which licence tiers a beat can be sold at.</p>
        </div>

        <div class="panel">
            <div class="panel-head">
                <p class="eyebrow">Add</p>
                <h2>New beat</h2>
            </div>
            <div class="field-grid">
                <label>Title<input id="beat-title" autocomplete="off"
                        placeholder="New Jazz + West Coast Type Beat - s0l0"></label>
                <label>Folder<input id="beat-folder" autocomplete="off" placeholder="Defaults to the title"></label>
                <label>Artist<input id="beat-artist" autocomplete="off"></label>
                <label>BPM<input id="beat-bpm" autocomplete="off" inputmode="numeric" placeholder="94"></label>
                <label>Key<input id="beat-key" autocomplete="off" placeholder="D minor"></label>
                <label>Price<input id="beat-price" autocomplete="off" placeholder="$30"></label>
                <label>License<input id="beat-license" autocomplete="off" placeholder="Non-exclusive MP3/WAV"></label>
                <label>Payment link<input id="beat-payment" autocomplete="off" placeholder="https://paypal.me/..."></label>
                <label>Tagged audio<input id="beat-audio" type="file" accept=".mp3,.wav,.m4a,.flac,audio/*"></label>
                <label>Untagged audio (clean)<input id="beat-untagged" type="file" accept=".mp3,.wav,.m4a,.flac,audio/*"></label>
                <label>Cover art<input id="beat-cover" type="file" accept=".jpg,.jpeg,.png,.webp,image/*"></label>
                <label>Stems / trackout ZIP<input id="beat-stems" type="file" accept=".zip,application/zip"></label>
                <label>Extra content ZIP<input id="beat-extras" type="file" accept=".zip,application/zip"></label>
            </div>
            <div class="row">
                <button class="button primary" type="button" id="beats-add">Add beat</button>
                <button class="button" type="button" id="beats-load">Load the published store</button>
                <span class="status" id="beats-count">0 beats</span>
            </div>
        </div>

        <div class="panel">
            <div class="panel-head">
                <p class="eyebrow">Checkout</p>
                <h2>Stripe payment links</h2>
                <p class="hint">Paste a <strong>restricted</strong> key (<code>rk_live_…</code> or
                    <code>rk_test_…</code>) with <em>Payment Links: write</em>. It is kept in this browser's
                    <code>localStorage</code>, sent only to <code>api.stripe.com</code>, and never committed.
                    Each new beat gets one link per tier it can deliver; the cheapest link becomes the
                    <em>Buy</em> button on the site.</p>
            </div>
            <div class="field-grid">
                <label>Restricted key<input id="beat-stripe-key" type="password" autocomplete="off"
                        spellcheck="false" placeholder="rk_live_…"></label>
            </div>
            <div class="row">
                <button class="button" type="button" id="beat-stripe-save">Save key</button>
                <button class="button ghost" type="button" id="beat-stripe-forget">Forget key</button>
                <span class="status" id="beat-stripe-status"></span>
            </div>
        </div>

        <div class="panel">
            <div class="panel-head">
                <p class="eyebrow">Catalogue</p>
                <h2>Published order</h2>
            </div>
            <div class="media-list" id="beats-list"></div>
            <p class="muted" id="beats-empty">No beats queued. Load the store or add one above.</p>
        </div>

        <div class="panel">
            <div class="panel-head">
                <p class="eyebrow">Publish</p>
                <h2>Commit beats</h2>
            </div>
            <div class="publish-grid">
                <label>Commit message<input id="beats-message" autocomplete="off" value="Update the beat store"></label>
                <label>Branch<input id="beats-branch" autocomplete="off" spellcheck="false" placeholder="main"></label>
                <label class="checkbox"><input type="checkbox" id="beats-dryrun"> Dry run</label>
            </div>
            <div class="row">
                <button class="button" type="button" id="beats-plan">Preview plan</button>
                <button class="button primary" type="button" id="beats-publish">Publish beats</button>
            </div>
            <div id="beats-output" aria-live="polite"></div>
        </div>
    `;

    function status(text, tone) {
        const node = $("beats-count");
        if (!node) return;
        node.textContent = text;
        node.dataset.tone = tone || "";
    }

    function mount() {
        const nav = document.querySelector(".admin-nav");
        const settings = nav && nav.querySelector('[data-view="settings"]');
        if (nav && !nav.querySelector('[data-view="beats"]')) {
            const button = document.createElement("button");
            button.className = "admin-nav__item";
            button.type = "button";
            button.dataset.view = "beats";
            button.innerHTML = "<span>Beat Store</span><small>Beats and licences</small>";
            button.addEventListener("click", () => Admin.switchView("beats"));
            nav.insertBefore(button, settings);
        }

        const main = document.querySelector(".admin-main");
        if (!main || $("view-beats")) return;
        const section = document.createElement("section");
        section.className = "admin-view";
        section.id = "view-beats";
        section.setAttribute("aria-labelledby", "beats-heading");
        section.innerHTML = MARKUP;
        main.insertBefore(section, $("view-settings"));
    }

    function thumb(beat) {
        if (beat.coverFile) return `<img class="media-row__thumb" alt="" src="${URL.createObjectURL(beat.coverFile)}">`;
        if (beat.coverUrl) return `<img class="media-row__thumb" alt="" src="../${esc(beat.coverUrl)}" loading="lazy">`;
        return `<span class="media-row__thumb">audio</span>`;
    }

    /* What the row is actually carrying: both cuts, one of them, or neither. */
    function versionLabel(beat) {
        const tagged = Boolean(beat.file || beat.taggedUrl || (beat.tagged && beat.audioUrl));
        const clean = Boolean(beat.untaggedFile || beat.cleanUrl);
        if (tagged && clean) return "tagged + untagged";
        if (tagged) return "tagged";
        if (clean) return "untagged only";
        return "no audio yet";
    }

    /* The tiers this beat can deliver, with the link once it exists. */
    function linkRow(beat, index) {
        if (!Stripe) return "";
        const tiers = Stripe.eligibleTiers(beat);
        if (!tiers.length) {
            return `<small class="manage-path">No licence tier yet - add the untagged audio.</small>`;
        }
        const links = beat.paymentUrls || {};
        const missing = tiers.filter(tier => !links[tier.id]).length;
        const chips = tiers.map(tier => links[tier.id]
            ? `<a class="button ghost" href="${esc(links[tier.id])}" target="_blank" rel="noopener">${esc(tier.name)} ${esc(Stripe.money(tier.cents))}</a>`
            : `<span class="status" data-tone="warn">${esc(tier.name)} ${esc(Stripe.money(tier.cents))}</span>`
        ).join("");
        const button = missing
            ? `<button class="button ghost" type="button" data-beat-links="${index}">Create ${missing} link${missing === 1 ? "" : "s"}</button>`
            : "";
        return `<div class="row">${chips}${button}</div>`;
    }

    function render() {
        const list = $("beats-list");
        list.innerHTML = model.items.map((beat, index) => `
            <div class="media-row" data-beat="${index}">
                ${thumb(beat)}
                <div class="media-row__fields">
                    <input data-beat-field="title" data-index="${index}" value="${esc(beat.title || "")}"
                        placeholder="Title" aria-label="Beat title">
                    <input data-beat-field="bpm" data-index="${index}" value="${esc(beat.bpm == null ? "" : beat.bpm)}"
                        placeholder="BPM" aria-label="BPM" inputmode="numeric">
                    <input data-beat-field="key" data-index="${index}" value="${esc(beat.key || "")}"
                        placeholder="Key" aria-label="Key">
                    <input data-beat-field="price" data-index="${index}" value="${esc(beat.price || "")}"
                        placeholder="$30" aria-label="Price">
                    <input data-beat-field="license" data-index="${index}" value="${esc(beat.license || "")}"
                        placeholder="License" aria-label="License">
                    <input data-beat-field="paymentUrl" data-index="${index}" value="${esc(beat.paymentUrl || "")}"
                        placeholder="Payment link (PayPal, Stripe)" aria-label="Payment link">
                    <small class="manage-path">${esc(versionLabel(beat))} - ${esc(beat.path || beat.audioUrl || "not uploaded yet")}</small>
                    ${linkRow(beat, index)}
                </div>
                <div class="media-row__actions">
                    <button class="button ghost" type="button" data-beat-move="-1" data-index="${index}"
                        aria-label="Move up" ${index === 0 ? "disabled" : ""}>&uarr;</button>
                    <button class="button ghost" type="button" data-beat-move="1" data-index="${index}"
                        aria-label="Move down" ${index === model.items.length - 1 ? "disabled" : ""}>&darr;</button>
                    <button class="button ghost" type="button" data-beat-remove="${index}">Remove</button>
                </div>
            </div>
        `).join("");
        $("beats-empty").hidden = model.items.length > 0;
        status(`${model.items.length} beat${model.items.length === 1 ? "" : "s"}`, "ok");
    }

    function clearForm() {
        ["beat-title", "beat-folder", "beat-bpm", "beat-key", "beat-price", "beat-payment"].forEach(id => {
            $(id).value = "";
        });
        $("beat-artist").value = Core.DEFAULT_ARTIST;
        $("beat-license").value = Core.DEFAULT_LICENSE;
        $("beat-audio").value = "";
        $("beat-untagged").value = "";
        $("beat-cover").value = "";
        $("beat-stems").value = "";
        $("beat-extras").value = "";
    }

    function readStoredKey() {
        try {
            return window.localStorage.getItem(KEY_STORE) || "";
        } catch (error) {
            return "";
        }
    }

    function storeKey(value) {
        try {
            if (value) window.localStorage.setItem(KEY_STORE, value);
            else window.localStorage.removeItem(KEY_STORE);
        } catch (error) {
            Admin.log(`This browser refused to store the key: ${error.message}`);
        }
    }

    function stripeStatus(text, tone) {
        const node = $("beat-stripe-status");
        if (!node) return;
        node.textContent = text;
        node.dataset.tone = tone || "";
    }

    function keyHint(key) {
        if (!key) return "No key saved - beats publish without Stripe links.";
        if (!Stripe.isStripeKey(key)) return "Saved key does not look like a Stripe key - replace it.";
        return Stripe.keyMode(key) === "live"
            ? "Live key saved - new links take real payments."
            : "Test key saved - new links are test-mode only.";
    }

    /* One Payment Link per tier, straight from the browser to Stripe. */
    async function createLink(tier, beat, key) {
        const response = await fetch(Stripe.ENDPOINT, {
            method: "POST",
            headers: Stripe.headers(key),
            body: Stripe.paymentLinkBody(tier, beat)
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const detail = payload && payload.error && payload.error.message
                ? payload.error.message
                : `Stripe answered ${response.status}`;
            throw new Error(detail);
        }
        return Stripe.parsePaymentLink(payload);
    }

    /* Fills in only the tiers that have no link yet, so re-running is safe. */
    async function generateLinks(beat, quiet) {
        if (!Stripe) return 0;
        const key = readStoredKey();
        if (!key) {
            if (!quiet) Admin.log("Save a Stripe restricted key first - no links were created.");
            return 0;
        }
        beat.paymentUrls = beat.paymentUrls || {};
        const missing = Stripe.pendingTiers(beat);
        if (!missing.length) {
            if (!quiet) Admin.log(`"${beat.title}" already has a link for every tier it can deliver.`);
            return 0;
        }
        let made = 0;
        for (const tier of missing) {
            stripeStatus(`Creating ${tier.name}…`, "warn");
            try {
                const link = await createLink(tier, beat, key);
                beat.paymentUrls[tier.id] = link.url;
                made += 1;
                Admin.log(`${beat.title} - ${tier.name}: ${link.url}`);
            } catch (error) {
                Admin.log(`Stripe refused the ${tier.name} link for "${beat.title}": ${error.message}`);
            }
        }
        const primary = Stripe.primaryTier(beat);
        if (primary && beat.paymentUrls[primary.id] && !Stripe.isPaymentLink(beat.paymentUrl)) {
            beat.paymentUrl = beat.paymentUrls[primary.id];
        }
        render();
        stripeStatus(`${made} link${made === 1 ? "" : "s"} created`, made ? "ok" : "warn");
        return made;
    }

    async function addBeat() {
        const file = ($("beat-audio").files || [])[0] || null;
        const untaggedFile = ($("beat-untagged").files || [])[0] || null;
        const coverFile = ($("beat-cover").files || [])[0] || null;
        const stemsFile = ($("beat-stems").files || [])[0] || null;
        const extrasFile = ($("beat-extras").files || [])[0] || null;
        const title = $("beat-title").value.trim();
        if (!title) {
            Admin.log("Give the beat a title first.");
            return;
        }
        if (!file && !untaggedFile) {
            Admin.log("Add the tagged beat, the untagged one, or both - the store needs something to play.");
            return;
        }
        const beat = {
            file,
            untaggedFile,
            coverFile,
            stemsFile,
            extrasFile,
            title,
            folder: $("beat-folder").value.trim(),
            artist: $("beat-artist").value.trim() || Core.DEFAULT_ARTIST,
            bpm: $("beat-bpm").value.trim(),
            key: $("beat-key").value.trim(),
            price: $("beat-price").value.trim(),
            license: $("beat-license").value.trim() || Core.DEFAULT_LICENSE,
            paymentUrl: $("beat-payment").value.trim(),
            paymentUrls: {}
        };
        model.items.push(beat);
        Admin.log(`Queued "${title}".`);
        clearForm();
        render();
        if (stemsFile) Admin.log("Stems ZIP queued - the trackout tiers are available for this beat.");
        await generateLinks(beat);
    }

    async function load(force) {
        if (model.loaded && !force) return;
        if (!Admin.state.config.token) {
            Admin.log("Connect a token to load the beat store.");
            return;
        }
        try {
            const doc = await Admin.readJson(Core.BEATS_PATH);
            model.existing = Array.isArray(doc) ? doc : [];
            model.items = Core.readBeats(doc).map(beat => ({ ...beat }));
            model.loaded = true;
            render();
            Admin.log(`Beat store loaded: ${model.items.length} beat(s).`);
        } catch (error) {
            Admin.log(`Could not load ${Core.BEATS_PATH}: ${error.message}`);
            status("Load failed", "error");
        }
    }

    function plan() {
        return Core.planBeats({ beats: model.items, existing: model.existing });
    }

    function wire() {
        clearForm();
        $("beats-load").addEventListener("click", () => load(true));
        $("beats-add").addEventListener("click", addBeat);

        $("beat-stripe-save").addEventListener("click", () => {
            const key = $("beat-stripe-key").value.trim();
            if (!Stripe.isStripeKey(key)) {
                Admin.log("That is not a Stripe key - it starts with rk_live_, rk_test_, sk_live_ or sk_test_.");
                return;
            }
            storeKey(key);
            $("beat-stripe-key").value = "";
            stripeStatus(keyHint(key), Stripe.keyMode(key) === "live" ? "warn" : "ok");
            if (!Stripe.isRestricted(key)) {
                Admin.log("Full secret key saved. A restricted key with only Payment Links: write is safer.");
            }
            Admin.log("Stripe key saved in this browser only - it is never committed.");
        });

        $("beat-stripe-forget").addEventListener("click", () => {
            storeKey("");
            $("beat-stripe-key").value = "";
            stripeStatus(keyHint(""), "");
            Admin.log("Stripe key forgotten in this browser.");
        });

        $("beats-list").addEventListener("input", event => {
            const field = event.target.closest("[data-beat-field]");
            if (!field) return;
            const beat = model.items[Number(field.dataset.index)];
            if (!beat) return;
            beat[field.dataset.beatField] = field.value;
        });

        $("beats-list").addEventListener("click", event => {
            const move = event.target.closest("[data-beat-move]");
            if (move) {
                const index = Number(move.dataset.index);
                const target = index + Number(move.dataset.beatMove);
                if (target < 0 || target >= model.items.length) return;
                const [beat] = model.items.splice(index, 1);
                model.items.splice(target, 0, beat);
                render();
                return;
            }
            const links = event.target.closest("[data-beat-links]");
            if (links) {
                const beat = model.items[Number(links.dataset.beatLinks)];
                if (beat) generateLinks(beat);
                return;
            }
            const remove = event.target.closest("[data-beat-remove]");
            if (remove) {
                const [beat] = model.items.splice(Number(remove.dataset.beatRemove), 1);
                if (beat) Admin.log(`Removed "${beat.title || beat.audioUrl}" from the queue.`);
                render();
            }
        });

        $("beats-plan").addEventListener("click", () => {
            try {
                const built = plan();
                Admin.renderPlan("beats-output", built, [[`${built.count}`, "beat(s)"]]);
                Admin.log("Beat plan ready.");
            } catch (error) {
                Admin.log(`Plan failed: ${error.message}`);
            }
        });

        $("beats-publish").addEventListener("click", async () => {
            const sha = await Admin.publish({
                prefix: "beats",
                outputId: "beats-output",
                build: plan,
                defaultMessage: "Update the beat store",
                stats: built => [[`${built.count}`, "beat(s)"]]
            });
            if (sha) {
                model.existing = plan().entries;
                model.items = model.items.map(beat => ({ ...beat, file: null, untaggedFile: null, coverFile: null }));
                model.loaded = true;
                render();
            }
        });
    }

    function boot() {
        if (!window.BeatCore || !window.StripeCore || !window.Admin || !document.querySelector(".admin-main")) return;
        if (!document.getElementById("view-beats")) {
            mount();
            wire();
            Admin.registerView("beats", () => load(false));
            stripeStatus(keyHint(readStoredKey()));
        }
    }

    window.BeatStore = { model, load, render, generateLinks };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }
})();
