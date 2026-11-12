/* Checks for the purchase claim endpoint: only a paid Stripe session may hand
   over a release, and a missing key must fail closed.
   Run: node admin/purchase-claim.test.mjs */
import assert from "node:assert";
import worker, { interpretSession, isSessionId, corsHeaders } from "../purchase-endpoint/index.mjs";

let count = 0;
const fails = [];
async function test(name, fn) {
    try {
        await fn();
        count += 1;
        console.log(`ok ${count} - ${name}`);
    } catch (error) {
        fails.push(`${name}: ${error.message}`);
        console.log(`FAIL - ${name}\n    ${error.message}`);
    }
}

const session = (extra) => Object.assign({
    id: "cs_test_a1b2c3d4",
    status: "complete",
    payment_status: "paid",
    amount_total: 1399,
    currency: "usd",
    customer_details: { email: "buyer@example.com" },
    metadata: { release: "ST\u00dc\u00d1T\u012aN SZN", category: "Albums and Mixtapes", product: "release" }
}, extra || {});

const call = async (path, env, options) => {
    const request = new Request(`https://purchase.example.dev${path}`, options || {});
    return worker.fetch(request, env || {}, {});
};

await test("only Stripe checkout session ids are accepted", () => {
    assert.equal(isSessionId("cs_test_a1b2c3d4"), true);
    assert.equal(isSessionId("cs_live_a1b2c3d4"), true);
    assert.equal(isSessionId("cs_test_"), false);
    assert.equal(isSessionId("pi_123"), false);
    assert.equal(isSessionId(""), false);
});

await test("a paid session names its release and product", () => {
    const verdict = interpretSession(session());
    assert.equal(verdict.ok, true);
    assert.equal(verdict.paid, true);
    assert.equal(verdict.release, "ST\u00dc\u00d1T\u012aN SZN");
    assert.equal(verdict.product, "release");
    assert.equal(verdict.amount, 1399);
    assert.equal(verdict.email, "buyer@example.com");
});

await test("an incomplete or unpaid session gives nothing away", () => {
    assert.equal(interpretSession(session({ status: "open" })).ok, false);
    assert.equal(interpretSession(session({ status: "open" })).reason, "incomplete");
    assert.equal(interpretSession(session({ payment_status: "unpaid" })).ok, false);
    assert.equal(interpretSession(session({ payment_status: "unpaid" })).reason, "unpaid");
    assert.equal(interpretSession({}).ok, false);
});

await test("no key configured: the endpoint fails closed with 503", async () => {
    const response = await call("/claim?session=cs_test_a1b2c3d4", {});
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.configured, false);
    assert.equal(body.ok, false);
});

await test("a paid session returns the release", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify(session()), { status: 200 });
    try {
        const response = await call("/claim?session=cs_test_a1b2c3d4", { STRIPE_SECRET_KEY: "rk_test_abc12345" });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.ok, true);
        assert.equal(body.release, "ST\u00dc\u00d1T\u012aN SZN");
    } finally {
        globalThis.fetch = original;
    }
});

await test("an unpaid session is refused with 402", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify(session({ payment_status: "unpaid" })), { status: 200 });
    try {
        const response = await call("/claim?session=cs_test_a1b2c3d4", { STRIPE_SECRET_KEY: "rk_test_abc12345" });
        assert.equal(response.status, 402);
        const body = await response.json();
        assert.equal(body.ok, false);
        assert.equal(body.reason, "unpaid");
    } finally {
        globalThis.fetch = original;
    }
});

await test("an unknown session is a 404, a malformed one a 400", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response("{}", { status: 404 });
    try {
        const missing = await call("/claim?session=cs_test_a1b2c3d4", { STRIPE_SECRET_KEY: "rk_test_abc12345" });
        assert.equal(missing.status, 404);
    } finally {
        globalThis.fetch = original;
    }
    const bad = await call("/claim?session=nope", { STRIPE_SECRET_KEY: "rk_test_abc12345" });
    assert.equal(bad.status, 400);
});

await test("CORS allows the site and localhost, not strangers", () => {
    const site = corsHeaders(new Request("https://purchase.example.dev/claim", { headers: { Origin: "https://shido275.github.io" } }), {});
    assert.equal(site["Access-Control-Allow-Origin"], "https://shido275.github.io");
    const local = corsHeaders(new Request("https://purchase.example.dev/claim", { headers: { Origin: "http://localhost:3000" } }), {});
    assert.equal(local["Access-Control-Allow-Origin"], "http://localhost:3000");
    const stranger = corsHeaders(new Request("https://purchase.example.dev/claim", { headers: { Origin: "https://evil.example" } }), {});
    assert.equal(stranger["Access-Control-Allow-Origin"], "https://shido275.github.io");
    assert.equal(stranger["Cache-Control"], "no-store");
});

await test("health reports whether the key is set without leaking it", async () => {
    const off = await (await call("/health", {})).json();
    assert.equal(off.configured, false);
    const on = await (await call("/health", { STRIPE_SECRET_KEY: "rk_test_abc12345" })).json();
    assert.equal(on.configured, true);
    assert.equal(JSON.stringify(on).includes("rk_test"), false);
});

console.log(`\n${count} passed, ${fails.length} failed`);
if (fails.length) {
    fails.forEach(failure => console.log(`  - ${failure}`));
    process.exit(1);
}
