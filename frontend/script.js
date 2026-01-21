const MAX_CHARS = 5000;

const COLOR_GOOD = [76, 175, 80];
const COLOR_WARN = [255, 183, 77];
const COLOR_BAD = [229, 115, 115];

const LOADER_FG = "#e9ecff";
const LOADER_RING = "rgba(96,165,250,0.18)";

const EQ_FREQS = [60, 250, 1000, 4000, 10000];

const SPIKE_IN = 0.5;
const SPIKE_HOLD = 1.0;
const SPIKE_OUT = 0.5;
const SPIKE_LIFE = SPIKE_IN + SPIKE_HOLD + SPIKE_OUT;
const SPIKE_RATE = 1.5;
const VIZ_BINS = 240;

let voices = [];
let selectedVoice = null;

let isExpanded = false;

let currentObjectUrl = null;
let currentBlob = null;

let lastNonZeroVolume = 1;
let volumeAnimRaf = null;

let seekRaf = null;
let isSeeking = false;

let smoothBaseTime = 0;
let smoothBasePerf = 0;
let smoothLastSyncPerf = 0;

let speedMenuPortaled = false;
let speedMenuPlaceholder = null;

let baseSpeed = 1;

let audioFx = { eq: [0, 0, 0, 0, 0] };

let audioCtx = null;
let mediaSrc = null;
let eqNodes = null;
let gainNode = null;

let vizRunning = false;
let vizRaf = null;
let vizT0 = 0;
let vizLastT = 0;
const vizSpikes = [];

const dropdown = document.getElementById("voiceDropdown");
const trigger = dropdown.querySelector(".custom-select-trigger");
const triggerText = dropdown.querySelector(".trigger-text");
const searchInput = dropdown.querySelector(".custom-search");
const optionsContainer = dropdown.querySelector(".custom-options");

const themeToggle = document.getElementById("themeToggle");

const textInput = document.getElementById("textInput");
const charCount = document.getElementById("charCount");
const expandBtn = document.getElementById("expandBtn");
const generateBtn = document.getElementById("generateBtn");

const audioOutput = document.getElementById("audioOutput");
const audioEl = document.getElementById("audioEl");
const seekBar = document.getElementById("seekBar");
const seekThumb = document.getElementById("seekThumb");
const timeCurrent = document.getElementById("timeCurrent");
const timeDuration = document.getElementById("timeDuration");

const playBtn = document.getElementById("playBtn");
const pauseBtn = document.getElementById("pauseBtn");
const stopBtn = document.getElementById("stopBtn");

const muteBtn = document.getElementById("muteBtn");
const volIcon = document.getElementById("volIcon");
const mutedIcon = document.getElementById("mutedIcon");
const volumeBar = document.getElementById("volumeBar");

const downloadBtn = document.getElementById("downloadBtn");

const speedDropdown = document.getElementById("speedDropdown");
const speedTriggerText = document.getElementById("speedTriggerText");
const speedTriggerBtn = speedDropdown.querySelector(".mini-select-trigger");
const speedOptions = Array.from(speedDropdown.querySelectorAll(".mini-option"));
const speedDropdownBox = speedDropdown.querySelector(".mini-dropdown-box");

const autoplayToggle = document.getElementById("autoplayToggle");

const footer = document.getElementsByClassName("footer")[0];

const settingsBtn = document.getElementById("settingsBtn");
const settingsPanel = document.getElementById("audioSettings");
const resetAudioFxBtn = document.getElementById("resetAudioFxBtn");
const eqSliders = Array.from(document.querySelectorAll(".eq-slider"));

const loadingOverlay = document.getElementById("loadingOverlay");

const vizCanvas = document.getElementById("viz");
const vizCtx = vizCanvas.getContext("2d");

const popupHost = document.getElementById("popupHost");
let popupActive = null;

function initPageEntrance() {
    const root = document.documentElement;

    requestAnimationFrame(() => {
        root.classList.add("page-ready");
    });

    window.addEventListener("pageshow", (e) => {
        if (e.persisted) root.classList.add("page-ready");
    });
}

