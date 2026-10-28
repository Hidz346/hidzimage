/**
 * HidzImage — foto-animasi.js
 * Tab ANIMASI di halaman foto: satu atau banyak foto → GIF, MP4, WebM, atau urutan gambar (ZIP).
 * FPS, resolusi, rasio, transisi, dan gerakan zoom ditentukan pengguna; hasilnya persis seperti ringkasan.
 * Memakai perkakas dari kit.js (HidzKit) dan fungsi halaman dari script.js ($, sleep, fmtSize, showAlert, TABS).
 */
(function () {
  'use strict';
  const K = window.HidzKit;
  if (!K || !document.getElementById('tabAnimasi')) return;

  const LIB_URL = 'vendor/mediabunny.min.js?v=1.62.1-b';
  const MAX_PHOTOS = 60;
  const COARSE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const MAX_VIDEO_SIDE = COARSE ? 2560 : 3840;
  const MAX_IMG_SIDE = 4096;                 // GIF / urutan gambar
  const MAX_VIDEO_SEC = 600;
  const HOLDS = [0.5, 1, 1.5, 2, 3, 5];       // detik per foto
  const RATIOS = [['first', 'FOTO 1'], ['1:1', '1:1'], ['4:5', '4:5'], ['9:16', '9:16'], ['16:9', '16:9'], ['4:3', '4:3']];
  const ZOOM = 0.12;                          // selisih skala zoom in/out sepanjang satu foto
  const TRANS_MAX = 0.5;                      // detik; transisi memakai paling lama ini (dan paling lama setengah durasi foto)
  const SAMPLE_PHOTOS = 24;                   // jumlah foto contoh untuk palet GIF
  const SLIDE_OVERSCAN = 1.3;                 // sisi terpanjang foto kerja = hasil × ini (ruang untuk zoom, tetap tajam)
  const FORMAT_LABEL = { mp4: 'MP4', webm: 'WEBM', gif: 'GIF', zip: 'GAMBAR' };
  const isVid = f => f === 'mp4' || f === 'webm';
  const fmtFps = n => String(Math.round(n * 100) / 100);
  const fmtDur = sec => {
    const s = Math.round(sec * 10) / 10;
    return s >= 60 ? Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0') : String(s).replace(/\.0$/, '') + ' dtk';
  };
  const $a = id => document.getElementById(id);

  TABS.animasi = $a('tabAnimasi');

  /* ═══════════════════════════════════════════════
     KEADAAN
     ═══════════════════════════════════════════════ */

  const A = {
    items: [],               // { file, w, h, thumb }
    format: 'mp4', hold: 2, trans: 'fade', motion: 'none', ratio: 'first', res: 720,
    fps: 30, fpsVal: 30, quality: 'seimbang', dither: 'seimbang', imgFmt: 'png', fit: 'cover',
    touched: { res: false, fps: false }, auto: { res: false, fps: false },
    busy: false, canceled: false, cancel: null, outUrl: null, outName: '',
  };

  const STAGES = ['aUpload', 'aSettings', 'aProgress', 'aResult'];
  const show = id => STAGES.forEach(s => $a(s).classList.toggle('hidden', s !== id));

  /* ═══════════════════════════════════════════════
     FOTO: TAMBAH, URUTKAN, HAPUS
     ═══════════════════════════════════════════════ */

  /** Baca satu foto: ukuran asli (orientasi EXIF sudah diterapkan) dan gambar mini untuk daftar. */
  async function probePhoto(file) {
    let src, w, h, close = () => {};
    if (typeof createImageBitmap === 'function') {
      try {
        src = await createImageBitmap(file, { imageOrientation: 'from-image' });
        w = src.width; h = src.height; close = () => src.close();
      } catch (e) { src = null; }
    }
    if (!src) {
      const url = URL.createObjectURL(file);
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        src = img; w = img.naturalWidth; h = img.naturalHeight;
      } finally { URL.revokeObjectURL(url); }
    }
    if (!w || !h) throw new Error('Ukuran foto tidak terbaca.');
    const T = 160, thumb = document.createElement('canvas');
    thumb.width = T; thumb.height = T; thumb.className = 'anim-thumb';
    const ctx = thumb.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, T, T);
    const k = Math.max(T / w, T / h);
    ctx.imageSmoothingQuality = 'medium';
    ctx.drawImage(src, (T - w * k) / 2, (T - h * k) / 2, w * k, h * k);
    close();
    return { file, w, h, thumb };
  }

  async function addFiles(list) {
    if (A.busy) return;
    let files = [...list].filter(f => f.type.startsWith('image/'));
    if (!files.length) { showAlert('Harap pilih file gambar (JPG, PNG, atau WEBP).'); return; }
    const room = MAX_PHOTOS - A.items.length;
    if (files.length > room) {
      showAlert(room > 0 ? `Maksimal ${MAX_PHOTOS} foto. ${files.length - room} foto terakhir tidak dimasukkan.` : `Sudah ${MAX_PHOTOS} foto, itu batas maksimal.`);
      files = files.slice(0, Math.max(0, room));
    }
    let bad = 0;
    for (const f of files) {
      try { A.items.push(await probePhoto(f)); } catch (e) { bad++; }
      if (A.items.length) { show('aSettings'); renderGrid(); refresh(); }
    }
    if (bad) showAlert(`${bad} file tidak bisa dibaca sebagai foto dan dilewati. Format HEIC kadang belum didukung browser; ubah ke JPG dulu.`);
    if (!A.items.length) show('aUpload');
    $a('aFileInput').value = '';
  }

  function renderGrid() {
    const grid = $a('aGrid');
    grid.textContent = '';
    A.items.forEach((it, i) => {
      const box = document.createElement('div');
      box.className = 'anim-item';
      const n = document.createElement('span');
      n.className = 'anim-n'; n.textContent = String(i + 1);
      const ctl = document.createElement('div');
      ctl.className = 'anim-ctl';
      [['◀', 'left', i === 0, 'Geser ke depan'], ['▶', 'right', i === A.items.length - 1, 'Geser ke belakang'], ['✕', 'del', false, 'Hapus foto']].forEach(([t, act, off, title]) => {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = t; b.dataset.act = act; b.dataset.i = i; b.disabled = off || A.busy;
        b.title = title; b.setAttribute('aria-label', title + ' ' + (i + 1));
        ctl.appendChild(b);
      });
      box.append(it.thumb, n, ctl);
      grid.appendChild(box);
    });
  }

  $a('aGrid').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (!b || A.busy) return;
    const i = +b.dataset.i, act = b.dataset.act;
    if (act === 'del') A.items.splice(i, 1);
    else { const j = act === 'left' ? i - 1 : i + 1; if (j >= 0 && j < A.items.length) [A.items[i], A.items[j]] = [A.items[j], A.items[i]]; }
    if (!A.items.length) { show('aUpload'); return; }
    renderGrid(); refresh();
  });

  const zone = $a('aUploadZone'), input = $a('aFileInput');
  $a('aUploadBtn').addEventListener('click', e => { e.stopPropagation(); input.click(); });
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag-over'); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
  $a('aAddBtn').addEventListener('click', () => input.click());
  input.addEventListener('change', () => { if (input.files.length) addFiles(input.files); });

  /* ═══════════════════════════════════════════════
     RENCANA — satu sumber kebenaran untuk ringkasan dan proses
     ═══════════════════════════════════════════════ */

  function ratioWH() {
    if (A.ratio === 'first') { const it = A.items[0]; return it ? [it.w, it.h] : [16, 9]; }
    return A.ratio.split(':').map(Number);
  }
  function dimsFor(short) {
    const [rw, rh] = ratioWH();
    const k = short / Math.min(rw, rh);
    return { w: K.even(rw * k), h: K.even(rh * k) };
  }
  const transLen = () => (A.trans === 'cut' || A.items.length < 2 ? 0 : Math.min(TRANS_MAX, A.hold / 2));

  function plan() {
    const n = A.items.length, fmt = A.format, vid = isVid(fmt), gif = fmt === 'gif';
    const p = { n, fmt, vid, gif, bad: [], warn: [], info: [], w: 0, h: 0, fps: 0, frames: 0, dur: 0, bytes: null, bps: 0 };
    if (!n) return p;
    const { w, h } = dimsFor(A.res);
    p.w = w; p.h = h;
    const limit = vid ? MAX_VIDEO_SIDE : MAX_IMG_SIDE;
    if (Math.max(w, h) > limit) p.bad.push(`Sisi terpanjang maksimal ${limit} px${vid ? ' di perangkat ini' : ''}. Pilih resolusi atau rasio lain.`);

    const cap = gif ? K.GIF_MAX_FPS : K.VIDEO_MAX_FPS;
    let fps = A.fps === 'custom' ? Math.round(+A.fpsVal) : A.fps;
    if (!(fps >= 1)) { p.bad.push('Isi FPS antara 1 dan ' + cap + '.'); fps = 0; }
    else if (fps > cap) p.bad.push(gif ? 'GIF mendukung maksimal 50 FPS.' : 'Maksimal 60 FPS.');
    p.fps = fps;
    p.dur = n * A.hold;
    p.frames = fps ? Math.max(1, Math.round(p.dur * fps)) : 0;

    if (vid && p.dur > MAX_VIDEO_SEC) p.bad.push('Durasi maksimal 10 menit. Kurangi jumlah foto atau durasi tiap foto.');
    if (!p.bad.length) {
      if (gif) { const g = K.gifProblem(w, h, p.frames); if (g) p.bad.push(g); }
      if (fmt === 'zip') { const z = K.framesProblem(w, h, p.frames, A.imgFmt); if (z) p.bad.push(z); }
    }
    if (vid && !(typeof VideoEncoder === 'function' && typeof VideoFrame === 'function')) {
      p.bad.push('Browser ini belum mendukung WebCodecs, jadi MP4/WebM belum bisa dibuat. Pakai GIF, atau gunakan Chrome, Edge, atau Safari terbaru.');
    }
    if (!p.bad.length) {
      const small = A.items.filter(it => (A.fit === 'cover' ? Math.max(w / it.w, h / it.h) : Math.min(w / it.w, h / it.h)) > 1.02).length;
      if (small) p.warn.push(`${small} foto lebih kecil dari resolusi hasil dan akan diperbesar (agak lebih lembut).`);
      if (A.motion !== 'none' && fps < 15) p.warn.push('Gerakan zoom terlihat patah pada FPS rendah. Pilih 24 FPS atau lebih untuk gerakan halus.');
      if (A.trans !== 'cut' && n > 1 && fps < 12) p.warn.push('Transisi hanya terdiri dari beberapa frame pada FPS rendah.');
      if (n === 1 && A.trans !== 'cut') p.info.push('Satu foto: transisi tidak dipakai.');
      if (gif && (p.frames > 400 || p.dur > 15)) p.warn.push('GIF cenderung berukuran besar. Untuk durasi panjang, MP4 jauh lebih hemat.');
      if (gif && p.fps > 33) p.info.push('Browser tertentu memutar GIF di atas 33 FPS sedikit lebih lambat; pakai MP4 bila perlu persis.');
    }
    if (vid && !p.bad.length) {
      p.bps = K.videoBitrate({ w, h, fps, quality: A.quality });
      p.bytes = Math.round(p.bps * p.dur / 8 * 1.02);         // batas atas: foto diam biasanya jauh di bawah ini
    }
    return p;
  }

  /* ═══════════════════════════════════════════════
     TAMPILAN
     ═══════════════════════════════════════════════ */

  function pickRow(el, items, onPick) {
    el.textContent = '';
    items.forEach(it => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pick-chip' + (it.active ? ' active' : '');
      b.setAttribute('aria-pressed', it.active ? 'true' : 'false');
      b.disabled = !!it.disabled;
      b.innerHTML = it.label + (it.sub ? `<small>${it.sub}</small>` : '');
      b.addEventListener('click', () => onPick(it.key));
      el.appendChild(b);
    });
  }
  const activate = (id, v) => document.querySelectorAll('#' + id + ' .scale-opt').forEach(b => b.classList.toggle('active', b.dataset.v === v));

  let probeTimer = 0, probeSeq = 0, probeFail = '';

  function paint() {
    const p = plan(), fmt = A.format, vid = isVid(fmt);
    document.querySelectorAll('#aFormat .fmt-card').forEach(b => b.classList.toggle('active', b.dataset.f === fmt));

    pickRow($a('aHold'), HOLDS.map(s => ({ key: s, label: s + ' dtk', active: A.hold === s })), v => { A.hold = v; refresh(); });
    pickRow($a('aRatio'), RATIOS.map(([k, l]) => ({ key: k, label: l, active: A.ratio === k })), v => { A.ratio = v; refresh(); });
    const limit = vid ? MAX_VIDEO_SIDE : MAX_IMG_SIDE;
    pickRow($a('aRes'), K.RES_PRESETS.map(r => {
      const d = dimsFor(r);
      return { key: r, label: r + 'p', sub: `${d.w}×${d.h}`, active: A.res === r, disabled: Math.max(d.w, d.h) > limit };
    }), v => { A.res = v; A.touched.res = true; A.auto.res = false; refresh(); });
    const cap = fmt === 'gif' ? K.GIF_MAX_FPS : K.VIDEO_MAX_FPS;
    pickRow($a('aFps'), K.FPS_PRESETS.map(f => ({ key: f, label: String(f), active: A.fps === f, disabled: f > cap }))
      .concat([{ key: 'custom', label: 'KUSTOM', active: A.fps === 'custom' }]),
      v => { A.fps = v; A.touched.fps = true; A.auto.fps = false; refresh(); });
    $a('aFpsCustom').classList.toggle('hidden', A.fps !== 'custom');

    $a('aQualityWrap').classList.toggle('hidden', !vid);
    $a('aDitherWrap').classList.toggle('hidden', fmt !== 'gif');
    $a('aImgWrap').classList.toggle('hidden', fmt !== 'zip');
    activate('aTrans', A.trans); activate('aMotion', A.motion); activate('aFit', A.fit);
    activate('aQuality', A.quality); activate('aDither', A.dither); activate('aImgFmt', A.imgFmt);

    $a('aTag').textContent = fmt === 'zip' ? A.imgFmt.toUpperCase() + ' ZIP' : FORMAT_LABEL[fmt];
    $a('aMain').textContent = p.w && p.fps ? `${p.w}×${p.h} · ${fmtFps(p.fps)} FPS` : 'lengkapi pengaturan';
    $a('aDur').textContent = p.n ? fmtDur(p.dur) : '—';
    $a('aFrames').textContent = p.frames ? p.frames + (fmt === 'zip' ? ' gambar' : '') : '—';
    $a('aSize').textContent = p.bytes ? '≤ ' + fmtSize(p.bytes) : fmt === 'gif' || fmt === 'zip' ? 'tergantung isi' : '—';

    const notes = $a('aNotes');
    notes.textContent = '';
    const add = (t, cls) => { const li = document.createElement('li'); if (cls) li.className = cls; li.textContent = t; notes.appendChild(li); };
    p.bad.forEach(t => add(t, 'bad'));
    if (!p.bad.length && probeFail) add(probeFail, 'bad');
    p.warn.forEach(t => add(t));
    p.info.forEach(t => add(t));
    if (p.n && !p.bad.length && !probeFail) add(`Hasil akan persis ${p.w}×${p.h} pada ${fmtFps(p.fps)} FPS, ${p.n} foto × ${fmtDur(A.hold)}.`, 'ok');

    $a('aCount').textContent = `${p.n} foto · urutan sesuai nomor`;
    $a('aProcessBtn').textContent = `🎞 BUAT ${fmt === 'zip' ? 'GAMBAR' : FORMAT_LABEL[fmt]} SEKARANG`;
    return p;
  }

  /** Tanya encoder perangkat apakah sanggup, supaya pesan muncul sebelum proses. */
  function scheduleProbe(p) {
    clearTimeout(probeTimer);
    const seq = ++probeSeq;
    if (!p.n || !p.vid || p.bad.length) { if (probeFail) { probeFail = ''; paint(); } return; }
    probeTimer = setTimeout(async () => {
      let msg = '';
      try {
        const MB = await K.loadMediabunny(LIB_URL);
        const codec = await pickCodec(MB, p);
        if (!codec) msg = `Perangkat ini tidak bisa meng-encode ${FORMAT_LABEL[p.fmt]} ${p.w}×${p.h} pada ${fmtFps(p.fps)} FPS. Turunkan resolusi atau FPS, atau pilih format lain.`;
      } catch (e) { /* pustaka gagal dimuat: biarkan proses yang melaporkan */ }
      if (seq !== probeSeq) return;
      if (msg !== probeFail) { probeFail = msg; paint(); }
    }, 250);
  }

  function refresh() { scheduleProbe(paint()); }

  function applyFormat(fmt) {
    const was = A.format;
    A.format = fmt;
    const toGif = fmt === 'gif', fromGif = was === 'gif' && !toGif;
    if (toGif && !A.touched.res && A.res > 480) { A.res = 480; A.auto.res = true; }
    if (fromGif && A.auto.res && !A.touched.res) { A.res = 720; A.auto.res = false; }
    if (toGif && !A.touched.fps && A.fps === 30) { A.fps = 15; A.auto.fps = true; }
    if (fromGif && A.auto.fps && !A.touched.fps) { A.fps = 30; A.auto.fps = false; }
    if (toGif && typeof A.fps === 'number' && A.fps > K.GIF_MAX_FPS) A.fps = K.GIF_MAX_FPS;
    probeFail = '';
  }

  document.querySelectorAll('#aFormat .fmt-card').forEach(b => b.addEventListener('click', () => { applyFormat(b.dataset.f); refresh(); }));
  const bind = (id, set) => document.querySelectorAll('#' + id + ' .scale-opt').forEach(b => b.addEventListener('click', () => { set(b.dataset.v); refresh(); }));
  bind('aTrans', v => { A.trans = v; });
  bind('aMotion', v => { A.motion = v; });
  bind('aFit', v => { A.fit = v; });
  bind('aQuality', v => { A.quality = v; });
  bind('aDither', v => { A.dither = v; });
  bind('aImgFmt', v => { A.imgFmt = v; });
  $a('aFpsVal').addEventListener('input', () => { A.fpsVal = $a('aFpsVal').value; probeFail = ''; refresh(); });
  document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => { if (b.dataset.tab === 'animasi') refresh(); }));

  /* ═══════════════════════════════════════════════
     PENYUSUN FRAME
     ═══════════════════════════════════════════════ */

  class Canceled extends Error { constructor() { super('Dibatalkan.'); this.canceled = true; } }

  /** Foto kerja: diperkecil sesuai kebutuhan hasil (cukup tajam untuk zoom), supaya foto 12 MP tidak menumpuk di memori. */
  async function loadSlide(item, p) {
    let src, w, h, close = () => {};
    if (typeof createImageBitmap === 'function') {
      try { src = await createImageBitmap(item.file, { imageOrientation: 'from-image' }); w = src.width; h = src.height; close = () => src.close(); }
      catch (e) { src = null; }
    }
    if (!src) {
      const url = URL.createObjectURL(item.file);
      try { const img = new Image(); img.src = url; await img.decode(); src = img; w = img.naturalWidth; h = img.naturalHeight; }
      finally { URL.revokeObjectURL(url); }
    }
    const k = Math.min(1, Math.ceil(Math.max(p.w, p.h) * SLIDE_OVERSCAN) / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    const cx = c.getContext('2d');
    cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
    cx.drawImage(src, 0, 0, c.width, c.height);
    close();
    return { canvas: c, w: item.w, h: item.h, cw: c.width, ch: c.height };
  }

  const ease = t => t * t * (3 - 2 * t);

  /** Penyusun: draw(i) menggambar frame ke-i ke R.cv. Foto dibaca bila perlu dan hanya dua yang disimpan. */
  function makeRenderer(p) {
    const cv = document.createElement('canvas');
    cv.width = p.w; cv.height = p.h;
    const ctx = cv.getContext('2d', { willReadFrequently: !p.vid });
    if (!ctx) throw new Error('Kanvas tidak tersedia. Tutup tab lain lalu coba lagi.');
    const tmp = document.createElement('canvas');
    tmp.width = p.w; tmp.height = p.h;
    const tctx = tmp.getContext('2d');
    const bg = A.fit === 'white' ? '#FFFFFF' : '#000000';
    const cover = A.fit === 'cover';
    const hold = A.hold, tr = transLen(), n = p.n;
    const cache = new Map();
    let lastKey = '';

    async function slide(k) {
      if (!cache.has(k)) cache.set(k, await loadSlide(A.items[k], p));
      return cache.get(k);
    }

    function paintSlide(c, s, prog, ox) {
      const sc0 = cover ? Math.max(p.w / s.w, p.h / s.h) : Math.min(p.w / s.w, p.h / s.h);
      const z = A.motion === 'in' ? 1 + ZOOM * prog : A.motion === 'out' ? 1 + ZOOM * (1 - prog) : 1;
      const dw = s.w * sc0 * z, dh = s.h * sc0 * z;
      c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
      c.drawImage(s.canvas, (p.w - dw) / 2 + ox, (p.h - dh) / 2, dw, dh);
    }
    const fill = c => { c.globalAlpha = 1; c.fillStyle = bg; c.fillRect(0, 0, p.w, p.h); };

    return {
      cv, ctx,
      async draw(i) {
        const t = i / p.fps;
        const k = Math.min(n - 1, Math.floor(t / hold + 1e-9));
        const local = Math.max(0, t - k * hold);
        const inTr = k < n - 1 && tr > 0 && local >= hold - tr - 1e-9;
        const prog = Math.min(1, local / hold);
        /* Foto diam tanpa transisi: frame sama persis dengan sebelumnya, tidak perlu digambar ulang. */
        const key = A.motion === 'none' && !inTr ? 'k' + k : '';
        if (key && key === lastKey) return;
        const a = await slide(k);
        const b = inTr ? await slide(k + 1) : null;
        for (const idx of [...cache.keys()]) if (idx !== k && idx !== k + 1) cache.delete(idx);
        fill(ctx);
        if (!inTr) paintSlide(ctx, a, prog, 0);
        else {
          const e = ease((local - (hold - tr)) / tr);
          if (A.trans === 'slide') {
            paintSlide(ctx, a, prog, -e * p.w);
            paintSlide(ctx, b, 0, (1 - e) * p.w);
          } else {                                            // memudar: foto berikutnya digambar utuh (dengan latar) lalu dicampur
            paintSlide(ctx, a, prog, 0);
            fill(tctx); paintSlide(tctx, b, 0, 0);
            ctx.globalAlpha = e; ctx.drawImage(tmp, 0, 0); ctx.globalAlpha = 1;
          }
        }
        lastKey = key;
      },
      dispose() { cache.clear(); },
    };
  }

  /* ═══════════════════════════════════════════════
     PROSES
     ═══════════════════════════════════════════════ */

  let etaFrom = 0;
  function setProg(frac, title, sub, emoji) {
    $a('aProgBar').style.width = Math.round(Math.min(1, Math.max(0, frac)) * 100) + '%';
    if (title) $a('aProgTitle').textContent = title;
    if (emoji) $a('aProgEmoji').textContent = emoji;
    if (sub !== undefined) {
      let eta = '';
      if (etaFrom && frac >= 0.03 && frac < 0.995) {
        const left = Math.round(((performance.now() - etaFrom) / 1000) * (1 - frac) / frac);
        if (left >= 3) eta = ' · sisa ±' + (left >= 90 ? Math.round(left / 60) + ' mnt' : left + ' dtk');
      }
      $a('aProgSub').textContent = sub ? sub + eta : '';
    }
  }
  const checkCancel = () => { if (A.canceled) throw new Canceled(); };

  async function pickCodec(MB, p) {
    const check = { width: p.w, height: p.h, quality: new MB.Quality({ bitrate: p.bps || 2e6 }), frameRate: p.fps };
    if (p.fmt === 'mp4') return MB.getFirstEncodableVideoCodec(['avc'], check);
    return MB.getFirstEncodableVideoCodec(['vp9', 'vp8'], check);
  }

  async function exportVideo(p) {
    const MB = await K.loadMediabunny(LIB_URL);
    const codec = await pickCodec(MB, p);
    if (!codec) throw new Error(`Perangkat ini tidak bisa meng-encode ${FORMAT_LABEL[p.fmt]} ${p.w}×${p.h} pada ${fmtFps(p.fps)} FPS. Turunkan resolusi atau FPS, atau pilih format lain.`);
    let lastErr = null;
    for (const hw of ['no-preference', 'prefer-software']) {
      const R = makeRenderer(p);
      const output = new MB.Output({
        format: p.fmt === 'mp4' ? new MB.Mp4OutputFormat({ fastStart: 'in-memory' }) : new MB.WebMOutputFormat(),
        target: new MB.BufferTarget(),
      });
      try {
        const source = new MB.CanvasSource(R.cv, { codec, quality: new MB.Quality({ bitrate: p.bps }), hardwareAcceleration: hw });
        output.addVideoTrack(source, { frameRate: p.fps });
        A.cancel = () => { A.canceled = true; output.cancel().catch(() => {}); };
        await output.start();
        for (let i = 0; i < p.frames; i++) {
          checkCancel();
          await R.draw(i);
          checkCancel();
          await source.add(i / p.fps, 1 / p.fps);
          if (i % 2 === 0 || i === p.frames - 1) setProg((i + 1) / p.frames * 0.97, 'MEMBUAT ' + FORMAT_LABEL[p.fmt], `frame ${i + 1} / ${p.frames}`, '🎞️');
        }
        await source.close();
        setProg(0.98, 'MENGEMAS ' + FORMAT_LABEL[p.fmt], 'menyusun berkas...', '🎞️');
        await output.finalize();
        const buf = output.target.buffer;
        if (!buf || !buf.byteLength) throw new Error('Hasil video kosong. Coba lagi.');
        return new Blob([buf], { type: p.fmt === 'mp4' ? 'video/mp4' : 'video/webm' });
      } catch (err) {
        try { await output.cancel(); } catch (e) { /* abaikan */ }
        if (A.canceled || (err && err.canceled) || (MB.ConversionCanceledError && err instanceof MB.ConversionCanceledError)) throw new Canceled();
        lastErr = err;
        console.warn(`Encoder gagal (${hw}), mencoba cara lain:`, err);
      } finally {
        R.dispose();
      }
    }
    throw new Error('Perangkat ini gagal membuat video dengan pengaturan tersebut. Coba resolusi atau FPS lebih kecil, atau format lain.' + (lastErr && lastErr.message ? ' (' + lastErr.message + ')' : ''));
  }

  async function exportGif(p) {
    const R = makeRenderer(p);
    try {
      const grab = () => R.ctx.getImageData(0, 0, p.w, p.h).data;
      setProg(0.02, 'MENYIAPKAN PALET', 'membaca warna foto...', '🎨');
      const pal = new K.GifPalette();
      const photos = p.n <= SAMPLE_PHOTOS ? [...Array(p.n).keys()] : Array.from({ length: SAMPLE_PHOTOS }, (_, i) => Math.round(i * (p.n - 1) / (SAMPLE_PHOTOS - 1)));
      for (const k of photos) {
        checkCancel();
        await R.draw(Math.min(p.frames - 1, Math.round((k + 0.4) * A.hold * p.fps)));
        pal.addFrame(grab(), p.w, p.h);
      }
      const gif = new K.GifWriter(p.w, p.h, pal.build(), { dither: A.dither, loop: 0 });
      const cs = i => Math.round(i * 100 / p.fps);               // jeda GIF 1/100 detik, dibulatkan kumulatif
      for (let i = 0; i < p.frames; i++) {
        checkCancel();
        await R.draw(i);
        gif.addFrame(grab(), Math.max(1, cs(i + 1) - cs(i)));
        if (i % 3 === 0 || i === p.frames - 1) setProg(0.06 + 0.92 * (i + 1) / p.frames, 'MEMBUAT GIF', `frame ${i + 1} / ${p.frames}`, '✨');
      }
      setProg(0.99, 'MENGEMAS GIF', 'menyusun berkas...', '✨');
      await sleep(30);
      return gif.finish();
    } finally { R.dispose(); }
  }

  async function exportImages(p) {
    const R = makeRenderer(p);
    const jpg = A.imgFmt === 'jpg', ext = jpg ? 'jpg' : 'png';
    try {
      const zip = new K.ZipWriter();
      const pad = Math.max(4, String(p.frames).length);
      let last = null;
      for (let i = 0; i < p.frames; i++) {
        checkCancel();
        await R.draw(i);
        last = await new Promise(ok => R.cv.toBlob(ok, jpg ? 'image/jpeg' : 'image/png', 0.92));
        if (!last) throw new Error('Gambar tidak bisa dibuat. Coba resolusi lebih kecil.');
        await zip.add(`frame_${String(i + 1).padStart(pad, '0')}.${ext}`, last);
        if (i % 2 === 0 || i === p.frames - 1) setProg(0.02 + 0.96 * (i + 1) / p.frames, 'MENGEKSTRAK FRAME', `${i + 1} / ${p.frames} gambar`, '🗂');
      }
      setProg(0.99, 'MENGEMAS ZIP', 'menyusun berkas...', '🗂');
      await sleep(30);
      return zip.finish();
    } finally { R.dispose(); }
  }

  function clearOut() {
    const v = $a('aOutVideo');
    v.pause(); v.removeAttribute('src'); v.load();
    $a('aOutImg').removeAttribute('src');
    if (A.outUrl) { URL.revokeObjectURL(A.outUrl); A.outUrl = null; }
  }

  $a('aProcessBtn').addEventListener('click', async () => {
    if (A.busy) return;
    const p = plan();
    if (!p.n) return;
    if (p.bad.length) { showAlert(p.bad[0], 'GAGAL MEMBUAT ANIMASI'); return; }
    A.busy = true; A.canceled = false; A.cancel = null;
    $a('aCancelBtn').disabled = false;
    etaFrom = performance.now();
    setProg(0, 'MEMBUAT ANIMASI', 'jangan tutup atau pindah tab browser', '🎞️');
    show('aProgress');
    renderGrid();
    try {
      const blob = p.fmt === 'gif' ? await exportGif(p) : p.fmt === 'zip' ? await exportImages(p) : await exportVideo(p);
      setProg(1, 'SELESAI!', '', '✅');
      await sleep(200);
      showResult(p, blob);
    } catch (err) {
      if (!(err && err.canceled)) showAlert((err && err.message) || 'Terjadi kesalahan. Coba lagi.', 'GAGAL MEMBUAT ANIMASI');
      show('aSettings');
    } finally {
      A.busy = false; A.cancel = null; etaFrom = 0;
      renderGrid();
    }
  });

  $a('aCancelBtn').addEventListener('click', () => {
    if (!A.busy) return;
    $a('aCancelBtn').disabled = true;
    A.canceled = true;
    if (A.cancel) A.cancel();
  });

  function showResult(p, blob) {
    clearOut();
    A.outUrl = URL.createObjectURL(blob);
    const ext = p.fmt === 'zip' ? 'zip' : p.fmt;
    A.outName = `hidzanimasi-${p.w}x${p.h}-${fmtFps(p.fps)}fps.${ext}`;
    const v = $a('aOutVideo'), im = $a('aOutImg');
    v.classList.toggle('hidden', !p.vid);
    im.classList.toggle('hidden', !p.gif);
    $a('aOutWrap').classList.toggle('hidden', p.fmt === 'zip');
    if (p.vid) v.src = A.outUrl;
    if (p.gif) im.src = A.outUrl;
    $a('aResultTitle').textContent = p.fmt === 'zip' ? 'GAMBAR BERHASIL DIBUAT' : 'ANIMASI BERHASIL DIBUAT';
    $a('aResultChips').innerHTML = [
      `<span class="chip chip-pink">${p.fmt === 'zip' ? A.imgFmt.toUpperCase() + ' ZIP' : FORMAT_LABEL[p.fmt]}</span>`,
      `<span class="chip chip-green">${p.w}×${p.h}</span>`,
      `<span class="chip chip-plain">${fmtFps(p.fps)} FPS</span>`,
      `<span class="chip chip-plain">${p.frames} FRAME</span>`,
      `<span class="chip chip-plain">${fmtDur(p.dur)}</span>`,
      `<span class="chip chip-plain">${fmtSize(blob.size)}</span>`,
    ].join('');
    show('aResult');
  }

  $a('aDownloadBtn').addEventListener('click', () => {
    if (!A.outUrl) return;
    const a = document.createElement('a');
    a.href = A.outUrl; a.download = A.outName; a.click();
  });
  $a('aEditAgainBtn').addEventListener('click', () => { clearOut(); show('aSettings'); });
  $a('aNewBtn').addEventListener('click', () => {
    clearOut();
    A.items = [];
    show('aUpload');
  });

  paint();
})();
