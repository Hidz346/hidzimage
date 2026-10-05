/**
 * HidzImage — video.js
 * Versi video: HD Enhance · Kompres · Ubah Dimensi · Potong · Kecepatan · Putar & Balik ·
 * Ambil Frame · Ekstrak Audio · Upload ke Link
 * Semua pemrosesan berjalan di browser: video diputar ke canvas (HD Enhance memakai GPU/WebGL),
 * lalu direkam ulang dengan MediaRecorder. Karena itu waktu proses kira-kira sama dengan durasi video.
 * Upload ke Link memakai endpoint yang sama dengan versi foto (/api/upload).
 */

'use strict';

/* ═══════════════════════════════════════════════
   UTILITAS
   ═══════════════════════════════════════════════ */

const $     = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const even  = n => Math.max(2, 2 * Math.round(n / 2));      // encoder H.264 butuh sisi genap

function fmtSize(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  if (bytes >= 1024)        return (bytes / 1024).toFixed(0) + ' KB';
  return bytes + ' B';
}
function fmtTime(sec) {
  const s = Math.round(sec);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
/** Menit:detik dengan pecahan, mis. 1:05.3 (digits = jumlah angka di belakang koma). */
function fmtClock(sec, digits = 1) {
  const f = Math.pow(10, digits);
  const units = Math.round(Math.max(0, sec) * f);
  const m = Math.floor(units / (60 * f));
  const rest = (units - m * 60 * f) / f;
  return m + ':' + rest.toFixed(digits).padStart(digits + 3, '0');
}

/* Dialog pesan di dalam halaman (pengganti alert bawaan browser) */
const dlg = { root: $('dlg'), title: $('dlgTitle'), msg: $('dlgMsg'), ok: $('dlgOk') };
let dlgReturnFocus = null;

function showAlert(message, title = 'PERHATIAN') {
  dlg.title.textContent = title;
  dlg.msg.textContent = message;
  dlgReturnFocus = document.activeElement;
  dlg.root.classList.remove('hidden');
  dlg.ok.focus();
}
function closeAlert() {
  dlg.root.classList.add('hidden');
  if (dlgReturnFocus && dlgReturnFocus.focus) dlgReturnFocus.focus();
  dlgReturnFocus = null;
}
dlg.ok.addEventListener('click', closeAlert);
dlg.root.addEventListener('click', e => { if (e.target === dlg.root) closeAlert(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !dlg.root.classList.contains('hidden')) closeAlert();
});

/* ═══════════════════════════════════════════════
   STATE & TAMPILAN
   ═══════════════════════════════════════════════ */

const TABS = {
  enhance: { panel: 'pEnhance', label: '✦ PROSES VIDEO SEKARANG', note: 'semua berjalan di browser — privasi terjaga' },
  kompres: { panel: 'pKompres', label: '⚡ KOMPRES SEKARANG',     note: 'output sesuai dukungan browser · hasil mendekati target' },
  dimensi: { panel: 'pDimensi', label: '↔ UBAH DIMENSI SEKARANG', note: 'output sesuai dukungan browser · proses di browser' },
  potong:    { panel: 'pPotong',    label: '✂ POTONG SEKARANG',         note: 'dimensi dan kualitas dipertahankan · proses di browser' },
  kecepatan: { panel: 'pKecepatan', label: '⏱ UBAH KECEPATAN SEKARANG', note: 'suara ikut menyesuaikan · nada tetap wajar' },
  putar:     { panel: 'pPutar',     label: '⟲ TERAPKAN SEKARANG',       note: 'dimensi hasil mengikuti arah putar · proses di browser' },
  frame:     { panel: 'pFrame',     label: '🖼 AMBIL FRAME SEKARANG',   note: 'resolusi penuh seperti video asli' },
  audio:     { panel: 'pAudio',     label: '🎵 EKSTRAK AUDIO SEKARANG', note: 'output WAV · proses di browser' },
  upload:  { panel: 'pUpload',  label: '☁ UPLOAD SEKARANG',       note: 'GOBOX melalui HidzImage · maksimal 4 MB per file' },
};
const STAGES = ['vUpload', 'vSettings', 'vProgress', 'vResult'];
const UPLOAD_LABELS = { gobox: 'GOBOX', uguu: 'UGUU', uploader: 'UPLOADER' };
const VIDEO_UPLOAD_APIS = {
  gobox: '/api/upload',
  uguu: 'https://uguu.se/upload',
};
const UPLOAD_ENDPOINT = '/api/upload';
const UPLOAD_MAX_BYTES = 4 * 1024 * 1024; // batas jalur Gobox via HidzImage
const FPS = 30;                             // batas frame rate hasil (sumber 60 fps diambil selang-seling)
/* Sisi terpanjang hasil enhance. Perekaman berjalan real-time, jadi di layar sentuh (HP/tablet) dibatasi
   Full HD agar encoder sanggup mengejar 30 fps; di komputer boleh sampai 2560. */
const COARSE_POINTER = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const MAX_SIDE = COARSE_POINTER ? 1920 : 2560;
const NEUTRAL_FX = { sharp: 0, bright: 0, contrast: 1, sat: 1, look: 0, grain: 0 };   // perbesar tanpa ubah warna
const MIN_CLIP = 0.3;                        // potongan terpendek (detik)
const FRAME_STEP = 1 / 30;                   // satu langkah tombol ±1 frame (detik)
const AUDIO_MAX_SEC = 600;                   // batas durasi ekstrak audio (dibaca penuh ke memori)
const AUDIO_MAX_BYTES = 400 * 1024 * 1024;   // batas ukuran file untuk ekstrak audio

const state = {
  tab: 'enhance', file: null, url: null, outUrl: null,
  vw: 0, vh: 0, dur: 0, scale: 2, unit: 'MB', locked: true, provider: 'gobox',
  busy: false, ext: 'webm', link: null,
  trimStart: 0, trimEnd: 0, rate: 2, turns: 0, flipX: 1, flipY: 1, frameFmt: 'png', channels: 2,
};

function showStage(id) {
  STAGES.forEach(s => $(s).classList.toggle('hidden', s !== id));
}

function setTab(key) {
  state.tab = key;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === key));
  Object.entries(TABS).forEach(([k, t]) => $(t.panel).classList.toggle('hidden', k !== key));
  $('vProcessBtn').textContent = TABS[key].label;
  $('vProcessNote').textContent = TABS[key].note;
  updateVideoProviderView();
  if (state.busy) return;
  $('vPreview').pause();
  previewLimit = null;
  showStage(state.file ? 'vSettings' : 'vUpload');
  updatePreviewView();
}

document.querySelectorAll('.tab-btn').forEach(b =>
  b.addEventListener('click', () => { if (!state.busy) setTab(b.dataset.tab); }));

function setProgress(frac, title, sub, emoji) {
  $('vProgBar').style.width = Math.round(Math.min(1, Math.max(0, frac)) * 100) + '%';
  if (title) $('vProgTitle').textContent = title;
  if (sub !== undefined) $('vProgSub').textContent = sub;
  if (emoji) $('vProgEmoji').textContent = emoji;
}

/* Preview hasil WebM dari MediaRecorder tidak punya durasi; ini memaksa browser menghitungnya. */
$('vOut').addEventListener('loadedmetadata', function () {
  if (this.duration !== Infinity) return;
  this.currentTime = 1e101;
  this.addEventListener('timeupdate', () => { this.currentTime = 0; }, { once: true });
});

/* ═══════════════════════════════════════════════
   PILIH VIDEO
   ═══════════════════════════════════════════════ */

const zone = $('vUploadZone'), input = $('vFileInput');
$('vUploadBtn').addEventListener('click', e => { e.stopPropagation(); input.click(); });
zone.addEventListener('click', () => input.click());
$('vChangeBtn').addEventListener('click', () => input.click());
zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
zone.addEventListener('drop', e => {
  e.preventDefault(); zone.classList.remove('drag-over');
  if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
});
input.addEventListener('change', () => { if (input.files[0]) loadFile(input.files[0]); });

