/* Pure-function checks for the Stripe beat checkout core.
   Run: node admin/stripe-core.test.js */
const assert = require("assert");
const path = require("path");
const S = require(path.join(__dirname, "stripe-core.js"));

let pass = 0;
const fails = [];
function test(name, fn) {
    try {
        fn();
        pass += 1;
        console.log(`  ok - ${name}`);
    } catch (error) {
        fails.push(`${name}: ${error.message}`);
        console.log(`  FAIL - ${name}\n      ${error.message}`);
    }
}

const beat = (extra) => Object.assign({
    title: "New Jazz + West Coast Type Beat - s0l0",
    artist: "X/i\\D, andrzxz",
    folder: "s0l0",
    bpm: 94,
    key: "D minor",
    file: { name: "tagged.mp3", size: 1024 },
    untaggedFile: { name: "clean.wav", size: 1024 }
}, extra || {});

test("tiers carry the six fixed prices in cents", () => {
    assert.deepEqual(S.TIERS.map(tier => tier.id), [
        "mp3-lease", "wav-lease", "premium-lease", "trackout", "complete", "r3bound"
    ]);
    assert.deepEqual(S.TIERS.map(tier => tier.cents), [1499, 2499, 5999, 7999, 12599, 15999]);
    assert.equal(S.money(1499), "$14.99");
    assert.equal(S.money(15999), "$159.99");
    assert.equal(S.tierById("r3bound").name, "R3B0UND");
    assert.equal(S.tierById("nope"), null);
});

test("a preview alone cannot be licensed", () => {
    const tagged = { title: "Preview only", file: { name: "tagged.mp3" } };
    assert.deepEqual(S.eligibleTiers(tagged), []);
    assert.equal(S.primaryTier(tagged), null);
    assert.equal(S.summary(tagged), "0 of 6 tiers");
});

test("an untagged cut opens the three lease tiers", () => {
    const beatLease = beat();
    assert.deepEqual(S.eligibleTiers(beatLease).map(tier => tier.id), ["mp3-lease", "wav-lease", "premium-lease"]);
    assert.equal(S.primaryTier(beatLease).id, "mp3-lease");
    assert.equal(S.summary(beatLease), "3 of 6 tiers");
});

test("stems unlock the trackout, complete and R3B0UND tiers", () => {
    const full = beat({ stemsFile: { name: "stems.zip", size: 2048 } });
    assert.deepEqual(S.eligibleTiers(full).map(tier => tier.id), [
        "mp3-lease", "wav-lease", "premium-lease", "trackout", "complete", "r3bound"
    ]);
    assert.equal(S.summary(full), "6 of 6 tiers");
});

test("published deliverables are read back from the manifest paths", () => {
    const published = {
        title: "Published",
        audioUrl: "Beats/x/x.mp3",
        cleanUrl: "Beats-clean/x/x.wav",
        stemsUrl: "Beats/x/stems.zip"
    };
    assert.deepEqual(S.eligibleTiers(published).map(tier => tier.id), [
        "mp3-lease", "wav-lease", "premium-lease", "trackout", "complete", "r3bound"
    ]);
    assert.deepEqual(S.deliverablesOf(published), { preview: true, clean: true, stems: true, extras: false });
});

test("existing links are only counted for tiers that can still be delivered", () => {
    const beatLease = beat({ paymentUrls: { "mp3-lease": "https://buy.stripe.com/test_abc123" } });
    assert.deepEqual(S.pendingTiers(beatLease).map(tier => tier.id), ["wav-lease", "premium-lease"]);
});

test("the request body carries the tier price, product name and metadata", () => {
    const body = S.paymentLinkBody(S.tierById("wav-lease"), beat());
    const params = new URLSearchParams(body);
    assert.equal(params.get("line_items[0][price_data][currency]"), "usd");
    assert.equal(params.get("line_items[0][price_data][unit_amount]"), "2499");
    assert.equal(params.get("line_items[0][quantity]"), "1");
    assert.equal(params.get("metadata[tier]"), "wav-lease");
    assert.equal(params.get("metadata[beat]"), "s0l0");
    assert.match(params.get("line_items[0][price_data][product_data][name]"), /WAV Lease$/);
    assert.match(params.get("line_items[0][price_data][product_data][description]"), /94 BPM/);
    assert.equal(params.get("after_completion[type]"), "hosted_confirmation");
});

