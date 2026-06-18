/**
 * HidzImage v3 — script.js
 * Pure client-side canvas processing. Zero external API.
 *
 * Pipeline: upscale → denoise → brightness/contrast
 *           → saturation → sharpen → clarity
 */

/* ── CONSTANTS ──────────────────────────────────── */
const MAX_OUT = 4096;
const DELAY   = 16;

/* ── STATE ──────────────────────────────────────── */
let originalFile  = null;
let originalURL   = null;
let resultBlobURL = null;
let currentScale  = 2;

/* ── DOM ────────────────────────────────────────── */
const $ = id => document.getElementById(id);

const sUpload   = $('sUpload');
const sEditor   = $('sEditor');
const sProgress = $('sProgress');
const sResult   = $('sResult');

const uploadZone  = $('uploadZone');
const uploadBtn   = $('uploadBtn');
const fileInput   = $('fileInput');
const previewImg  = $('previewImg');
const previewName = $('previewName');
const changeBtn   = $('changeBtn');
const processBtn  = $('processBtn');

const progEmoji = $('progEmoji');
const progTitle = $('progTitle');
const progSub   = $('progSub');
const progBar   = $('progBar');

const cmpSpacer   = $('cmpSpacer');
const cmpBefore   = $('cmpBefore');
const cmpAfterImg = $('cmpAfterImg');
const cmpAfter    = $('cmpAfter');
const cmpWrap     = $('cmpWrap');
const cmpHandle   = $('cmpHandle');
const resultChips = $('resultChips');
const downloadBtn = $('downloadBtn');
const editAgainBtn= $('editAgainBtn');
const newPhotoBtn = $('newPhotoBtn');

/* ── HELPERS ────────────────────────────────────── */
const clamp = (v, lo=0, hi=255) => v < lo ? lo : v > hi ? hi : v;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function showOnly(section) {
  [sUpload, sEditor, sProgress, sResult]
    .forEach(s => s.classList.add('hidden'));
  section.classList.remove('hidden');
}

function setProgress(pct, title, sub, emoji) {
  progBar.style.width = pct + '%';
  if (title) progTitle.textContent = title;
  if (sub)   progSub.textContent   = sub;
  if (emoji) progEmoji.textContent = emoji;
}

/* ── UPLOAD FLOW ────────────────────────────────── */
uploadBtn.addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });
uploadZone.addEventListener('click', () => fileInput.click());
changeBtn.addEventListener('click',  () => fileInput.click());

uploadZone.addEventListener('dragover',  e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', e => {
  e.preventDefault(); uploadZone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f) loadFile(f);
});

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) loadFile(fileInput.files[0]);
});

function loadFile(file) {
  if (!file.type.startsWith('image/')) { alert('Harap pilih file gambar.'); return; }
  if (originalURL) URL.revokeObjectURL(originalURL);
  originalFile = file;
  originalURL  = URL.createObjectURL(file);
  previewImg.src = originalURL;
  previewImg.style.filter = '';
  previewName.textContent =
    file.name + ' · ' + (file.size / 1024).toFixed(0) + ' KB';
  showOnly(sEditor);
  updateLivePreview();
}

/* ── SCALE TOGGLE ───────────────────────────────── */
document.querySelectorAll('.scale-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.scale-opt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentScale = parseInt(btn.dataset.v);
  });
});

/* ── LIVE PREVIEW (CSS filters, instant) ─────────── */
const valMap = {
  sSharpen:'vSharpen', sClarity:'vClarity', sDenoise:'vDenoise',
  sBright:'vBright',   sContrast:'vContrast', sSaturate:'vSaturate'
};

function updateLivePreview() {
  const sh = +$('sSharpen').value;
  const cl = +$('sClarity').value;
  const dn = +$('sDenoise').value;
  const br = +$('sBright').value;
  const co = +$('sContrast').value;
  const sa = +$('sSaturate').value;

  previewImg.style.filter = [
    `brightness(${1 + br/150})`,
    `contrast(${(1 + co/120) * (1 + (sh+cl*0.5)/250)})`,
    `saturate(${1 + sa/120})`,
    dn > 20 ? `blur(${(dn/100*1.5).toFixed(2)}px)` : ''
  ].join(' ');
}

