/* Image Studio — round, crop, resize, and compress images on any device. Everything runs locally. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/* ---------- Environment ---------- */
const ua = navigator.userAgent;
const isIOS = /iP(hone|ad|od)/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
const isTouchDevice = matchMedia("(pointer: coarse)").matches && navigator.maxTouchPoints > 0;
const isStandalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
// iOS caps canvases at ~16.7M pixels; stay well inside on all phones.
const MAX_AREA = isTouchDevice || isIOS ? 16_777_216 : 50_000_000;
const VIEW_MAX = 2048; // longest side of the fast on-screen copy
const PRE_ENCODE_MAX = 24_000_000;
const STORE_KEY = "image-rounder:v2";

const FORMATS = {
  png: { label: "PNG", mime: "image/png", ext: "png", alpha: true, native: true, supported: true },
  jpeg: { label: "JPG", mime: "image/jpeg", ext: "jpg", alpha: false, native: true, quality: true, supported: true },
  webp: { label: "WebP", mime: "image/webp", ext: "webp", alpha: true, native: true, quality: true, supported: false },
  avif: { label: "AVIF", mime: "image/avif", ext: "avif", alpha: true, native: true, quality: true, supported: false },
  ico: { label: "ICO", mime: "image/x-icon", ext: "ico", alpha: true, supported: true, note: "Multi-size icon (16–256px)" },
  svg: { label: "SVG", mime: "image/svg+xml", ext: "svg", alpha: true, supported: true, note: "Vector mask with embedded image" },
  bmp: { label: "BMP", mime: "image/bmp", ext: "bmp", alpha: false, supported: true }
};

const RATIOS = [
  ["free", "Free"], ["original", "Original"], ["1:1", "1:1"], ["4:5", "4:5"], ["3:4", "3:4"],
  ["2:3", "2:3"], ["4:3", "4:3"], ["3:2", "3:2"], ["16:9", "16:9"], ["9:16", "9:16"]
];

// Resolution presets fit the output inside a box that follows the crop's orientation.
const RES_PRESETS = [
  [{ mode: "full" }, "Original"], [{ mode: "pct", pct: 50 }, "50%"], [{ mode: "pct", pct: 200 }, "2×"],
  [{ mode: "box", long: 1280, short: 720 }, "720p"], [{ mode: "box", long: 1920, short: 1080 }, "1080p"],
  [{ mode: "box", long: 2560, short: 1440 }, "2K"], [{ mode: "box", long: 3840, short: 2160 }, "4K"],
  [{ mode: "box", long: 7680, short: 4320 }, "8K"]
];
const FILE_PRESETS = [0.1, 0.25, 0.5, 1, 2, 5, 10];

const PRESETS = [
  { label: "Soft", glyph: "18%", style: { shape: "round", radius: 0.05, border: 0, shadow: false } },
  { label: "Card", glyph: "30%", style: { shape: "round", radius: 0.12, border: 0, shadow: true } },
  { label: "App icon", glyph: "34%", ratio: "1:1", style: { shape: "squircle", radius: 0.2237, border: 0, shadow: false } },
  { label: "Avatar", glyph: "50%", ratio: "1:1", style: { shape: "circle", border: 0, shadow: false } },
  { label: "Pill", glyph: "999px", style: { shape: "round", radius: 0.5, border: 0, shadow: false } },
  { label: "Framed", glyph: "12%", style: { shape: "round", radius: 0.035, border: 2.5, borderColor: "#ffffff", shadow: true } },
  { label: "Square", glyph: "0", style: { shape: "round", radius: 0, border: 0, shadow: false } }
];

const BORDER_COLORS = ["#ffffff", "#111318", "#2f6bff", "#ff5c8a", "#ffc93c"];
const FILL_COLORS = [null, "#ffffff", "#111318", "#f2efe9"];

/* ---------- State ---------- */
const DEFAULT_STYLE = { shape: "round", radius: 0.08, corners: [true, true, true, true], border: 0, borderColor: "#ffffff", shadow: false, fill: null };
const DEFAULT_OUT = { format: "png", quality: 0.9, sizeMode: "res", res: { mode: "full" }, targetMB: 1 };
const DEFAULT_PREFS = { theme: "auto", viewBg: "dark", ratio: "free", tab: "crop" };

const S = {
  items: [],
  activeId: null,
  style: { ...DEFAULT_STYLE, corners: [...DEFAULT_STYLE.corners] },
  out: { ...DEFAULT_OUT },
  prefs: { ...DEFAULT_PREFS },
  drag: null,
  hover: null,
  resultView: false,
  rev: 0,
  cache: null,
  view: { scale: 1, dpr: 1, w: 0, h: 0, mode: "" }
};

let nextId = 1;
const active = () => S.items.find((it) => it.id === S.activeId) || null;

loadSettings();

/* ---------- DOM ---------- */
const app = $("#app");
const stage = $("#stage");
const editor = $("#editor");
const ectx = editor.getContext("2d");
const preview = $("#preview");
const pctx = preview.getContext("2d");
const fileInput = $("#fileInput");
const hud = $("#hud");
const tray = $("#tray");
const saveBtn = $("#saveBtn");
const menu = $("#menu");

/* ---------- Settings persistence ---------- */
function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (!saved) return;
    Object.assign(S.style, saved.style || {});
    Object.assign(S.out, saved.out || {});
    delete S.out.maxSide;
    if (!S.out.res || !S.out.res.mode) S.out.res = { mode: "full" };
    if (!(S.out.targetMB > 0)) S.out.targetMB = 1;
    Object.assign(S.prefs, saved.prefs || {});
    if (!Array.isArray(S.style.corners) || S.style.corners.length !== 4) S.style.corners = [true, true, true, true];
  } catch (e) { /* storage unavailable */ }
}

let saveSettingsTimer;
function saveSettings() {
  clearTimeout(saveSettingsTimer);
  saveSettingsTimer = setTimeout(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ style: S.style, out: S.out, prefs: S.prefs })); } catch (e) { /* ignore */ }
  }, 250);
}

/* ---------- Feedback: haptics, toasts, confetti ---------- */
const hapticLabel = $("#haptic");
function buzz(pattern = 8) {
  if (navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch (e) { /* ignore */ }
  } else if (isIOS && hapticLabel) {
    hapticLabel.click(); // iOS 18+ ticks the Taptic Engine when a switch toggles
  }
}

function toast(message, type = "", ms = 2600) {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  $("#toasts").append(el);
  const kill = () => { el.classList.add("out"); setTimeout(() => el.remove(), 260); };
  const t = setTimeout(kill, ms);
  return { el, done(msg, kind = "ok") { clearTimeout(t); el.className = `toast ${kind}`; el.textContent = msg; setTimeout(kill, 1800); }, close: kill };
}

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
function celebrate(fromEl) {
  saveBtn.classList.remove("shine");
  void saveBtn.offsetWidth;
  saveBtn.classList.add("shine");
  if (reducedMotion.matches || !fromEl.animate) return;
  const fx = $("#fx");
  const r = fromEl.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const colors = ["#2f6bff", "#8b5cf6", "#b15cff", "#34c759", "#ffc93c", "#ff5c8a"];
  for (let i = 0; i < 22; i++) {
    const p = document.createElement("i");
    const size = 6 + Math.random() * 9;
    p.style.cssText = `left:${cx}px;top:${cy}px;width:${size}px;height:${size}px;background:${colors[i % colors.length]};border-radius:${["50%", "3px", "30%"][i % 3]}`;
    fx.append(p);
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3;
    const d = 70 + Math.random() * 130;
    p.animate([
      { transform: "translate(-50%,-50%) scale(.4) rotate(0deg)", opacity: 1 },
      { transform: `translate(${Math.cos(a) * d - size / 2}px, ${Math.sin(a) * d - size / 2}px) scale(1) rotate(${Math.random() * 540}deg)`, opacity: 1, offset: 0.65 },
      { transform: `translate(${Math.cos(a) * d * 1.1}px, ${Math.sin(a) * d + 90}px) scale(.8) rotate(${Math.random() * 720}deg)`, opacity: 0 }
    ], { duration: 900 + Math.random() * 500, easing: "cubic-bezier(.2,.8,.2,1)" }).onfinish = () => p.remove();
  }
}

/* ---------- Shape geometry ---------- */
// Returns a closed polygon (dense enough to be smooth) for the chosen shape at size w×h.
// The same points drive the editor, the canvas export, and the SVG export.
function shapePoints(w, h, st, seg = 36) {
  const short = Math.min(w, h);
  let radii; // [tl, tr, br, bl] as [ex, ey]
  let n = 2;
  if (st.shape === "circle") {
    radii = [[w / 2, h / 2], [w / 2, h / 2], [w / 2, h / 2], [w / 2, h / 2]];
  } else {
    const r = st.radius * short;
    const e = st.shape === "squircle" ? Math.min(r * 1.45, short / 2) : Math.min(r, short / 2);
    if (st.shape === "squircle") n = 4;
    radii = st.corners.map((on) => (on ? [e, e] : [0, 0]));
  }
  const [tl, tr, br, bl] = radii;
  const corners = [
    [w - tr[0], tr[1], tr, -Math.PI / 2],
    [w - br[0], h - br[1], br, 0],
    [bl[0], h - bl[1], bl, Math.PI / 2],
    [tl[0], tl[1], tl, Math.PI]
  ];
  const pts = [];
  const exp = 2 / n;
  for (const [cx, cy, [ex, ey], a0] of corners) {
    if (ex <= 0.0001 || ey <= 0.0001) { pts.push(cx, cy); continue; }
    for (let i = 0; i <= seg; i++) {
      const t = a0 + (i / seg) * (Math.PI / 2);
      const c = Math.cos(t);
      const s = Math.sin(t);
      pts.push(cx + ex * Math.sign(c) * Math.abs(c) ** exp, cy + ey * Math.sign(s) * Math.abs(s) ** exp);
    }
  }
  return pts;
}

function tracePath(ctx, pts, ox = 0, oy = 0) {
  ctx.beginPath();
  ctx.moveTo(pts[0] + ox, pts[1] + oy);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] + ox, pts[i + 1] + oy);
  ctx.closePath();
}

