/**
 * HidzImage — video.js
 * Versi video: HD Enhance · Kompres Ukuran File · Ubah Dimensi · Upload ke Link
 * Semua pemrosesan berjalan di browser: video diputar ke canvas, lalu direkam ulang
 * dengan MediaRecorder. Karena itu waktu proses kira-kira sama dengan durasi video.
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
  upload:  { panel: 'pUpload',  label: '☁ UPLOAD SEKARANG',       note: 'video dikirim ke Uguu · di atas 4 MB dikecilkan otomatis' },
};
const STAGES = ['vUpload', 'vSettings', 'vProgress', 'vResult'];
const UPLOAD_LABELS = { uguu: 'UGUU', catbox: 'CATBOX' };
const UPLOAD_ENDPOINT = '/api/upload';
const UPLOAD_MAX_BYTES = 4 * 1024 * 1024;   // batas body request fungsi serverless
const MAX_SIDE = 2560;                      // sisi terpanjang hasil enhance

const state = {
  tab: 'enhance', file: null, url: null, outUrl: null,
  vw: 0, vh: 0, dur: 0, scale: 2, unit: 'MB', locked: true, provider: 'catbox',
  busy: false, ext: 'webm', link: null,
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
  if (state.busy) return;
  showStage(state.file ? 'vSettings' : 'vUpload');
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
    setUnit(file.size >= 2 * 1024 * 1024 ? 'MB' : 'KB');
    $('vTargetVal').value = state.unit === 'MB'
      ? Math.max(1, Math.round(file.size / (2 * 1024 * 1024)))
      : Math.max(1, Math.round(file.size / 2048));
    input.value = '';
    showStage('vSettings');
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
providerBtns.forEach(b => b.addEventListener('click', () => {
  providerBtns.forEach(x => {
    x.classList.toggle('active', x === b);
    x.setAttribute('aria-checked', x === b);
  });
  state.provider = b.dataset.provider;
}));

/* ═══════════════════════════════════════════════
   MESIN RENDER
   Memutar video ke canvas (dengan filter), merekam canvas + audio.
   ═══════════════════════════════════════════════ */

function pickMime() {
  return [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ].find(t => MediaRecorder.isTypeSupported(t)) || '';
}

/** Bitrate wajar untuk resolusi tertentu (± 0,12 bit per piksel per frame pada 30 fps). */
const autoBitrate = (w, h) => Math.round(Math.min(16e6, Math.max(1.5e6, w * h * 3.6)));

/**
 * @param {{w:number,h:number,filter?:string,bps:number,audioBps?:number}} o
 * @param {(frac:number)=>void} onFrame
 * @returns {Promise<{blob:Blob, silent:boolean}>}
 */
async function renderVideo(o, onFrame) {
  const mime = pickMime();
  const v = document.createElement('video');
  v.playsInline = true;
  v.preload = 'auto';
  v.src = state.url;
  await new Promise((ok, fail) => {
    v.onloadeddata = ok;
    v.onerror = () => fail(new Error('Video tidak bisa dibaca oleh browser.'));
  });

  const cv = document.createElement('canvas');
  cv.width = o.w; cv.height = o.h;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const stream = cv.captureStream(30);

  /* Audio lewat Web Audio (tidak disambungkan ke speaker, jadi proses berjalan senyap) */
  let audioCtx = null, silent = false;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const dest = audioCtx.createMediaStreamDestination();
    audioCtx.createMediaElementSource(v).connect(dest);
    dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
    await audioCtx.resume();
  } catch (e) {
    silent = true;
    if (audioCtx) audioCtx.close().catch(() => {});
    audioCtx = null;
  }

  const rec = new MediaRecorder(stream, {
    ...(mime ? { mimeType: mime } : {}),
    videoBitsPerSecond: o.bps,
    audioBitsPerSecond: o.audioBps || 128000,
  });
  const chunks = [];
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((ok, fail) => {
    rec.onstop = ok;
    rec.onerror = () => fail(new Error('Perekaman video gagal.'));
  });

  const drawFrame = () => {
    ctx.filter = o.filter || 'none';
    ctx.drawImage(v, 0, 0, o.w, o.h);
    onFrame(v.currentTime / state.dur);
  };
  const loop = () => {
    drawFrame();
    if (v.ended) return;
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(loop);
    else requestAnimationFrame(loop);
  };
  v.onended = () => { drawFrame(); if (rec.state !== 'inactive') rec.stop(); };

  try {
    drawFrame();
    rec.start(500);
    await v.play();
    loop();
    await stopped;
  } finally {
    if (rec.state !== 'inactive') rec.stop();
    v.pause();
    v.removeAttribute('src');
    v.load();
    if (audioCtx) audioCtx.close().catch(() => {});
  }

  const type = (rec.mimeType || mime || 'video/webm').split(';')[0];
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