function popupEscapeHtml(s) {
    return String(s)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function popupClose(node, resolve, value = true) {
    if (!node || node.classList.contains("closing")) return;
    node.classList.add("closing");

    const done = () => {
        node.removeEventListener("transitionend", done);
        node.remove();
        if (popupActive === node) popupActive = null;
        resolve(value);
    };

    node.addEventListener("transitionend", done);
    setTimeout(done, 260);
}

function popupShow({
    title = "Notice",
    message = "",
    variant = "info",
    okText = "OK",
    timeoutMs = 0,
} = {}) {
    if (!popupHost) return Promise.resolve(true);

    if (popupActive) popupActive.remove();

    const barColor =
        variant === "error"
            ? "rgb(229,115,115)"
            : variant === "warn"
                ? "rgb(255,183,77)"
                : "var(--accent-color)";

    const node = document.createElement("div");
    node.className = "popup";
    node.setAttribute("role", "status");
    node.tabIndex = -1;

    node.innerHTML = `
      <div class="popup-bar" style="background:${barColor}"></div>
      <div class="popup-body">
        <div class="popup-texts">
          <div class="popup-title">${popupEscapeHtml(title)}</div>
          <div class="popup-message">${popupEscapeHtml(message)}</div>
        </div>
        <div class="popup-actions">
          <button class="popup-btn primary" data-action="ok">${popupEscapeHtml(okText)}</button>
          <button class="popup-btn popup-x" data-action="x" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M18 6L6 18"></path>
              <path d="M6 6l12 12"></path>
            </svg>
          </button>
        </div>
      </div>
    `;

    popupHost.appendChild(node);
    popupActive = node;

    requestAnimationFrame(() => node.classList.add("open"));
    node.focus({ preventScroll: true });

    return new Promise((resolve) => {
        const onClick = (e) => {
            const btn = e.target.closest("button[data-action]");
            if (!btn) return;
            popupClose(node, resolve, true);
        };

        const onKey = (e) => {
            if (e.key === "Escape" || e.key === "Enter") popupClose(node, resolve, true);
        };

        node.addEventListener("click", onClick);
        document.addEventListener("keydown", onKey);

        node.addEventListener("transitionend", () => {
            if (!node.isConnected) document.removeEventListener("keydown", onKey);
        });

        if (timeoutMs > 0) {
            setTimeout(() => {
                if (node.isConnected) popupClose(node, resolve, true);
            }, timeoutMs);
        }
    });
}

window.popup = function (message, opts = {}) {
    return popupShow({
        title: opts.title || "Notice",
        message,
        variant: opts.variant || "info",
        okText: opts.okText || "OK",
        timeoutMs: opts.timeoutMs || 0,
    });
};

function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
}

function clamp01(n) {
    return Math.max(0, Math.min(1, Number(n)));
}

function smoothstep01(x) {
    x = clamp(x, 0, 1);
    return x * x * (3 - 2 * x);
}