function svgPathData(pts) {
  let d = `M${pts[0].toFixed(2)} ${pts[1].toFixed(2)}`;
  for (let i = 2; i < pts.length; i += 2) d += `L${pts[i].toFixed(2)} ${pts[i + 1].toFixed(2)}`;
  return d + "Z";
}

/* ---------- Decoding ---------- */
const scriptCache = new Map();
function loadScript(src) {
  if (!scriptCache.has(src)) {
    scriptCache.set(src, new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { scriptCache.delete(src); reject(new Error(`Could not load ${src}`)); };
      document.head.append(s);
    }));
  }
  return scriptCache.get(src);
}

function extOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || "");
  return m ? m[1].toLowerCase() : "";
}

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "jfif", "pjpeg", "gif", "webp", "avif", "heic", "heif", "hif", "bmp", "ico", "cur", "svg", "tif", "tiff", "jxl", "apng"]);
function looksLikeImage(file) {
  return (file.type && file.type.startsWith("image/")) || IMAGE_EXT.has(extOf(file.name));
}

async function decodeWithImg(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (!w || !h) { w = 1024; h = 1024; } // SVGs without intrinsic size
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d").drawImage(img, 0, 0, w, h);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function decodeNative(file) {
  if ("createImageBitmap" in window) {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (e) { /* fall through */ }
    try { return await createImageBitmap(file); } catch (e) { /* fall through */ }
  }
  return decodeWithImg(file);
}

async function decodeHeic(file) {
  await loadScript("vendor/heic-to.js");
  return window.HeicTo({ blob: file, type: "bitmap" });
}

async function decodeTiff(file) {
  await loadScript("vendor/pako_inflate.min.js");
  await loadScript("vendor/utif.js");
  const buf = await file.arrayBuffer();
  const ifds = window.UTIF.decode(buf);
  const page = ifds.find((d) => d.width && d.height) || ifds[0];
  window.UTIF.decodeImage(buf, page);
  const rgba = window.UTIF.toRGBA8(page);
  const c = document.createElement("canvas");
  c.width = page.width;
  c.height = page.height;
  c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), page.width, page.height), 0, 0);
  return c;
}

async function decodeFile(file) {
  const ext = extOf(file.name);
  const type = (file.type || "").toLowerCase();
  const heic = /hei[cf]/.test(type) || ["heic", "heif", "hif"].includes(ext);
  const tiff = type.includes("tiff") || ["tif", "tiff"].includes(ext);
  const svg = type === "image/svg+xml" || ext === "svg";
  if (svg) return decodeWithImg(file.type ? file : new Blob([file], { type: "image/svg+xml" }));
  try {
    return await decodeNative(file);
  } catch (err) {
    if (heic) return decodeHeic(file);
    if (tiff) return decodeTiff(file);
    throw err;
  }
}

function sizeOf(src) {
  return { w: src.naturalWidth || src.width, h: src.naturalHeight || src.height };
}

function scaledCopy(src, w, h, maxSide, maxArea = Infinity) {
  let k = Math.min(1, maxSide / Math.max(w, h));
  if (w * h * k * k > maxArea) k = Math.sqrt(maxArea / (w * h));
  if (k >= 1) return null;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

function release(src) {
  if (!src) return;
  if (typeof src.close === "function") src.close();
  else if (src instanceof HTMLCanvasElement) { src.width = 0; src.height = 0; }
}

function buildView(item) {
  if (item.view && item.view !== item.src) release(item.view);
  item.view = scaledCopy(item.src, item.w, item.h, VIEW_MAX) || item.src;
  // Tray thumbnail
  const t = document.createElement("canvas");
  const k = 120 / Math.min(item.w, item.h);
  t.width = Math.max(1, Math.round(item.w * k));
  t.height = Math.max(1, Math.round(item.h * k));
  const tctx = t.getContext("2d");
  tctx.imageSmoothingQuality = "high";
  tctx.drawImage(item.view, 0, 0, t.width, t.height);
  item.thumb = t;
}

async function addFiles(fileList) {
  const files = [...fileList].filter(looksLikeImage);
  if (!files.length) {
    if (fileList.length) toast("That file isn't an image I can open", "err");
    return;
  }
  const status = files.length > 1 || files.some((f) => /hei[cf]|tif/i.test(f.type + extOf(f.name))) ? toast(`Opening ${files.length > 1 ? files.length + " images" : "image"}…`, "", 60000) : null;
  let firstId = null;
  let failed = 0;
  let shrunk = false;
  for (const [i, file] of files.entries()) {
    if (status && files.length > 1) status.el.textContent = `Opening ${i + 1} of ${files.length}…`;
    try {
      let src = await decodeFile(file);
      let { w, h } = sizeOf(src);
      const fitted = scaledCopy(src, w, h, Infinity, MAX_AREA);
      if (fitted) { release(src); src = fitted; w = fitted.width; h = fitted.height; shrunk = true; }
      const item = { id: nextId++, name: file.name || "image", bytes: file.size || 0, src, w, h, crop: { x: 0, y: 0, w, h }, view: null, thumb: null };
      buildView(item);
      fitCropToRatio(item);
      S.items.push(item);
      if (!firstId) firstId = item.id;
    } catch (err) {
      console.warn("Decode failed", file.name, err);
      failed++;
    }
  }
  if (status) status.close();
  if (failed) toast(failed === files.length ? "Couldn't open that image format" : `${failed} file${failed > 1 ? "s" : ""} couldn't be opened`, "err");
  if (shrunk) toast("Very large photo scaled to fit this device's memory", "", 3200);
  if (firstId) {
    buzz(10);
    selectItem(firstId);
  }
}

/* ---------- Items ---------- */
function selectItem(id) {
  S.activeId = id;
  S.drag = null;
  app.classList.toggle("has-image", S.items.length > 0);
  app.classList.toggle("has-many", S.items.length > 1);
  renderTray();
  updateSub();
  changed({ settings: false });
}

function removeItem(id) {
  const idx = S.items.findIndex((it) => it.id === id);
  if (idx < 0) return;
  const [it] = S.items.splice(idx, 1);
  if (it.view !== it.src) release(it.view);
  release(it.src);
  if (S.cache && S.cache.id === id) S.cache = null;
  const next = S.items[Math.min(idx, S.items.length - 1)];
  if (next) selectItem(next.id);
  else {
    S.activeId = null;
    S.resultView = false;
    app.classList.remove("has-image", "has-many");
    renderTray();
    updateSub();
  }
}

function renderTray() {
  tray.textContent = "";
  for (const it of S.items) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "thumb" + (it.id === S.activeId ? " is-active" : "");
    b.title = it.name;
    b.append(it.thumb);
    const x = document.createElement("span");
    x.className = "x";
    x.textContent = "×";
    x.setAttribute("role", "button");
    x.setAttribute("aria-label", `Remove ${it.name}`);
    b.append(x);
    b.addEventListener("click", (e) => {
      if (e.target === x) { removeItem(it.id); return; }
      if (it.id !== S.activeId) { buzz(6); selectItem(it.id); }
    });
    tray.append(b);
  }
  const add = document.createElement("button");
  add.type = "button";
  add.className = "thumb add";
  add.setAttribute("aria-label", "Add images");
  add.innerHTML = '<svg class="i"><use href="#i-plus"/></svg>';
  add.addEventListener("click", () => fileInput.click());
  tray.append(add);
  $("#allCount").textContent = S.items.length;
  const tActive = tray.querySelector(".is-active");
  if (tActive) tActive.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function updateSub() {
  const it = active();
  $("#sub").textContent = it ? (S.items.length > 1 ? `${it.name} · ${S.items.findIndex((x) => x.id === it.id) + 1}/${S.items.length}` : it.name) : "Round · crop · resize — on any device";
}

/* ---------- Crop math ---------- */
function ratioValue(item, key = S.prefs.ratio) {
  if (key === "free" || !item) return null;
  if (key === "original") return item.w / item.h;
  const [a, b] = key.split(":").map(Number);
  return a / b;
}

function minCrop(item) {
  const s = Math.min(item.w, item.h);
  return Math.max(1, Math.min(s, Math.max(8, s * 0.04)));
}

// Largest crop of the chosen ratio that fits the image, centered on the current crop.
function fitCropToRatio(item) {
  const ratio = ratioValue(item);
  if (!ratio) return;
  const c = item.crop;
  const cx = c.x + c.w / 2;
  const cy = c.y + c.h / 2;
  let w = item.w;
  let h = w / ratio;
  if (h > item.h) { h = item.h; w = h * ratio; }
  item.crop = { x: clamp(cx - w / 2, 0, item.w - w), y: clamp(cy - h / 2, 0, item.h - h), w, h };
}

function moveCrop(item, start, dx, dy) {
  item.crop = { ...start, x: clamp(start.x + dx, 0, item.w - start.w), y: clamp(start.y + dy, 0, item.h - start.h) };
}

function resizeFree(item, p, handle, start) {
  const min = minCrop(item);
  const right = start.x + start.w;
  const bottom = start.y + start.h;
  let { x, y, w, h } = start;
  if (handle.includes("w")) { x = clamp(p.x, 0, right - min); w = right - x; }
  if (handle.includes("e")) w = clamp(p.x - start.x, min, item.w - start.x);
  if (handle.includes("n")) { y = clamp(p.y, 0, bottom - min); h = bottom - y; }
  if (handle.includes("s")) h = clamp(p.y - start.y, min, item.h - start.y);
  item.crop = { x, y, w, h };
}

function resizeLocked(item, p, handle, start, ratio) {
  const min = minCrop(item);
  if (handle.length === 2) {
    const sx = handle.includes("w") ? -1 : 1;
    const sy = handle.includes("n") ? -1 : 1;
    const ax = sx > 0 ? start.x : start.x + start.w;
    const ay = sy > 0 ? start.y : start.y + start.h;
    const maxW = sx > 0 ? item.w - ax : ax;
    const maxH = sy > 0 ? item.h - ay : ay;
    let w = Math.abs(p.x - ax);
    let h = Math.abs(p.y - ay);
    if (w / ratio > h) h = w / ratio; else w = h * ratio;
    w = clamp(w, min, maxW); h = w / ratio;
    if (h > maxH) { h = maxH; w = h * ratio; }
    if (h < min) { h = Math.min(maxH, min); w = h * ratio; }
    item.crop = { x: sx > 0 ? ax : ax - w, y: sy > 0 ? ay : ay - h, w, h };
  } else if (handle === "e" || handle === "w") {
    const cy = start.y + start.h / 2;
    const fx = handle === "e" ? start.x : start.x + start.w;
    const maxW = Math.min(handle === "e" ? item.w - fx : fx, 2 * Math.min(cy, item.h - cy) * ratio);
    const w = clamp(handle === "e" ? p.x - fx : fx - p.x, min, Math.max(min, maxW));
    const h = w / ratio;
    item.crop = { x: handle === "e" ? fx : fx - w, y: clamp(cy - h / 2, 0, item.h - h), w, h };
  } else {
    const cx = start.x + start.w / 2;
    const fy = handle === "s" ? start.y : start.y + start.h;
    const maxH = Math.min(handle === "s" ? item.h - fy : fy, (2 * Math.min(cx, item.w - cx)) / ratio);
    const h = clamp(handle === "s" ? p.y - fy : fy - p.y, min, Math.max(min, maxH));
    const w = h * ratio;
    item.crop = { x: clamp(cx - w / 2, 0, item.w - w), y: handle === "s" ? fy : fy - h, w, h };
  }
}

function transformItem(item, kind) {
  const { w, h } = item;
  const c = document.createElement("canvas");
  const rot = kind === "rotate";
  c.width = rot ? h : w;
  c.height = rot ? w : h;
  const ctx = c.getContext("2d");
  if (rot) { ctx.translate(h, 0); ctx.rotate(Math.PI / 2); } else { ctx.translate(w, 0); ctx.scale(-1, 1); }
  ctx.drawImage(item.src, 0, 0);
  const cr = item.crop;
  item.crop = rot ? { x: h - (cr.y + cr.h), y: cr.x, w: cr.h, h: cr.w } : { ...cr, x: w - (cr.x + cr.w) };
  if (item.view !== item.src) release(item.view);
  release(item.src);
  item.src = c;
  item.w = c.width;
  item.h = c.height;
  buildView(item);
  if (rot) fitCropToRatio(item);
  renderTray();
}

/* ---------- Output geometry & rendering ---------- */
function resolutionScale(c, res) {
  if (res.mode === "pct") return res.pct / 100;
  if (res.mode === "box") return Math.min(res.long / Math.max(c.w, c.h), res.short / Math.min(c.w, c.h));
  if (res.mode === "width") return res.w / c.w;
  if (res.mode === "height") return res.h / c.h;
  return 1;
}

const fileMode = (out = S.out) => out.sizeMode === "file" && out.format !== "ico";

// k = output pixels per crop pixel. In file-size mode it comes from the last search result.
function geometry(item, out = S.out, st = S.style, kOverride) {
  const c = item.crop;
  let k = kOverride;
  if (k == null) {
    if (fileMode(out)) {
      const hit = S.cache && S.cache.id === item.id && S.cache.rev === S.rev && S.cache.k;
      k = hit || 1;
    } else {
      k = out.format === "ico" ? 1 : resolutionScale(c, out.res);
    }
  }
  k = Math.max(k, 1 / Math.min(c.w, c.h));
  const calc = () => {
    const w = Math.max(1, Math.round(c.w * k));
    const h = Math.max(1, Math.round(c.h * k));
    const pad = st.shadow ? Math.round(Math.min(w, h) * 0.09) : 0;
    return { k, w, h, pad, W: w + pad * 2, H: h + pad * 2 };
  };
  let g = calc();
  if (g.W * g.H > MAX_AREA) {
    k *= Math.sqrt(MAX_AREA / (g.W * g.H)) * 0.995;
    g = calc();
    g.limited = true;
  }
  return g;
}

function effectiveFill(fmt = FORMATS[S.out.format]) {
  if (S.style.fill) return S.style.fill;
  return fmt.alpha ? null : "#ffffff";
}

let scratch = null;
// Draws the finished image into ctx. `d` is the display scale (1 = full size export).
function renderOutput(ctx, item, g, { d = 1, useView = false, fill = effectiveFill(), seg = 64 } = {}) {
  const st = S.style;
  const W = g.W * d;
  const H = g.H * d;
  const w = g.w * d;
  const h = g.h * d;
  const pad = g.pad * d;
  const short = Math.min(w, h);
  const img = useView ? item.view : item.src;
  const vs = useView ? item.view.width / item.w : 1;
  const c = item.crop;
  const pts = shapePoints(w, h, st, seg);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (fill) { ctx.fillStyle = fill; ctx.fillRect(0, 0, W, H); }

  const paint = (tctx, ox, oy) => {
    tctx.save();
    tracePath(tctx, pts, ox, oy);
    tctx.clip();
    tctx.drawImage(img, c.x * vs, c.y * vs, c.w * vs, c.h * vs, ox, oy, w, h);
    if (st.border > 0) {
      tracePath(tctx, pts, ox, oy);
      tctx.lineWidth = (st.border / 100) * short * 2;
      tctx.strokeStyle = st.borderColor;
      tctx.stroke();
    }
    tctx.restore();
  };

  if (st.shadow) {
    // Render the shape on its own layer (at screen resolution) so the shadow follows real transparency.
    const ts = ctx.getTransform ? Math.abs(ctx.getTransform().a) || 1 : 1;
    const sw = Math.max(1, Math.ceil(w * ts));
    const sh = Math.max(1, Math.ceil(h * ts));
    if (!scratch) scratch = document.createElement("canvas");
    if (scratch.width !== sw || scratch.height !== sh) { scratch.width = sw; scratch.height = sh; }
    const sctx = scratch.getContext("2d");
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, sw, sh);
    sctx.setTransform(sw / w, 0, 0, sh / h, 0, 0);
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = "high";
    paint(sctx, 0, 0);
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.38)";
    ctx.shadowBlur = short * 0.07 * ts;
    ctx.shadowOffsetY = short * 0.03 * ts;
    ctx.drawImage(scratch, pad, pad, w, h);
    ctx.restore();
    if (sw * sh > 4_000_000) { scratch.width = 0; scratch.height = 0; scratch = null; }
  } else {
    paint(ctx, pad, pad);
  }
}