const runners = {
  async enhance() {
    const s = state.scale;
    let w = state.vw * s, h = state.vh * s;
    const k = Math.min(1, MAX_SIDE / Math.max(w, h));
    w = even(w * k); h = even(h * k);

    const sharpen = +$('vSharpen').value, br = +$('vBright').value;
    const co = +$('vContrast').value, sa = +$('vSaturate').value;
    const a = sharpen / 200;
    $('vSharpKernel').setAttribute('kernelMatrix', `0 ${-a} 0 ${-a} ${1 + 4 * a} ${-a} 0 ${-a} 0`);
    const filter = [
      sharpen > 0 ? 'url(#vSharpFilter)' : '',
      `brightness(${1 + br / 150})`, `contrast(${1 + co / 120})`, `saturate(${1 + sa / 120})`,
    ].join(' ').trim();

    const { blob, silent } = await renderVideo({ w, h, filter, bps: autoBitrate(w, h) }, f =>
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
    const { blob, silent } = await renderVideo({ w: ow, h: oh, bps: autoBitrate(ow, oh) }, f =>
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

  async upload() {
    let payload = state.file, shrunk = false;
    if (payload.size > UPLOAD_MAX_BYTES) {
      const plan = planCompress(UPLOAD_MAX_BYTES * 0.85);
      if (!plan) throw new Error('Video terlalu panjang untuk diupload lewat layanan ini.');
      setProgress(0, 'MENYIAPKAN VIDEO', 'mengecilkan ukuran agar muat diupload', '📦');
      const { blob } = await renderVideo({ ...plan }, f =>
        setProgress(f * 0.6, null, `mengecilkan ${fmtTime(f * state.dur)} / ${fmtTime(state.dur)}`));
      if (blob.size > UPLOAD_MAX_BYTES) throw new Error('Video masih terlalu besar setelah dikecilkan. Pangkas durasinya dulu.');
      payload = new File([blob], state.file.name.replace(/\.[^.]+$/, '') + '.' + state.ext, { type: blob.type });
      shrunk = true;
    }
    setProgress(shrunk ? 0.65 : 0.05, 'MENGUPLOAD', 'mengirim ke ' + UPLOAD_LABELS[state.provider] + '...', '☁️');
    const link = await uploadFile(payload, state.provider, frac =>
      setProgress((shrunk ? 0.65 : 0.05) + frac * (shrunk ? 0.33 : 0.9)));
    state.link = link;
    return {
      link, title: 'VIDEO BERHASIL DIUPLOAD',
      chips: [`<span class="chip chip-pink">${UPLOAD_LABELS[state.provider]}</span>`,
              `<span class="chip chip-plain">${fmtSize(payload.size)}</span>`,
              shrunk ? '<span class="chip chip-plain">DIKECILKAN</span>' : '',
              '<span class="chip chip-green">LINK SIAP ✓</span>'],
    };
  },
};

/** Kirim file ke /api/upload, kembalikan URL hasil. onProgress menerima 0..1. */
function uploadFile(file, provider, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', UPLOAD_ENDPOINT);
    xhr.timeout = 90000;
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.setRequestHeader('X-File-Type', file.type);
    xhr.setRequestHeader('X-Provider', provider);
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onerror   = () => reject(new Error('Tidak bisa terhubung ke server. Cek koneksi internet.'));
    xhr.ontimeout = () => reject(new Error('Upload terlalu lama. Coba lagi.'));
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch (e) { /* respons bukan JSON */ }
      if (xhr.status === 413) return reject(new Error('Ukuran video terlalu besar.'));
      if (xhr.status >= 200 && xhr.status < 300 && data && data.url) return resolve(data.url);
      reject(new Error((data && data.error) || 'Upload gagal (kode ' + xhr.status + '). Coba lagi.'));
    };
    xhr.send(file);
  });
}

/* ═══════════════════════════════════════════════
   TOMBOL PROSES & HASIL
   ═══════════════════════════════════════════════ */

const GAGAL = { enhance: 'GAGAL MEMPERJELAS', kompres: 'GAGAL KOMPRES', dimensi: 'GAGAL UBAH DIMENSI', upload: 'GAGAL UPLOAD' };

$('vProcessBtn').addEventListener('click', async () => {
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

function showResult(tab, res) {
  const isLink = tab === 'upload';
  $('vResultTitle').textContent = res.title;
  const chips = res.chips.slice();
  if (res.silent) chips.push('<span class="chip chip-plain">TANPA SUARA</span>');
  $('vResultChips').innerHTML = chips.join('');

  ['vOutWrap', 'vDownloadBtn'].forEach(id => $(id).classList.toggle('hidden', isLink));
  ['vLinkBox', 'vCopyBtn', 'vOpenBtn'].forEach(id => $(id).classList.toggle('hidden', !isLink));

  if (state.outUrl) { URL.revokeObjectURL(state.outUrl); state.outUrl = null; }
  if (isLink) {
    $('vLinkText').textContent = res.link;
  } else {
    state.outUrl = URL.createObjectURL(res.blob);
    state.outName = `${res.name}.${state.ext}`;
    $('vOut').src = state.outUrl;
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
$('vEditAgainBtn').addEventListener('click', () => { $('vOut').pause(); showStage('vSettings'); });
$('vNewBtn').addEventListener('click', () => {
  $('vOut').pause();
  if (state.url) URL.revokeObjectURL(state.url);
  if (state.outUrl) URL.revokeObjectURL(state.outUrl);
  $('vPreview').removeAttribute('src');
  Object.assign(state, { file: null, url: null, outUrl: null, link: null });
  showStage('vUpload');
});

setTab('enhance');