Object.keys(valMap).forEach(sid => {
  $(sid).addEventListener('input', () => {
    $(valMap[sid]).textContent = $(sid).value;
    updateLivePreview();
  });
});

document.querySelectorAll('.btn-rst').forEach(btn => {
  btn.addEventListener('click', () => {
    const t = btn.dataset.t, d = btn.dataset.d;
    $(t).value = d;
    $(valMap[t]).textContent = d;
    updateLivePreview();
  });
});

/* ── PROCESS ────────────────────────────────────── */
processBtn.addEventListener('click', async () => {
  if (!originalFile) return;
  previewImg.style.filter = '';
  showOnly(sProgress);
  setProgress(0, 'MEMPROSES', 'mohon tunggu sebentar', '⚙️');

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

    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    if (resultBlobURL) URL.revokeObjectURL(resultBlobURL);
    resultBlobURL = URL.createObjectURL(blob);

    cmpSpacer.src   = originalURL;
    cmpBefore.src   = originalURL;
    cmpAfterImg.src = resultBlobURL;
    cmpAfter.style.clipPath = 'inset(0 50% 0 0)';

    resultChips.innerHTML = [
      `<span class="chip chip-pink">${info.scale}× UPSCALE</span>`,
      `<span class="chip chip-plain">${info.inW}×${info.inH}</span>`,
      `<span class="chip chip-green">→ ${info.outW}×${info.outH}</span>`,
      info.sharpen > 0 ? '<span class="chip chip-plain">TAJAM ✓</span>' : '',
      info.denoise > 0 ? '<span class="chip chip-plain">DENOISE ✓</span>' : '',
    ].join('');

    showOnly(sResult);
    initComparison();

  } catch (err) {
    alert('Gagal memproses: ' + err.message);
    showOnly(sEditor);
  }
});

/* ── RESULT BUTTONS ─────────────────────────────── */
downloadBtn.addEventListener('click', () => {
  if (!resultBlobURL) return;
  const a = document.createElement('a');
  a.href = resultBlobURL;
  a.download = 'hidzimage-hd.png';
  a.click();
});

editAgainBtn.addEventListener('click', () => {
  updateLivePreview();
  showOnly(sEditor);
});

newPhotoBtn.addEventListener('click', () => {
  fileInput.value = '';
  originalFile = null;
  if (originalURL)   { URL.revokeObjectURL(originalURL);   originalURL   = null; }
  if (resultBlobURL) { URL.revokeObjectURL(resultBlobURL); resultBlobURL = null; }
  showOnly(sUpload);
});

/* ── COMPARISON SLIDER ──────────────────────────── */
function initComparison() {
  let dragging = false;

  function applyPct(pct) {
    pct = Math.max(2, Math.min(98, pct));
    cmpAfter.style.clipPath  = `inset(0 ${100 - pct}% 0 0)`;
    cmpHandle.style.left     = pct + '%';
    cmpHandle.style.transform= 'translateX(-50%)';
  }

  function pctFromEvent(e) {
    const r = cmpWrap.getBoundingClientRect();
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    return ((x - r.left) / r.width) * 100;
  }

  cmpWrap.addEventListener('mousedown',  e => { dragging = true; applyPct(pctFromEvent(e)); });
  // passive:false so we can prevent page horizontal scroll on touch
  cmpWrap.addEventListener('touchstart', e => {
    dragging = true;
    applyPct(pctFromEvent(e));
  }, { passive: true });

  document.addEventListener('mousemove', e => { if (dragging) applyPct(pctFromEvent(e)); });
  document.addEventListener('touchmove', e => {
    if (!dragging) return;
    e.preventDefault(); // stop horizontal page scroll
    applyPct(pctFromEvent(e));
  }, { passive: false });

  document.addEventListener('mouseup',  () => dragging = false);
  document.addEventListener('touchend', () => dragging = false);

  cmpHandle.style.position  = 'absolute';
  cmpHandle.style.top       = '0';
  applyPct(50);
}