/* ---------- Editor ---------- */
const coarse = matchMedia("(pointer: coarse)");
const HANDLE_TOL = () => (coarse.matches ? 24 : 13);

function layoutEditor() {
  const it = active();
  if (!it) return false;
  const r = stage.getBoundingClientRect();
  const compact = r.width < 600;
  const padX = compact ? 18 : 28;
  const padTop = compact ? 58 : 66;
  const padBottom = compact ? 44 : 52;
  const availW = Math.max(60, r.width - padX * 2);
  const availH = Math.max(60, r.height - padTop - padBottom);
  let contentW = it.w;
  let contentH = it.h;
  let g = null;
  if (S.resultView) {
    g = geometry(it);
    contentW = g.W;
    contentH = g.H;
  }
  const scale = Math.min(availW / contentW, availH / contentH, S.resultView ? 2 : 3);
  const cssW = Math.max(1, Math.round(contentW * scale));
  const cssH = Math.max(1, Math.round(contentH * scale));
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const mode = S.resultView ? "result" : "edit";
  if (S.view.w !== cssW || S.view.h !== cssH || S.view.dpr !== dpr || S.view.mode !== mode) {
    editor.style.width = cssW + "px";
    editor.style.height = cssH + "px";
    editor.width = Math.round(cssW * dpr);
    editor.height = Math.round(cssH * dpr);
  }
  editor.style.left = Math.round((r.width - cssW) / 2) + "px";
  editor.style.top = Math.round(padTop + (availH - cssH) / 2) + "px";
  S.view = { scale, dpr, w: cssW, h: cssH, mode, g, imgScale: scale * (S.resultView ? g.k : 1) };
  return true;
}

