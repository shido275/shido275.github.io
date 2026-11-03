/* ==========================================================================
   Passcode gate for the Control Room.

   The dashboard talks to api.github.com with a personal token, so an
   unprotected /admin/ is an open door. This gate does two things:

   - It puts a passcode in front of the dashboard: the tools, the header and
     the log stay hidden until the passcode is entered, and the tab re-locks
     itself after a stretch of inactivity or when you press Lock.
   - It keeps the token out of plain localStorage: the token is sealed with
     AES-GCM under a PBKDF2 key derived from the passcode, so a backed-up
     browser profile holds a cipher, not a credential.

   This is a deterrent for a shared laptop, not a server-side secret. The page
   is public, so what actually protects the repository is the token itself:
   scope it to this repository with Contents: Read and write and nothing more.
   ========================================================================== */
(function () {
    "use strict";

    const CONFIG_KEY = "xid.admin.config.v2";
    const VAULT_KEY = "xid.admin.vault.v1";
    const LOCK_AFTER_MS = 20 * 60 * 1000;
    const MIN_PASSCODE = 6;
    const ITERATIONS = 210000;

    const store = window.localStorage;
    // Captured before the guard below is installed, so internal writes are exact.
    const setItemRaw = Storage.prototype.setItem;

    let cryptoKey = null;
    let unlocked = false;
    let pendingToken = "";
    let idleTimer = null;
    let gate = null;
    let setupMode = false;

    const $ = id => document.getElementById(id);
    const encode = value => new TextEncoder().encode(value);
    const decode = buffer => new TextDecoder().decode(buffer);

    /* ------------------------------------------------------------- migration */

    /* A token saved by an older version of the dashboard sits in plain text.
       Lift it out at load and keep it only until a passcode seals it. */
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

    async function deriveKey(passcode, salt) {
        const material = await crypto.subtle.importKey("raw", encode(passcode), "PBKDF2", false, ["deriveKey"]);
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
        if (!vault) return false;
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const data = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv },
            cryptoKey,
            encode(JSON.stringify({ token: String(token || "") }))
        );
        setItemRaw.call(store, VAULT_KEY, JSON.stringify({ ...vault, iv: base64(iv), data: base64(data) }));
        return true;
    }

    async function createVault(passcode) {
        if (!window.crypto || !crypto.subtle) throw new Error("This browser cannot store a passcode over an insecure connection.");
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await deriveKey(passcode, salt);
        const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encode(JSON.stringify({ token: pendingToken })));
        setItemRaw.call(store, VAULT_KEY, JSON.stringify({
            v: 1,
            salt: base64(salt),
            iv: base64(iv),
            data: base64(data),
            createdAt: new Date().toISOString()
        }));
        cryptoKey = key;
        return pendingToken;
    }

    async function openVault(passcode) {
        const vault = readVault();
        if (!vault) return null;
        const key = await deriveKey(passcode, unbase64(vault.salt));
        try {
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
                <p class="lock-hint" id="lock-hint"></p>
                <label>Passcode
                    <input id="lock-pass" type="password" inputmode="text" autocomplete="current-password"
                        aria-describedby="lock-message">
                </label>
                <label id="lock-confirm-row" hidden>Confirm passcode
                    <input id="lock-confirm" type="password" autocomplete="new-password">
                </label>
                <p class="lock-message" id="lock-message" role="alert"></p>
                <button class="button primary" type="submit" id="lock-submit">Unlock</button>
                <button class="button ghost" type="button" id="lock-forgot" hidden>Forgot it - reset the vault</button>
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
        const confirm = $("lock-confirm");
        if (confirm) confirm.value = "";
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

    function configureMode() {
        setupMode = !readVault();
        const title = $("lock-title");
        const hint = $("lock-hint");
        const confirm = $("lock-confirm-row");
        const submit = $("lock-submit");
        const forgot = $("lock-forgot");

        if (setupMode) {
            title.textContent = "Create a passcode";
            hint.textContent = "Choose a passcode for this browser. It seals the GitHub token stored here, so nobody can publish through the dashboard without it. There is no recovery: losing it means pasting the token again.";
            confirm.hidden = false;
            submit.textContent = "Set passcode";
            forgot.hidden = true;
        } else {
            title.textContent = "Locked";
            hint.textContent = "Enter the passcode to open the Control Room. It stays locked after a stretch of inactivity, or when you press Lock.";
            confirm.hidden = true;
            submit.textContent = "Unlock";
            forgot.hidden = false;
        }
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
        configureMode();
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

        if (setupMode) {
            const confirmValue = $("lock-confirm").value;
            if (passcode.length < MIN_PASSCODE) {
                message(`Use at least ${MIN_PASSCODE} characters.`);
                return;
            }
            if (passcode !== confirmValue) {
                message("The two passcodes do not match.");
                return;
            }
            try {
                const token = await createVault(passcode);
                await applyUnlocked({ token });
                message("");
            } catch (error) {
                message(error.message || "Could not create the vault.");
            }
            return;
        }

        const payload = await openVault(passcode);
        if (!payload) {
            message("Wrong passcode.", "error");
            if (passInput) {
                passInput.value = "";
                passInput.focus();
            }
            return;
        }
        await applyUnlocked(payload);
    }

    function resetVault() {
        const sure = window.confirm("Reset the passcode? The sealed token is deleted and you will need to paste a new token in Connect.");
        if (!sure) return;
        store.removeItem(VAULT_KEY);
        setItemRaw.call(store, CONFIG_KEY, JSON.stringify({ owner: "shido275", repo: "shido275.github.io", branch: "main", token: "" }));
        pendingToken = "";
        cryptoKey = null;
        configureMode();
        showGate();
        message("Vault cleared. Choose a new passcode.");
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
                <h2>Change the passcode</h2>
            </div>
            <p class="hint">The passcode seals the GitHub token stored in this browser. Changing it re-seals the
                token you are signed in with now, so you do not need the old one.</p>
            <div class="field-grid">
                <label>New passcode
                    <input id="lock-new" type="password" autocomplete="new-password" minlength="${MIN_PASSCODE}">
                </label>
                <label>Confirm new passcode
                    <input id="lock-new-confirm" type="password" autocomplete="new-password" minlength="${MIN_PASSCODE}">
                </label>
            </div>
            <div class="row">
                <button class="button primary" type="button" id="lock-save">Save passcode</button>
                <span class="status" id="lock-status"></span>
            </div>
        `;
        view.appendChild(panel);

        $("lock-save").addEventListener("click", async () => {
            const next = $("lock-new").value;
            const confirmValue = $("lock-new-confirm").value;
            const status = $("lock-status");
            const say = (text, tone) => {
                status.textContent = text;
                status.dataset.tone = tone || "";
            };

            if (!unlocked) {
                say("Unlock first.", "warn");
                return;
            }
            if (next.length < MIN_PASSCODE) {
                say(`Use at least ${MIN_PASSCODE} characters.`, "warn");
                return;
            }
            if (next !== confirmValue) {
                say("The two passcodes do not match.", "warn");
                return;
            }

            try {
                const token = (window.Admin && window.Admin.state.config.token) || pendingToken || "";
                const salt = crypto.getRandomValues(new Uint8Array(16));
                const iv = crypto.getRandomValues(new Uint8Array(12));
                const key = await deriveKey(next, salt);
                const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encode(JSON.stringify({ token })));
                setItemRaw.call(store, VAULT_KEY, JSON.stringify({
                    v: 1,
                    salt: base64(salt),
                    iv: base64(iv),
                    data: base64(data),
                    createdAt: new Date().toISOString()
                }));
                cryptoKey = key;
                $("lock-new").value = "";
                $("lock-new-confirm").value = "";
                say("Passcode saved.", "ok");
            } catch (error) {
                say(error.message || "Could not save the passcode.", "error");
            }
        });
    }

    /* ------------------------------------------------------------------- boot */

    function wireGate() {
        gate = buildGate();
        configureMode();

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
        configureMode();
    });

    window.AdminLock = { lock, unlock: () => showGate(), isUnlocked: () => unlocked };
})();
