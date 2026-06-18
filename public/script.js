/**
 * HidzImage v2 — Pure Client-Side Image Enhancer
 * Semua proses berjalan di browser menggunakan Canvas API.
 * Tidak ada API eksternal → tidak ada error jaringan.
 *
 * Pipeline:
 *   1. Upscale multi-pass (canvas imageSmoothingQuality 'high')
 *   2. Denoise  (box blur — sebelum sharpen)
 *   3. Brightness / Contrast (per-pixel)
 *   4. Saturation (per-pixel)
 *   5. Sharpen  (Laplacian kernel 3×3)
 *   6. Clarity  (unsharp mask dengan radius lebih besar)
 */

/* ─── CONSTANTS ──────────────────────────────── */
const MAX_OUTPUT_PX = 4096; // Batas dimensi output agar tidak OOM
const STEP_DELAY    = 16;    // ms antar langkah (agar UI tidak freeze)

/* ─── STATE ──────────────────────────────────── */
let originalFile  = null;
let originalURL   = null;
let resultBlobURL = null;
let currentScale  = 2;

/* ─── DOM ────────────────────────────────────── */
const $ = id => document.getElementById(id);

const sUpload   = $('sUpload');
const sEditor   = $('sEditor');
const sProgress = $('sProgress');
const sResult   = $('sResult');

const uploadZone   = $('uploadZone');
const uploadBtn    = $('uploadBtn');
const fileInput    = $('fileInput');
const previewImg   = $('previewImg');
const previewName  = $('previewName');
const changeBtn    = $('changeBtn');
const processBtn   = $('processBtn');

const progTitle = $('progTitle');
const progSub   = $('progSub');
const progBar   = $('progBar');

const cmpSpacer   = $('cmpSpacer');
const cmpBefore   = $('cmpBefore');
const cmpAfterImg = $('cmpAfterImg');
const cmpAfter    = $('cmpAfter');
const cmpHandle   = $('cmpHandle');
const cmpWrap     = $('cmpWrap');
const resultInfo  = $('resultInfo');
const downloadBtn = $('downloadBtn');
const editAgainBtn= $('editAgainBtn');
const newPhotoBtn = $('newPhotoBtn');

/* ─── HELPERS ────────────────────────────────── */
const clamp = (v, lo=0, hi=255) => v < lo ? lo : v > hi ? hi : v;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function showOnly(section) {
  [sUpload, sEditor, sProgress, sResult].forEach(s => s.classList.add('hidden'));
  section.classList.remove('hidden');
}

function setProgress(pct, title, sub='') {
  progBar.style.width = pct + '%';
  if (title) progTitle.textContent = title;
  if (sub)   progSub.textContent   = sub;
}

function fmt(n) {
  return n >= 1000000 ? (n/1000000).toFixed(1)+'M px'
       : n >= 1000    ? (n/1000).toFixed(0)+'K px'
       : n + ' px';
}

/* ─── UPLOAD FLOW ────────────────────────────── */
uploadBtn.addEventListener('click', () => fileInput.click());
uploadZone.addEventListener('click', e => { if (e.target !== uploadBtn) fileInput.click(); });
changeBtn.addEventListener('click', () => fileInput.click());

// Drag & Drop
uploadZone.addEventListener('dragover',  e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', e => {
  e.preventDefault(); uploadZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) loadFile(file);
});

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) loadFile(fileInput.files[0]);
});

function loadFile(file) {
  if (!file.type.startsWith('image/')) { alert('Harap pilih file gambar.'); return; }
  if (originalURL) URL.revokeObjectURL(originalURL);
  originalFile = file;
  originalURL  = URL.createObjectURL(file);
  previewImg.src  = originalURL;
  previewName.textContent = file.name + ' · ' + (file.size / 1024).toFixed(0) + ' KB';
  showOnly(sEditor);
  // Reset slider live-preview
  updateLivePreview();
}

/* ─── SCALE BUTTONS ─────────────────────────── */
document.querySelectorAll('.scale-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.scale-opt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentScale = parseInt(btn.dataset.v);
  });
});

/* ─── SLIDER LIVE PREVIEW ─────────────────────
   CSS filters for instant feedback — not pixel-perfect
   but shows direction of change without processing lag.
   ─────────────────────────────────────────────── */
const sliders = ['sSharpen','sClarity','sDenoise','sBright','sContrast','sSaturate'];
const vals    = { sSharpen:'vSharpen', sClarity:'vClarity', sDenoise:'vDenoise',
                  sBright:'vBright', sContrast:'vContrast', sSaturate:'vSaturate' };