function drawEditor() {
  const it = active();
  if (!it) return;
  const { scale, dpr } = S.view;
  ectx.setTransform(1, 0, 0, 1, 0, 0);
  ectx.clearRect(0, 0, editor.width, editor.height);

  if (S.resultView) {
    ectx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    renderOutput(ectx, it, S.view.g, { d: 1, useView: true, seg: 40 });
    return;
  }

  const c = it.crop;
  const px = 1 / scale; // one CSS pixel in image units
  ectx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  ectx.imageSmoothingEnabled = true;
  ectx.imageSmoothingQuality = "high";

  // Dimmed full image, then the rounded crop at full strength.
  ectx.globalAlpha = 0.26;
  ectx.drawImage(it.view, 0, 0, it.w, it.h);
  ectx.globalAlpha = 1;
  ectx.clearRect(c.x, c.y, c.w, c.h);
  const pts = shapePoints(c.w, c.h, S.style, 28);
  ectx.save();
  tracePath(ectx, pts, c.x, c.y);
  ectx.clip();
  ectx.drawImage(it.view, 0, 0, it.w, it.h);
  if (S.style.border > 0) {
    tracePath(ectx, pts, c.x, c.y);
    ectx.lineWidth = (S.style.border / 100) * Math.min(c.w, c.h) * 2;
    ectx.strokeStyle = S.style.borderColor;
    ectx.stroke();
  }
  ectx.restore();

  const dragging = S.drag && S.drag.type === "crop";
  // Rule-of-thirds while moving/resizing
  if (dragging) {
    ectx.save();
    ectx.strokeStyle = "rgba(255,255,255,.45)";
    ectx.lineWidth = px;
    ectx.beginPath();
    for (let i = 1; i < 3; i++) {
      ectx.moveTo(c.x + (c.w * i) / 3, c.y); ectx.lineTo(c.x + (c.w * i) / 3, c.y + c.h);
      ectx.moveTo(c.x, c.y + (c.h * i) / 3); ectx.lineTo(c.x + c.w, c.y + (c.h * i) / 3);
    }
    ectx.stroke();
    ectx.restore();
  }

  // Crop frame
  ectx.save();
  ectx.beginPath();
  ectx.rect(c.x, c.y, c.w, c.h);
  ectx.lineWidth = px * 3;
  ectx.strokeStyle = "rgba(0,0,0,.35)";
  ectx.stroke();
  ectx.lineWidth = px * 1.25;
  ectx.strokeStyle = "rgba(255,255,255,.9)";
  ectx.stroke();
  tracePath(ectx, pts, c.x, c.y);
  ectx.lineWidth = px * 2;
  ectx.strokeStyle = "rgba(79, 124, 255, .95)";
  ectx.stroke();
  ectx.restore();

  // Corner brackets + edge bars
  const big = coarse.matches ? 1.35 : 1;
  const L = Math.min(22 * big * px, c.w / 3, c.h / 3);
  const T = 4 * big * px;
  ectx.save();
  ectx.lineCap = "round";
  ectx.shadowColor = "rgba(0,0,0,.45)";
  ectx.shadowBlur = 4 * dpr;
  ectx.strokeStyle = "#fff";
  ectx.lineWidth = T;
  ectx.beginPath();
  const x2 = c.x + c.w;
  const y2 = c.y + c.h;
  ectx.moveTo(c.x, c.y + L); ectx.lineTo(c.x, c.y); ectx.lineTo(c.x + L, c.y);
  ectx.moveTo(x2 - L, c.y); ectx.lineTo(x2, c.y); ectx.lineTo(x2, c.y + L);
  ectx.moveTo(x2, y2 - L); ectx.lineTo(x2, y2); ectx.lineTo(x2 - L, y2);
  ectx.moveTo(c.x + L, y2); ectx.lineTo(c.x, y2); ectx.lineTo(c.x, y2 - L);
  const mx = c.x + c.w / 2;
  const my = c.y + c.h / 2;
  const b = Math.min(L * 0.7, c.w / 4, c.h / 4);
  ectx.moveTo(mx - b, c.y); ectx.lineTo(mx + b, c.y);
  ectx.moveTo(mx - b, y2); ectx.lineTo(mx + b, y2);
  ectx.moveTo(c.x, my - b); ectx.lineTo(c.x, my + b);
  ectx.moveTo(x2, my - b); ectx.lineTo(x2, my + b);
  ectx.stroke();
  ectx.restore();

  // Radius handles
  if (S.style.shape !== "circle") {
    const activeR = (S.drag && S.drag.type === "radius") || (S.hover && S.hover.type === "radius");
    const dot = (coarse.matches ? 10 : 7.5) * px * (activeR ? 1.25 : 1);
    ectx.save();
    for (const [corner, x, y, cx, cy] of radiusHandles(it)) {
      ectx.setLineDash([4 * px, 4 * px]);
      ectx.lineWidth = 1.5 * px;
      ectx.strokeStyle = "rgba(120,150,255,.7)";
      ectx.beginPath(); ectx.moveTo(cx, cy); ectx.lineTo(x, y); ectx.stroke();
      ectx.setLineDash([]);
      ectx.beginPath();
      ectx.arc(x, y, dot, 0, Math.PI * 2);
      ectx.shadowColor = "rgba(0,0,0,.4)";
      ectx.shadowBlur = 6 * dpr;
      ectx.fillStyle = corner === (S.drag && S.drag.handle) ? "#8b5cf6" : "#2f6bff";
      ectx.fill();
      ectx.shadowBlur = 0;
      ectx.lineWidth = 2.5 * px;
      ectx.strokeStyle = "#fff";
      ectx.stroke();
    }
    ectx.restore();
  }
}

const CORNER_KEYS = ["tl", "tr", "br", "bl"];
function radiusHandles(it) {
  const c = it.crop;
  const short = Math.min(c.w, c.h);
  const maxR = short / 2;
  const minVisible = Math.min(26 / S.view.scale, maxR);
  const d = clamp(S.style.radius * short || minVisible, minVisible, maxR);
  const all = [
    ["tl", c.x + d, c.y + d, c.x, c.y],
    ["tr", c.x + c.w - d, c.y + d, c.x + c.w, c.y],
    ["br", c.x + c.w - d, c.y + c.h - d, c.x + c.w, c.y + c.h],
    ["bl", c.x + d, c.y + c.h - d, c.x, c.y + c.h]
  ];
  return all.filter((_, i) => S.style.corners[i]);
}

function pointFrom(e) {
  const r = editor.getBoundingClientRect();
  return { x: (e.clientX - r.left) / S.view.scale, y: (e.clientY - r.top) / S.view.scale };
}

function hitTest(p) {
  const it = active();
  if (!it || S.resultView) return null;
  const c = it.crop;
  const tolPx = HANDLE_TOL();
  if (S.style.shape !== "circle") {
    for (const [corner, x, y] of radiusHandles(it)) {
      if (Math.hypot(p.x - x, p.y - y) * S.view.scale <= tolPx + 2) return { type: "radius", handle: corner };
    }
  }
  const tol = tolPx / S.view.scale;
  const nl = Math.abs(p.x - c.x) <= tol;
  const nr = Math.abs(p.x - (c.x + c.w)) <= tol;
  const nt = Math.abs(p.y - c.y) <= tol;
  const nb = Math.abs(p.y - (c.y + c.h)) <= tol;
  const inX = p.x >= c.x - tol && p.x <= c.x + c.w + tol;
  const inY = p.y >= c.y - tol && p.y <= c.y + c.h + tol;
  if (nl && nt) return { type: "crop", handle: "nw" };
  if (nr && nt) return { type: "crop", handle: "ne" };
  if (nr && nb) return { type: "crop", handle: "se" };
  if (nl && nb) return { type: "crop", handle: "sw" };
  if (nt && inX) return { type: "crop", handle: "n" };
  if (nr && inY) return { type: "crop", handle: "e" };
  if (nb && inX) return { type: "crop", handle: "s" };
  if (nl && inY) return { type: "crop", handle: "w" };
  if (p.x > c.x && p.x < c.x + c.w && p.y > c.y && p.y < c.y + c.h) return { type: "crop", handle: "move" };
  return null;
}

const CURSORS = { n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize", move: "move" };
function updateCursor() {
  const h = S.drag || S.hover;
  editor.style.cursor = !h ? (S.resultView ? "zoom-out" : "default") : h.type === "radius" ? (S.drag ? "grabbing" : "grab") : CURSORS[h.handle];
}

editor.addEventListener("pointerdown", (e) => {
  if (S.drag || !active()) return;
  if (S.resultView) { setResultView(false); return; }
  const p = pointFrom(e);
  const hit = hitTest(p);
  if (!hit) return;
  e.preventDefault();
  editor.setPointerCapture(e.pointerId);
  S.drag = { ...hit, pointerId: e.pointerId, start: p, startCrop: { ...active().crop }, snapped: null };
  if (hit.type === "radius") buzz(5);
  updateCursor();
  requestRender();
});

editor.addEventListener("pointermove", (e) => {
  const it = active();
  if (!it) return;
  if (!S.drag) {
    if (e.pointerType === "mouse") {
      const h = hitTest(pointFrom(e));
      if ((h && h.type) !== (S.hover && S.hover.type) || (h && h.handle) !== (S.hover && S.hover.handle)) {
        S.hover = h;
        updateCursor();
        requestRender();
      }
    }
    return;
  }
  if (e.pointerId !== S.drag.pointerId) return;
  e.preventDefault();
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
  const p = pointFrom(events.length ? events[events.length - 1] : e);
  const d = S.drag;
  if (d.type === "radius") {
    const c = it.crop;
    const short = Math.min(c.w, c.h);
    let r = 0;
    if (d.handle === "tl") r = Math.min(p.x - c.x, p.y - c.y);
    if (d.handle === "tr") r = Math.min(c.x + c.w - p.x, p.y - c.y);
    if (d.handle === "br") r = Math.min(c.x + c.w - p.x, c.y + c.h - p.y);
    if (d.handle === "bl") r = Math.min(p.x - c.x, c.y + c.h - p.y);
    let frac = clamp(r / short, 0, 0.5);
    let snap = null;
    if (frac < 0.012) { frac = 0; snap = "min"; } else if (frac > 0.485) { frac = 0.5; snap = "max"; }
    if (snap && snap !== d.snapped) buzz(12);
    d.snapped = snap;
    S.style.radius = frac;
    syncControls();
  } else if (d.handle === "move") {
    moveCrop(it, d.startCrop, p.x - d.start.x, p.y - d.start.y);
  } else {
    const ratio = ratioValue(it);
    if (ratio) resizeLocked(it, p, d.handle, d.startCrop, ratio);
    else resizeFree(it, p, d.handle, d.startCrop);
  }
  changed({ settings: d.type === "radius", light: true });
});

function endDrag(e) {
  if (!S.drag || (e && e.pointerId !== S.drag.pointerId)) return;
  if (editor.hasPointerCapture(S.drag.pointerId)) editor.releasePointerCapture(S.drag.pointerId);
  S.drag = null;
  S.hover = e && e.pointerType === "mouse" ? hitTest(pointFrom(e)) : null;
  updateCursor();
  changed({ settings: true });
}
editor.addEventListener("pointerup", endDrag);
editor.addEventListener("pointercancel", endDrag);
editor.addEventListener("lostpointercapture", (e) => { if (S.drag) endDrag(e); });
editor.addEventListener("pointerleave", () => { if (!S.drag && S.hover) { S.hover = null; updateCursor(); requestRender(); } });

/* ---------- Render loop ---------- */
let frame = 0;
function requestRender() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    if (!active()) return;
    layoutEditor();
    drawEditor();
    drawPreview();
    updateReadouts();
  });
}