/* ════════════════════════════════════════════════
   CANVAS PROCESSING PIPELINE
   ════════════════════════════════════════════════ */

async function processImage(file, opts) {
  const { scale, sharpen, clarity, denoise, brightness, contrast, saturation } = opts;

  setProgress(5,  'MEMUAT GAMBAR',  'loading image...', '📂');
  await sleep(DELAY);
  const img = await loadImg(URL.createObjectURL(file));

  const inW = img.naturalWidth, inH = img.naturalHeight;

  setProgress(15, 'UPSCALING', `${inW}×${inH} → ${scale}×`, '🔍');
  await sleep(DELAY);
  let canvas = await upscale(img, inW, inH, scale);
  const outW = canvas.width, outH = canvas.height;

  setProgress(30, 'MENGAMBIL DATA', `${outW}×${outH} piksel`, '💾');
  await sleep(DELAY);
  const ctx = canvas.getContext('2d');
  let d = ctx.getImageData(0, 0, outW, outH);

  if (denoise > 0) {
    setProgress(42, 'DENOISE', `radius ${denoiseR(denoise)}`, '🌫️');
    await sleep(DELAY);
    d = boxBlur(d, denoiseR(denoise));
  }

  if (brightness !== 0 || contrast !== 0) {
    setProgress(55, 'KECERAHAN & KONTRAS', '', '☀️');
    await sleep(DELAY);
    d = applyBC(d, brightness, contrast);
  }

  if (saturation !== 0) {
    setProgress(65, 'SATURASI', '', '🎨');
    await sleep(DELAY);
    d = applySat(d, saturation);
  }

  if (sharpen > 0) {
    setProgress(75, 'MEMPERTAJAM', `strength ${sharpen}%`, '✦');
    await sleep(DELAY);
    d = applySharpen(d, sharpen / 200);
  }

  if (clarity > 0) {
    setProgress(87, 'CLARITY', `strength ${clarity}%`, '💎');
    await sleep(DELAY);
    d = applyClarity(d, clarity / 150);
  }

  setProgress(95, 'MENYIMPAN', 'almost done...', '💾');
  await sleep(DELAY);
  ctx.putImageData(d, 0, 0);
  setProgress(100, 'SELESAI!', '', '✅');
  await sleep(200);

  return { canvas, info: { scale, inW, inH, outW, outH, sharpen, denoise } };
}

/* ── Load image ─────────────────────────────────── */
function loadImg(src) {
  return new Promise((ok, fail) => {
    const i = new Image();
    i.onload  = () => ok(i);
    i.onerror = () => fail(new Error('Gagal memuat gambar'));
    i.src = src;
  });
}

/* ── Multi-pass upscale ─────────────────────────── */
async function upscale(img, inW, inH, scale) {
  let tW = Math.round(inW * scale);
  let tH = Math.round(inH * scale);
  const mx = Math.max(tW, tH);
  if (mx > MAX_OUT) { const r = MAX_OUT / mx; tW = Math.round(tW*r); tH = Math.round(tH*r); }

  let cur = document.createElement('canvas');
  cur.width = inW; cur.height = inH;
  cur.getContext('2d').drawImage(img, 0, 0);

  while (cur.width < tW || cur.height < tH) {
    const nW = Math.min(Math.round(cur.width  * 1.5), tW);
    const nH = Math.min(Math.round(cur.height * 1.5), tH);
    const nx = document.createElement('canvas');
    nx.width = nW; nx.height = nH;
    const c = nx.getContext('2d');
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(cur, 0, 0, nW, nH);
    cur = nx;
  }
  return cur;
}

/* ── Denoise radius ─────────────────────────────── */
const denoiseR = v => Math.max(1, Math.round(v / 35));

