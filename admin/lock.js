/* ==========================================================================
   Passcode gate for the Control Room - one fixed passcode.

   The dashboard talks to api.github.com with a personal token, so an
   unprotected /admin/ is an open door. This gate puts a passcode in front of
   the tools, the header and the log, and re-locks after a stretch of
   inactivity or when Lock is pressed.

   The passcode is fixed here rather than chosen per browser. It is still the
   key to the token: the token is sealed with AES-GCM under a PBKDF2 key
   derived from it, so localStorage holds a cipher, not a credential, and a
   copied browser profile cannot publish on its own.

   Because the page is public, this is a lock on the browser rather than a
   server secret - the token's own scope is still the real protection. Keep it
   limited to this repository with Contents: Read and write.
   ========================================================================== */
(function () {
    "use strict";

    const CONFIG_KEY = "xid.admin.config.v2";
    const VAULT_KEY = "xid.admin.vault.v1";
    const FIXED_PASSCODE = "05042005";
    const LOCK_AFTER_MS = 20 * 60 * 1000;
    const ITERATIONS = 210000;

    const store = window.localStorage;
    // Captured before the guard below is installed, so internal writes are exact.
    const setItemRaw = Storage.prototype.setItem;

    let cryptoKey = null;
    let unlocked = false;
    let pendingToken = "";
    let idleTimer = null;
    let gate = null;

    const $ = id => document.getElementById(id);
    const encode = value => new TextEncoder().encode(value);
    const decode = buffer => new TextDecoder().decode(buffer);

    /* ------------------------------------------------------------- migration */

    /* A token saved by an older version of the dashboard sits in plain text.
       Lift it out at load and keep it only until the fixed passcode seals it. */
    function takePlainToken() {
        let config = {};
        try {
            config = JSON.parse(store.getItem(CONFIG_KEY) || "{}");
        } catch {
            return;
        }
        if (!config || !config.token) return;
        pendingToken = String(config.token);
        setItemRaw.call(store, CONFIG_KEY, JSON.stringify({ ...config, token: "" }));
    }

    /* Any later save (the Connect form) is intercepted so the token is sealed
       instead of written to localStorage in the clear. */
    Storage.prototype.setItem = function (name, value) {
        if (name !== CONFIG_KEY) return setItemRaw.call(this, name, value);

        let config;
        try {
            config = JSON.parse(value);
        } catch {
            return setItemRaw.call(this, name, value);
        }
        if (!config || !config.token) return setItemRaw.call(this, name, value);

        const token = String(config.token);
        pendingToken = token;
        setItemRaw.call(this, name, JSON.stringify({ ...config, token: "" }));
        if (cryptoKey && $("lock-message")) sealVault(token).catch(() => {});
        return undefined;
    };

    /* ---------------------------------------------------------------- crypto */

    function base64(bytes) {
        let binary = "";
        new Uint8Array(bytes).forEach(byte => {
            binary += String.fromCharCode(byte);
        });
        return window.btoa(binary);
    }

    function unbase64(value) {
        const binary = window.atob(String(value));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }

    async function deriveKey(salt) {
        const material = await crypto.subtle.importKey("raw", encode(FIXED_PASSCODE), "PBKDF2", false, ["deriveKey"]);
        return crypto.subtle.deriveKey(
            { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
            material,
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"]
        );
    }

    function readVault() {
        try {
            return JSON.parse(store.getItem(VAULT_KEY) || "null");
        } catch {
            return null;
        }
    }

    async function sealVault(token) {
        const vault = readVault();
        if (!vault || !cryptoKey) return false;
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const data = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv },
            cryptoKey,
            encode(JSON.stringify({ token: String(token || "") }))
        );
        setItemRaw.call(store, VAULT_KEY, JSON.stringify({ ...vault, iv: base64(iv), data: base64(data) }));
        return true;
    }

    async function createVault(token) {
        if (!window.crypto || !crypto.subtle) throw new Error("This browser cannot seal the token over an insecure connection.");
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await deriveKey(salt);
        const data = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv },
            key,
            encode(JSON.stringify({ token: String(token || "") }))
        );
        setItemRaw.call(store, VAULT_KEY, JSON.stringify({
            v: 1,
            salt: base64(salt),
            iv: base64(iv),
            data: base64(data),
            createdAt: new Date().toISOString()
        }));
        cryptoKey = key;
        return String(token || "");
    }

    async function openVault() {
        const vault = readVault();
        if (!vault) return null;
        try {
            const key = await deriveKey(unbase64(vault.salt));
            const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unbase64(vault.iv) }, key, unbase64(vault.data));
            const payload = JSON.parse(decode(plain));
            cryptoKey = key;
            return payload;
        } catch {
            return null;
        }
    }

    /* ------------------------------------------------------------------- gate */

    function buildGate() {
        const node = document.createElement("div");
        node.className = "lock-gate";
        node.id = "lock-gate";
        node.setAttribute("role", "dialog");
        node.setAttribute("aria-modal", "true");
        node.setAttribute("aria-labelledby", "lock-title");
        node.innerHTML = `
            <form class="lock-card" id="lock-form" autocomplete="off">
                <p class="eyebrow">Control Room</p>
                <h1 id="lock-title">Passcode</h1>
                <p class="lock-hint" id="lock-hint">Enter the passcode to open the Control Room. It stays locked after a stretch of inactivity, or when you press Lock.</p>
                <label>Passcode
                    <input id="lock-pass" type="password" inputmode="numeric" autocomplete="current-password"
                        aria-describedby="lock-message">
                </label>
                <p class="lock-message" id="lock-message" role="alert"></p>
                <button class="button primary" type="submit" id="lock-submit">Unlock</button>
                <button class="button ghost" type="button" id="lock-forgot" hidden>Reset the sealed token</button>
            </form>
        `;
        document.body.appendChild(node);
        return node;
    }

    function showGate() {
        if (!gate) gate = buildGate();
        gate.hidden = false;
        document.body.classList.add("is-locked");
        const input = $("lock-pass");
        if (input) {
            input.value = "";
            input.focus();
        }
        message("");
    }

    function hideGate() {
        if (gate) gate.hidden = true;
        document.body.classList.remove("is-locked");
    }

    function message(text, tone) {
        const node = $("lock-message");
        if (!node) return;
        node.textContent = text || "";
        node.dataset.tone = tone || "";
    }

    /* --------------------------------------------------------------- unlock */

    async function applyUnlocked(payload) {
        unlocked = true;
        const token = (payload && payload.token) || pendingToken || "";
        pendingToken = token;

        if (window.Admin && window.Admin.state && window.Admin.state.config) {
            window.Admin.state.config.token = token;
        }
        const field = $("cfg-token");
        if (field) field.value = token;

        hideGate();
        resetIdle();

        if (window.Admin) {
            if (token) {
                window.Admin.setStatus("Unlocked - token sealed", "ok");
                if (typeof window.Admin.refreshOverview === "function") await window.Admin.refreshOverview();
            } else {
                window.Admin.setStatus("Unlocked - no token yet", "warn");
                if (typeof window.Admin.switchView === "function") window.Admin.switchView("settings");
            }
        }
    }

    function lock() {
        unlocked = false;
        cryptoKey = null;
        if (window.Admin && window.Admin.state && window.Admin.state.config) {
            window.Admin.state.config.token = "";
            if (typeof window.Admin.setStatus === "function") window.Admin.setStatus("Locked", "warn");
        }
        const field = $("cfg-token");
        if (field) field.value = "";
        showGate();
    }

    function resetIdle() {
        window.clearTimeout(idleTimer);
        idleTimer = window.setTimeout(() => {
            if (unlocked) lock();
        }, LOCK_AFTER_MS);
    }

    async function submitGate(event) {
        event.preventDefault();
        const passInput = $("lock-pass");
        const passcode = passInput ? passInput.value : "";

        if (!passcode) {
            message("Enter the passcode.");
            return;
        }
        if (passcode !== FIXED_PASSCODE) {
            message("Wrong passcode.", "error");
            if (passInput) {
                passInput.value = "";
                passInput.focus();
            }
            return;
        }

        try {
            if (!readVault()) {
                const token = await createVault(pendingToken);
                await applyUnlocked({ token });
                return;
            }
            const payload = await openVault();
            if (payload) {
                await applyUnlocked(payload);
                return;
            }
            // Sealed by an older passcode: the cipher cannot be opened, so start
            // a fresh vault and ask for the token once.
            store.removeItem(VAULT_KEY);
            const token = await createVault(pendingToken);
            await applyUnlocked({ token });
            message("Unlocked. The old sealed token could not be opened - paste it again in Connect.", "warn");
        } catch (error) {
            message(error.message || "Could not open the vault.", "error");
        }
    }

    function resetVault() {
        const sure = window.confirm("Clear the sealed token? You will need to paste it again in Connect.");
        if (!sure) return;
        store.removeItem(VAULT_KEY);
        setItemRaw.call(store, CONFIG_KEY, JSON.stringify({ owner: "shido275", repo: "shido275.github.io", branch: "main", token: "" }));
        pendingToken = "";
        cryptoKey = null;
        showGate();
        message("Sealed token cleared. Unlock, then paste a new token in Connect.");
    }

    /* ------------------------------------------------------------- chrome */

    function injectLockButton() {
        const meta = document.querySelector(".admin-bar__meta");
        if (!meta || document.getElementById("btn-lock")) return;
        const button = document.createElement("button");
        button.className = "button ghost";
        button.id = "btn-lock";
        button.type = "button";
        button.textContent = "Lock";
        button.title = "Lock the dashboard now";
        button.addEventListener("click", lock);
        meta.insertBefore(button, meta.querySelector("#btn-log-toggle") || null);
    }

    function injectPasscodePanel() {
        const view = document.getElementById("view-settings");
        if (!view || document.getElementById("lock-panel")) return;
        const panel = document.createElement("div");
        panel.className = "panel";
        panel.id = "lock-panel";
        panel.innerHTML = `
            <div class="panel-head">
                <p class="eyebrow">Passcode</p>
                <h2>Access</h2>
            </div>
            <p class="hint">The passcode for this dashboard is fixed. It seals the GitHub token in this browser, so
                the dashboard cannot publish until it is entered. <strong>Reset the sealed token</strong> on the lock
                screen clears the token without changing the passcode.</p>
        `;
        view.appendChild(panel);
    }

    /* ------------------------------------------------------------------- boot */

    function wireGate() {
        gate = buildGate();
        $("lock-form").addEventListener("submit", submitGate);
        $("lock-forgot").addEventListener("click", resetVault);

        ["pointerdown", "keydown", "focusin"].forEach(name => {
            document.addEventListener(name, () => {
                if (unlocked) resetIdle();
            }, { passive: true });
        });

        // A locked tab must not keep a usable session in memory.
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) return;
            if (!unlocked && window.Admin && window.Admin.state && window.Admin.state.config) {
                window.Admin.state.config.token = "";
            }
        });
    }

    takePlainToken();
    wireGate();
    showGate();

    document.addEventListener("DOMContentLoaded", () => {
        injectLockButton();
        injectPasscodePanel();
        // The reset button is only useful once something is sealed.
        const forgot = $("lock-forgot");
        if (forgot) forgot.hidden = !readVault();
    });

    window.AdminLock = { lock, unlock: () => showGate(), isUnlocked: () => unlocked };
})();