const desktopQuery = matchMedia("(min-width: 861px) and (min-height: 561px)");
function drawPreview() {
  const it = active();
  if (!it || !desktopQuery.matches) return;
  const box = $("#previewBox");
  const bw = box.clientWidth - 24;
  const bh = box.clientHeight - 24;
  if (bw <= 0 || bh <= 0) return;
  const g = geometry(it);
  const scale = Math.min(bw / g.W, bh / g.H, 1);
  const cw = Math.max(1, Math.round(g.W * scale));
  const ch = Math.max(1, Math.round(g.H * scale));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (preview.width !== Math.round(cw * dpr) || preview.height !== Math.round(ch * dpr)) {
    preview.width = Math.round(cw * dpr);
    preview.height = Math.round(ch * dpr);
    preview.style.width = cw + "px";
    preview.style.height = ch + "px";
  }
  pctx.setTransform(1, 0, 0, 1, 0, 0);
  pctx.clearRect(0, 0, preview.width, preview.height);
  pctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  renderOutput(pctx, it, g, { useView: true, seg: 32 });
}

function fmtMB(mb) {
  return mb < 1 ? `${Math.round(mb * 1000)} KB` : `${+mb.toFixed(2)} MB`;
}

// Keep the W × H boxes showing the real output size (unless the user is typing in them).
function syncDims(it, g) {
  const wIn = $("#outW");
  const hIn = $("#outH");
  if (document.activeElement !== wIn) wIn.value = g.w;
  if (document.activeElement !== hIn) hIn.value = g.h;
  wIn.disabled = hIn.disabled = fileMode();
}

function fmtBytes(n) {
  if (n < 1000) return n + " B";
  if (n < 1e6) return (n / 1000).toFixed(n < 10000 ? 1 : 0) + " KB";
  return (n / 1e6).toFixed(n < 1e7 ? 2 : 1) + " MB";
}

function updateReadouts() {
  const it = active();
  if (!it) return;
  const g = geometry(it);
  const fmt = FORMATS[S.out.format];
  const short = Math.min(it.crop.w, it.crop.h);
  const radiusText = S.style.shape === "circle" ? "circle" : `${Math.round(S.style.radius * short * g.k)}px corners`;
  hud.textContent = S.resultView ? `Preview · ${g.W} × ${g.H}` : `${Math.round(it.crop.w)} × ${Math.round(it.crop.h)} · ${radiusText}`;
  $("#statSrc").textContent = `${it.w} × ${it.h}${it.bytes ? " · " + fmtBytes(it.bytes) : ""}`;
  const cached = S.cache && S.cache.id === it.id && S.cache.rev === S.rev ? S.cache : null;
  const fm = fileMode();
  let sizeText = cached ? fmtBytes(cached.blob.size) : fm ? "Finding best fit…" : "…";
  if (cached && it.bytes) sizeText += ` · ${Math.round((cached.blob.size / it.bytes) * 100)}% of original`;
  $("#statSize").textContent = sizeText;
  $("#statQ").textContent = cached && cached.q != null ? `${Math.round(cached.q * 100)}%` : fmt.quality ? `${Math.round(S.out.quality * 100)}%` : "Lossless";
  const outText = fm && !cached ? `≤ ${fmtMB(S.out.targetMB)}` : `${g.W} × ${g.H}`;
  $("#statOut").textContent = `${outText} ${fmt.label}`;
  $("#saveSub").textContent = `${fmt.label} · ${outText}${cached ? " · " + fmtBytes(cached.blob.size) : ""}${g.limited ? " · fitted" : ""}${cached && cached.missed ? " · over target" : ""}`;
  syncDims(it, g);
}

/* ---------- Change pipeline ---------- */
let encodeTimer = 0;
let encodeToken = 0;
function changed({ settings = true, light = false } = {}) {
  S.rev++;
  if (settings) saveSettings();
  requestRender();
  clearTimeout(encodeTimer);
  if (!light) encodeTimer = setTimeout(preEncode, 650);
}

// Encode the current image in the background so "Save" is instant
// (and so iOS still treats the tap as a direct user action for sharing).
async function preEncode() {
  const it = active();
  if (!it || S.drag) return;
  const g = geometry(it);
  if (g.W * g.H > PRE_ENCODE_MAX) return;
  const token = ++encodeToken;
  const rev = S.rev;
  try {
    const res = await encodeItem(it);
    if (token !== encodeToken || rev !== S.rev || it.id !== S.activeId) return;
    S.cache = { id: it.id, rev, ...res };
    updateReadouts();
  } catch (err) {
    console.warn("Pre-encode failed", err);
  }
}

/* ---------- Encoders ---------- */
function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Encoding failed (image may be too large)"))), mime, quality);
  });
}