function loadFile(file) {
  if (state.busy) return;
  if (!file.type.startsWith('video/')) { showAlert('Harap pilih file video.'); return; }
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) {
    showAlert('Browser ini belum mendukung perekaman video. Gunakan Chrome, Edge, Firefox, atau Safari versi terbaru.', 'BROWSER TIDAK DIDUKUNG');
    return;
  }
  const url = URL.createObjectURL(file);
  const probe = document.createElement('video');
  probe.preload = 'metadata';
  probe.onloadedmetadata = () => {
    if (!isFinite(probe.duration) || !probe.videoWidth) {
      URL.revokeObjectURL(url);
      showAlert('Video tidak bisa dibaca. Coba format lain, misalnya MP4.', 'GAGAL MEMUAT');
      return;
    }
    if (state.url) URL.revokeObjectURL(state.url);
    Object.assign(state, { file, url, vw: probe.videoWidth, vh: probe.videoHeight, dur: probe.duration });
    $('vPreview').src = url;
    $('vFileName').textContent = file.name + ' · ' + fmtSize(file.size);
    $('vSizeHint').textContent = `ukuran saat ini: ${fmtSize(file.size)} · durasi ${fmtTime(state.dur)}`;
    $('vDimInfo').innerHTML = `Dimensi asli: <strong>${state.vw} × ${state.vh} px</strong> · ${fmtSize(file.size)}`;
    $('vWidth').value = state.vw;
    $('vHeight').value = state.vh;
    initFeatureViews();
    setUnit(file.size >= 2 * 1024 * 1024 ? 'MB' : 'KB');
    $('vTargetVal').value = state.unit === 'MB'
      ? Math.max(1, Math.round(file.size / (2 * 1024 * 1024)))
      : Math.max(1, Math.round(file.size / 2048));
    input.value = '';
    showStage('vSettings');
    updatePreviewView();
  };
  probe.onerror = () => {
    URL.revokeObjectURL(url);
    showAlert('Video tidak bisa dibaca. Coba format lain, misalnya MP4.', 'GAGAL MEMUAT');
  };
  probe.src = url;
}

/* ═══════════════════════════════════════════════
   PENGATURAN
   ═══════════════════════════════════════════════ */

/* Enhance */
document.querySelectorAll('#vScaleGroup .scale-opt').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#vScaleGroup .scale-opt').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  state.scale = parseInt(b.dataset.v, 10);
}));
['vSharpen', 'vBright', 'vContrast', 'vSaturate'].forEach(id =>
  $(id).addEventListener('input', () => { $(id + 'V').textContent = $(id).value; }));
document.querySelectorAll('.btn-rst').forEach(b => b.addEventListener('click', () => {
  $(b.dataset.t).value = b.dataset.d;
  $(b.dataset.t + 'V').textContent = b.dataset.d;
}));

/* Kompres */
function setUnit(unit) {
  state.unit = unit;
  $('vUnitKB').classList.toggle('active', unit === 'KB');
  $('vUnitMB').classList.toggle('active', unit === 'MB');
}
$('vUnitKB').addEventListener('click', () => setUnit('KB'));
$('vUnitMB').addEventListener('click', () => setUnit('MB'));

/* Dimensi */
$('vWidth').addEventListener('input', () => {
  const w = parseInt($('vWidth').value, 10) || 0;
  if (state.locked && w > 0) $('vHeight').value = Math.max(1, Math.round(w * state.vh / state.vw));
});
$('vHeight').addEventListener('input', () => {
  const h = parseInt($('vHeight').value, 10) || 0;
  if (state.locked && h > 0) $('vWidth').value = Math.max(1, Math.round(h * state.vw / state.vh));
});
$('vLockBtn').addEventListener('click', () => {
  state.locked = !state.locked;
  $('vLockBtn').classList.toggle('active', state.locked);
  $('vLockBtn').textContent = state.locked ? '🔒' : '🔓';
  $('vRatioNote').textContent = state.locked ? '🔒 rasio aspek terkunci' : '🔓 rasio aspek bebas (stretch)';
});

/* Upload */
const providerBtns = document.querySelectorAll('#vProviderGroup .prov-opt');
function updateVideoProviderView(){
  const external=$('vUploaderWrap');
  const button=$('vProcessBtn');
  const note=$('vProcessNote');
  if(!external||!button||!note)return;
  const onUploadTab=state.tab==='upload';
  const externalMode=onUploadTab&&state.provider==='uploader';
  external.classList.toggle('hidden',!externalMode);
  button.classList.toggle('hidden',externalMode);
  if(!onUploadTab)return;
  note.textContent=externalMode
    ? 'UPLOADER langsung di panel · maksimal 100 MB anonim'
    : state.provider==='uguu'
      ? 'UGUU langsung · maksimal 128 MiB per file · sekitar 3 jam'
      : 'GOBOX melalui HidzImage · maksimal 4 MB per file';
  if(externalMode)external.scrollIntoView({behavior:'smooth',block:'center'});
}
/* Skala form UPLOADER mengikuti lebar panel (lebar render diatur di CSS: --ue-w) */
function fitUploaderFrame(){
  const vp=document.querySelector('.ue-viewport');
  if(!vp||!vp.clientWidth) return;
  const baseW=parseFloat(getComputedStyle(vp).getPropertyValue('--ue-w'))||340;
  vp.style.setProperty('--ue-scale', Math.min(1, vp.clientWidth/baseW).toFixed(4));
}
(function(){
  const vp=document.querySelector('.ue-viewport');
  if(vp&&'ResizeObserver' in window) new ResizeObserver(fitUploaderFrame).observe(vp);
  window.addEventListener('resize', fitUploaderFrame);
})();

providerBtns.forEach(b => b.addEventListener('click', () => {
  providerBtns.forEach(x => {
    x.classList.toggle('active', x === b);
    x.setAttribute('aria-checked', x === b);
  });
  state.provider = b.dataset.provider;
  updateVideoProviderView();
}));

/* ═══════════════════════════════════════════════
   PENGATURAN FITUR TAMBAHAN
   Potong · Kecepatan · Putar & Balik · Ambil Frame · Ekstrak Audio
   ═══════════════════════════════════════════════ */

const pv = $('vPreview');
let previewLimit = null;                  // detik: pemutar pratinjau berhenti di sini (pratinjau potongan)

/** Tampilan pratinjau menyesuaikan tab: putaran/balikan, kecepatan, dan kontrol bawaan. */
function updatePreviewView() {
  const rotating = state.tab === 'putar';
  pv.controls = !rotating;                // kontrol bawaan ikut berputar, jadi dimatikan (ketuk video untuk memutar)
  pv.playbackRate = state.tab === 'kecepatan' ? state.rate : 1;
  pv.style.transform = '';
  if (!rotating || !state.vw || !pv.clientWidth || !pv.clientHeight) return;
  const bw = pv.clientWidth, bh = pv.clientHeight;
  const fit = Math.min(bw / state.vw, bh / state.vh);
  const cw = state.vw * fit, ch = state.vh * fit;
  const k = state.turns % 2 ? Math.min(bw / ch, bh / cw) : 1;     // putaran 90°/270° dikecilkan agar muat
  pv.style.transform = `rotate(${state.turns * 90}deg) scale(${k * state.flipX}, ${k * state.flipY})`;
}
pv.addEventListener('loadedmetadata', updatePreviewView);
pv.addEventListener('click', () => {
  if (state.tab !== 'putar') return;
  if (pv.paused) pv.play().catch(() => {}); else pv.pause();
});
window.addEventListener('resize', updatePreviewView);

function initFeatureViews() {
  state.turns = 0; state.flipX = 1; state.flipY = 1;
  initTrim();
  updateRateView();
  updateTfView();
  updateAudioNote();
  updateFrameInfo();
}

/* Potong */
const clipEnd = () => state.trimEnd >= state.dur - 0.05 ? state.dur : state.trimEnd;