function updateLivePreview() {
  const sh = +$('sSharpen').value;
  const cl = +$('sClarity').value;
  const dn = +$('sDenoise').value;
  const br = +$('sBright').value;
  const co = +$('sContrast').value;
  const sa = +$('sSaturate').value;

  const brightness = 1 + br / 150;
  const contrast   = 1 + co / 120;
  const saturate   = 1 + sa / 120;
  const blur       = dn > 20 ? (dn / 100) * 1.5 : 0;
  // Sharpen + clarity approximated via contrast boost
  const sharpContrast = 1 + (sh + cl * 0.5) / 250;

  previewImg.style.filter =
    `brightness(${brightness}) ` +
    `contrast(${(contrast * sharpContrast).toFixed(3)}) ` +
    `saturate(${saturate}) ` +
    (blur > 0 ? `blur(${blur.toFixed(2)}px) ` : '');
}

sliders.forEach(id => {
  const el = $(id);
  el.addEventListener('input', () => {
    $(vals[id]).textContent = el.value;
    updateLivePreview();
  });
});

// Reset buttons
document.querySelectorAll('.slider-reset').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.target;
    const def    = btn.dataset.default;
    $(target).value = def;
    $(vals[target]).textContent = def;
    updateLivePreview();
  });
});

/* ─── PROCESS ────────────────────────────────── */
processBtn.addEventListener('click', async () => {
  if (!originalFile) return;
  previewImg.style.filter = ''; // reset CSS preview
  showOnly(sProgress);
  setProgress(0, 'Memuat gambar...', 'Mohon tunggu sebentar');

  try {
    const opts = {
      scale:      currentScale,
      sharpen:    +$('sSharpen').value,
      clarity:    +$('sClarity').value,
      denoise:    +$('sDenoise').value,
      brightness: +$('sBright').value,
      contrast:   +$('sContrast').value,
      saturation: +$('sSaturate').value,
    };

    const { canvas, info } = await processImage(originalFile, opts);

    // Convert to blob URL
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    if (resultBlobURL) URL.revokeObjectURL(resultBlobURL);
    resultBlobURL = URL.createObjectURL(blob);

    // Show result
    cmpSpacer.src   = originalURL;
    cmpBefore.src   = originalURL;
    cmpAfterImg.src = resultBlobURL;
    cmpAfter.style.clipPath = 'inset(0 50% 0 0)';

    // Info chips
    resultInfo.innerHTML = [
      `<span class="info-chip highlight">${info.scale}× Upscale</span>`,
      `<span class="info-chip">${fmt(info.inW)} × ${fmt(info.inH)}</span>`,
      `<span class="info-chip highlight">→ ${fmt(info.outW)} × ${fmt(info.outH)}</span>`,
      info.sharpen  > 0 ? `<span class="info-chip">Ketajaman ✓</span>` : '',
      info.denoise  > 0 ? `<span class="info-chip">Denoise ✓</span>` : '',
    ].join('');

    showOnly(sResult);
    initComparison();

  } catch (err) {
    alert('Gagal memproses gambar: ' + err.message);
    showOnly(sEditor);
  }
});

/* ─── RESULT ACTIONS ─────────────────────────── */
downloadBtn.addEventListener('click', () => {
  if (!resultBlobURL) return;
  const a = document.createElement('a');
  a.href     = resultBlobURL;
  a.download = 'hidzimage-hd.png';
  a.click();
});

editAgainBtn.addEventListener('click', () => {
  previewImg.style.filter = '';
  updateLivePreview();
  showOnly(sEditor);
});

newPhotoBtn.addEventListener('click', () => {
  fileInput.value = '';
  originalFile    = null;
  if (originalURL)   { URL.revokeObjectURL(originalURL);   originalURL   = null; }
  if (resultBlobURL) { URL.revokeObjectURL(resultBlobURL); resultBlobURL = null; }
  showOnly(sUpload);
});

/* ─── BEFORE/AFTER COMPARISON SLIDER ─────────── */
function initComparison() {
  let dragging = false;
  let pos = 50; // percent

  function applyPos(pct) {
    pct = Math.max(2, Math.min(98, pct));
    pos = pct;
    cmpAfter.style.clipPath  = `inset(0 ${100 - pct}% 0 0)`;
    cmpHandle.style.left     = pct + '%';
    cmpHandle.style.transform= 'translateX(-50%)';
  }

  function getPos(e, rect) {
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    return ((clientX - rect.left) / rect.width) * 100;
  }

  cmpWrap.addEventListener('mousedown',  e => { dragging = true; applyPos(getPos(e, cmpWrap.getBoundingClientRect())); });
  cmpWrap.addEventListener('touchstart', e => { dragging = true; applyPos(getPos(e, cmpWrap.getBoundingClientRect())); }, { passive: true });
  document.addEventListener('mousemove',  e => { if (dragging) applyPos(getPos(e, cmpWrap.getBoundingClientRect())); });
  document.addEventListener('touchmove',  e => { if (dragging) applyPos(getPos(e, cmpWrap.getBoundingClientRect())); }, { passive: true });
  document.addEventListener('mouseup',  () => dragging = false);
  document.addEventListener('touchend', () => dragging = false);

  // Position handle
  cmpHandle.style.position  = 'absolute';
  cmpHandle.style.top       = '0';
  cmpHandle.style.left      = '50%';
  cmpHandle.style.transform = 'translateX(-50%)';
  applyPos(50);
}