function hasTransparency(canvas) {
  const ctx = canvas.getContext("2d");
  const { width: w, height: h } = canvas;
  const rows = Math.max(1, Math.floor(4_000_000 / w));
  for (let y = 0; y < h; y += rows) {
    const data = ctx.getImageData(0, y, w, Math.min(rows, h - y)).data;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  }
  return false;
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

async function makeIco(source) {
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = [];
  for (const s of sizes) {
    const c = document.createElement("canvas");
    c.width = c.height = s;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    // step down for crisp small icons
    let src = source;
    let sw = source.width;
    let sh = source.height;
    while (Math.max(sw, sh) > s * 2) {
      const t = document.createElement("canvas");
      t.width = Math.max(1, Math.round(sw / 2));
      t.height = Math.max(1, Math.round(sh / 2));
      const tctx = t.getContext("2d");
      tctx.imageSmoothingQuality = "high";
      tctx.drawImage(src, 0, 0, t.width, t.height);
      if (src !== source) release(src);
      src = t; sw = t.width; sh = t.height;
    }
    const k = s / Math.max(sw, sh);
    const dw = sw * k;
    const dh = sh * k;
    ctx.drawImage(src, (s - dw) / 2, (s - dh) / 2, dw, dh);
    if (src !== source) release(src);
    pngs.push(new Uint8Array(await (await canvasToBlob(c, "image/png")).arrayBuffer()));
  }
  const head = new DataView(new ArrayBuffer(6 + 16 * sizes.length));
  head.setUint16(2, 1, true);
  head.setUint16(4, sizes.length, true);
  let offset = head.byteLength;
  sizes.forEach((s, i) => {
    const o = 6 + i * 16;
    head.setUint8(o, s >= 256 ? 0 : s);
    head.setUint8(o + 1, s >= 256 ? 0 : s);
    head.setUint16(o + 4, 1, true);
    head.setUint16(o + 6, 32, true);
    head.setUint32(o + 8, pngs[i].length, true);
    head.setUint32(o + 12, offset, true);
    offset += pngs[i].length;
  });
  return new Blob([head.buffer, ...pngs], { type: "image/x-icon" });
}

function makeBmp(canvas) {
  const { width: w, height: h } = canvas;
  const rowSize = Math.ceil((w * 3) / 4) * 4;
  const size = 54 + rowSize * h;
  const buf = new ArrayBuffer(size);
  const v = new DataView(buf);
  const out = new Uint8Array(buf);
  v.setUint8(0, 0x42); v.setUint8(1, 0x4d);
  v.setUint32(2, size, true);
  v.setUint32(10, 54, true);
  v.setUint32(14, 40, true);
  v.setInt32(18, w, true);
  v.setInt32(22, h, true);
  v.setUint16(26, 1, true);
  v.setUint16(28, 24, true);
  v.setUint32(34, rowSize * h, true);
  v.setInt32(38, 2835, true);
  v.setInt32(42, 2835, true);
  const ctx = canvas.getContext("2d");
  const band = Math.max(1, Math.floor(4_000_000 / w));
  for (let y0 = 0; y0 < h; y0 += band) {
    const bh = Math.min(band, h - y0);
    const data = ctx.getImageData(0, y0, w, bh).data;
    for (let yy = 0; yy < bh; yy++) {
      const y = y0 + yy;
      let o = 54 + (h - 1 - y) * rowSize;
      let i = yy * w * 4;
      for (let x = 0; x < w; x++, i += 4) {
        out[o++] = data[i + 2];
        out[o++] = data[i + 1];
        out[o++] = data[i];
      }
    }
  }
  return new Blob([buf], { type: "image/bmp" });
}

async function makeSvg(item, g) {
  const st = S.style;
  const c = item.crop;
  const raster = document.createElement("canvas");
  raster.width = g.w;
  raster.height = g.h;
  const rctx = raster.getContext("2d");
  rctx.imageSmoothingQuality = "high";
  rctx.drawImage(item.src, c.x, c.y, c.w, c.h, 0, 0, g.w, g.h);
  const alpha = hasTransparency(raster);
  const embedded = await blobToDataURL(await canvasToBlob(raster, alpha ? "image/png" : "image/jpeg", 0.92));
  release(raster);
  const short = Math.min(g.w, g.h);
  const d = svgPathData(shapePoints(g.w, g.h, st, 48));
  const fill = st.fill ? `<rect width="${g.W}" height="${g.H}" fill="${st.fill}"/>` : "";
  const shadow = st.shadow
    ? `<filter id="ds" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="${(short * 0.03).toFixed(1)}" stdDeviation="${(short * 0.035).toFixed(1)}" flood-color="#000" flood-opacity="0.38"/></filter>`
    : "";
  const border = st.border > 0 ? `<path d="${d}" fill="none" stroke="${st.borderColor}" stroke-width="${((st.border / 100) * short * 2).toFixed(2)}"/>` : "";
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${g.W}" height="${g.H}" viewBox="0 0 ${g.W} ${g.H}">
<defs><clipPath id="shape"><path d="${d}"/></clipPath>${shadow}</defs>
${fill}<g transform="translate(${g.pad} ${g.pad})"${st.shadow ? ' filter="url(#ds)"' : ""}><g clip-path="url(#shape)"><image width="${g.w}" height="${g.h}" preserveAspectRatio="none" href="${embedded}" xlink:href="${embedded}"/>${border}</g></g>
</svg>`;
  return new Blob([svg], { type: "image/svg+xml" });
}

function outputName(item, fmt) {
  const base = (item.name || "image").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80) || "image";
  const rounded = S.style.shape === "circle" || (S.style.radius > 0 && S.style.corners.some(Boolean));
  return `${base}-${rounded ? "rounded" : "resized"}.${fmt.ext}`;
}

function renderCanvas(item, g, fmtKey) {
  const canvas = document.createElement("canvas");
  canvas.width = g.W;
  canvas.height = g.H;
  const ctx = canvas.getContext("2d", { willReadFrequently: fmtKey === "bmp" });
  renderOutput(ctx, item, g, { fill: effectiveFill(FORMATS[fmtKey]) });
  return canvas;
}

async function nativeBlob(canvas, fmt, quality) {
  const blob = await canvasToBlob(canvas, fmt.mime, fmt.quality ? quality : undefined);
  if (blob.type !== fmt.mime) throw new Error(`${fmt.label} isn't supported by this browser`);
  return blob;
}

async function encodeAt(item, g, fmtKey, quality) {
  const fmt = FORMATS[fmtKey];
  let blob;
  if (fmtKey === "svg") {
    blob = await makeSvg(item, g);
  } else {
    const canvas = renderCanvas(item, g, fmtKey);
    try {
      if (fmtKey === "ico") blob = await makeIco(canvas);
      else if (fmtKey === "bmp") blob = makeBmp(canvas);
      else blob = await nativeBlob(canvas, fmt, quality);
    } finally {
      release(canvas);
    }
  }
  return { blob, k: g.k, w: g.W, h: g.H, q: fmt.quality ? quality : null, limited: g.limited };
}

// Find the biggest, best-looking file that stays under the target size.
// Lossy formats lower quality first (keeps full resolution), then shrink resolution.
async function fitToSize(item, fmtKey) {
  const fmt = FORMATS[fmtKey];
  const target = S.out.targetMB * 1e6;
  let best = null;
  let smallest = null;
  const consider = (r) => {
    if (r.blob.size <= target && (!best || r.blob.size > best.blob.size)) best = r;
    if (!smallest || r.blob.size < smallest.blob.size) smallest = r;
    return r;
  };
  const g1 = geometry(item, S.out, S.style, 1);
  const ceilingQ = fmt.quality ? S.out.quality : undefined;
  let ref;
  if (fmt.quality) {
    const canvas = renderCanvas(item, g1, fmtKey);
    try {
      const enc = async (q) => consider({ blob: await nativeBlob(canvas, fmt, q), k: g1.k, w: g1.W, h: g1.H, q, limited: g1.limited });
      const top = await enc(ceilingQ);
      if (top.blob.size <= target) return top;
      ref = top;
      const floorQ = Math.min(0.5, ceilingQ);
      const low = await enc(floorQ);
      if (low.blob.size <= target) {
        let lo = floorQ;
        let hi = ceilingQ;
        for (let i = 0; i < 6; i++) {
          const mid = (lo + hi) / 2;
          const r = await enc(mid);
          if (r.blob.size <= target) lo = mid; else hi = mid;
          if (r.blob.size <= target && r.blob.size > target * 0.95) break;
        }
        return best;
      }
    } finally {
      release(canvas);
    }
  } else {
    ref = consider(await encodeAt(item, g1, fmtKey));
    if (ref.blob.size <= target) return ref;
  }
  // Shrink resolution. File size grows roughly with pixel count, so step by sqrt of the ratio.
  const q = fmt.quality ? Math.min(ceilingQ, 0.8) : undefined;
  let k = ref.k;
  let size = ref.blob.size;
  for (let i = 0; i < 8; i++) {
    k = clamp(k * Math.sqrt(target / size) * (i ? 0.99 : 0.96), 0.005, ref.k);
    const r = consider(await encodeAt(item, geometry(item, S.out, S.style, k), fmtKey, q));
    size = r.blob.size;
    if (size <= target && size > target * 0.93) break;
    if (Math.min(r.w, r.h) <= 8) break;
  }
  if (best) return best;
  return { ...smallest, missed: true };
}

async function encodeItem(item) {
  const fmtKey = S.out.format;
  const fmt = FORMATS[fmtKey];
  const r = fileMode() ? await fitToSize(item, fmtKey) : await encodeAt(item, geometry(item), fmtKey, S.out.quality);
  return { ...r, name: outputName(item, fmt), mime: fmt.mime };
}

async function getEncoded(item) {
  if (S.cache && S.cache.id === item.id && S.cache.rev === S.rev) return S.cache;
  const res = await encodeItem(item);
  if (item.id === S.activeId) { S.cache = { id: item.id, rev: S.rev, ...res }; updateReadouts(); }
  return res;
}

/* ---------- ZIP (store) for batch downloads ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function makeZip(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const f of files) {
    const data = new Uint8Array(await f.blob.arrayBuffer());
    const name = enc.encode(f.name);
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true);
    lh.setUint16(10, dosTime, true);
    lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true);
    parts.push(lh.buffer, name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(12, dosTime, true);
    ch.setUint16(14, dosDate, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(ch.buffer, name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((s, p) => s + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: "application/zip" });
}

/* ---------- Saving ---------- */
const preferShare = isTouchDevice && typeof navigator.share === "function";

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function canShareFiles(files) {
  try { return typeof navigator.canShare === "function" && navigator.canShare({ files }); } catch (e) { return false; }
}

let sheetUrl = "";
function openSheet(blob) {
  if (sheetUrl) URL.revokeObjectURL(sheetUrl);
  sheetUrl = URL.createObjectURL(blob);
  $("#sheetImg").src = sheetUrl;
  $("#sheet").hidden = false;
}
function closeSheet() {
  $("#sheet").hidden = true;
  $("#sheetImg").removeAttribute("src");
  if (sheetUrl) { URL.revokeObjectURL(sheetUrl); sheetUrl = ""; }
}
$("#sheetClose").addEventListener("click", closeSheet);
$("#sheet").addEventListener("click", (e) => { if (e.target.id === "sheet") closeSheet(); });

function setBusy(b) {
  saveBtn.classList.toggle("busy", b);
  saveBtn.disabled = b;
}

async function save(mode = preferShare ? "share" : "download") {
  const it = active();
  if (!it || saveBtn.disabled) return;
  const ready = S.cache && S.cache.id === it.id && S.cache.rev === S.rev;
  if (!ready) setBusy(true);
  let res;
  try {
    res = await getEncoded(it);
  } catch (err) {
    setBusy(false);
    toast(err.message || "Couldn't create that file", "err", 3600);
    return;
  }
  setBusy(false);
  if (res.limited) toast("Scaled down to fit this device's limit", "", 2400);
  if (res.missed) toast(`Couldn't get under ${fmtMB(S.out.targetMB)} — this is the smallest (${fmtBytes(res.blob.size)})`, "err", 4200);

  if (mode === "share") {
    const file = new File([res.blob], res.name, { type: res.mime });
    if (canShareFiles([file])) {
      try {
        await navigator.share({ files: [file], title: res.name });
        buzz([10, 40, 10]);
        celebrate(saveBtn);
        return;
      } catch (err) {
        if (err.name === "AbortError") return;
        if (err.name === "NotAllowedError" && !ready) { toast("Ready! Tap Save once more", "ok"); return; }
        // fall through to other methods
      }
    }
    if (isIOS && /^image\/(png|jpeg|webp|gif)$/.test(res.mime)) { openSheet(res.blob); return; }
  }
  download(res.blob, res.name);
  buzz([10, 40, 10]);
  celebrate(saveBtn);
  toast(`Saved ${res.name}`, "ok");
}

async function copyImage() {
  const it = active();
  if (!it) return;
  if (!navigator.clipboard || typeof ClipboardItem === "undefined") { toast("Copying images isn't supported here", "err"); return; }
  const pngBlob = (async () => {
    if (S.out.format === "png") return (await getEncoded(it)).blob;
    const g = geometry(it);
    const c = document.createElement("canvas");
    c.width = g.W; c.height = g.H;
    renderOutput(c.getContext("2d"), it, g, { fill: S.style.fill });
    try { return await canvasToBlob(c, "image/png"); } finally { release(c); }
  })();
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
    buzz(10);
    toast("Copied to clipboard", "ok");
  } catch (err) {
    toast("Couldn't copy — try Save instead", "err");
  }
}

async function saveAll(forceZip = false) {
  if (!S.items.length) return;
  const t = toast(`Preparing ${S.items.length} images…`, "", 120000);
  setBusy(true);
  const results = [];
  const used = new Set();
  try {
    for (const [i, it] of S.items.entries()) {
      t.el.textContent = `Rounding ${i + 1} of ${S.items.length}…`;
      const res = it.id === S.activeId ? await getEncoded(it) : await encodeItem(it);
      let name = res.name;
      for (let n = 2; used.has(name); n++) name = res.name.replace(/(\.[^.]+)$/, `-${n}$1`);
      used.add(name);
      results.push({ ...res, name });
    }
  } catch (err) {
    setBusy(false);
    t.done(err.message || "Something went wrong", "err");
    return;
  }
  setBusy(false);
  if (!forceZip && preferShare) {
    const files = results.map((r) => new File([r.blob], r.name, { type: r.mime }));
    if (canShareFiles(files)) {
      t.close();
      try {
        await navigator.share({ files });
        buzz([10, 40, 10]);
        celebrate(saveBtn);
        return;
      } catch (err) {
        if (err.name === "AbortError") return;
        if (err.name === "NotAllowedError") { toast("Ready! Tap Save all once more", "ok"); stashAll = results; return; }
      }
    }
  }
  const zip = await makeZip(results);
  download(zip, `rounded-images-${new Date().toISOString().slice(0, 10)}.zip`);
  t.done(`Saved ${results.length} images as ZIP`);
  celebrate(saveBtn);
}

let stashAll = null; // results kept around if iOS needed a fresh tap to share
async function saveAllTap() {
  if (stashAll && preferShare) {
    const files = stashAll.map((r) => new File([r.blob], r.name, { type: r.mime }));
    stashAll = null;
    try { await navigator.share({ files }); celebrate(saveBtn); return; } catch (err) { if (err.name === "AbortError") return; }
  }
  saveAll();
}

/* ---------- Controls ---------- */
function setResultView(on) {
  S.resultView = on;
  $("#viewBtn").setAttribute("aria-pressed", String(on));
  S.hover = null;
  updateCursor();
  requestRender();
}

function chip(label, attrs = {}) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "chip";
  b.textContent = label;
  for (const [k, v] of Object.entries(attrs)) b.dataset[k] = v;
  return b;
}