/* ── Box blur (separable) ───────────────────────── */
function boxBlur(imageData, r) {
  const {width: W, height: H, data} = imageData;
  const out = new Uint8ClampedArray(data.length);
  const tmp = new Float32Array(data.length);

  for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
    let [R,G,B,n] = [0,0,0,0];
    for (let dx=-r;dx<=r;dx++) {
      const nx=clamp(x+dx,0,W-1); const i=(y*W+nx)*4;
      R+=data[i]; G+=data[i+1]; B+=data[i+2]; n++;
    }
    const i=(y*W+x)*4;
    tmp[i]=R/n; tmp[i+1]=G/n; tmp[i+2]=B/n; tmp[i+3]=data[i+3];
  }
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
    let [R,G,B,n] = [0,0,0,0];
    for (let dy=-r;dy<=r;dy++) {
      const ny=clamp(y+dy,0,H-1); const i=(ny*W+x)*4;
      R+=tmp[i]; G+=tmp[i+1]; B+=tmp[i+2]; n++;
    }
    const i=(y*W+x)*4;
    out[i]=R/n; out[i+1]=G/n; out[i+2]=B/n; out[i+3]=data[i+3];
  }
  return new ImageData(out, W, H);
}

/* ── Brightness / Contrast ──────────────────────── */
function applyBC(imageData, brightness, contrast) {
  const {width:W, height:H, data} = imageData;
  const out = new Uint8ClampedArray(data.length);
  const b = (brightness/60)*80;
  const c = 1 + (contrast/60)*0.75;
  for (let i=0;i<data.length;i+=4) {
    for (let j=0;j<3;j++)
      out[i+j] = clamp(Math.round((data[i+j]-128)*c+128+b));
    out[i+3] = data[i+3];
  }
  return new ImageData(out, W, H);
}

/* ── Saturation ─────────────────────────────────── */
function applySat(imageData, sat) {
  const {width:W, height:H, data} = imageData;
  const out = new Uint8ClampedArray(data.length);
  const f = 1 + sat/80;
  for (let i=0;i<data.length;i+=4) {
    const [r,g,b] = [data[i], data[i+1], data[i+2]];
    const gray = 0.299*r + 0.587*g + 0.114*b;
    out[i]   = clamp(Math.round(gray + f*(r-gray)));
    out[i+1] = clamp(Math.round(gray + f*(g-gray)));
    out[i+2] = clamp(Math.round(gray + f*(b-gray)));
    out[i+3] = data[i+3];
  }
  return new ImageData(out, W, H);
}

/* ── Sharpen (Laplacian 3×3) ────────────────────── */
function applySharpen(imageData, a) {
  const {width:W, height:H, data} = imageData;
  const out = new Uint8ClampedArray(data.length);
  const ctr = 1 + 4*a;
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
    const i=(y*W+x)*4;
    if (y===0||y===H-1||x===0||x===W-1) {
      out[i]=data[i]; out[i+1]=data[i+1]; out[i+2]=data[i+2]; out[i+3]=data[i+3]; continue;
    }
    const t=((y-1)*W+x)*4, b=((y+1)*W+x)*4,
          l=(y*W+(x-1))*4, r=(y*W+(x+1))*4;
    for (let c=0;c<3;c++)
      out[i+c] = clamp(Math.round(
        ctr*data[i+c]-a*data[t+c]-a*data[b+c]-a*data[l+c]-a*data[r+c]
      ));
    out[i+3]=data[i+3];
  }
  return new ImageData(out, W, H);
}

/* ── Clarity (unsharp mask r=2) ─────────────────── */
function applyClarity(imageData, a) {
  const blurred = boxBlur(imageData, 2);
  const {width:W, height:H, data} = imageData;
  const bd  = blurred.data;
  const out = new Uint8ClampedArray(data.length);
  for (let i=0;i<data.length;i+=4) {
    for (let c=0;c<3;c++)
      out[i+c] = clamp(Math.round(data[i+c]+a*(data[i+c]-bd[i+c])));
    out[i+3]=data[i+3];
  }
  return new ImageData(out, W, H);
}