/* ════════════════════════════════════════════════
   IMAGE PROCESSING PIPELINE
   ════════════════════════════════════════════════ */

async function processImage(file, opts) {
  const { scale, sharpen, clarity, denoise, brightness, contrast, saturation } = opts;

  /* Step 0: Load image */
  setProgress(5, 'Memuat gambar...', '');
  await sleep(STEP_DELAY);
  const img = await loadImage(URL.createObjectURL(file));

  const inW = img.naturalWidth;
  const inH = img.naturalHeight;

  /* Step 1: Upscale (multi-pass, browser high-quality resampling) */
  setProgress(15, 'Memperbesar gambar...', `${inW}×${inH} → ${scale}×`);
  await sleep(STEP_DELAY);
  let canvas = await upscale(img, inW, inH, scale);

  const outW = canvas.width;
  const outH = canvas.height;

  /* Step 2: Get ImageData */
  setProgress(30, 'Mempersiapkan data piksel...', `${outW}×${outH}`);
  await sleep(STEP_DELAY);
  const ctx  = canvas.getContext('2d');
  let imgData = ctx.getImageData(0, 0, outW, outH);

  /* Step 3: Denoise */
  if (denoise > 0) {
    setProgress(40, 'Mengurangi noise...', `radius ${denoiseRadius(denoise)}`);
    await sleep(STEP_DELAY);
    imgData = boxBlur(imgData, denoiseRadius(denoise));
  }

  /* Step 4: Brightness / Contrast */
  if (brightness !== 0 || contrast !== 0) {
    setProgress(55, 'Menyesuaikan kecerahan & kontras...', '');
    await sleep(STEP_DELAY);
    imgData = applyBrightnessContrast(imgData, brightness, contrast);
  }

  /* Step 5: Saturation */
  if (saturation !== 0) {
    setProgress(65, 'Menyesuaikan saturasi...', '');
    await sleep(STEP_DELAY);
    imgData = applySaturation(imgData, saturation);
  }

  /* Step 6: Sharpen */
  if (sharpen > 0) {
    setProgress(75, 'Mempertajam gambar...', `strength ${sharpen}%`);
    await sleep(STEP_DELAY);
    imgData = applySharpen(imgData, sharpen / 200); // map 0-100 → 0-0.5
  }

  /* Step 7: Clarity (unsharp mask, wider radius) */
  if (clarity > 0) {
    setProgress(87, 'Menambah clarity...', `strength ${clarity}%`);
    await sleep(STEP_DELAY);
    imgData = applyClarity(imgData, clarity / 150); // map 0-100 → 0-0.67
  }

  /* Step 8: Commit */
  setProgress(95, 'Menyimpan hasil...', '');
  await sleep(STEP_DELAY);
  ctx.putImageData(imgData, 0, 0);

  setProgress(100, 'Selesai!', '');
  await sleep(200);

  return { canvas, info: { scale, inW, inH, outW, outH, sharpen, denoise } };
}

/* ─── LOAD IMAGE ─────────────────────────────── */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error('Gagal memuat gambar'));
    img.src = src;
  });
}

/* ─── UPSCALE (multi-pass) ───────────────────── */
async function upscale(img, inW, inH, scale) {
  // Target, respecting MAX_OUTPUT_PX
  let tW = Math.round(inW * scale);
  let tH = Math.round(inH * scale);
  const maxDim = Math.max(tW, tH);
  if (maxDim > MAX_OUTPUT_PX) {
    const ratio = MAX_OUTPUT_PX / maxDim;
    tW = Math.round(tW * ratio);
    tH = Math.round(tH * ratio);
  }

  // Draw original to canvas
  let cur = document.createElement('canvas');
  cur.width = inW; cur.height = inH;
  cur.getContext('2d').drawImage(img, 0, 0);

  // Multi-pass: step up by 1.5× each time (smoother than one big jump)
  while (cur.width < tW || cur.height < tH) {
    const nW = Math.min(Math.round(cur.width  * 1.5), tW);
    const nH = Math.min(Math.round(cur.height * 1.5), tH);
    const next = document.createElement('canvas');
    next.width = nW; next.height = nH;
    const ctx = next.getContext('2d');
    ctx.imageSmoothingEnabled  = true;
    ctx.imageSmoothingQuality  = 'high';
    ctx.drawImage(cur, 0, 0, nW, nH);
    cur = next;
  }

  return cur;
}