function buildControls() {
  const ratioWrap = $("#ratioChips");
  for (const [key, label] of RATIOS) ratioWrap.append(chip(label, { ratio: key }));
  ratioWrap.addEventListener("click", (e) => {
    const b = e.target.closest("[data-ratio]");
    if (!b) return;
    setRatio(b.dataset.ratio);
  });

  const presetWrap = $("#presetChips");
  PRESETS.forEach((p, i) => {
    const b = chip("", { preset: i });
    const g = document.createElement("span");
    g.className = "glyph";
    g.style.borderRadius = p.glyph;
    if (p.style.border) g.style.boxShadow = "inset 0 0 0 2px currentColor";
    b.append(g, p.label);
    presetWrap.append(b);
  });
  presetWrap.addEventListener("click", (e) => {
    const b = e.target.closest("[data-preset]");
    if (!b) return;
    const p = PRESETS[+b.dataset.preset];
    Object.assign(S.style, p.style, { corners: [true, true, true, true] });
    if (p.ratio) setRatio(p.ratio, false);
    buzz(8);
    b.animate && b.animate([{ transform: "scale(.9)" }, { transform: "scale(1.06)" }, { transform: "scale(1)" }], { duration: 380, easing: "cubic-bezier(.34,1.56,.64,1)" });
    syncControls();
    changed();
  });

  $("#shapeSeg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-shape]");
    if (!b) return;
    S.style.shape = b.dataset.shape;
    buzz(6);
    syncControls();
    changed();
  });

  const radiusRange = $("#radiusRange");
  radiusRange.addEventListener("input", () => {
    S.style.radius = +radiusRange.value / 100;
    if (S.style.shape === "circle") S.style.shape = "round";
    syncControls();
    changed({ light: true });
  });
  radiusRange.addEventListener("change", () => changed());

  $$(".corner").forEach((b) => b.addEventListener("click", () => {
    const i = +b.dataset.c;
    S.style.corners[i] = !S.style.corners[i];
    if (S.style.shape === "circle") S.style.shape = "round";
    buzz(6);
    syncControls();
    changed();
  }));
  $("#allCorners").addEventListener("click", () => {
    const allOn = S.style.corners.every(Boolean);
    S.style.corners = [!allOn, !allOn, !allOn, !allOn];
    if (!allOn && S.style.radius === 0) S.style.radius = 0.08;
    buzz(6);
    syncControls();
    changed();
  });

  const borderRange = $("#borderRange");
  borderRange.addEventListener("input", () => { S.style.border = +borderRange.value; syncControls(); changed({ light: true }); });
  borderRange.addEventListener("change", () => changed());

  buildSwatches($("#borderSwatches"), BORDER_COLORS, () => S.style.borderColor, (c) => {
    S.style.borderColor = c;
    if (!S.style.border) S.style.border = 2;
  });
  buildSwatches($("#fillSwatches"), FILL_COLORS, () => S.style.fill, (c) => { S.style.fill = c; });

  $("#shadowToggle").addEventListener("click", () => { S.style.shadow = !S.style.shadow; buzz(8); syncControls(); changed(); });

  const formatWrap = $("#formatChips");
  for (const [key, f] of Object.entries(FORMATS)) formatWrap.append(chip(f.label, { format: key }));
  formatWrap.addEventListener("click", (e) => {
    const b = e.target.closest("[data-format]");
    if (!b || b.disabled) return;
    S.out.format = b.dataset.format;
    buzz(6);
    syncControls();
    changed();
  });

  const qualityRange = $("#qualityRange");
  qualityRange.addEventListener("input", () => { S.out.quality = +qualityRange.value / 100; syncControls(); changed({ light: true }); });
  qualityRange.addEventListener("change", () => changed());

  $("#sizeModeSeg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-size-mode]");
    if (!b) return;
    S.out.sizeMode = b.dataset.sizeMode;
    buzz(6);
    syncControls();
    changed();
  });

  const resWrap = $("#resChips");
  RES_PRESETS.forEach(([res, label], i) => resWrap.append(chip(label, { res: i })));
  resWrap.addEventListener("click", (e) => {
    const b = e.target.closest("[data-res]");
    if (!b) return;
    S.out.res = { ...RES_PRESETS[+b.dataset.res][0] };
    buzz(6);
    syncControls();
    changed();
  });

  // Typing a width or height sets an exact size; the other side follows the crop's shape.
  const dimInput = (el, mode) => {
    el.addEventListener("input", () => {
      const v = Math.round(+el.value);
      if (!(v >= 1)) return;
      S.out.res = mode === "width" ? { mode, w: Math.min(v, 30000) } : { mode, h: Math.min(v, 30000) };
      syncControls();
      changed({ light: true });
    });
    el.addEventListener("change", () => { el.blur(); changed(); });
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") el.blur(); });
  };
  dimInput($("#outW"), "width");
  dimInput($("#outH"), "height");

  const fileWrap = $("#fileChips");
  for (const mb of FILE_PRESETS) fileWrap.append(chip(fmtMB(mb), { mb }));
  fileWrap.addEventListener("click", (e) => {
    const b = e.target.closest("[data-mb]");
    if (!b) return;
    S.out.targetMB = +b.dataset.mb;
    buzz(6);
    syncControls();
    changed();
  });
  const mbIn = $("#targetMB");
  mbIn.addEventListener("input", () => {
    const v = +mbIn.value;
    if (!(v > 0)) return;
    S.out.targetMB = Math.min(v, 500);
    syncControls();
    changed({ light: true });
  });
  mbIn.addEventListener("change", () => changed());

  // Tabs
  const tabs = $("#tabs");
  tabs.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) setTab(b.dataset.tab);
  });
  setTab(S.prefs.tab || "crop");

  $$("[data-act]").forEach((b) => b.addEventListener("click", () => act(b.dataset.act)));
  $("#viewBtn").addEventListener("click", () => { buzz(6); setResultView(!S.resultView); });
  $("#bgBtn").addEventListener("click", () => {
    const order = ["dark", "light", "grid"];
    S.prefs.viewBg = order[(order.indexOf(S.prefs.viewBg) + 1) % order.length];
    applyViewBg();
    saveSettings();
  });
  $("#themeBtn").addEventListener("click", () => {
    const order = ["auto", "light", "dark"];
    S.prefs.theme = order[(order.indexOf(S.prefs.theme) + 1) % order.length];
    applyTheme();
    saveSettings();
    toast(`Theme: ${S.prefs.theme === "auto" ? "match system" : S.prefs.theme}`, "", 1400);
  });
}

function buildSwatches(wrap, colors, get, set) {
  const render = () => {
    wrap.textContent = "";
    const current = get();
    let matched = false;
    for (const c of colors) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "swatch" + (c === null ? " none checker" : "");
      if (c) b.style.background = c;
      b.setAttribute("aria-label", c === null ? "None (transparent)" : c);
      if (c === current) { b.classList.add("is-active"); matched = true; }
      b.addEventListener("click", () => { set(c); buzz(6); syncControls(); changed(); });
      wrap.append(b);
    }
    const custom = document.createElement("label");
    custom.className = "swatch custom" + (!matched && current ? " is-active" : "");
    custom.title = "Custom color";
    const input = document.createElement("input");
    input.type = "color";
    input.value = current && /^#[0-9a-f]{6}$/i.test(current) ? current : "#2f6bff";
    input.setAttribute("aria-label", "Custom color");
    input.addEventListener("input", () => { set(input.value); syncControls(false); changed({ light: true }); });
    input.addEventListener("change", () => { syncControls(); changed(); });
    custom.append(input);
    wrap.append(custom);
  };
  wrap._render = render;
  render();
}

function setRange(el, value) {
  el.value = value;
  const p = ((value - el.min) / (el.max - el.min)) * 100;
  el.style.setProperty("--p", p + "%");
}

function syncControls(rebuildSwatches = true) {
  $$("#ratioChips [data-ratio]").forEach((b) => b.classList.toggle("is-active", b.dataset.ratio === S.prefs.ratio));
  $$("#shapeSeg [data-shape]").forEach((b) => b.classList.toggle("is-active", b.dataset.shape === S.style.shape));
  const isCircle = S.style.shape === "circle";
  $("#radiusGroup").style.opacity = isCircle ? ".45" : "";
  setRange($("#radiusRange"), Math.round(S.style.radius * 200) / 2);
  $("#radiusOut").textContent = isCircle ? "Circle" : `${(S.style.radius * 100).toFixed(S.style.radius * 100 % 1 ? 1 : 0)}%`;
  $$(".corner").forEach((b) => b.classList.toggle("is-on", S.style.corners[+b.dataset.c]));
  $("#allCorners").textContent = S.style.corners.every(Boolean) ? "None" : "All";
  setRange($("#borderRange"), S.style.border);
  $("#borderOut").textContent = S.style.border ? `${S.style.border}%` : "Off";
  $("#shadowToggle").setAttribute("aria-checked", String(S.style.shadow));
  if (rebuildSwatches) { $("#borderSwatches")._render(); $("#fillSwatches")._render(); }
  const fmt = FORMATS[S.out.format];
  $$("#formatChips [data-format]").forEach((b) => {
    const f = FORMATS[b.dataset.format];
    b.disabled = !f.supported;
    b.title = f.supported ? f.note || "" : "Not supported by this browser";
    b.classList.toggle("is-active", b.dataset.format === S.out.format);
  });
  $("#qualityGroup").style.display = fmt.quality ? "" : "none";
  setRange($("#qualityRange"), Math.round(S.out.quality * 100));
  $("#qualityOut").textContent = `${Math.round(S.out.quality * 100)}%`;
  const isIco = S.out.format === "ico";
  const fm = fileMode();
  $("#sizeGroup").style.display = isIco ? "none" : "";
  $("#icoNote").hidden = !isIco;
  $$("#sizeModeSeg [data-size-mode]").forEach((b) => b.classList.toggle("is-active", b.dataset.sizeMode === S.out.sizeMode));
  $("#resControls").hidden = fm;
  $("#fileControls").hidden = !fm;
  const resKey = JSON.stringify(S.out.res);
  $$("#resChips [data-res]").forEach((b) => b.classList.toggle("is-active", JSON.stringify(RES_PRESETS[+b.dataset.res][0]) === resKey));
  $$("#fileChips [data-mb]").forEach((b) => b.classList.toggle("is-active", +b.dataset.mb === S.out.targetMB));
  if (document.activeElement !== $("#targetMB")) $("#targetMB").value = S.out.targetMB;
  $("#qualityHead").firstChild.textContent = fm ? "Max quality " : "Quality ";
  const fillNote = !fmt.alpha && !S.style.fill ? `${fmt.label} has no transparency, so corners are filled white — pick a color to change it.` : S.style.fill ? "" : "Corners stay transparent.";
  $("#fillNote").textContent = [fillNote, fmt.note ? `${fmt.label}: ${fmt.note}.` : ""].filter(Boolean).join(" ");
  $("#saveLabel").textContent = preferShare ? (isIOS ? "Save to Photos" : "Save / Share") : "Download";
  $("#saveIcon").innerHTML = `<use href="#${preferShare ? "i-share" : "i-download"}"/>`;
}