function hexToRgba(hex, a) {
    let h = (hex || "").replace("#", "").trim();
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h, 16);
    if (!Number.isFinite(n)) return `rgba(233,236,255,${a})`;
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r},${g},${b},${a})`;
}

function writeStr(view, offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
}

function waitForTransitionEnd(el, timeoutMs = 450) {
    return new Promise((resolve) => {
        let done = false;

        const finish = () => {
            if (done) return;
            done = true;
            el.removeEventListener("transitionend", onEnd);
            clearTimeout(t);
            resolve();
        };

        const onEnd = (e) => {
            if (e.target !== el) return;
            finish();
        };

        const t = setTimeout(finish, timeoutMs);
        el.addEventListener("transitionend", onEnd);
    });
}

function getSystemTheme() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getStoredTheme() {
    return localStorage.getItem("theme");
}

function setTheme(theme) {
    const isDark = theme === "dark";
    document.documentElement.classList.toggle("dark", isDark);
    document.body.classList.toggle("dark", isDark);
    localStorage.setItem("theme", theme);
}

function initTheme() {
    const storedTheme = getStoredTheme();
    setTheme(storedTheme || getSystemTheme());
}

function hasRenderedAudio() {
    return audioOutput.classList.contains("show") && !!audioEl.src;
}

function updateSeekUI(cur, dur) {
    const pct = dur > 0 ? Math.min(100, Math.max(0, (cur / dur) * 100)) : 0;
    seekBar.style.setProperty("--progress", `${pct}%`);

    const trackWidth = seekBar.clientWidth;
    const thumbSize = 16;
    const x = thumbSize / 2 + (pct / 100) * (trackWidth - thumbSize);
    seekThumb.style.left = `${x}px`;
}

function syncTransportButtons() {
    const hasAudio = !!audioEl.src;
    playBtn.disabled = !hasAudio || !audioEl.paused;
    pauseBtn.disabled = !hasAudio || audioEl.paused;
    stopBtn.disabled = !hasAudio;
}

function setVolumeUI(value) {
    const v = clamp01(value);
    volumeBar.value = String(v);

    const isMuted = v === 0;
    volIcon.style.display = isMuted ? "none" : "block";
    mutedIcon.style.display = isMuted ? "block" : "none";
    muteBtn.setAttribute("aria-label", isMuted ? "Unmute" : "Mute");

    if (audioEl.src) audioEl.volume = 1;
    if (gainNode) gainNode.gain.value = v;
}

function animateVolumeTo(target, ms = 180) {
    const from = Number(volumeBar.value);
    const to = clamp01(target);

    if (volumeAnimRaf) cancelAnimationFrame(volumeAnimRaf);

    const start = performance.now();
    const delta = to - from;

    const step = (now) => {
        const t = Math.min(1, (now - start) / ms);
        const eased = 1 - Math.pow(1 - t, 3);
        const v = from + delta * eased;

        setVolumeUI(v);

        if (t < 1) volumeAnimRaf = requestAnimationFrame(step);
        else volumeAnimRaf = null;
    };

    volumeAnimRaf = requestAnimationFrame(step);
}

function syncSmoothClock() {
    smoothBaseTime = audioEl.currentTime || 0;
    smoothBasePerf = performance.now();
    smoothLastSyncPerf = smoothBasePerf;
}

function startSeekRaf() {
    if (seekRaf) return;

    syncSmoothClock();

    const tick = (now) => {
        seekRaf = null;

        if (!audioEl.src) return;

        if (!audioEl.paused && !isSeeking) {
            const dur = audioEl.duration || 0;
            const rate = audioEl.playbackRate || 1;

            let est = smoothBaseTime + ((now - smoothBasePerf) / 1000) * rate;

            if (dur > 0) {
                if (dur - est < 0.03) est = dur;
                if (est > dur) est = dur;
                if (est < 0) est = 0;
            } else {
                if (est < 0) est = 0;
            }

            seekBar.value = est;
            timeCurrent.textContent = fmtTime(est);
            updateSeekUI(est, dur);

            if (now - smoothLastSyncPerf > 250) {
                const real = audioEl.currentTime || 0;
                const drift = Math.abs(real - est);
                if (drift > 0.08) {
                    smoothBaseTime = real;
                    smoothBasePerf = now;
                } else {
                    smoothBaseTime = est;
                    smoothBasePerf = now;
                }
                smoothLastSyncPerf = now;
            }
        }

        if (!audioEl.paused) seekRaf = requestAnimationFrame(tick);
    };

    seekRaf = requestAnimationFrame(tick);
}

function stopSeekRaf() {
    if (!seekRaf) return;
    cancelAnimationFrame(seekRaf);
    seekRaf = null;
}

function applyAudioFxToUI() {
    eqSliders.forEach((s) => {
        const idx = Number(s.dataset.band);
        const v = Number(audioFx.eq[idx] || 0);
        s.value = String(v);
        const valEl = s.closest(".eq-band")?.querySelector(".eq-val");
        if (valEl) valEl.textContent = v.toFixed(1);
    });
}

function resetAudioFx() {
    audioFx = { eq: [0, 0, 0, 0, 0] };
    applyAudioFxToUI();
    applyEqLive();
}

function ensureAudioGraph() {
    if (audioCtx) return;

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    mediaSrc = audioCtx.createMediaElementSource(audioEl);

    gainNode = audioCtx.createGain();
    gainNode.gain.value = Number(volumeBar.value || 1);

    eqNodes = EQ_FREQS.map((f) => {
        const biquad = audioCtx.createBiquadFilter();
        biquad.type = "peaking";
        biquad.frequency.value = f;
        biquad.Q.value = 1;
        biquad.gain.value = 0;
        return biquad;
    });

    mediaSrc.connect(eqNodes[0]);
    for (let i = 0; i < eqNodes.length - 1; i++) eqNodes[i].connect(eqNodes[i + 1]);
    eqNodes[eqNodes.length - 1].connect(gainNode);
    gainNode.connect(audioCtx.destination);

    applyEqLive();
}

async function resumeAudioGraph() {
    ensureAudioGraph();
    if (audioCtx && audioCtx.state === "suspended") {
        try {
            await audioCtx.resume();
        } catch { }
    }
}

function applyEqLive() {
    if (!eqNodes) return;
    for (let i = 0; i < 5; i++) eqNodes[i].gain.value = Number(audioFx.eq[i] || 0);
}

function applyPlaybackRate() {
    audioEl.playbackRate = Number(baseSpeed || 1);
}

function toggleSettingsPanel() {
    const open = settingsPanel.classList.toggle("open");
    settingsPanel.setAttribute("aria-hidden", open ? "false" : "true");
    settingsBtn.setAttribute("aria-expanded", open ? "true" : "false");
}

function setSpeed(value) {
    baseSpeed = Number(value);

    speedTriggerText.textContent = `${baseSpeed.toFixed(baseSpeed % 1 === 0 ? 1 : 2)}x`.replace(/\.00x$/, ".0x");
    speedOptions.forEach((btn) => btn.classList.toggle("selected", btn.dataset.value === String(value)));

    applyPlaybackRate();
}

function populateOptions(list) {
    optionsContainer.innerHTML = "";

    list.forEach((voice) => {
        const option = document.createElement("div");
        option.classList.add("custom-option");
        option.dataset.value = voice.value;
        option.textContent = voice.label;

        option.classList.toggle("selected", voice.value === selectedVoice);

        option.addEventListener("click", () => {
            selectedVoice = voice.value;
            triggerText.textContent = voice.label;
            dropdown.classList.remove("open");
            searchInput.value = "";
            populateOptions(voices);
        });

        optionsContainer.appendChild(option);
    });
}

function updateCharCount() {
    const len = textInput.value.length;
    charCount.textContent = `${len} / ${MAX_CHARS} characters`;

    let color;
    if (len <= MAX_CHARS * 0.8) {
        const t = len / (MAX_CHARS * 0.8);
        color = COLOR_GOOD.map((v, i) => Math.round(v + (COLOR_WARN[i] - v) * t));
    } else if (len <= MAX_CHARS) {
        const t = (len - MAX_CHARS * 0.8) / (MAX_CHARS * 0.2);
        color = COLOR_WARN.map((v, i) => Math.round(v + (COLOR_BAD[i] - v) * t));
    } else {
        color = COLOR_BAD;
    }

    charCount.style.color = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}

function toggleExpand() {
    isExpanded = !isExpanded;
    textInput.classList.toggle("expanded", isExpanded);
    expandBtn.title = isExpanded ? "Collapse" : "Expand";
}

async function waitForAudioBlob(downloadUrl) {
    while (true) {
        const pollRes = await fetch(downloadUrl);

        if (pollRes.status === 202) {
            await new Promise((r) => setTimeout(r, 1000));
            continue;
        }

        if (pollRes.status === 200) return await pollRes.blob();

        const textErr = await pollRes.text().catch(() => "");
        throw new Error(`Unexpected response: ${pollRes.status}\n${textErr}`);
    }
}

async function hideAndResetAudioOutput() {
    if (!hasRenderedAudio()) return;

    try {
        audioEl.pause();
    } catch { }

    stopSeekRaf();

    audioOutput.classList.remove("show");
    await waitForTransitionEnd(audioOutput);

    audioEl.removeAttribute("src");
    audioEl.load();

    if (currentObjectUrl) {
        URL.revokeObjectURL(currentObjectUrl);
        currentObjectUrl = null;
    }

    currentBlob = null;

    seekBar.value = 0;
    timeCurrent.textContent = "0:00";
    timeDuration.textContent = "0:00";
    updateSeekUI(0, 0);
    syncTransportButtons();

    footer.style.marginTop = "-12vh";
}

function showLoading() {
    document.body.classList.add("loading");
    loadingOverlay.classList.add("open");
    loadingOverlay.setAttribute("aria-hidden", "false");
    startViz();
}

async function hideLoading() {
    stopViz();
    loadingOverlay.classList.remove("open");
    loadingOverlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("loading");
    await waitForTransitionEnd(loadingOverlay, 400);
}

function vizResize() {
    const dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
    const w = vizCanvas.clientWidth;
    const h = vizCanvas.clientHeight;
    vizCanvas.width = Math.floor(w * dpr);
    vizCanvas.height = Math.floor(h * dpr);
    vizCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function catmullRomClosedToBezier(points) {
    const beziers = [];
    const n = points.length;

    for (let i = 0; i < n; i++) {
        const p0 = points[(i - 1 + n) % n];
        const p1 = points[i];
        const p2 = points[(i + 1) % n];
        const p3 = points[(i + 2) % n];

        const c1x = p1.x + (p2.x - p0.x) / 6;
        const c1y = p1.y + (p2.y - p0.y) / 6;
        const c2x = p2.x - (p3.x - p1.x) / 6;
        const c2y = p2.y - (p3.y - p1.y) / 6;

        beziers.push({ p1, c1: { x: c1x, y: c1y }, c2: { x: c2x, y: c2y }, p2 });
    }

    return beziers;
}

function amplitudeAt(angle, t) {
    const travel1 = 0.5 + 0.5 * Math.sin(angle * 2.0 - t * 1.8);
    const travel2 = 0.5 + 0.5 * Math.sin(angle * 4.6 + t * 1.15 + 1.2);
    const travel3 = 0.5 + 0.5 * Math.sin(angle * 7.8 - t * 0.85 + 2.6);

    const breath = 0.62 + 0.22 * Math.sin(t * 0.9) + 0.1 * Math.sin(t * 0.41 + 2.0);

    let v = 0.15 + 0.55 * travel1 + 0.22 * travel2 + 0.16 * travel3;
    v = clamp(v, 0, 1);
    v = Math.pow(v, 1.25) * breath;

    return clamp(v, 0, 1);
}

function wrapAngleDiff(a) {
    a = (a + Math.PI) % (Math.PI * 2);
    if (a < 0) a += Math.PI * 2;
    return a - Math.PI;
}

function smoothCircular(arr, passes = 1) {
    const n = arr.length;
    let a = arr.slice();
    let b = new Array(n);

    for (let p = 0; p < passes; p++) {
        for (let i = 0; i < n; i++) {
            const im2 = (i - 2 + n) % n;
            const im1 = (i - 1 + n) % n;
            const ip1 = (i + 1) % n;
            const ip2 = (i + 2) % n;
            b[i] = (a[im2] + 4 * a[im1] + 6 * a[i] + 4 * a[ip1] + a[ip2]) / 16;
        }
        const tmp = a;
        a = b;
        b = tmp;
    }

    return a;
}

function spawnSpike(t) {
    vizSpikes.push({
        t0: t,
        angle: Math.random() * Math.PI * 2,
        sigma: 0.08 + Math.random() * 0.12,
        strength: 0.45 + Math.random() * 0.9,
    });
}

function maybeSpawnSpikes(t, dt) {
    const expected = SPIKE_RATE * dt;
    let x = expected;

    while (x > 0) {
        if (Math.random() < x) spawnSpike(t);
        x -= 1;
    }
}

function spikeContribution(angle, t) {
    let add = 0;

    for (let i = vizSpikes.length - 1; i >= 0; i--) {
        const s = vizSpikes[i];
        const age = t - s.t0;

        if (age >= SPIKE_LIFE) {
            vizSpikes.splice(i, 1);
            continue;
        }

        let env = 0;
        if (age < SPIKE_IN) env = smoothstep01(age / SPIKE_IN);
        else if (age < SPIKE_IN + SPIKE_HOLD) env = 1;
        else {
            const u = (age - (SPIKE_IN + SPIKE_HOLD)) / SPIKE_OUT;
            env = 1 - smoothstep01(u);
        }

        const d = wrapAngleDiff(angle - s.angle);
        const g = Math.exp(-(d * d) / (2 * s.sigma * s.sigma));
        add += s.strength * env * g;
    }

    return add;
}

function startViz() {
    if (vizRunning) return;
    vizRunning = true;
    vizT0 = performance.now();
    vizLastT = 0;
    vizResize();
    vizLoop();
}

function stopViz() {
    vizRunning = false;
    if (vizRaf) cancelAnimationFrame(vizRaf);
    vizRaf = null;
    vizSpikes.length = 0;
}

function vizLoop() {
    if (!vizRunning) return;

    const t = (performance.now() - vizT0) * 0.001;
    const dt = Math.max(0, t - vizLastT);
    vizLastT = t;

    maybeSpawnSpikes(t, dt);

    const w = vizCanvas.clientWidth;
    const h = vizCanvas.clientHeight;
    const cx = w / 2;
    const cy = h / 2;

    vizCtx.clearRect(0, 0, w, h);

    const baseR = Math.min(w, h) * 0.28;
    const waveMax = Math.min(w, h) * 0.06;
    const innerCap = Math.min(w, h) * 0.01;

    vizCtx.save();
    vizCtx.beginPath();
    vizCtx.arc(cx, cy, baseR, 0, Math.PI * 2);
    vizCtx.strokeStyle = LOADER_RING;
    vizCtx.lineWidth = Math.max(2, Math.min(6, baseR * 0.06));
    vizCtx.stroke();
    vizCtx.restore();

    const ptsOuter = [];
    const ptsInner = [];
    const rot = t * 0.22;

    const rOuter = new Array(VIZ_BINS);
    const rInner = new Array(VIZ_BINS);
    const phase = ((Math.PI * 2) / VIZ_BINS) * 0.5;

    for (let i = 0; i < VIZ_BINS; i++) {
        const a = (i / VIZ_BINS) * Math.PI * 2 + rot + phase;
        const v = amplitudeAt(a, t);
        const spike = spikeContribution(a, t);
        const vOut = v + spike * 0.75;

        const ampOut = Math.pow(clamp(vOut, 0, 2), 1.15) * waveMax;
        const inset = innerCap * (0.35 + 0.65 * (1 - v));

        rOuter[i] = baseR + ampOut;
        rInner[i] = baseR - inset;
    }

    const rOuterSmooth = smoothCircular(rOuter, 2);
    const rInnerSmooth = smoothCircular(rInner, 2);

    for (let i = 0; i < VIZ_BINS; i++) {
        const a = (i / VIZ_BINS) * Math.PI * 2 + rot + phase;
        ptsOuter.push({ x: cx + Math.cos(a) * rOuterSmooth[i], y: cy + Math.sin(a) * rOuterSmooth[i] });
        ptsInner.push({ x: cx + Math.cos(a) * rInnerSmooth[i], y: cy + Math.sin(a) * rInnerSmooth[i] });
    }

    const outerBez = catmullRomClosedToBezier(ptsOuter);
    const innerBez = catmullRomClosedToBezier(ptsInner);

    vizCtx.save();
    vizCtx.beginPath();

    vizCtx.moveTo(outerBez[0].p1.x, outerBez[0].p1.y);
    for (const seg of outerBez) {
        vizCtx.bezierCurveTo(seg.c1.x, seg.c1.y, seg.c2.x, seg.c2.y, seg.p2.x, seg.p2.y);
    }
    vizCtx.closePath();

    vizCtx.moveTo(innerBez[0].p1.x, innerBez[0].p1.y);
    for (let i = innerBez.length - 1; i >= 0; i--) {
        const seg = innerBez[i];
        vizCtx.bezierCurveTo(seg.c2.x, seg.c2.y, seg.c1.x, seg.c1.y, seg.p1.x, seg.p1.y);
    }
    vizCtx.closePath();

    vizCtx.lineJoin = "round";
    vizCtx.lineCap = "round";
    vizCtx.miterLimit = 2;

    vizCtx.globalCompositeOperation = "lighter";
    vizCtx.fillStyle = hexToRgba(LOADER_FG, 0.95);
    vizCtx.fill("evenodd");

    vizCtx.globalCompositeOperation = "source-over";
    vizCtx.strokeStyle = hexToRgba(LOADER_FG, 0.52);
    vizCtx.lineWidth = 1.2;
    vizCtx.stroke();

    vizCtx.restore();

    vizRaf = requestAnimationFrame(vizLoop);
}

async function generateSpeech() {
    const text = textInput.value.trim();

    if (!selectedVoice) return popup("Please select a voice", { title: "Missing voice", variant: "warn" });
    if (!text) return popup("Please enter some text", { title: "Missing text", variant: "warn" });

    if (text.length > MAX_CHARS) {
        return popup(
            `Text is too long! Maximum ${MAX_CHARS} characters allowed.\n\nWant no character limits? Self-host this project over at https://github.com/rip-super/tts-service`,
            { title: "Too long", variant: "error" }
        );
    }

    generateBtn.disabled = true;
    showLoading();

    try {
        await hideAndResetAudioOutput();

        const res = await fetch("/api", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ voice: selectedVoice, text }),
        });

        if (!res.ok) {
            const textErr = await res.text().catch(() => "");
            return popup(`Request failed: ${res.status}\n${textErr}`, { title: "Request failed", variant: "error" });
        }

        const { downloadUrl } = await res.json();
        const audioData = await waitForAudioBlob(downloadUrl);

        loadGeneratedAudio(audioData);
    } catch (err) {
        popup(`Error generating voice: ${err.message || err}`, { title: "Error", variant: "error" });
    } finally {
        await hideLoading();
        generateBtn.disabled = false;
    }
}