function updateTrimView() {
  $('vTrimStartV').textContent = fmtClock(state.trimStart);
  $('vTrimEndV').textContent = fmtClock(state.trimEnd);
  $('vTrimNote').textContent = `hasil ${fmtClock(state.trimEnd - state.trimStart)} dari ${fmtClock(state.dur)}`;
}
function initTrim() {
  state.trimStart = 0;
  state.trimEnd = state.dur;
  ['vTrimStart', 'vTrimEnd'].forEach(id => { $(id).max = state.dur; });
  $('vTrimStart').value = 0;
  $('vTrimEnd').value = state.dur;
  updateTrimView();
}
function seekPreview(t) {
  pv.pause();
  previewLimit = null;
  pv.currentTime = Math.min(Math.max(0, t), state.dur);
}
function setTrimStart(t) {
  state.trimStart = Math.max(0, Math.min(t, state.trimEnd - MIN_CLIP));
  $('vTrimStart').value = state.trimStart;
  updateTrimView();
}
function setTrimEnd(t) {
  state.trimEnd = Math.min(state.dur, Math.max(t, state.trimStart + MIN_CLIP));
  $('vTrimEnd').value = state.trimEnd;
  updateTrimView();
}
$('vTrimStart').addEventListener('input', () => { setTrimStart(+$('vTrimStart').value); seekPreview(state.trimStart); });
$('vTrimEnd').addEventListener('input', () => { setTrimEnd(+$('vTrimEnd').value); seekPreview(state.trimEnd - 0.05); });
$('vTrimMarkStart').addEventListener('click', () => setTrimStart(pv.currentTime));
$('vTrimMarkEnd').addEventListener('click', () => setTrimEnd(pv.currentTime));
$('vTrimPlay').addEventListener('click', () => {
  pv.currentTime = state.trimStart;
  previewLimit = clipEnd();
  pv.play().catch(() => {});
});
pv.addEventListener('timeupdate', () => {
  if (previewLimit !== null && pv.currentTime >= previewLimit) { pv.pause(); previewLimit = null; }
});
pv.addEventListener('pause', () => { previewLimit = null; });

/* Kecepatan */
function updateRateView() {
  $('vRateNote').textContent = `durasi hasil ≈ ${fmtTime(state.dur / state.rate)} dari ${fmtTime(state.dur)}`;
}
document.querySelectorAll('#vRateGroup .scale-opt').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#vRateGroup .scale-opt').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  state.rate = parseFloat(b.dataset.v);
  updateRateView();
  updatePreviewView();
}));

/* Putar & Balik. Model: sumber dibalik (flipX/flipY) lalu diputar searah jarum jam (turns × 90°). */
function currentTf() {
  let rot = (((state.turns % 4) + 4) % 4) * 90, fx = state.flipX, fy = state.flipY;
  if (fx < 0 && fy < 0) { rot = (rot + 180) % 360; fx = fy = 1; }     // dibalik dua arah sama dengan putar 180°
  return { rot, fx, fy, same: rot === 0 && fx > 0 && fy > 0 };
}
function updateTfView() {
  const turned = state.turns % 2 !== 0;
  const w = even(turned ? state.vh : state.vw), h = even(turned ? state.vw : state.vh);
  $('vTfNote').textContent = (currentTf().same ? 'belum ada perubahan' : 'siap diterapkan') + ` · hasil ${w} × ${h} px · ketuk video untuk memutar`;
  updatePreviewView();
}
/* Balik "horizontal"/"vertikal" mengikuti apa yang terlihat; setelah diputar 90° sumbunya tertukar. */
function flipVisible(axis) {
  const turned = state.turns % 2 !== 0;
  if ((axis === 'h') !== turned) state.flipX *= -1; else state.flipY *= -1;
  updateTfView();
}
$('vRotL').addEventListener('click', () => { state.turns -= 1; updateTfView(); });
$('vRotR').addEventListener('click', () => { state.turns += 1; updateTfView(); });
$('vRot180').addEventListener('click', () => { state.turns += 2; updateTfView(); });
$('vTfReset').addEventListener('click', () => { state.turns = 0; state.flipX = 1; state.flipY = 1; updateTfView(); });
$('vFlipH').addEventListener('click', () => flipVisible('h'));
$('vFlipV').addEventListener('click', () => flipVisible('v'));

/* Ambil frame */
function updateFrameInfo() {
  $('vFrameInfo').innerHTML = `Posisi <strong>${fmtClock(pv.currentTime || 0, 2)}</strong> / ${fmtClock(state.dur, 2)} · ${state.vw} × ${state.vh} px`;
}
['timeupdate', 'seeked', 'loadedmetadata'].forEach(ev => pv.addEventListener(ev, () => { if (state.tab === 'frame') updateFrameInfo(); }));
function stepFrame(dir) {
  pv.pause();
  previewLimit = null;
  pv.currentTime = Math.min(Math.max(0, pv.currentTime + dir * FRAME_STEP), state.dur);
}
$('vFramePrev').addEventListener('click', () => stepFrame(-1));
$('vFrameNext').addEventListener('click', () => stepFrame(1));
document.querySelectorAll('#vFrameFmt .scale-opt').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#vFrameFmt .scale-opt').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  state.frameFmt = b.dataset.f;
}));

/* Ekstrak audio */
function updateAudioNote() {
  const bytes = state.dur * 48000 * state.channels * 2 + 44;
  $('vAudioNote').textContent = `WAV tanpa kompresi · perkiraan ${fmtSize(bytes)} · video maksimal ${AUDIO_MAX_SEC / 60} menit`;
}
document.querySelectorAll('#vAudioCh .scale-opt').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#vAudioCh .scale-opt').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  state.channels = parseInt(b.dataset.c, 10);
  updateAudioNote();
}));

/* ═══════════════════════════════════════════════
   MESIN GPU (WebGL)
   Upscale bicubic + ketajaman adaptif + warna dikerjakan di GPU, jadi satu frame selesai
   dalam hitungan milidetik. Cara lama (filter SVG pada kanvas 2D) dihitung CPU untuk setiap
   frame sehingga tidak sanggup mengejar 30 fps dan hasil rekaman jadi patah-patah.
   Jika WebGL tidak tersedia, proses otomatis memakai kanvas 2D biasa.
   ═══════════════════════════════════════════════ */

const GL_VERT = `
attribute vec2 a_pos;
uniform float u_flip;
varying vec2 v_uv;
void main() {
  vec2 uv = a_pos * 0.5 + 0.5;
  v_uv = vec2(uv.x, u_flip > 0.5 ? 1.0 - uv.y : uv.y);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

/* Pass 1 — upscale Catmull-Rom (bicubic tajam). Hasil dibatasi ke rentang 4 piksel terdekat
   supaya tidak muncul halo/ringing di tepi objek. */
const GL_FRAG_UP = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D u_tex;
uniform vec2 u_size;
varying vec2 v_uv;

vec3 tap(vec2 p) { return texture2D(u_tex, p / u_size).rgb; }

void main() {
  vec2 pos = v_uv * u_size;
  vec2 c1 = floor(pos - 0.5) + 0.5;
  vec2 f = pos - c1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 o12 = w2 / w12;
  vec2 c0 = c1 - 1.0;
  vec2 c3 = c1 + 2.0;
  vec2 c12 = c1 + o12;

  vec3 col =
      tap(vec2(c0.x,  c0.y))  * (w0.x  * w0.y)
    + tap(vec2(c12.x, c0.y))  * (w12.x * w0.y)
    + tap(vec2(c3.x,  c0.y))  * (w3.x  * w0.y)
    + tap(vec2(c0.x,  c12.y)) * (w0.x  * w12.y)
    + tap(vec2(c12.x, c12.y)) * (w12.x * w12.y)
    + tap(vec2(c3.x,  c12.y)) * (w3.x  * w12.y)
    + tap(vec2(c0.x,  c3.y))  * (w0.x  * w3.y)
    + tap(vec2(c12.x, c3.y))  * (w12.x * w3.y)
    + tap(vec2(c3.x,  c3.y))  * (w3.x  * w3.y);

  vec3 n0 = tap(c1);
  vec3 n1 = tap(c1 + vec2(1.0, 0.0));
  vec3 n2 = tap(c1 + vec2(0.0, 1.0));
  vec3 n3 = tap(c1 + vec2(1.0, 1.0));
  vec3 lo = min(min(n0, n1), min(n2, n3));
  vec3 hi = max(max(n0, n1), max(n2, n3));
  gl_FragColor = vec4(clamp(col, lo, hi), 1.0);
}`;

/* Pass 2 — ketajaman adaptif (CAS: kuat di area lembut, otomatis dikurangi di tepi kontras tinggi),
   lalu kecerahan/kontras/saturasi dengan rumus yang sama seperti HD foto, sentuhan warna
   sinematik yang halus, dan dither sangat tipis agar gradasi tidak bergaris (banding). */
