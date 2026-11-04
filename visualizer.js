/* ==========================================================================
   visualizer.js - the player's frequency display, in several styles.

   The old display painted 128 neon gradients a frame, forever: while paused,
   while the panel was closed, and while the tab was in the background. That is
   a constant CPU burn on phones and desktops alike. This takes the canvas over
   and paints only when there is something to show - panel open, track playing,
   tab visible - at a capped frame rate, with the gradients built once per size
   change instead of once per bar per frame.

   The style comes from visualizer.json, which the dashboard writes:

     { "mode": "bars", "rotate": false }

   "rotate" picks a different style on every reload, like the themes. A style
   the file names that this build does not know is ignored in favour of "bars".
   ========================================================================== */
(function () {
    "use strict";

    const FEED = window.XIDFeed;
    const PATH = "visualizer.json";
    const MODES = ["bars", "mirror", "wave", "radial", "dots", "pulse", "off"];
    const ROTATION = MODES.filter(mode => mode !== "off");
    const LAST_KEY = "xid.vis.last";
    const DEFAULT_MODE = "bars";
    const FPS = 30;
    const BARS = 64;

    const state = {
        config: { mode: DEFAULT_MODE, rotate: false },
        mode: DEFAULT_MODE,
        analyser: null,
        freq: null,
        time: null,
        canvas: null,
        ctx: null,
        raf: 0,
        last: 0,
        width: 0,
        height: 0,
        dpr: 1,
        gradient: null,
        accent: "#d41515",
        cool: "#edebe6",
        phase: 0
    };

    const byId = id => document.getElementById(id);
    const wrapper = () => byId("visualizer-wrapper");
    const player = () => byId("main-audio");

    function panelOpen() {
        const node = wrapper();
        return Boolean(node && !node.hidden);
    }

    function playing() {
        const audio = player();
        return Boolean(audio && !audio.paused && !audio.ended);
    }

    function session(key) {
        try {
            return window.sessionStorage.getItem(key) || "";
        } catch {
            return "";
        }
    }

    function remember(key, value) {
        try {
            window.sessionStorage.setItem(key, value);
        } catch {
            /* private mode: rotation may repeat */
        }
    }

    /* Rotation must actually change something, so the previous style is
       skipped; a fixed choice is honoured as long as it is a known style. */
    function chooseMode(config) {
        const doc = config && typeof config === "object" ? config : {};
        const wanted = MODES.includes(doc.mode) ? doc.mode : DEFAULT_MODE;
        if (!doc.rotate) return wanted;
        const last = session(LAST_KEY);
        const pool = ROTATION.filter(mode => mode !== last);
        const next = pool[Math.floor(Math.random() * pool.length)] || wanted;
        remember(LAST_KEY, next);
        return next;
    }

    /* ------------------------------------------------------------- the canvas */

    function claimCanvas() {
        if (state.canvas) return true;
        const legacy = byId("global-visualizer-canvas");
        if (!legacy || !legacy.parentNode) return false;

        // Taking the id away stops the old paint loop from finding a canvas to
        // draw into, so only this one paints.
        legacy.removeAttribute("id");
        legacy.hidden = true;

        const canvas = document.createElement("canvas");
        canvas.id = "xid-vis-canvas";
        canvas.className = "xid-vis-canvas";
        legacy.parentNode.insertBefore(canvas, legacy.nextSibling);

        state.canvas = canvas;
        state.ctx = canvas.getContext("2d", { alpha: false });
        sizeCanvas();
        window.addEventListener("resize", sizeCanvas, { passive: true });
        window.addEventListener("orientationchange", sizeCanvas, { passive: true });
        if (typeof ResizeObserver === "function") {
            const observer = new ResizeObserver(sizeCanvas);
            observer.observe(canvas.parentElement || canvas);
        }
        return true;
    }

    function sizeCanvas() {
        const canvas = state.canvas;
        if (!canvas || !state.ctx) return;
        const box = canvas.parentElement;
        if (!box) return;
        // A phone at 3x does not need 3x pixels for a small bar display.
        state.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        state.width = Math.max(1, Math.round(box.clientWidth * state.dpr));
        state.height = Math.max(1, Math.round(box.clientHeight * state.dpr));
        canvas.width = state.width;
        canvas.height = state.height;
        buildPaint();
    }

    function readColours() {
        const style = window.getComputedStyle(document.documentElement);
        const blood = style.getPropertyValue("--blood").trim();
        const cool = style.getPropertyValue("--cyan").trim();
        if (blood) state.accent = blood;
        if (cool) state.cool = cool;
    }

    /* One gradient per size change, reused by every bar in the frame. */
    function buildPaint() {
        if (!state.ctx) return;
        readColours();
        const gradient = state.ctx.createLinearGradient(0, state.height, 0, 0);
        gradient.addColorStop(0, hexToRgba(state.accent, 0.12));
        gradient.addColorStop(0.45, hexToRgba(state.accent, 0.72));
        gradient.addColorStop(1, hexToRgba(state.cool, 0.95));
        state.gradient = gradient;
    }

    function hexToRgba(value, alpha) {
        const text = String(value || "").trim();
        const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
        if (!hex) return text || `rgba(212, 21, 21, ${alpha})`;
        const raw = hex[1];
        const full = raw.length === 3 ? raw.split("").map(c => c + c).join("") : raw;
        const r = parseInt(full.slice(0, 2), 16);
        const g = parseInt(full.slice(2, 4), 16);
        const b = parseInt(full.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    /* ------------------------------------------------------------- the styles */

    function energy(index, span) {
        const freq = state.freq;
        if (!freq || !freq.length) return 0;
        const start = Math.floor((index / span) * freq.length);
        const end = Math.max(start + 1, Math.floor(((index + 1) / span) * freq.length));
        let sum = 0;
        for (let i = start; i < end; i += 1) sum += freq[i] || 0;
        return sum / (end - start) / 255;
    }

    function clear() {
        const { ctx, width, height } = state;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, width, height);
    }

    function drawBars() {
        const { ctx, width, height, gradient } = state;
        const barWidth = width / BARS;
        ctx.fillStyle = gradient;
        for (let i = 0; i < BARS; i += 1) {
            const value = energy(i, BARS);
            const barHeight = Math.max(1, value * height * 0.94);
            ctx.fillRect(i * barWidth + barWidth * 0.2, height - barHeight, barWidth * 0.6, barHeight);
        }
    }

    function drawMirror() {
        const { ctx, width, height, gradient } = state;
        const half = BARS / 2;
        const barWidth = width / BARS;
        ctx.fillStyle = gradient;
        for (let i = 0; i < half; i += 1) {
            const value = energy(i, half);
            const barHeight = Math.max(1, value * height * 0.46);
            const offset = i * barWidth;
            ctx.fillRect(width / 2 + offset, height / 2 - barHeight, barWidth * 0.72, barHeight);
            ctx.fillRect(width / 2 - offset - barWidth * 0.72, height / 2 - barHeight, barWidth * 0.72, barHeight);
            ctx.fillRect(width / 2 + offset, height / 2, barWidth * 0.72, barHeight);
            ctx.fillRect(width / 2 - offset - barWidth * 0.72, height / 2, barWidth * 0.72, barHeight);
        }
    }

    function drawWave() {
        const { ctx, width, height, time } = state;
        if (!time || !time.length) return;
        ctx.beginPath();
        for (let i = 0; i < time.length; i += 1) {
            const x = (i / (time.length - 1)) * width;
            const y = (time[i] / 255) * height;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = state.accent;
        ctx.lineWidth = Math.max(1, 2 * state.dpr);
        ctx.stroke();

        // A dimmer second pass gives the trace some weight without shadows.
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = state.cool;
        ctx.lineWidth = Math.max(1, 5 * state.dpr);
        ctx.stroke();
        ctx.globalAlpha = 1;
    }

    function drawRadial() {
        const { ctx, width, height } = state;
        const cx = width / 2;
        const cy = height / 2;
        const radius = Math.min(width, height) * 0.28;
        const bars = 48;
        ctx.lineCap = "butt";
        for (let i = 0; i < bars; i += 1) {
            const value = energy(i, bars);
            const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;
            const length = Math.max(2, value * radius * 1.05);
            const x1 = cx + Math.cos(angle) * radius;
            const y1 = cy + Math.sin(angle) * radius;
            const x2 = cx + Math.cos(angle) * (radius + length);
            const y2 = cy + Math.sin(angle) * (radius + length);
            ctx.strokeStyle = i % 2 ? state.cool : state.accent;
            ctx.globalAlpha = 0.25 + value * 0.75;
            ctx.lineWidth = Math.max(2, (Math.PI * radius) / bars * 0.55);
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }

    function drawDots() {
        const { ctx, width, height } = state;
        const cols = 32;
        const rows = 6;
        const cellW = width / cols;
        const cellH = height / rows;
        const size = Math.min(cellW, cellH) * 0.5;
        for (let row = 0; row < rows; row += 1) {
            for (let col = 0; col < cols; col += 1) {
                const value = energy(col, cols);
                ctx.globalAlpha = 0.12 + value * 0.88;
                ctx.fillStyle = (row + col) % 3 === 0 ? state.accent : state.cool;
                ctx.fillRect(col * cellW + cellW / 2 - size / 2, row * cellH + cellH / 2 - size / 2, size, size);
            }
        }
        ctx.globalAlpha = 1;
    }

    function drawPulse() {
        const { ctx, width, height } = state;
        const bass = energy(0, 8);
        state.phase += 0.06;
        const cx = width / 2;
        const cy = height / 2;
        const base = Math.min(width, height) * 0.18;
        for (let ring = 0; ring < 3; ring += 1) {
            const grow = ((state.phase + ring * 0.9) % 2.7) / 2.7;
            const radius = base + grow * Math.min(width, height) * 0.4 + bass * 18 * state.dpr;
            ctx.globalAlpha = (1 - grow) * (0.25 + bass * 0.75);
            ctx.strokeStyle = ring === 1 ? state.accent : state.cool;
            ctx.lineWidth = Math.max(1, 2 * state.dpr);
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = state.accent;
        ctx.beginPath();
        ctx.arc(cx, cy, base * (0.55 + bass * 0.7), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    }

    const RENDER = {
        bars: drawBars,
        mirror: drawMirror,
        wave: drawWave,
        radial: drawRadial,
        dots: drawDots,
        pulse: drawPulse
    };

    /* ------------------------------------------------------------- the loop */

    function clearOnce() {
        if (state.ctx) clear();
    }

    function shouldPaint() {
        return Boolean(state.analyser && state.freq && panelOpen() && playing() && !document.hidden);
    }

    function tick(now) {
        state.raf = 0;
        if (!shouldPaint()) {
            clearOnce();
            return;
        }
        const gap = 1000 / FPS;
        if (now - state.last < gap) {
            state.raf = window.requestAnimationFrame(tick);
            return;
        }
        state.last = now;

        const draw = RENDER[state.mode];
        clear();
        if (!draw) {
            state.raf = window.requestAnimationFrame(tick);
            return;
        }
        if (state.mode === "wave" || state.mode === "pulse") {
            state.analyser.getByteTimeDomainData(state.time);
        } else {
            state.analyser.getByteFrequencyData(state.freq);
        }
        draw();
        state.raf = window.requestAnimationFrame(tick);
    }

    function start() {
        claimCanvas();
        if (state.raf || !shouldPaint()) return;
        state.raf = window.requestAnimationFrame(tick);
    }

    function stop() {
        if (state.raf) window.cancelAnimationFrame(state.raf);
        state.raf = 0;
        clearOnce();
    }

    function restart() {
        stop();
        start();
    }

    /* --------------------------------------------------------------- audio tap */

    /* site.js builds the analyser its own way; this captures the node it makes
       so the display can read the same data without touching the audio chain. */
    function hookAudio() {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx || !Ctx.prototype || Ctx.prototype.__xidVisualizer) return;
        const original = Ctx.prototype.createAnalyser;
        if (typeof original !== "function") return;
        Ctx.prototype.createAnalyser = function () {
            const node = original.apply(this, arguments);
            if (!state.analyser) {
                state.analyser = node;
                state.freq = new Uint8Array(node.frequencyBinCount);
                state.time = new Uint8Array(node.fftSize);
                start();
            }
            return node;
        };
        Ctx.prototype.__xidVisualizer = true;
    }

    /* ------------------------------------------------------------ lifecycle */

    function wire() {
        const audio = player();
        if (audio) {
            audio.addEventListener("play", restart);
            audio.addEventListener("pause", stop);
            audio.addEventListener("ended", stop);
        }

        const node = wrapper();
        if (node && typeof MutationObserver === "function") {
            new MutationObserver(restart).observe(node, { attributes: true, attributeFilter: ["hidden"] });
        }

        document.addEventListener("visibilitychange", () => {
            if (document.hidden) stop();
            else restart();
        });

        window.addEventListener("pagehide", stop);
    }

    async function load() {
        const doc = FEED ? await FEED.json(PATH) : null;
        const config = doc && typeof doc === "object" ? doc : { mode: DEFAULT_MODE, rotate: false };
        state.config = { mode: config.mode, rotate: Boolean(config.rotate) };
        state.mode = chooseMode(state.config);
        document.documentElement.setAttribute("data-visualizer", state.mode);
        if (FEED && typeof FEED.watch === "function") {
            FEED.watch([PATH], () => load(), 30000);
        }
        start();
        return state.mode;
    }

    function boot() {
        if (!claimCanvas()) return;
        hookAudio();
        wire();
        load();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }

    window.XIDVisualizer = {
        modes: MODES,
        chooseMode,
        load,
        setMode(mode) {
            state.mode = MODES.includes(mode) ? mode : DEFAULT_MODE;
            restart();
            return state.mode;
        },
        get mode() {
            return state.mode;
        },
        get running() {
            return Boolean(state.raf);
        }
    };
})();