async function renderProcessedWav(blob, speed, gain, eqDb) {
    const ab = await blob.arrayBuffer();
    const oac = new OfflineAudioContext(2, 1, 44100);
    const decoded = await oac.decodeAudioData(ab.slice(0));

    const channels = decoded.numberOfChannels;
    const sr = decoded.sampleRate;
    const len = decoded.length;

    const offline = new OfflineAudioContext(channels, Math.ceil(len / Math.max(0.01, speed)), sr);

    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.playbackRate.value = speed;

    const g = offline.createGain();
    g.gain.value = gain;

    const filters = EQ_FREQS.map((f, i) => {
        const biquad = offline.createBiquadFilter();
        biquad.type = "peaking";
        biquad.frequency.value = f;
        biquad.Q.value = 1;
        biquad.gain.value = Number(eqDb?.[i] || 0);
        return biquad;
    });

    src.connect(g);
    g.connect(filters[0]);
    for (let i = 0; i < filters.length - 1; i++) filters[i].connect(filters[i + 1]);
    filters[filters.length - 1].connect(offline.destination);

    src.start(0);

    const rendered = await offline.startRendering();
    return audioBufferToWavBlob(rendered);
}

function audioBufferToWavBlob(buffer) {
    const numCh = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const numFrames = buffer.length;

    const channels = [];
    for (let c = 0; c < numCh; c++) channels.push(buffer.getChannelData(c));

    const bytesPerSample = 2;
    const blockAlign = numCh * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = numFrames * blockAlign;

    const ab = new ArrayBuffer(44 + dataSize);
    const view = new DataView(ab);

    writeStr(view, 0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeStr(view, 8, "WAVE");

    writeStr(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numCh, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);

    writeStr(view, 36, "data");
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < numFrames; i++) {
        for (let c = 0; c < numCh; c++) {
            const s = Math.max(-1, Math.min(1, channels[c][i] || 0));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
            offset += 2;
        }
    }

    return new Blob([ab], { type: "audio/wav" });
}