/* ─── DENOISE RADIUS ─────────────────────────── */
function denoiseRadius(v) {
  // slider 0-100 → radius 0-3
  return Math.max(1, Math.round(v / 35));
}

/* ─── BOX BLUR (for denoise) ─────────────────── */
function boxBlur(imageData, radius) {
  const { width, height, data } = imageData;
  const out = new Uint8ClampedArray(data.length);

  // Horizontal pass
  const tmp = new Float32Array(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r=0,g=0,b=0,cnt=0;
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = clamp(x + dx, 0, width - 1);
        const i = (y * width + nx) * 4;
        r += data[i]; g += data[i+1]; b += data[i+2]; cnt++;
      }
      const i = (y * width + x) * 4;
      tmp[i]   = r / cnt;
      tmp[i+1] = g / cnt;
      tmp[i+2] = b / cnt;
      tmp[i+3] = data[i+3];
    }
  }

  // Vertical pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r=0,g=0,b=0,cnt=0;
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = clamp(y + dy, 0, height - 1);
        const i = (ny * width + x) * 4;
        r += tmp[i]; g += tmp[i+1]; b += tmp[i+2]; cnt++;
      }
      const i = (y * width + x) * 4;
      out[i]   = r / cnt;
      out[i+1] = g / cnt;
      out[i+2] = b / cnt;
      out[i+3] = data[i+3];
    }
  }

  return new ImageData(out, width, height);
}

/* ─── BRIGHTNESS / CONTRAST ──────────────────── */
function applyBrightnessContrast(imageData, brightness, contrast) {
  const { width, height, data } = imageData;
  const out = new Uint8ClampedArray(data.length);
  const b = (brightness / 60) * 80;          // map ±60 → ±80 pixel offset
  const c = 1 + (contrast / 60) * 0.75;      // map ±60 → contrast factor

  for (let i = 0; i < data.length; i += 4) {
    for (let j = 0; j < 3; j++) {
      out[i+j] = clamp(Math.round((data[i+j] - 128) * c + 128 + b));
    }
    out[i+3] = data[i+3];
  }
  return new ImageData(out, width, height);
}

/* ─── SATURATION ─────────────────────────────── */
function applySaturation(imageData, saturation) {
  const { width, height, data } = imageData;
  const out = new Uint8ClampedArray(data.length);
  const factor = 1 + saturation / 80;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i+1], b = data[i+2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    out[i]   = clamp(Math.round(gray + factor * (r - gray)));
    out[i+1] = clamp(Math.round(gray + factor * (g - gray)));
    out[i+2] = clamp(Math.round(gray + factor * (b - gray)));
    out[i+3] = data[i+3];
  }
  return new ImageData(out, width, height);
}

/* ─── SHARPEN (Laplacian 3×3 kernel) ─────────── */
function applySharpen(imageData, amount) {
  // Kernel: center = 1+4a, edges = -a
  // amount 0.0 → 0.5 gives mild → strong sharpen
  const { width, height, data } = imageData;
  const out = new Uint8ClampedArray(data.length);
  const a = amount;
  const center = 1 + 4 * a;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;

      // Border: copy as-is
      if (y === 0 || y === height-1 || x === 0 || x === width-1) {
        out[i] = data[i]; out[i+1] = data[i+1];
        out[i+2] = data[i+2]; out[i+3] = data[i+3];
        continue;
      }

      const t = ((y-1)*width + x) * 4;
      const b = ((y+1)*width + x) * 4;
      const l = (y*width + (x-1)) * 4;
      const r = (y*width + (x+1)) * 4;

      for (let c = 0; c < 3; c++) {
        out[i+c] = clamp(Math.round(
          center * data[i+c]
          - a * data[t+c]
          - a * data[b+c]
          - a * data[l+c]
          - a * data[r+c]
        ));
      }
      out[i+3] = data[i+3];
    }
  }
  return new ImageData(out, width, height);
}

/* ─── CLARITY (Unsharp Mask with radius 2) ───── */
function applyClarity(imageData, amount) {
  // Unsharp mask: original + amount * (original - blurred)
  const blurred = boxBlur(imageData, 2);
  const { width, height, data } = imageData;
  const bd   = blurred.data;
  const out  = new Uint8ClampedArray(data.length);

  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      out[i+c] = clamp(Math.round(data[i+c] + amount * (data[i+c] - bd[i+c])));
    }
    out[i+3] = data[i+3];
  }
  return new ImageData(out, width, height);
}
