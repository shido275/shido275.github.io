/* feed.js checks - runs in a bare vm context, no browser and no dependencies.
   Run: node admin/feed.test.js */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "feed.js"), "utf8");
const RAW = "https://raw.githubusercontent.com";

function response(body, options) {
    const opts = options || {};
    const ok = opts.ok !== false;
    return {
        ok,
        status: ok ? 200 : 404,
        statusText: ok ? "OK" : "Not Found",
        headers: {},
        text: async () => body,
        json: async () => JSON.parse(body),
        clone() {
            return response(body, { ok });
        }
    };
}

function build(options) {
    const opts = options || {};
    const calls = [];
    const rawFiles = opts.raw || {};
    const pageFiles = opts.page || {};
    const apiFiles = opts.api || {};

    const respond = url => {
        const clean = url.split("?")[0];
        if (clean.startsWith(RAW)) {
            const key = decodeURIComponent(clean.slice(clean.indexOf("/main/") + 6));
            return key in rawFiles ? response(rawFiles[key]) : response("", { ok: false });
        }
        if (clean.startsWith("https://api.github.com/")) {
            return clean in apiFiles ? response(apiFiles[clean]) : response("", { ok: false });
        }
        if (/^https?:\/\//.test(clean)) return response(opts.external || "");
        const key = decodeURIComponent(clean.replace(/^\.?\//, ""));
        return key in pageFiles ? response(pageFiles[key]) : response("", { ok: false });
    };

    const window = {
        SITE_CONFIG: { owner: opts.owner || "o", repo: opts.repo || "r", branch: "main" },
        location: { hostname: opts.hostname || "shido275.github.io" },
        setTimeout,
        clearTimeout,
        setInterval: () => 0,
        addEventListener: () => {},
        fetch: async (url, init) => {
            calls.push(String(url));
            return respond(String(url), init);
        }
    };

    const context = {
        window,
        document: { hidden: false, addEventListener: () => {} },
        fetch: window.fetch,
        Response,
        AbortController,
        setTimeout,
        clearTimeout,
        console,
        TextEncoder,
        URL
    };

    vm.createContext(context);
    vm.runInContext(source, context);
    return { feed: window.XIDFeed, calls, window };
}

let pass = 0;
const fails = [];
async function test(name, fn) {
    try {
        await fn();
        pass += 1;
        console.log(`  ok - ${name}`);
    } catch (error) {
        fails.push(`${name}: ${error.message}`);
        console.log(`  FAIL - ${name}\n      ${error.message}`);
    }
}

(async () => {
    await test("media: repo paths become cache-busted raw URLs", () => {
        const { feed } = build();
        const url = feed.media("Music/Albums and Mixtapes/STÜÑTĪN SZN/BÅÑKKRØLLL.wav");
        assert(url.startsWith(`${RAW}/o/r/main/Music/Albums%20and%20Mixtapes/`), url);
        assert(url.includes(encodeURIComponent("BÅÑKKRØLLL.wav")), url);
        assert(/\?v=\d+$/.test(url), url);
    });

    await test("media: external links and inline data are left alone", () => {
        const { feed } = build();
        assert.equal(feed.media("https://paypal.me/YOURNAME/30"), "https://paypal.me/YOURNAME/30");
        assert.equal(feed.media("data:image/png;base64,AAA"), "data:image/png;base64,AAA");
        assert.equal(feed.repoPath("data:image/png;base64,AAA"), "");
    });

    await test("media: a Pages-hosted file is re-pointed at raw", () => {
        const { feed } = build({ owner: "shido275", repo: "shido275.github.io" });
        const url = feed.media("https://shido275.github.io/Beats/s0l0/beat.mp3");
        assert(url.startsWith(`${RAW}/shido275/shido275.github.io/main/Beats/s0l0/beat.mp3`), url);
    });

    await test("media: an existing raw URL is not doubled up", () => {
        const { feed } = build();
        const twice = feed.media(feed.media("Beats/s0l0/beat.mp3"));
        assert.equal(twice.split("raw.githubusercontent.com").length, 2);
        assert(twice.includes("/Beats/s0l0/beat.mp3?v="), twice);
    });

    await test("fetch: a manifest is read from the commit and its media re-pointed", async () => {
        const { calls, window } = build({
            raw: {
                "music-manifest.json": JSON.stringify([{ title: "T", audioUrl: "Music/A/a.mp3", coverUrl: "Music/A/cover.jpg", path: "Music/A/a.mp3" }])
            }
        });
        const doc = await (await window.fetch("music-manifest.json?v=123")).json();
        assert.equal(doc[0].title, "T");
        assert(doc[0].audioUrl.startsWith(`${RAW}/o/r/main/Music/A/a.mp3`), doc[0].audioUrl);
        assert(doc[0].coverUrl.startsWith(`${RAW}/o/r/main/Music/A/cover.jpg`), doc[0].coverUrl);
        assert.equal(doc[0].path, "Music/A/a.mp3", "the repo path must stay intact");
        assert.equal(calls.length, 1);
    });

    await test("fetch: raw is asked first for a repo JSON file", async () => {
        const { calls, window } = build({
            raw: { "themes.json": '{"default":"opium"}' },
            page: { "themes.json": '{"default":"stale"}' }
        });
        const doc = await (await window.fetch("themes.json")).json();
        assert.equal(doc.default, "opium");
        assert(calls[0].startsWith(`${RAW}/o/r/main/themes.json`), calls[0]);
        assert.equal(calls.length, 1);
    });

    await test("fetch: a raw failure falls back to the Pages copy", async () => {
        const { calls, window } = build({
            page: { "beats-manifest.json": JSON.stringify([{ title: "B", audioUrl: "Beats/x/b.mp3" }]) }
        });
        const doc = await (await window.fetch("beats-manifest.json?v=1")).json();
        assert.equal(doc[0].title, "B");
        assert(doc[0].audioUrl.startsWith(`${RAW}/o/r/main/Beats/x/b.mp3`), doc[0].audioUrl);
        assert.equal(calls.length, 2);
    });

    await test("fetch: the contents API keeps its data and gets raw download URLs", async () => {
        const api = "https://api.github.com/repos/o/r/contents/Music";
        const body = JSON.stringify([
            { name: "a.mp3", path: "Music/A/a.mp3", download_url: "https://shido275.github.io/Music/A/a.mp3" },
            { name: "cover.jpg", path: "Music/A/cover.jpg", download_url: "https://shido275.github.io/Music/A/cover.jpg" }
        ]);
        const { window } = build({ owner: "shido275", repo: "shido275.github.io", api: { [api]: body } });
        const items = await (await window.fetch(api)).json();
        assert.equal(items[0].path, "Music/A/a.mp3");
        assert(items[0].download_url.startsWith(`${RAW}/shido275/shido275.github.io/main/Music/A/a.mp3`), items[0].download_url);
        assert(items[1].download_url.startsWith(`${RAW}/shido275/shido275.github.io/main/Music/A/cover.jpg`), items[1].download_url);
    });

    await test("fetch: a non-GET request passes straight through", async () => {
        const { calls, window } = build({ raw: { "themes.json": '{"a":1}' } });
        await window.fetch("themes.json", { method: "POST", body: "{}" });
        assert.equal(calls.length, 1);
        assert(!calls[0].startsWith(RAW), calls[0]);
    });

    await test("fetch: an external endpoint is untouched", async () => {
        const { calls, window } = build({ external: '{"live":true}' });
        const doc = await (await window.fetch("https://example.com/live.json")).json();
        assert.deepEqual(doc, { live: true });
        assert.equal(calls.length, 1);
        assert.equal(calls[0], "https://example.com/live.json");
    });

    await test("json: returns the fallback when the file is missing everywhere", async () => {
        const { feed } = build();
        assert.equal(await feed.json("nope.json"), null);
        assert.deepEqual(await feed.json("nope.json", { fallback: [] }), []);
    });

    await test("json: reads a repo file from the commit", async () => {
        const { feed } = build({ raw: { "backgrounds.json": '{"interval":12,"items":[]}' } });
        const doc = await feed.json("backgrounds.json");
        assert.equal(doc.interval, 12);
    });

    await test("watch: fires once when the committed file changes", async () => {
        const bodies = { current: '{"v":1}' };
        const { feed } = build({
            raw: {
                get "music-manifest.json"() {
                    return bodies.current;
                }
            }
        });
        const fired = [];
        await feed.json("music-manifest.json");
        const tick = feed.watch(["music-manifest.json"], changed => fired.push(changed));

        bodies.current = '{"v":2}';
        await tick();
        assert.deepEqual(fired, [["music-manifest.json"]]);

        await tick();
        assert.equal(fired.length, 1, "an unchanged file must not fire again");
    });

    console.log(`\n${fails.length ? "FAILED" : "all passed"}: ${pass} passed, ${fails.length} failed`);
    process.exit(fails.length ? 1 : 0);
})();