async function downloadCurrentAudio() {
    if (!currentBlob) return;

    const speed = Number(baseSpeed || 1);
    const gain = clamp01(Number(volumeBar.value || 1));
    const eqDb = audioFx.eq.slice(0, 5);

    const needsProcessing =
        Math.abs(speed - 1) > 1e-6 ||
        Math.abs(gain - 1) > 1e-6 ||
        eqDb.some((v) => Math.abs(Number(v) || 0) > 1e-6);

    if (!needsProcessing && currentObjectUrl) {
        const type = (currentBlob.type || "").toLowerCase();
        const ext = type.includes("mpeg") || type.includes("mp3") ? "mp3" : "audio";

        const a = document.createElement("a");
        a.href = currentObjectUrl;
        a.download = `tts.${ext}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        return;
    }

    try {
        downloadBtn.disabled = true;

        const wavBlob = await renderProcessedWav(currentBlob, speed, gain, eqDb);
        const outUrl = URL.createObjectURL(wavBlob);

        const a = document.createElement("a");
        a.href = outUrl;
        a.download = "tts_edited.wav";
        document.body.appendChild(a);
        a.click();
        a.remove();

        setTimeout(() => URL.revokeObjectURL(outUrl), 2000);
    } catch (e) {
        popup(`Download processing failed: ${e?.message || e}`, { title: "Download failed", variant: "error" });
    } finally {
        downloadBtn.disabled = false;
    }
}

function loadGeneratedAudio(blob) {
    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);

    currentBlob = blob;
    currentObjectUrl = URL.createObjectURL(blob);

    audioEl.src = currentObjectUrl;
    audioEl.currentTime = 0;

    seekBar.value = 0;
    timeCurrent.textContent = "0:00";
    timeDuration.textContent = "0:00";

    setSpeed("1");
    lastNonZeroVolume = 1;
    setVolumeUI(1);

    resumeAudioGraph().then(() => applyEqLive());

    updateSeekUI(0, 0);
    audioOutput.classList.add("show");
    syncTransportButtons();

    if (autoplayToggle?.checked) {
        const tryPlay = async () => {
            try {
                await resumeAudioGraph();
                await audioEl.play();
            } catch { }
        };

        if (audioEl.readyState >= 2) tryPlay();
        else audioEl.addEventListener("canplay", tryPlay, { once: true });
    }

    footer.style.marginTop = "-3vh";
}

function initVoices() {
    fetch("/api/voices")
        .then((res) => {
            if (!res.ok) throw new Error(res.status);
            return res.json();
        })
        .then((data) => {
            voices = data
                .sort((a, b) => {
                    const qualityRank = { high: 0, medium: 1, low: 2 };
                    const langPopularity = [
                        "English",
                        "Spanish",
                        "French",
                        "German",
                        "Japanese",
                        "Korean",
                        "Chinese",
                        "Arabic",
                        "Portuguese",
                        "Italian",
                        "Dutch",
                        "Russian",
                    ];
                    const engRegionRank = { US: 0, GB: 1 };

                    const qA = qualityRank[a.key.includes("high") ? "high" : a.key.includes("medium") ? "medium" : "low"];
                    const qB = qualityRank[b.key.includes("high") ? "high" : b.key.includes("medium") ? "medium" : "low"];
                    if (qA !== qB) return qA - qB;

                    const lA = langPopularity.indexOf(a.family) >= 0 ? langPopularity.indexOf(a.family) : 1e9;
                    const lB = langPopularity.indexOf(b.family) >= 0 ? langPopularity.indexOf(b.family) : 1e9;
                    if (lA !== lB) return lA - lB;

                    if (a.family === "English" && b.family === "English") {
                        const rA = engRegionRank[a["short-region"]] ?? 1e9;
                        const rB = engRegionRank[b["short-region"]] ?? 1e9;
                        if (rA !== rB) return rA - rB;
                    }

                    return a.name.localeCompare(b.name);
                })
                .map((v) => ({ value: v.key, label: `${v.name} (${v.family}, ${v["short-region"]})` }));

            populateOptions(voices);

            const lessac = voices.find((v) => v.value.toLowerCase().includes("lessac"));
            if (lessac) {
                selectedVoice = lessac.value;
                triggerText.textContent = lessac.label;
            }
        })
        .catch(() => popup("API error", { title: "Network error", variant: "error" }));
}

function initUI() {
    charCount.textContent = `0 / ${MAX_CHARS} characters`;
    charCount.style.color = `rgb(${COLOR_GOOD[0]}, ${COLOR_GOOD[1]}, ${COLOR_GOOD[2]})`;

    setSpeed("1");
    applyAudioFxToUI();
    applyPlaybackRate();

    updateSeekUI(0, 0);
    syncTransportButtons();
    setVolumeUI(Number(volumeBar.value || 1));
}

function positionSpeedMenu() {
    if (!speedMenuPortaled) return;

    const triggerRect = speedTriggerBtn.getBoundingClientRect();
    const width = Math.max(triggerRect.width, 140);

    speedDropdownBox.style.width = `${width}px`;

    const menuRect = speedDropdownBox.getBoundingClientRect();
    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;

    let top = triggerRect.bottom + 8;
    if (top + menuRect.height > viewportH - 8) top = triggerRect.top - 8 - menuRect.height;

    let left = triggerRect.left;
    left = Math.min(left, viewportW - width - 8);
    left = Math.max(8, left);

    speedDropdownBox.style.top = `${Math.round(top)}px`;
    speedDropdownBox.style.left = `${Math.round(left)}px`;
}

function onSpeedMenuKeydown(e) {
    if (e.key === "Escape") closeSpeedMenu();
}

function openSpeedMenu() {
    if (speedMenuPortaled) return;

    speedDropdown.classList.add("open");
    speedTriggerBtn.setAttribute("aria-expanded", "true");

    speedMenuPlaceholder = document.createElement("div");
    speedMenuPlaceholder.style.display = "none";
    speedDropdownBox.parentNode.insertBefore(speedMenuPlaceholder, speedDropdownBox);

    document.body.appendChild(speedDropdownBox);
    speedDropdownBox.classList.add("portal");

    speedMenuPortaled = true;

    positionSpeedMenu();
    requestAnimationFrame(() => speedDropdownBox.classList.add("portal-open"));

    window.addEventListener("resize", positionSpeedMenu);
    window.addEventListener("scroll", positionSpeedMenu, true);
    document.addEventListener("keydown", onSpeedMenuKeydown);
}

function closeSpeedMenu() {
    speedDropdown.classList.remove("open");
    speedTriggerBtn.setAttribute("aria-expanded", "false");

    if (!speedMenuPortaled) return;

    speedDropdownBox.classList.remove("portal-open");
    speedDropdownBox.classList.remove("portal");

    speedDropdownBox.style.top = "";
    speedDropdownBox.style.left = "";
    speedDropdownBox.style.width = "";

    if (speedMenuPlaceholder && speedMenuPlaceholder.parentNode) {
        speedMenuPlaceholder.parentNode.insertBefore(speedDropdownBox, speedMenuPlaceholder);
        speedMenuPlaceholder.remove();
    }

    speedMenuPlaceholder = null;
    speedMenuPortaled = false;

    window.removeEventListener("resize", positionSpeedMenu);
    window.removeEventListener("scroll", positionSpeedMenu, true);
    document.removeEventListener("keydown", onSpeedMenuKeydown);
}

function toggleSpeedMenu() {
    if (speedMenuPortaled) closeSpeedMenu();
    else openSpeedMenu();
}

function toggleOutsideMenus(e) {
    if (!dropdown.contains(e.target)) dropdown.classList.remove("open");
    if (speedMenuPortaled && speedDropdownBox.contains(e.target)) return;
    if (speedTriggerBtn.contains(e.target)) return;
    closeSpeedMenu();
}

function onThemeToggleClick() {
    const currentTheme = document.documentElement.classList.contains("dark") ? "dark" : "light";
    setTheme(currentTheme === "dark" ? "light" : "dark");
}

function onSystemThemeChange(e) {
    if (!getStoredTheme()) setTheme(e.matches ? "dark" : "light");
}

function onVoiceTriggerClick() {
    dropdown.classList.toggle("open");
    if (dropdown.classList.contains("open")) searchInput.focus();
}

function onVoiceSearchInput() {
    const query = searchInput.value.toLowerCase();
    populateOptions(voices.filter((v) => v.label.toLowerCase().includes(query)));
}

function onAudioLoadedMetadata() {
    seekBar.max = audioEl.duration || 0;
    timeDuration.textContent = fmtTime(audioEl.duration);
    updateSeekUI(audioEl.currentTime || 0, audioEl.duration || 0);
}

function onAudioTimeUpdate() {
    if (!audioEl.paused && !isSeeking) syncSmoothClock();
}

function onAudioEnded() {
    const dur = audioEl.duration || 0;
    seekBar.value = dur;
    timeCurrent.textContent = fmtTime(dur);
    updateSeekUI(dur, dur);
    stopSeekRaf();
    syncTransportButtons();
}

function onAudioPlay() {
    syncTransportButtons();
    startSeekRaf();
}

function onAudioPause() {
    syncTransportButtons();
    stopSeekRaf();
}

async function onPlayClick() {
    if (!audioEl.src || !audioEl.paused) return;
    await resumeAudioGraph();
    audioEl.play().catch(() => { });
    syncTransportButtons();
}

function onPauseClick() {
    if (!audioEl.src || audioEl.paused) return;
    audioEl.pause();
    syncTransportButtons();
}

function onStopClick() {
    if (!audioEl.src) return;
    audioEl.pause();
    audioEl.currentTime = 0;
    seekBar.value = 0;
    timeCurrent.textContent = "0:00";
    updateSeekUI(0, audioEl.duration || 0);
    syncTransportButtons();
}

function onMuteClick() {
    const current = Number(volumeBar.value);
    if (current === 0) {
        const restore = lastNonZeroVolume && lastNonZeroVolume > 0 ? lastNonZeroVolume : 1;
        animateVolumeTo(restore, 220);
    } else {
        lastNonZeroVolume = current;
        animateVolumeTo(0, 180);
    }
}

function onSeekPointerDown(e) {
    isSeeking = true;
    if (seekBar.setPointerCapture) seekBar.setPointerCapture(e.pointerId);
}

function onSeekInput() {
    const v = Number(seekBar.value);
    timeCurrent.textContent = fmtTime(v);
    updateSeekUI(v, audioEl.duration || 0);
}

function onSeekPointerUp() {
    const v = Number(seekBar.value);
    audioEl.currentTime = v;
    syncSmoothClock();
    isSeeking = false;
}

function onSeekPointerCancel() {
    isSeeking = false;
}

function onVolumeInput() {
    const v = Number(volumeBar.value);
    if (v > 0) lastNonZeroVolume = v;
    setVolumeUI(v);
}

function onSpeedTriggerClick(e) {
    e.stopPropagation();
    toggleSpeedMenu();
}

function onSpeedOptionClick(e) {
    setSpeed(e.currentTarget.dataset.value);
    closeSpeedMenu();
}

function onWindowResize() {
    updateSeekUI(Number(seekBar.value) || 0, audioEl.duration || 0);
    positionSpeedMenu();
    vizResize();
}

function onWindowScroll() {
    positionSpeedMenu();
}

async function onSettingsClick(e) {
    e.stopPropagation();
    toggleSettingsPanel();
    await resumeAudioGraph();
    applyEqLive();
}

async function onResetAudioFxClick() {
    await resumeAudioGraph();
    resetAudioFx();
}

async function onEqSliderInput(e) {
    const s = e.currentTarget;
    const idx = Number(s.dataset.band);
    const v = Number(s.value);
    audioFx.eq[idx] = v;

    const valEl = s.closest(".eq-band")?.querySelector(".eq-val");
    if (valEl) valEl.textContent = v.toFixed(1);

    await resumeAudioGraph();
    applyEqLive();
}

function bindEvents() {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");

    themeToggle.addEventListener("click", onThemeToggleClick);
    prefersDark.addEventListener("change", onSystemThemeChange);

    trigger.addEventListener("click", onVoiceTriggerClick);
    document.addEventListener("click", toggleOutsideMenus);

    searchInput.addEventListener("input", onVoiceSearchInput);

    textInput.addEventListener("input", updateCharCount);
    expandBtn.addEventListener("click", toggleExpand);
    generateBtn.addEventListener("click", generateSpeech);

    audioEl.addEventListener("loadedmetadata", onAudioLoadedMetadata);
    audioEl.addEventListener("timeupdate", onAudioTimeUpdate);
    audioEl.addEventListener("ended", onAudioEnded);
    audioEl.addEventListener("play", onAudioPlay);
    audioEl.addEventListener("pause", onAudioPause);

    playBtn.addEventListener("click", onPlayClick);
    pauseBtn.addEventListener("click", onPauseClick);
    stopBtn.addEventListener("click", onStopClick);

    muteBtn.addEventListener("click", onMuteClick);

    seekBar.addEventListener("pointerdown", onSeekPointerDown);
    seekBar.addEventListener("input", onSeekInput);
    seekBar.addEventListener("pointerup", onSeekPointerUp);
    seekBar.addEventListener("pointercancel", onSeekPointerCancel);

    volumeBar.addEventListener("input", onVolumeInput);

    downloadBtn.addEventListener("click", downloadCurrentAudio);

    speedTriggerBtn.addEventListener("click", onSpeedTriggerClick);
    speedOptions.forEach((btn) => btn.addEventListener("click", onSpeedOptionClick));

    window.addEventListener("resize", onWindowResize);
    window.addEventListener("scroll", onWindowScroll, true);

    settingsBtn.addEventListener("click", onSettingsClick);
    resetAudioFxBtn.addEventListener("click", onResetAudioFxClick);
    eqSliders.forEach((s) => s.addEventListener("input", onEqSliderInput));
}

function initApp() {
    initPageEntrance();
    initTheme();
    initUI();
    bindEvents();
    initVoices();
}

window.addEventListener("resize", vizResize, { passive: true });

initApp();