test("brackets survive as documented and values are encoded", () => {
    const body = S.paymentLinkBody(S.tierById("mp3-lease"), beat({ title: "Jazz & Soul (Type Beat)" }));
    assert(body.includes("line_items[0][price_data][unit_amount]=1499"), body);
    assert(!body.includes("Jazz & Soul"), "the ampersand must be encoded");
    // Stripe parses the decoded form back to the names it documents.
    const params = new URLSearchParams(body);
    assert.equal(params.get("line_items[0][price_data][product_data][name]"), "Jazz & Soul (Type Beat) - MP3 Lease");
    assert.equal(params.get("metadata[beat]"), "s0l0", "the folder wins as the slug");
    assert.equal(S.slugOf({ title: "Jazz & Soul (Type Beat)" }), "jazz-soul-type-beat");
});

test("a body needs a known tier and a title", () => {
    assert.throws(() => S.paymentLinkBody({ id: "made-up" }, beat()), /Unknown licence tier/);
    assert.throws(() => S.paymentLinkBody(S.tierById("mp3-lease"), {}), /needs a title/);
});

test("keys are checked for type and mode", () => {
    assert.equal(S.isStripeKey("rk_live_51AbCdEfGh123456"), true);
    assert.equal(S.isStripeKey("rk_test_51AbCdEfGh123456"), true);
    assert.equal(S.isStripeKey("sk_test_51AbCdEfGh123456"), true);
    assert.equal(S.isStripeKey("pk_live_51AbCdEfGh123456"), false);
    assert.equal(S.isStripeKey("nonsense"), false);
    assert.equal(S.isStripeKey(""), false);
    assert.equal(S.isRestricted("rk_live_51AbCdEfGh123456"), true);
    assert.equal(S.isRestricted("sk_live_51AbCdEfGh123456"), false);
    assert.equal(S.keyMode("rk_test_51AbCdEfGh123456"), "test");
    assert.equal(S.keyMode("sk_live_51AbCdEfGh123456"), "live");
    assert.equal(S.keyMode("nope"), "");
});

test("only buy.stripe.com links count as payment links", () => {
    assert.equal(S.isPaymentLink("https://buy.stripe.com/test_cN25nr0iZ7bUa7meUY"), true);
    assert.equal(S.isPaymentLink("https://buy.stripe.com/abc123"), true);
    assert.equal(S.isPaymentLink("https://evil.example/buy.stripe.com"), false);
    assert.equal(S.isPaymentLink("https://buy.stripe.com.evil.test/x"), false);
    assert.equal(S.isPaymentLink("http://buy.stripe.com/abc"), false);
    assert.equal(S.isPaymentLink(""), false);
});

test("a Stripe response is parsed, and junk is refused", () => {
    const parsed = S.parsePaymentLink({ id: "plink_1", url: "https://buy.stripe.com/test_abc123", active: true });
    assert.equal(parsed.url, "https://buy.stripe.com/test_abc123");
    assert.equal(parsed.mode, "test");
    assert.throws(() => S.parsePaymentLink({ error: { message: "nope" } }), /did not return a payment link/);
    assert.throws(() => S.parsePaymentLink({ url: "https://example.com/x" }), /did not return a payment link/);
});

test("request headers use the key as a bearer token", () => {
    const headers = S.headers("rk_test_51AbCdEfGh123456");
    assert.equal(headers.Authorization, "Bearer rk_test_51AbCdEfGh123456");
    assert.equal(headers["Content-Type"], "application/x-www-form-urlencoded");
    assert(S.ENDPOINT.endsWith("/v1/payment_links"));
});

test("slugs are stable and safe for metadata", () => {
    assert.equal(S.slugOf({ folder: "s0l0" }), "s0l0");
    assert.equal(S.slugOf({ title: "New Jazz + West Coast Type Beat - s0l0" }), "new-jazz-west-coast-type-beat-s0l0");
    assert.equal(S.slugOf({}), "beat");
});

console.log(`\n${fails.length ? "FAILED" : "all passed"}: ${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