const GL_FRAG_FX = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D u_tex;
uniform vec2 u_px;
uniform float u_sharp;
uniform float u_bright;
uniform float u_contrast;
uniform float u_sat;
uniform float u_look;
uniform float u_grain;
uniform float u_seed;
varying vec2 v_uv;

void main() {
  vec3 e = texture2D(u_tex, v_uv).rgb;
  vec3 b = texture2D(u_tex, v_uv + vec2(0.0, -u_px.y)).rgb;
  vec3 d = texture2D(u_tex, v_uv + vec2(-u_px.x, 0.0)).rgb;
  vec3 f = texture2D(u_tex, v_uv + vec2(u_px.x, 0.0)).rgb;
  vec3 h = texture2D(u_tex, v_uv + vec2(0.0, u_px.y)).rgb;

  vec3 mn = min(min(min(d, f), min(b, h)), e);
  vec3 mx = max(max(max(d, f), max(b, h)), e);
  vec3 amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, vec3(0.0001)), 0.0, 1.0));
  vec3 wgt = amp * (-1.0 / mix(8.0, 5.0, u_sharp));
  vec3 sharp = clamp(((b + d + f + h) * wgt + e) / (1.0 + 4.0 * wgt), 0.0, 1.0);
  vec3 col = mix(e, sharp, min(1.0, u_sharp * 1.5));

  col = (col - 0.5) * u_contrast + 0.5 + u_bright;
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = clamp(vec3(l) + (col - vec3(l)) * u_sat, 0.0, 1.0);

  vec3 curve = col * col * (3.0 - 2.0 * col);
  col = mix(col, curve, 0.12 * u_look);
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col += u_look * (vec3(-0.010, 0.004, 0.014) * (1.0 - lum) + vec3(0.012, 0.004, -0.010) * lum * lum);

  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + u_seed * 37.719) * 43758.5453) - 0.5;
  gl_FragColor = vec4(clamp(col + n * u_grain, 0.0, 1.0), 1.0);
}`;

function buildProgram(gl, vsSrc, fsSrc) {
  const compile = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return sh;
    console.warn('Shader WebGL gagal dikompilasi, memakai kanvas 2D:', gl.getShaderInfoLog(sh));
    return null;
  };
  const vs = compile(gl.VERTEX_SHADER, vsSrc), fs = compile(gl.FRAGMENT_SHADER, fsSrc);
  if (!vs || !fs) return null;
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.bindAttribLocation(p, 0, 'a_pos');
  gl.linkProgram(p);
  if (gl.getProgramParameter(p, gl.LINK_STATUS)) return p;
  console.warn('Program WebGL gagal ditautkan, memakai kanvas 2D:', gl.getProgramInfoLog(p));
  return null;
}

/**
 * @returns {{draw:(video:HTMLVideoElement, n:number)=>void, dispose:()=>void}|null}
 *          null bila WebGL tidak bisa dipakai → pemanggil memakai kanvas 2D (kanvas baru).
 */
function createGLEngine(cv, srcW, srcH, o) {
  let gl = null;
  try {
    gl = cv.getContext('webgl', {
      alpha: false, antialias: false, depth: false, stencil: false,
      preserveDrawingBuffer: true, powerPreference: 'high-performance',
    });
  } catch (e) { gl = null; }
  if (!gl) return null;

  const release = () => {
    try { const x = gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); } catch (e) { /* abaikan */ }
    return null;
  };
  if (Math.max(srcW, srcH, o.w, o.h) > gl.getParameter(gl.MAX_TEXTURE_SIZE)) return release();

  const up = buildProgram(gl, GL_VERT, GL_FRAG_UP);
  const fxp = buildProgram(gl, GL_VERT, GL_FRAG_FX);
  if (!up || !fxp) return release();

  const locs = (p, names) => Object.fromEntries(names.map(n => [n, gl.getUniformLocation(p, 'u_' + n)]));
  const uUp = locs(up, ['tex', 'size', 'flip']);
  const uFx = locs(fxp, ['tex', 'px', 'flip', 'sharp', 'bright', 'contrast', 'sat', 'look', 'grain', 'seed']);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const makeTex = (w, h) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (w) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return t;
  };
  const srcTex = makeTex(0, 0);       // frame video (diisi tiap frame)
  const midTex = makeTex(o.w, o.h);   // hasil upscale, dibaca pass 2
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, midTex, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return release();

  gl.useProgram(up);
  gl.uniform1i(uUp.tex, 0);
  gl.uniform2f(uUp.size, srcW, srcH);
  gl.uniform1f(uUp.flip, 1);
  gl.useProgram(fxp);
  gl.uniform1i(uFx.tex, 0);
  gl.uniform2f(uFx.px, 1 / o.w, 1 / o.h);
  gl.uniform1f(uFx.flip, 0);
  const g = o.fx;
  gl.uniform1f(uFx.sharp, g.sharp);
  gl.uniform1f(uFx.bright, g.bright);
  gl.uniform1f(uFx.contrast, g.contrast);
  gl.uniform1f(uFx.sat, g.sat);
  gl.uniform1f(uFx.look, g.look);
  gl.uniform1f(uFx.grain, g.grain);

  return {
    draw(video, n) {
      if (gl.isContextLost()) throw new Error('Koneksi ke GPU terputus. Coba proses ulang.');
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);

      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, o.w, o.h);
      gl.useProgram(up);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, o.w, o.h);
      gl.bindTexture(gl.TEXTURE_2D, midTex);
      gl.useProgram(fxp);
      gl.uniform1f(uFx.seed, n % 61);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    dispose() {
      try {
        gl.deleteTexture(srcTex); gl.deleteTexture(midTex); gl.deleteFramebuffer(fbo);
        gl.deleteProgram(up); gl.deleteProgram(fxp); gl.deleteBuffer(quad);
      } catch (e) { /* abaikan */ }
      release();
    },
  };
}

/* ═══════════════════════════════════════════════
   MESIN RENDER
   Memutar video, menggambar tiap frame ke kanvas (GPU atau 2D), lalu merekam kanvas + audio.
   ═══════════════════════════════════════════════ */

/** Level H.264 terkecil yang cukup untuk resolusi & 30 fps (supaya encoder tidak menolak/memotong). */
function h264Level(w, h) {
  const mbs = Math.ceil(w / 16) * Math.ceil(h / 16);
  const levels = [ // [kode level, MaxFS, MaxMBPS]
    [0x1E, 1620, 40500], [0x1F, 3600, 108000], [0x28, 8192, 245760],
    [0x32, 22080, 589824], [0x33, 36864, 983040], [0x34, 36864, 2073600],
  ];
  const hit = levels.find(([, fs, rate]) => mbs <= fs && mbs * FPS <= rate);
  return (hit || levels[levels.length - 1])[0];
}

/** Daftar format rekam, urut dari yang paling diutamakan (MP4 H.264 → WebM). */
function mimeCandidates(w, h) {
  const lv = h264Level(w, h).toString(16).toUpperCase().padStart(2, '0');
  return [
    `video/mp4;codecs=avc1.6400${lv},mp4a.40.2`,
    `video/mp4;codecs=avc1.4D40${lv},mp4a.40.2`,
    `video/mp4;codecs=avc1.42E0${lv},mp4a.40.2`,
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ].filter(t => MediaRecorder.isTypeSupported(t)).concat(['']);
}

/** Coba format satu per satu sampai ada yang diterima browser. */
function makeRecorder(stream, mimes, videoBps, audioBps) {
  let lastErr = null;
  for (const mimeType of mimes) {
    try {
      const rec = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: videoBps,
        audioBitsPerSecond: audioBps,
      });
      return { rec, mimeType };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Browser ini tidak bisa merekam video.');
}

/** Bitrate wajar untuk resolusi tertentu (± 0,14 bit per piksel per frame pada 30 fps). */
const autoBitrate = (w, h) => Math.round(Math.min(20e6, Math.max(2.5e6, w * h * 4.2)));

/** Loncat ke detik tertentu dan tunggu sampai frame-nya siap (maksimal 5 detik). */
function seekTo(el, t) {
  return new Promise(ok => {
    const timer = setTimeout(done, 5000);
    function done() { clearTimeout(timer); el.removeEventListener('seeked', done); ok(); }
    el.addEventListener('seeked', done);
    el.currentTime = t;
  });
}

/**
 * @param {{w:number,h:number,bps:number,audioBps?:number,fx?:object,filter?:string,
 *          start?:number,end?:number,rate?:number,tf?:{rot:number,fx:number,fy:number}}} o
 *        fx     → parameter jalur GPU (HD Enhance / perbesar dimensi)
 *        filter → filter kanvas 2D, hanya dipakai bila WebGL tidak tersedia
 *        start/end → potong: hanya detik [start, end) yang direkam
 *        rate   → kecepatan putar (0.25–4); suara ikut menyesuaikan tanpa mengubah nada
 *        tf     → putar (rot: 0/90/180/270) dan balik (fx/fy: 1 atau -1), hanya di kanvas 2D
 * @param {(frac:number)=>void} onFrame
 * @returns {Promise<{blob:Blob, silent:boolean}>}
 */
async function renderVideo(o, onFrame) {
  const makeVideo = () => {
    const el = document.createElement('video');
    el.playsInline = true;
    el.preload = 'auto';
    el.disableRemotePlayback = true;
    el.src = state.url;
    return el;
  };
  let v = makeVideo();
  let audioCtx = null, audioDest = null, silent = false;
  let engine = null, stream = null, rec = null, mimeUsed = '';
  let finished = false, halted = false, watchdog = 0;
  const holdRef = { id: 0 };
  const chunks = [];

  const onVisibility = () => {
    /* Tab disembunyikan → browser membekukan penggambaran frame. Jeda dulu supaya hasil tidak macet. */
    if (document.hidden) {
      if (rec && rec.state === 'recording' && !v.ended) {
        rec.pause(); v.pause(); halted = true;
        $('vProgSub').textContent = 'dijeda — buka lagi halaman ini untuk melanjutkan';
      }
    } else if (halted) {
      halted = false;
      v.play().catch(() => {});
      if (rec && rec.state === 'paused') rec.resume();
    }
  };

  try {
    /* Audio lewat Web Audio (tidak disambungkan ke speaker, jadi proses berjalan senyap).
       Dibuat lebih dulu selagi masih dalam gestur klik agar tidak diblokir autoplay. */
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioDest = audioCtx.createMediaStreamDestination();
      audioCtx.createMediaElementSource(v).connect(audioDest);
      await Promise.race([audioCtx.resume(), sleep(1500)]);
      if (audioCtx.state !== 'running') throw new Error('audio ditangguhkan');
    } catch (e) {
      /* Audio tidak bisa ditangkap: pakai elemen baru yang dibisukan (tidak bersuara) dan rekam tanpa suara.
         Elemen yang sudah terhubung ke Web Audio tidak boleh dipakai lagi karena bisa membuat video macet. */
      silent = true;
      audioDest = null;
      if (audioCtx) audioCtx.close().catch(() => {});
      audioCtx = null;
      v.removeAttribute('src');
      v.load();
      v = makeVideo();
      v.muted = true;
    }

    await new Promise((ok, fail) => {
      const timer = setTimeout(ok, 8000);               // sebagian browser mobile baru memuat saat diputar
      const ready = () => { clearTimeout(timer); ok(); };
      v.onloadeddata = ready;
      v.oncanplay = ready;
      v.onerror = () => { clearTimeout(timer); fail(new Error('Video tidak bisa dibaca oleh browser.')); };
      if (v.readyState >= 2) ready();
    });

    const t0 = Math.max(0, o.start || 0);
    const tEnd = o.end != null ? o.end : state.dur;
    const span = Math.max(0.001, tEnd - t0);
    const rate = o.rate || 1;
    if (t0 > 0) await seekTo(v, t0);

    const sw = v.videoWidth || state.vw, sh = v.videoHeight || state.vh;
    const makeCanvas = () => {
      const c = document.createElement('canvas');
      c.width = o.w; c.height = o.h;
      return c;
    };
    let cv = makeCanvas();
    if (o.fx && o.w >= 0.6 * sw && o.h >= 0.6 * sh) {
      engine = createGLEngine(cv, sw, sh, o);
      if (!engine) cv = makeCanvas();                    // kanvas lama sudah terikat WebGL → pakai yang baru untuk 2D
    }
    const tf = o.tf || null;
    const quarter = !!tf && tf.rot % 180 !== 0;
    const dw = quarter ? o.h : o.w, dh = quarter ? o.w : o.h;      // ukuran gambar sebelum diputar
    let ctx = null;
    if (!engine) {
      ctx = cv.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      if (o.filter) ctx.filter = o.filter;
    }

    /* Satu frame sumber = satu frame hasil (requestFrame manual). Dengan begitu irama 24/25/30 fps
       asli terjaga dan tidak ada frame ganda/terlewat seperti pada pengambilan 30 fps otomatis. */
    const manual = typeof CanvasCaptureMediaStreamTrack !== 'undefined' &&
                   typeof CanvasCaptureMediaStreamTrack.prototype.requestFrame === 'function';
    /* Gerak lambat: frame sumber datang lebih jarang dari 30/detik, jadi frame terakhir ditahan dan
       dikirim ke perekam tepat 30x per detik supaya irama hasil tetap rata. */
    const hold = manual && rate < 1;
    stream = cv.captureStream(manual ? 0 : FPS);
    const track = stream.getVideoTracks()[0];
    if (audioDest) audioDest.stream.getAudioTracks().forEach(t => stream.addTrack(t));

    const made = makeRecorder(stream, mimeCandidates(o.w, o.h), o.bps, o.audioBps || 128000);
    rec = made.rec;
    mimeUsed = made.mimeType;
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise(ok => { rec.onstop = ok; });
    let abort;
    const aborted = new Promise((_, no) => { abort = no; });
    aborted.catch(() => {});
    rec.onerror = () => abort(new Error('Perekaman video gagal.'));
    v.onerror = () => abort(new Error('Video berhenti dibaca oleh browser.'));

    let frameNo = 0, lastUi = 0, lastTick = performance.now();
    const drawFrame = () => {
      if (engine) engine.draw(v, frameNo);
      else if (tf) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.translate(o.w / 2, o.h / 2);
        ctx.rotate(tf.rot * Math.PI / 180);
        ctx.scale(tf.fx, tf.fy);
        ctx.drawImage(v, -dw / 2, -dh / 2, dw, dh);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      } else ctx.drawImage(v, 0, 0, o.w, o.h);
      frameNo++;
      if (manual && track && !hold) track.requestFrame();
      const now = performance.now();
      if (now - lastUi > 200) {                          // perbarui progres secukupnya, jangan tiap frame
        lastUi = now;
        onFrame(Math.min(1, Math.max(0, (v.currentTime - t0) / span)));
      }
    };

    /* Frame diambil maksimal FPS per detik: sumber 60 fps diambil selang-seling (rata), 24 fps tetap 24. */
    const MIN_GAP = rate / FPS - 0.008;
    let lastTime = -1;
    const finish = async () => {
      if (finished) return;
      finished = true;
      v.pause();
      await sleep(150);                                  // beri waktu encoder memproses frame terakhir
      if (rec.state !== 'inactive') rec.stop();
    };
    const onStep = (now, meta) => {
      if (finished) return;
      try {
        lastTick = performance.now();
        const t = meta && typeof meta.mediaTime === 'number' ? meta.mediaTime : v.currentTime;
        if (t >= tEnd - 0.001 && tEnd < state.dur - 0.05) { finish(); return; }   // akhir potongan tercapai
        const dt = t - lastTime;
        if (v.readyState >= 2 && (lastTime < 0 || dt < 0 || dt >= MIN_GAP)) {
          lastTime = t;
          drawFrame();
        }
      } catch (err) { abort(err); return; }
      if (!v.ended) schedule();
    };
    const schedule = () => {
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(onStep);
      else requestAnimationFrame(onStep);
    };
    v.onended = () => {
      try { if (v.readyState >= 2) drawFrame(); } catch (err) { abort(err); return; }
      finish();
    };

    document.addEventListener('visibilitychange', onVisibility);
    watchdog = setInterval(() => {
      if (!halted && !finished && performance.now() - lastTick > 20000) {
        abort(new Error('Proses berhenti merespons. Coba video yang lebih pendek atau dimensi yang lebih kecil.'));
      }
    }, 2000);

    if (v.readyState >= 2) drawFrame();
    rec.start(500);
    v.defaultPlaybackRate = rate;
    v.playbackRate = rate;
    if (hold) {
      holdRef.id = setInterval(() => { if (!halted && !finished) track.requestFrame(); }, 1000 / FPS);
    }
    try { await v.play(); }
    catch (e) { throw new Error('Browser menolak memutar video. Ketuk tombol proses sekali lagi.'); }
    schedule();
    await Promise.race([stopped, aborted]);
  } finally {
    finished = true;
    clearInterval(watchdog);
    clearInterval(holdRef.id);
    document.removeEventListener('visibilitychange', onVisibility);
    if (rec && rec.state !== 'inactive') { try { rec.stop(); } catch (e) { /* abaikan */ } }
    v.onended = v.onerror = null;
    v.pause();
    v.removeAttribute('src');
    v.load();
    if (stream) stream.getTracks().forEach(t => t.stop());
    if (engine) engine.dispose();
    if (audioCtx) audioCtx.close().catch(() => {});
  }

  const type = (rec.mimeType || mimeUsed || 'video/webm').split(';')[0];
  const blob = new Blob(chunks, { type });
  if (!blob.size) throw new Error('Hasil video kosong. Coba lagi.');
  state.ext = type.includes('mp4') ? 'mp4' : 'webm';
  return { blob, silent };
}

/** Rencana kompres: bitrate dari target ukuran, resolusi turun kalau bitrate terlalu kecil. */
function planCompress(targetBytes) {
  const audioBps = 64000;
  const bps = Math.floor(targetBytes * 8 * 0.9 / state.dur) - audioBps;
  if (bps < 80000) return null;
  const maxPixels = bps / (30 * 0.07);
  const k = Math.min(1, Math.sqrt(maxPixels / (state.vw * state.vh)));
  return { w: even(state.vw * k), h: even(state.vh * k), bps, audioBps };
}

/* ═══════════════════════════════════════════════
   PROSES PER TAB
   ═══════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════
   AUDIO → WAV
   Suara dibaca dari file video, lalu dikemas sebagai WAV 16-bit. Tidak melalui perekaman
   real-time, jadi cepat dan hasilnya persis sama dengan suara aslinya.
   ═══════════════════════════════════════════════ */

function decodeAudio(ac, raw) {
  return new Promise((ok, fail) => {
    const p = ac.decodeAudioData(raw, ok, fail);       // bentuk callback untuk Safari lama
    if (p && typeof p.then === 'function') p.then(ok, fail);
  });
}

/** Audio surround (lebih dari 2 saluran) diturunkan ke stereo agar suara tengah/dialog tidak hilang. */
async function toStereo(buf) {
  if (buf.numberOfChannels <= 2 || typeof OfflineAudioContext === 'undefined') return buf;
  try {
    const oc = new OfflineAudioContext(2, buf.length, buf.sampleRate);
    const src = oc.createBufferSource();
    src.buffer = buf;
    src.connect(oc.destination);
    src.start();
    return await oc.startRendering();
  } catch (e) {
    return buf;                                        // cadangan: dua saluran pertama
  }
}

/** @returns {Blob} berkas WAV PCM 16-bit */
function encodeWav(buf, channels) {
  const ch = channels === 1 || buf.numberOfChannels === 1 ? 1 : 2;
  const n = buf.length, rate = buf.sampleRate, bytes = n * ch * 2;
  const L = buf.getChannelData(0);
  const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const pcm = new Int16Array(n * ch);
  const q = x => (x < -1 ? -32768 : x > 1 ? 32767 : Math.round(x < 0 ? x * 32768 : x * 32767));
  if (ch === 1) for (let i = 0; i < n; i++) pcm[i] = q((L[i] + R[i]) / 2);          // mono: rata-rata kiri & kanan
  else for (let i = 0, j = 0; i < n; i++) { pcm[j++] = q(L[i]); pcm[j++] = q(R[i]); }

  const head = new DataView(new ArrayBuffer(44));
  const tag = (o, t) => { for (let i = 0; i < 4; i++) head.setUint8(o + i, t.charCodeAt(i)); };
  tag(0, 'RIFF'); head.setUint32(4, 36 + bytes, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  head.setUint32(16, 16, true); head.setUint16(20, 1, true); head.setUint16(22, ch, true);
  head.setUint32(24, rate, true); head.setUint32(28, rate * ch * 2, true);
  head.setUint16(32, ch * 2, true); head.setUint16(34, 16, true);
  tag(36, 'data'); head.setUint32(40, bytes, true);
  return new Blob([head, pcm], { type: 'audio/wav' });
}

const runners = {
  async enhance() {
    const s = state.scale;
    let w = state.vw * s, h = state.vh * s;
    const k = Math.min(1, MAX_SIDE / Math.max(w, h));
    w = even(w * k); h = even(h * k);

    const sharpen = +$('vSharpen').value, br = +$('vBright').value;
    const co = +$('vContrast').value, sa = +$('vSaturate').value;

    /* Jalur GPU: rumus kecerahan/kontras/saturasi/ketajaman sama dengan HD foto (script.js). */
    const fx = {
      sharp: sharpen / 100, bright: (br / 60) * 80 / 255,
      contrast: 1 + (co / 60) * 0.75, sat: 1 + sa / 80,
      look: 1, grain: 1.6 / 255,
    };

    /* Cadangan bila WebGL tidak tersedia. Konvolusi SVG dihitung CPU per frame, jadi hanya dipakai pada resolusi kecil. */
    const a = sharpen / 200;
    $('vSharpKernel').setAttribute('kernelMatrix', `0 ${-a} 0 ${-a} ${1 + 4 * a} ${-a} 0 ${-a} 0`);
    const filter = [
      sharpen > 0 && w * h <= 921600 ? 'url(#vSharpFilter)' : '',
      `brightness(${1 + br / 150})`, `contrast(${1 + co / 120})`, `saturate(${1 + sa / 120})`,
    ].join(' ').trim();

    const { blob, silent } = await renderVideo({ w, h, fx, filter, bps: autoBitrate(w, h) }, f =>
      setProgress(f, 'MEMPERJELAS', `${fmtTime(f * state.dur)} / ${fmtTime(state.dur)}`, '✦'));
    return {
      blob, silent, title: 'VIDEO SELESAI DIPROSES', name: 'hidzvideo-hd',
      chips: [`<span class="chip chip-pink">${s}× UPSCALE</span>`,
              `<span class="chip chip-plain">${state.vw}×${state.vh}</span>`,
              `<span class="chip chip-green">→ ${w}×${h}</span>`],
    };
  },

  async kompres() {
    const raw = parseFloat($('vTargetVal').value);
    if (!raw || raw <= 0) throw new Error('Masukkan target ukuran yang valid (angka lebih dari 0).');
    const target = state.unit === 'MB' ? raw * 1024 * 1024 : raw * 1024;
    if (target >= state.file.size) throw new Error('Target harus lebih kecil dari ukuran video saat ini (' + fmtSize(state.file.size) + ').');
    const plan = planCompress(target);
    if (!plan) throw new Error('Target terlalu kecil untuk durasi video ini. Naikkan targetnya.');

    const { blob, silent } = await renderVideo({ ...plan }, f =>
      setProgress(f, 'MENGKOMPRES', `${fmtTime(f * state.dur)} / ${fmtTime(state.dur)}`, '📦'));
    const change = '-' + Math.max(0, (1 - blob.size / state.file.size) * 100).toFixed(0) + '%';
    return {
      blob, silent, title: 'VIDEO BERHASIL DIKOMPRES', name: 'hidzvideo-compressed',
      chips: [`<span class="chip chip-pink">TARGET ${raw} ${state.unit}</span>`,
              `<span class="chip chip-green">HASIL ${fmtSize(blob.size)}</span>`,
              `<span class="chip chip-plain">${fmtSize(state.file.size)} → ${change}</span>`,
              `<span class="chip chip-plain">${plan.w}×${plan.h} px</span>`],
    };
  },

  async dimensi() {
    const w = parseInt($('vWidth').value, 10) || 0;
    const h = parseInt($('vHeight').value, 10) || 0;
    if (w < 2 || h < 2 || w > 4096 || h > 4096) {
      throw new Error('Masukkan dimensi valid: antara 2 dan 4096 piksel untuk lebar dan tinggi.');
    }
    const ow = even(w), oh = even(h);
    /* Diperbesar → upscaler GPU (tajam, tanpa mengubah warna); diperkecil → kanvas 2D biasa. */
    const enlarge = ow * oh >= state.vw * state.vh;
    const { blob, silent } = await renderVideo({ w: ow, h: oh, fx: enlarge ? NEUTRAL_FX : null, bps: autoBitrate(ow, oh) }, f =>
      setProgress(f, 'MENGUBAH DIMENSI', `${fmtTime(f * state.dur)} / ${fmtTime(state.dur)}`, '↔️'));
    return {
      blob, silent, title: 'DIMENSI BERHASIL DIUBAH', name: `hidzvideo-${ow}x${oh}`,
      chips: [`<span class="chip chip-pink">${ow} × ${oh} px</span>`,
              `<span class="chip chip-plain">${fmtSize(blob.size)}</span>`,
              ow * oh > state.vw * state.vh
                ? '<span class="chip chip-cyan">DIPERBESAR ⬆</span>'
                : '<span class="chip chip-green">DIPERKECIL ⬇</span>',
              state.locked ? '<span class="chip chip-plain">RASIO TERJAGA 🔒</span>'
                           : '<span class="chip chip-plain">STRETCH MODE 🔓</span>'],
    };
  },

  async potong() {
    const start = state.trimStart, end = clipEnd(), len = end - start;
    if (start <= 0.05 && end >= state.dur - 0.05) {
      throw new Error('Rentang masih sama dengan video asli. Geser penanda awal atau akhir dulu.');
    }
    if (len < MIN_CLIP) throw new Error(`Potongan terlalu pendek. Minimal ${MIN_CLIP} detik.`);
    const w = even(state.vw), h = even(state.vh);
    const { blob, silent } = await renderVideo({ w, h, start, end, bps: autoBitrate(w, h) }, f =>
      setProgress(f, 'MEMOTONG', `${fmtClock(f * len)} / ${fmtClock(len)}`, '✂️'));
    return {
      blob, silent, title: 'VIDEO BERHASIL DIPOTONG', name: 'hidzvideo-potong',
      chips: [`<span class="chip chip-pink">${fmtClock(start)} → ${fmtClock(end)}</span>`,
              `<span class="chip chip-green">DURASI ${fmtClock(len)}</span>`,
              `<span class="chip chip-plain">${fmtSize(blob.size)}</span>`,
              `<span class="chip chip-plain">${w}×${h}</span>`],
    };
  },

  async kecepatan() {
    const rate = state.rate;
    const w = even(state.vw), h = even(state.vh);
    const { blob, silent } = await renderVideo({ w, h, rate, bps: autoBitrate(w, h) }, f =>
      setProgress(f, 'MENGUBAH KECEPATAN', `${fmtTime(f * state.dur)} / ${fmtTime(state.dur)}`, '⏱️'));
    return {
      blob, silent, title: 'KECEPATAN BERHASIL DIUBAH', name: `hidzvideo-${rate}x`,
      chips: [`<span class="chip chip-pink">${rate}× ${rate < 1 ? 'LAMBAT' : 'CEPAT'}</span>`,
              `<span class="chip chip-green">DURASI ${fmtTime(state.dur / rate)}</span>`,
              `<span class="chip chip-plain">${fmtSize(blob.size)}</span>`,
              `<span class="chip chip-plain">${w}×${h}</span>`],
    };
  },

  async putar() {
    const { rot, fx, fy, same } = currentTf();
    if (same) throw new Error('Belum ada perubahan. Pilih putar atau balik dulu.');
    const sw = even(state.vw), sh = even(state.vh);
    const turned = rot % 180 !== 0;
    const w = turned ? sh : sw, h = turned ? sw : sh;
    const { blob, silent } = await renderVideo({ w, h, tf: { rot, fx, fy }, bps: autoBitrate(w, h) }, f =>
      setProgress(f, 'MEMUTAR VIDEO', `${fmtTime(f * state.dur)} / ${fmtTime(state.dur)}`, '⟲'));
    return {
      blob, silent, title: 'VIDEO BERHASIL DIUBAH', name: `hidzvideo-${w}x${h}`,
      chips: [rot ? `<span class="chip chip-pink">PUTAR ${rot}°</span>` : '',
              fx < 0 || fy < 0 ? '<span class="chip chip-cyan">DIBALIK ⇋</span>' : '',
              `<span class="chip chip-green">${w}×${h}</span>`,
              `<span class="chip chip-plain">${fmtSize(blob.size)}</span>`],
    };
  },

  async frame() {
    pv.pause();
    if (pv.readyState < 2) throw new Error('Frame belum siap. Tunggu video selesai dimuat, lalu coba lagi.');
    if (pv.seeking) await new Promise(ok => pv.addEventListener('seeked', ok, { once: true }));
    const w = pv.videoWidth || state.vw, h = pv.videoHeight || state.vh;
    const jpg = state.frameFmt === 'jpg';
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    if (jpg) { ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, w, h); }  // JPG tidak punya transparansi
    ctx.drawImage(pv, 0, 0, w, h);
    const t = pv.currentTime;
    const blob = await new Promise(ok => cv.toBlob(ok, jpg ? 'image/jpeg' : 'image/png', 0.95));
    if (!blob) throw new Error('Frame tidak bisa dibuat. Coba video dengan resolusi lebih kecil.');
    return {
      blob, kind: 'image', ext: jpg ? 'jpg' : 'png', title: 'FRAME BERHASIL DIAMBIL',
      name: 'hidzvideo-frame-' + fmtClock(t, 2).replace(/[:.]/g, '-'),
      chips: [`<span class="chip chip-pink">FRAME ${fmtClock(t, 2)}</span>`,
              `<span class="chip chip-green">${w}×${h}</span>`,
              `<span class="chip chip-plain">${fmtSize(blob.size)}</span>`,
              `<span class="chip chip-plain">${jpg ? 'JPG' : 'PNG'}</span>`],
    };
  },

  async audio() {
    if (state.dur > AUDIO_MAX_SEC) {
      throw new Error(`Video terlalu panjang untuk diekstrak di browser (maksimal ${AUDIO_MAX_SEC / 60} menit).`);
    }
    if (state.file.size > AUDIO_MAX_BYTES) {
      throw new Error(`File terlalu besar untuk diekstrak di browser (maksimal ${fmtSize(AUDIO_MAX_BYTES)}).`);
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('Browser ini belum mendukung pengolahan audio.');
    setProgress(0.15, 'MEMBACA AUDIO', 'mengambil suara dari video...', '🎵');
    const ac = new AC();
    let decoded;
    try {
      decoded = await decodeAudio(ac, await state.file.arrayBuffer());
    } catch (e) {
      throw new Error('Suara tidak bisa diambil. Video ini mungkin tidak punya suara, atau format audionya belum didukung browser.');
    } finally {
      try { const r = ac.close(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* abaikan */ }
    }
    setProgress(0.7, 'MENGEMAS WAV', 'menyusun berkas audio...', '🎵');
    await sleep(30);                                    // beri waktu layar menampilkan progres
    const pcm = await toStereo(decoded);
    const blob = encodeWav(pcm, state.channels);
    const mono = state.channels === 1 || pcm.numberOfChannels === 1;
    return {
      blob, kind: 'audio', ext: 'wav', title: 'AUDIO BERHASIL DIEKSTRAK', name: 'hidzvideo-audio',
      chips: ['<span class="chip chip-pink">WAV</span>',
              `<span class="chip chip-plain">${mono ? 'MONO' : 'STEREO'}</span>`,
              `<span class="chip chip-plain">${(pcm.sampleRate / 1000).toFixed(1)} kHz</span>`,
              `<span class="chip chip-green">${fmtSize(blob.size)}</span>`,
              `<span class="chip chip-plain">${fmtClock(pcm.length / pcm.sampleRate)}</span>`],
    };
  },

  async upload() {
    if(state.provider==='uploader'){
      updateVideoProviderView();
      throw new Error('UPLOADER diproses langsung lewat form di panel.');
    }
    let payload=state.file, shrunk=false;
    if(state.provider==='gobox' && payload.size>UPLOAD_MAX_BYTES){
      const plan=planCompress(UPLOAD_MAX_BYTES*0.85);
      if(!plan)throw new Error('Video terlalu panjang untuk dikompres ke batas 4 MB GOBOX.');
      setProgress(0.02,'MENYIAPKAN VIDEO','mengecilkan video agar muat di GOBOX','📦');
      const {blob}=await renderVideo({...plan},f=>setProgress(f*0.55,null,`mengecilkan ${fmtTime(f*state.dur)} / ${fmtTime(state.dur)}`));
      if(blob.size>UPLOAD_MAX_BYTES)throw new Error('Video masih lebih dari 4 MB setelah dikompres.');
      payload=new File([blob],state.file.name.replace(/\.[^.]+$/,'')+'.'+state.ext,{type:blob.type});
      shrunk=true;
    }
    setProgress(shrunk?0.58:0.04,'MENGUPLOAD','mengirim video ke '+UPLOAD_LABELS[state.provider]+'...','☁️');
    const link=await uploadFile(payload,state.provider,frac=>setProgress((shrunk?0.58:0.04)+frac*(shrunk?0.37:0.92),null,'mengirim video...'));
    state.link=link;
    return {
      link,title:'VIDEO BERHASIL DIUPLOAD',
      chips:[
        `<span class="chip chip-pink">${UPLOAD_LABELS[state.provider]}</span>`,
        `<span class="chip chip-plain">${fmtSize(payload.size)}</span>`,
        shrunk?'<span class="chip chip-plain">DIKECILKAN</span>':'',
        '<span class="chip chip-green">LINK SIAP ✓</span>',
      ],
    };
  }
};

/** Upload video ke Gobox atau Uguu; UPLOADER memakai form resmi di panel. */
function uploadFile(file,provider,onProgress){
  if(provider==='uploader')return Promise.reject(new Error('UPLOADER diproses lewat form di panel.'));
  if(provider==='uguu'){
    return new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest(), form=new FormData();
      form.append('files[]',file,file.name);
      xhr.open('POST',VIDEO_UPLOAD_APIS.uguu,true);
      xhr.timeout=0;
      xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress(e.loaded/e.total);};
      xhr.onerror=()=>reject(new Error('UGUU tidak dapat dihubungi dari browser.'));
      xhr.ontimeout=()=>reject(new Error('Upload UGUU terlalu lama.'));
      xhr.onload=()=>{
        let data=null;try{data=JSON.parse(xhr.responseText);}catch(_){}
        if(xhr.status>=200&&xhr.status<300&&data?.files?.[0]?.url)return resolve(data.files[0].url);
        reject(new Error((data&&data.error)||'UGUU gagal mengembalikan link video.'));
      };
      xhr.send(form);
    });
  }
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();
    xhr.open('POST',VIDEO_UPLOAD_APIS.gobox,true);
    xhr.timeout=90000;
    xhr.setRequestHeader('Content-Type','application/octet-stream');
    xhr.setRequestHeader('X-File-Name',encodeURIComponent(file.name));
    xhr.setRequestHeader('X-File-Type',file.type);
    xhr.setRequestHeader('X-Provider','gobox');
    xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress(e.loaded/e.total);};
    xhr.onerror=()=>reject(new Error('Tidak bisa terhubung ke GOBOX.'));
    xhr.ontimeout=()=>reject(new Error('Upload GOBOX terlalu lama.'));
    xhr.onload=()=>{
      let data=null;try{data=JSON.parse(xhr.responseText);}catch(_){}
      if(xhr.status===413)return reject(new Error('GOBOX maksimal 4 MB melalui HidzImage.'));
      if(xhr.status>=200&&xhr.status<300&&data?.url)return resolve(data.url);
      reject(new Error((data&&data.error)||'GOBOX gagal mengembalikan link video.'));
    };
    xhr.send(file);
  });
}

/* ═══════════════════════════════════════════════
   TOMBOL PROSES & HASIL
   ═══════════════════════════════════════════════ */

const GAGAL = {
  enhance: 'GAGAL MEMPERJELAS', kompres: 'GAGAL KOMPRES', dimensi: 'GAGAL UBAH DIMENSI',
  potong: 'GAGAL MEMOTONG', kecepatan: 'GAGAL UBAH KECEPATAN', putar: 'GAGAL MEMUTAR',
  frame: 'GAGAL AMBIL FRAME', audio: 'GAGAL EKSTRAK AUDIO', upload: 'GAGAL UPLOAD',
};

$('vProcessBtn').addEventListener('click', async () => {
  if (state.tab==='upload' && state.provider==='uploader') { updateVideoProviderView(); return; }
  if (!state.file || state.busy) return;
  const tab = state.tab;
  state.busy = true;
  setProgress(0, 'MEMPROSES', 'jangan tutup atau pindah tab browser', '⚙️');
  showStage('vProgress');
  try {
    const res = await runners[tab]();
    setProgress(1, 'SELESAI!', '', '✅');
    await sleep(200);
    showResult(tab, res);
  } catch (err) {
    showAlert(err.message || 'Terjadi kesalahan. Coba lagi.', GAGAL[tab]);
    showStage('vSettings');
  } finally {
    state.busy = false;
  }
});

/** Hentikan dan kosongkan pemutar hasil (video/audio) supaya tidak terus berbunyi atau menahan memori. */
function clearOutputs() {
  [$('vOut'), $('vAudioOut')].forEach(el => { el.pause(); el.removeAttribute('src'); el.load(); });
  $('vFrameOut').removeAttribute('src');
}

function showResult(tab, res) {
  const kind = res.kind || (tab === 'upload' ? 'link' : 'video');
  const isLink = kind === 'link';
  $('vResultTitle').textContent = res.title;
  const chips = res.chips.slice();
  if (res.silent) chips.push('<span class="chip chip-plain">TANPA SUARA</span>');
  $('vResultChips').innerHTML = chips.join('');

  ['vOutWrap', 'vDownloadBtn'].forEach(id => $(id).classList.toggle('hidden', isLink));
  ['vLinkBox', 'vCopyBtn', 'vOpenBtn'].forEach(id => $(id).classList.toggle('hidden', !isLink));

  if (state.outUrl) { URL.revokeObjectURL(state.outUrl); state.outUrl = null; }
  clearOutputs();
  if (isLink) {
    $('vLinkText').textContent = res.link;
  } else {
    state.outUrl = URL.createObjectURL(res.blob);
    state.outName = `${res.name}.${res.ext || state.ext}`;
    $('vOut').classList.toggle('hidden', kind !== 'video');
    $('vFrameOut').classList.toggle('hidden', kind !== 'image');
    $('vAudioOut').classList.toggle('hidden', kind !== 'audio');
    $({ video: 'vOut', image: 'vFrameOut', audio: 'vAudioOut' }[kind]).src = state.outUrl;
  }
  showStage('vResult');
}

$('vDownloadBtn').addEventListener('click', () => {
  if (!state.outUrl) return;
  const a = document.createElement('a');
  a.href = state.outUrl; a.download = state.outName; a.click();
});
$('vCopyBtn').addEventListener('click', async () => {
  if (!state.link) return;
  try {
    await navigator.clipboard.writeText(state.link);
    $('vCopyBtn').textContent = '✓ TERSALIN!';
    setTimeout(() => { $('vCopyBtn').textContent = '📋 SALIN LINK'; }, 1500);
  } catch (e) {
    showAlert(state.link, 'SALIN MANUAL');
  }
});
$('vOpenBtn').addEventListener('click', () => { if (state.link) window.open(state.link, '_blank', 'noopener'); });
$('vEditAgainBtn').addEventListener('click', () => { clearOutputs(); showStage('vSettings'); updatePreviewView(); });
$('vNewBtn').addEventListener('click', () => {
  clearOutputs();
  if (state.url) URL.revokeObjectURL(state.url);
  if (state.outUrl) URL.revokeObjectURL(state.outUrl);
  $('vPreview').removeAttribute('src');
  Object.assign(state, { file: null, url: null, outUrl: null, link: null });
  showStage('vUpload');
});

setTab('enhance');
