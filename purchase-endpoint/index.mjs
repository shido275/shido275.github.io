/* ==========================================================================
   Purchase claim endpoint.

   One job: a buyer comes back from Stripe with a Checkout Session id, and this
   answers whether that session was actually paid - and for which release. The
   site only shows the files once this says yes, so the download link is not
   something anyone can read off the page.

   The Stripe secret key stays here, in the Worker's environment. It is never
   sent to the browser and never committed.

   Routes
     GET /claim?session=cs_...   -> { ok, paid, release, product, category }
     GET /health                 -> { ok, configured }

   Set the key once:
     wrangler secret put STRIPE_SECRET_KEY      (or Sites -> Secrets)
   A restricted key with Checkout Sessions: Read is enough.
   ========================================================================== */

const STRIPE_SESSIONS = "https://api.stripe.com/v1/checkout/sessions/";
const DEFAULT_ORIGINS = ["https://shido275.github.io"];
const SESSION_PATTERN = /^cs_(test|live)_[A-Za-z0-9]{6,}$/;

export function corsHeaders(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = String((env && env.ALLOWED_ORIGINS) || "")
        .split(",")
        .map(value => value.trim())
        .filter(Boolean);
    const list = allowed.length ? allowed : DEFAULT_ORIGINS;
    const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const permit = list.includes(origin) || local ? (origin || list[0]) : list[0];
    return {
        "Access-Control-Allow-Origin": permit,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin",
        "Cache-Control": "no-store"
    };
}

export function json(body, status, request, env) {
    return new Response(JSON.stringify(body), {
        status: status || 200,
        headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, corsHeaders(request, env))
    });
}

export function isSessionId(value) {
    return SESSION_PATTERN.test(String(value || "").trim());
}

/* Stripe returns the session object; anything else is a failure worth naming. */
export function interpretSession(payload) {
    const session = payload || {};
    if (!session.id) return { ok: false, paid: false, reason: "unknown_session" };
    if (session.status !== "complete") return { ok: false, paid: false, reason: "incomplete" };
    const paid = session.payment_status === "paid" || session.payment_status === "no_payment_required";
    if (!paid) return { ok: false, paid: false, reason: "unpaid" };

    const metadata = session.metadata || {};
    return {
        ok: true,
        paid: true,
        reason: "paid",
        release: String(metadata.release || "").trim(),
        product: String(metadata.product || "release").trim(),
        category: String(metadata.category || "").trim(),
        amount: Number(session.amount_total) || 0,
        currency: String(session.currency || "usd"),
        email: String((session.customer_details && session.customer_details.email) || "").trim()
    };
}

async function claimSession(sessionId, env, fetchImpl) {
    const key = String((env && env.STRIPE_SECRET_KEY) || "").trim();
    if (!key) return { status: 503, body: { ok: false, configured: false, reason: "not_configured" } };

    const response = await fetchImpl(`${STRIPE_SESSIONS}${encodeURIComponent(sessionId)}`, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${key}`,
            "Stripe-Version": "2023-10-16"
        }
    });

    if (response.status === 404) return { status: 404, body: { ok: false, reason: "unknown_session" } };
    if (!response.ok) {
        const detail = await response.text().catch(() => "");
        return { status: 502, body: { ok: false, reason: "stripe_error", detail: detail.slice(0, 200) } };
    }

    const session = await response.json();
    const verdict = interpretSession(session);
    if (!verdict.ok) return { status: 402, body: Object.assign({ configured: true }, verdict) };
    return { status: 200, body: Object.assign({ configured: true }, verdict) };
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const runtime = { fetch: (typeof fetch === "function" ? fetch : ctx && ctx.fetch) };

        if (request.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: corsHeaders(request, env) });
        }

        if (url.pathname === "/health") {
            return json({ ok: true, configured: Boolean(env && env.STRIPE_SECRET_KEY) }, 200, request, env);
        }

        if (url.pathname === "/claim") {
            const sessionId = url.searchParams.get("session") || "";
            if (!isSessionId(sessionId)) {
                return json({ ok: false, reason: "bad_session" }, 400, request, env);
            }
            try {
                const result = await claimSession(sessionId, env, runtime.fetch);
                return json(result.body, result.status, request, env);
            } catch (error) {
                return json({ ok: false, reason: "network_error", detail: String(error && error.message || error).slice(0, 200) }, 502, request, env);
            }
        }

        return json({ ok: false, reason: "not_found" }, 404, request, env);
    }
};