function setTab(tab) {
  S.prefs.tab = tab;
  const names = ["crop", "shape", "style", "resize", "export"];
  $("#tabs").style.setProperty("--i", names.indexOf(tab));
  $$("#tabs [data-tab]").forEach((b) => { const on = b.dataset.tab === tab; b.classList.toggle("is-active", on); b.setAttribute("aria-selected", String(on)); });
  $$(".tab-panel").forEach((p) => p.classList.toggle("is-active", p.dataset.panel === tab));
  $("#panelBody").scrollTop = 0;
  saveSettings();
  if (tab === "export") requestRender();
}

function setRatio(key, feedback = true) {
  S.prefs.ratio = key;
  for (const it of S.items) {
    if (key === "free") continue;
    fitCropToRatio(it);
  }
  if (feedback) buzz(6);
  syncControls(false);
  changed();
}

function act(name) {
  const it = active();
  if (!it) return;
  if (name === "rotate" || name === "flip") { transformItem(it, name); buzz(8); }
  if (name === "reset") {
    it.crop = { x: 0, y: 0, w: it.w, h: it.h };
    fitCropToRatio(it);
    buzz(8);
  }
  changed({ settings: false });
}

function applyViewBg() {
  stage.dataset.bg = S.prefs.viewBg;
  $("#bgDot").dataset.bg = S.prefs.viewBg;
}

const darkQuery = matchMedia("(prefers-color-scheme: dark)");
function applyTheme() {
  const t = S.prefs.theme;
  const dark = t === "dark" || (t === "auto" && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  $("#themeColor").content = dark ? "#0b0d11" : "#eceff5";
  $("#themeBtn").innerHTML = `<svg class="i"><use href="#i-${t === "auto" ? "auto" : t === "dark" ? "moon" : "sun"}"/></svg>`;
  $("#themeBtn").title = `Theme: ${t}`;
}
darkQuery.addEventListener("change", applyTheme);

/* ---------- Menu ---------- */
function openMenu() {
  const r = $("#moreBtn").getBoundingClientRect();
  menu.hidden = false;
  $$(".many-only", menu).forEach((el) => (el.style.display = S.items.length > 1 ? "" : "none"));
  menu.querySelector('[data-menu="share"]').style.display = typeof navigator.share === "function" ? "" : "none";
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  menu.style.left = clamp(r.right - mw, 8, innerWidth - mw - 8) + "px";
  menu.style.top = (r.top - mh - 8 > 8 ? r.top - mh - 8 : r.bottom + 8) + "px";
  $("#moreBtn").setAttribute("aria-expanded", "true");
}
function closeMenu() { menu.hidden = true; $("#moreBtn").setAttribute("aria-expanded", "false"); }
$("#moreBtn").addEventListener("click", (e) => { e.stopPropagation(); menu.hidden ? openMenu() : closeMenu(); });
document.addEventListener("pointerdown", (e) => { if (!menu.hidden && !menu.contains(e.target) && e.target !== $("#moreBtn")) closeMenu(); });
menu.addEventListener("click", (e) => {
  const b = e.target.closest("[data-menu]");
  if (!b) return;
  closeMenu();
  const m = b.dataset.menu;
  if (m === "download") save("download");
  if (m === "share") save("share");
  if (m === "copy") copyImage();
  if (m === "zip") saveAll(true);
  if (m === "remove" && active()) removeItem(S.activeId);
  if (m === "clear") while (S.items.length) removeItem(S.items[0].id);
});

/* ---------- Inputs: picker, drop, paste, share target, file handlers ---------- */
fileInput.addEventListener("change", () => { addFiles(fileInput.files); fileInput.value = ""; });
$("#pickBtn").addEventListener("click", (e) => { e.stopPropagation(); fileInput.click(); });
$("#addBtn").addEventListener("click", () => fileInput.click());
stage.addEventListener("click", () => { if (!active()) fileInput.click(); });
saveBtn.addEventListener("click", () => save());
$("#allBtn").addEventListener("click", saveAllTap);

let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
  e.preventDefault();
  dragDepth++;
  stage.classList.add("is-over");
});
window.addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.types || [])].includes("Files")) e.preventDefault(); });
window.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) stage.classList.remove("is-over"); });
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  stage.classList.remove("is-over");
  if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
});

window.addEventListener("paste", (e) => {
  if (e.target.closest && e.target.closest("input")) return;
  const files = [...(e.clipboardData?.files || [])];
  if (!files.length) {
    for (const item of e.clipboardData?.items || []) if (item.kind === "file") { const f = item.getAsFile(); if (f) files.push(f); }
  }
  if (files.length) {
    e.preventDefault();
    addFiles(files.map((f, i) => (f.name && f.name !== "image.png" ? f : new File([f], `pasted-${Date.now()}-${i}.${extOf(f.name) || (f.type.split("/")[1] || "png")}`, { type: f.type }))));
  }
});

async function receiveShared() {
  const params = new URLSearchParams(location.search);
  if (!params.has("share")) return;
  history.replaceState(null, "", location.pathname);
  try {
    const cache = await caches.open("image-rounder-share");
    const keys = await cache.keys();
    const files = [];
    for (const req of keys) {
      const res = await cache.match(req);
      const blob = await res.blob();
      files.push(new File([blob], decodeURIComponent(res.headers.get("x-name") || "shared-image"), { type: blob.type }));
      await cache.delete(req);
    }
    if (files.length) addFiles(files);
  } catch (err) {
    console.warn("Share receive failed", err);
  }
}

if ("launchQueue" in window) {
  window.launchQueue.setConsumer(async (params) => {
    if (!params.files || !params.files.length) return;
    const files = await Promise.all(params.files.map((h) => h.getFile()));
    addFiles(files);
  });
}

/* ---------- Keyboard ---------- */
window.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  const typing = e.target.closest && e.target.closest("input, textarea, select");
  if (e.key === "Escape") { closeMenu(); closeSheet(); if (S.resultView) setResultView(false); return; }
  if (mod && e.key.toLowerCase() === "o") { e.preventDefault(); fileInput.click(); return; }
  const it = active();
  if (!it) return;
  if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); e.shiftKey ? saveAll() : save("download"); return; }
  if (mod && e.key.toLowerCase() === "c" && !String(getSelection())) { e.preventDefault(); copyImage(); return; }
  if (typing || mod || e.altKey) return;
  const k = e.key;
  if (k === " ") {
    if (e.target.closest && e.target.closest("button")) return;
    e.preventDefault();
    if (!e.repeat) setResultView(true);
    return;
  }
  if (k === "r" || k === "R") act("rotate");
  else if (k === "f" || k === "F") act("flip");
  else if (k === "[" || k === "]") {
    S.style.radius = clamp(S.style.radius + (k === "]" ? 0.01 : -0.01) * (e.shiftKey ? 5 : 1), 0, 0.5);
    if (S.style.shape === "circle") S.style.shape = "round";
    syncControls(false);
    changed();
  } else if (k.startsWith("Arrow")) {
    e.preventDefault();
    const step = (e.shiftKey ? 10 : 1) / S.view.scale;
    const dx = k === "ArrowLeft" ? -step : k === "ArrowRight" ? step : 0;
    const dy = k === "ArrowUp" ? -step : k === "ArrowDown" ? step : 0;
    moveCrop(it, it.crop, dx, dy);
    changed({ settings: false });
  } else if (k === "Delete") {
    removeItem(it.id);
    toast("Image removed", "", 1400);
  } else if (S.items.length > 1 && (k === "," || k === ".")) {
    const i = S.items.findIndex((x) => x.id === it.id);
    selectItem(S.items[(i + (k === "." ? 1 : -1) + S.items.length) % S.items.length].id);
  }
});
window.addEventListener("keyup", (e) => { if (e.key === " " && S.resultView) setResultView(false); });

/* ---------- Resize ---------- */
if ("ResizeObserver" in window) {
  new ResizeObserver(() => requestRender()).observe(stage);
  new ResizeObserver(() => requestRender()).observe($("#previewBox"));
} else {
  window.addEventListener("resize", requestRender);
}
desktopQuery.addEventListener("change", requestRender);

/* ---------- Boot ---------- */
async function detectEncoders() {
  const c = document.createElement("canvas");
  c.width = c.height = 2;
  for (const key of ["webp", "avif"]) {
    try {
      const b = await canvasToBlob(c, FORMATS[key].mime, 0.8);
      FORMATS[key].supported = b.type === FORMATS[key].mime;
    } catch (e) { FORMATS[key].supported = false; }
  }
  if (!FORMATS[S.out.format] || !FORMATS[S.out.format].supported) S.out.format = "png";
  syncControls();
  if (active()) changed({ settings: false });
}

buildControls();
applyTheme();
applyViewBg();
syncControls();
detectEncoders();
receiveShared();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("SW registration failed", err));
  });
}

// Expose a tiny hook for automated tests.
window.__rounder = { S, addFiles, encodeItem, geometry, setRatio, FORMATS, makeZip };
