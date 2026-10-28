/**
 * HidzImage — video-ekspor.js
 * Studio Ekspor: pilih format (MP4 · WebM · GIF · urutan gambar), resolusi, dan FPS; hasilnya persis seperti ringkasan.
 * Berjalan setelah video.js dan memakai fungsi/keadaan miliknya ($, state, runners, TABS, GAGAL, renderVideo, ...),
 * serta perkakas dari kit.js (HidzKit). Juga mengisi baris FPS di tab HD dan Ubah Dimensi.
 */
(function () {
  'use strict';
  const K = window.HidzKit;
  if (!K || typeof state === 'undefined') return;

  const MAX_GIF_SIDE = 4096;        // batas sisi terpanjang GIF / urutan gambar (batas aman kanvas di HP)
  const SAMPLE_FRAMES = 24;         // jumlah frame contoh untuk menyusun palet GIF
  const fmtFps = n => String(Math.round(n * 100) / 100);

  /* Pilihan pengguna di Studio Ekspor */
  const X = {
    format: 'mp4',
    res: 'src',            // 'src' | angka sisi pendek | 'custom'
    fps: 'src',            // 'src' | angka | 'custom'
    fpsVal: 30,
    quality: 'seimbang', dither: 'seimbang', imgFmt: 'png', mute: false,
    fit: 'cover', w: '', h: '',
    touched: { res: false, fps: false },   // diubah sendiri oleh pengguna → jangan diatur otomatis
    auto: { res: false, fps: false },      // diatur otomatis oleh pindah format
    manualW: false, manualH: false,
    lastFile: null,
  };

  TABS.ekspor = { panel: 'pEkspor', label: '📤 EKSPOR SEKARANG', note: 'format, resolusi, dan FPS persis seperti ringkasan di atas · proses di browser' };
  GAGAL.ekspor = 'GAGAL MENGEKSPOR';

  /* ═══════════════════════════════════════════════
     RENCANA EKSPOR — satu sumber kebenaran untuk ringkasan dan proses
     ═══════════════════════════════════════════════ */

  const isVideoFmt = f => f === 'mp4' || f === 'webm';
  /* FPS yang terbaca dari paket video bisa meleset sedikit (mis. 29,3 untuk video 30 fps); dirapikan ke laju standar terdekat. */
  const STD_FPS = [10, 12, 15, 20, 24, 25, 30, 48, 50, 60, 90, 120];
  const NTSC_FPS = [23.976, 29.97, 59.94, 119.88];
  const srcFps = () => {
    const f = Math.max(1, state.fps || 30);
    const ntsc = NTSC_FPS.find(s => Math.abs(f - s) < 0.015);
    if (ntsc) return ntsc;
    const near = STD_FPS.find(s => Math.abs(f - s) / s < 0.035);
    return near || Math.round(f * 100) / 100;
  };
  const sideLimit = fmt => (isVideoFmt(fmt) ? MAX_SIDE_HQ : MAX_GIF_SIDE);
  const FORMAT_LABEL = { mp4: 'MP4', webm: 'WEBM', gif: 'GIF', zip: 'GAMBAR' };

  /** Dimensi hasil menurut pilihan resolusi (tanpa pembulatan genap untuk video; itu dilakukan plan()). */
  function dimsFor(res) {
    if (res === 'src') return { w: state.vw, h: state.vh };
    return K.sizeForShort(state.vw, state.vh, res);
  }

  function plan() {
    const fmt = X.format, vid = isVideoFmt(fmt), gif = fmt === 'gif';
    const bad = [], warn = [], info = [];
    const p = { fmt, vid, gif, bad, warn, info, fit: 'fill', explicit: true };
    if (!state.file) return Object.assign(p, { w: 0, h: 0, fps: 0, frames: 0, bytes: null });

    /* dimensi */
    let w, h;
    if (X.res === 'custom') {
      w = parseInt(X.w, 10) || 0; h = parseInt(X.h, 10) || 0;
      p.fit = X.fit;
      if (w < 2 || h < 2) bad.push('Isi lebar dan tinggi (minimal 2 px).');
    } else {
      ({ w, h } = dimsFor(X.res));
    }
    if (vid && w >= 2 && h >= 2 && (w % 2 || h % 2)) {
      const ew = even(w), eh = even(h);
      if (X.res === 'custom') info.push(`Ukuran dibulatkan ke genap (${ew}×${eh}) karena syarat encoder video.`);
      w = ew; h = eh;
    }
    p.w = w; p.h = h;
    const limit = sideLimit(fmt);
    if (Math.max(w, h) > limit) bad.push(`Sisi terpanjang maksimal ${limit} px${vid ? ' di perangkat ini' : ''}.`);

    /* FPS */
    const cap = gif ? K.GIF_MAX_FPS : K.VIDEO_MAX_FPS;
    let fps;
    if (X.fps === 'src') { fps = Math.min(cap, srcFps()); p.explicit = false; }
    else if (X.fps === 'custom') {
      fps = Math.round(+X.fpsVal);
      if (!(fps >= 1)) { bad.push('Isi FPS antara 1 dan ' + cap + '.'); fps = 0; }
      else if (fps > cap) bad.push(gif ? 'GIF mendukung maksimal 50 FPS.' : 'Maksimal 60 FPS.');
    } else fps = X.fps;
    p.fps = fps;
    p.frames = fps ? Math.max(1, Math.round(state.dur * fps)) : 0;

    /* kewajaran */
    if (!bad.length) {
      if (gif) { const g = K.gifProblem(w, h, p.frames); if (g) bad.push(g); }
      if (fmt === 'zip') { const z = K.framesProblem(w, h, p.frames, X.imgFmt); if (z) bad.push(z); }
    }
    if (!canUseWebCodecs()) bad.push('Browser ini belum mendukung WebCodecs, jadi Studio Ekspor belum bisa dipakai. Gunakan Chrome, Edge, atau Safari terbaru.');

    if (!bad.length) {
      if (w * h > state.vw * state.vh * 1.02) {
        warn.push(`Lebih besar dari video asli (${state.vw}×${state.vh}): ukuran diperbesar, detail tidak bertambah. Untuk hasil lebih tajam, jalankan HD ENHANCE dulu lalu LANJUT EDIT HASIL.`);
      }
      if (p.explicit && fps > srcFps() * 1.02) {
        warn.push(`FPS sumber ±${fmtFps(srcFps())}: frame diulang agar sesuai ${fps} FPS, gerakan tidak jadi lebih halus.`);
      }
      if (X.res === 'custom') {
        const dr = Math.abs(w / h - state.vw / state.vh) / (state.vw / state.vh);
        if (dr > 0.01) {
          warn.push({ cover: 'Rasio berbeda dari video asli: gambar diisi penuh dan sisi yang lebih panjang terpotong.',
                      contain: 'Rasio berbeda dari video asli: gambar dimuat utuh dengan bar hitam di sisi yang kosong.',
                      fill: 'Rasio berbeda dari video asli: gambar ditarik mengikuti ukuran, sehingga bisa terlihat melar.' }[X.fit]);
        }
      }
      if (gif) {
        if (state.hasAudio) info.push('GIF tidak membawa suara.');
        if (state.dur > 15 || p.frames > 400) warn.push('GIF cenderung berukuran besar. Untuk durasi panjang, MP4 jauh lebih hemat.');
      }
    }

    /* perkiraan ukuran */
    p.bytes = !bad.length ? K.estimateBytes({
      format: fmt, w, h, fps, quality: X.quality, srcBps: state.srcBps, srcW: state.vw, srcH: state.vh, srcFps: state.fps,
      dur: state.dur, hasAudio: state.hasAudio, mute: X.mute, audioBps: state.audioBps || 128000,
    }) : null;
    p.bps = vid && !bad.length ? K.videoBitrate({
      w, h, fps, quality: X.quality, srcBps: state.srcBps, srcW: state.vw, srcH: state.vh, srcFps: state.fps,
    }) : 0;
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
      b.className = 'pick-chip' + (it.active ? ' active' : '') + (it.up ? ' up' : '');
      b.setAttribute('aria-pressed', it.active ? 'true' : 'false');
      if (it.title) b.title = it.title;
      b.disabled = !!it.disabled;
      b.innerHTML = it.label + (it.sub ? `<small>${it.sub}</small>` : '');
      b.addEventListener('click', () => onPick(it.key));
      el.appendChild(b);
    });
  }

  function paintResolution(p) {
    const items = [];
    const limit = sideLimit(X.format);
    const srcShort = Math.min(state.vw, state.vh);
    const srcDims = state.vw ? (isVideoFmt(X.format) ? { w: even(state.vw), h: even(state.vh) } : { w: state.vw, h: state.vh }) : { w: 0, h: 0 };
    items.push({ key: 'src', label: 'ASLI', sub: state.vw ? `${srcDims.w}×${srcDims.h}` : '', active: X.res === 'src',
                 disabled: Math.max(srcDims.w, srcDims.h) > limit, title: 'Dimensi sama dengan video' });
    K.RES_PRESETS.forEach(r => {
      const d = state.vw ? K.sizeForShort(state.vw, state.vh, r) : { w: 0, h: 0 };
      items.push({
        key: r, label: r + 'p', sub: state.vw ? `${d.w}×${d.h}` : '', active: X.res === r,
        up: state.vw && r > srcShort * 1.02, disabled: state.vw && Math.max(d.w, d.h) > limit,
        title: state.vw && r > srcShort * 1.02 ? 'Lebih besar dari video asli' : '',
      });
    });
    items.push({ key: 'custom', label: 'KUSTOM', active: X.res === 'custom' });
    pickRow($('xRes'), items, key => {
      X.touched.res = true; X.auto.res = false;
      if (key === 'custom' && X.res !== 'custom') {
        const d = p.w ? { w: p.w, h: p.h } : dimsFor('src');
        X.w = d.w; X.h = d.h; X.manualW = X.manualH = false;
        $('xW').value = X.w; $('xH').value = X.h;
      }
      X.res = key;
      refresh();
    });
    $('xCustom').classList.toggle('hidden', X.res !== 'custom');
  }

  function fpsItems(current, includeCustom, cap) {
    const items = [{ key: 'src', label: 'ASLI', sub: state.file ? fmtFps(Math.min(cap, srcFps())) + ' fps' : '', active: current === 'src' }];
    K.FPS_PRESETS.forEach(f => items.push({ key: f, label: String(f), active: current === f, disabled: f > cap }));
    if (includeCustom) items.push({ key: 'custom', label: 'KUSTOM', active: current === 'custom' });
    return items;
  }

  function paintFps() {
    const cap = X.format === 'gif' ? K.GIF_MAX_FPS : K.VIDEO_MAX_FPS;
    pickRow($('xFps'), fpsItems(X.fps, true, cap), key => {
      X.touched.fps = true; X.auto.fps = false;
      X.fps = key;
      refresh();
    });
    $('xFpsCustom').classList.toggle('hidden', X.fps !== 'custom');
  }

  function activate(groupId, value) {
    document.querySelectorAll('#' + groupId + ' .scale-opt').forEach(b => b.classList.toggle('active', b.dataset.v === value));
  }

  /** Pindah format: sesuaikan pilihan yang jelas tidak cocok, tanpa menimpa yang sudah dipilih pengguna. */
  function applyFormat(fmt) {
    const was = X.format;
    X.format = fmt;
    const toGif = fmt === 'gif', fromGif = was === 'gif' && !toGif;
    if (state.vw) {
      if (toGif && !X.touched.res && X.res === 'src' && Math.min(state.vw, state.vh) > 540) { X.res = 480; X.auto.res = true; }
      if (fromGif && X.auto.res && !X.touched.res) { X.res = 'src'; X.auto.res = false; }
    }
    if (toGif && !X.touched.fps && X.fps === 'src' && srcFps() > 25) { X.fps = 15; X.auto.fps = true; }
    if (fromGif && X.auto.fps && !X.touched.fps) { X.fps = 'src'; X.auto.fps = false; }
    if (toGif && typeof X.fps === 'number' && X.fps > K.GIF_MAX_FPS) X.fps = K.GIF_MAX_FPS;
  }

  let probeTimer = 0, probeSeq = 0, probeFail = '';

  function paint() {
    const p = plan();
    const fmt = X.format, vid = isVideoFmt(fmt);

    document.querySelectorAll('#xFormat .fmt-card').forEach(b => b.classList.toggle('active', b.dataset.f === fmt));
    paintResolution(p);
    paintFps();
    $('xQualityWrap').classList.toggle('hidden', !vid);
    $('xDitherWrap').classList.toggle('hidden', fmt !== 'gif');
    $('xImgWrap').classList.toggle('hidden', fmt !== 'zip');
    $('xAudioWrap').classList.toggle('hidden', !vid || !state.hasAudio);
    activate('xQuality', X.quality); activate('xDither', X.dither); activate('xAudio', X.mute ? 'off' : 'on');
    activate('xImgFmt', X.imgFmt); activate('xFit', X.fit);

    /* tiket ringkasan */
    $('xTag').textContent = fmt === 'zip' ? X.imgFmt.toUpperCase() + ' ZIP' : FORMAT_LABEL[fmt];
    if (!state.file) {
      ['xMain', 'xDur', 'xFrames', 'xSize'].forEach(id => { $(id).textContent = '—'; });
      $('xMain').textContent = 'pilih video dulu';
    } else {
      $('xMain').textContent = p.w && p.h && p.fps
        ? `${p.w}×${p.h} · ${fmtFps(p.fps)} FPS`
        : 'lengkapi pengaturan';
      $('xDur').textContent = fmtTime(state.dur);
      $('xFrames').textContent = p.frames ? (vid ? '≈ ' : '') + p.frames + (fmt === 'zip' ? ' gambar' : '') : '—';
      $('xSize').textContent = p.bytes ? '≈ ' + fmtSize(p.bytes) : fmt === 'gif' || fmt === 'zip' ? 'tergantung isi' : '—';
    }
    const notes = $('xNotes');
    notes.textContent = '';
    const add = (text, cls) => { const li = document.createElement('li'); if (cls) li.className = cls; li.textContent = text; notes.appendChild(li); };
    p.bad.forEach(t => add(t, 'bad'));
    if (!p.bad.length && probeFail) add(probeFail, 'bad');
    p.warn.forEach(t => add(t));
    p.info.forEach(t => add(t));
    if (state.file && !p.bad.length && !probeFail) {
      add(p.explicit || X.res !== 'src'
        ? `Hasil akan persis ${p.w}×${p.h} pada ${fmtFps(p.fps)} FPS.`
        : `Dimensi dan FPS mengikuti video asli${p.fps ? ` (${fmtFps(p.fps)} FPS)` : ''}.`, 'ok');
    }
    $('xHint').classList.toggle('hidden', !!state.file);

    if (state.tab === 'ekspor') {
      const label = fmt === 'zip' ? 'GAMBAR' : FORMAT_LABEL[fmt];
      $('vProcessBtn').textContent = `📤 EKSPOR ${label} SEKARANG`;
    }
    return p;
  }

  /** Tanya encoder perangkat apakah sanggup (MP4/WebM pada ukuran + FPS ini), supaya pesan muncul sebelum proses. */
  function scheduleProbe(p) {
    clearTimeout(probeTimer);
    const seq = ++probeSeq;
    if (!state.file || !p.vid || p.bad.length || !canUseWebCodecs()) { if (probeFail) { probeFail = ''; } return; }
    probeTimer = setTimeout(async () => {
      let msg = '';
      try {
        const MB = await loadLib();
        const pick = await pickOutput(MB, p.w, p.h, p.bps, p.fps, p.fmt);
        if (!pick) msg = `Perangkat ini tidak bisa meng-encode ${FORMAT_LABEL[p.fmt]} ${p.w}×${p.h} pada ${fmtFps(p.fps)} FPS. Turunkan resolusi atau FPS, atau pilih format lain.`;
      } catch (e) { /* pustaka gagal dimuat: biarkan proses yang melaporkan */ }
      if (seq !== probeSeq) return;
      if (msg !== probeFail) { probeFail = msg; paint(); }
    }, 250);
  }

  function refresh() {
    const p = paint();
    scheduleProbe(p);
  }

  /* ═══════════════════════════════════════════════
     KONTROL
     ═══════════════════════════════════════════════ */

  document.querySelectorAll('#xFormat .fmt-card').forEach(b => b.addEventListener('click', () => { applyFormat(b.dataset.f); probeFail = ''; refresh(); }));

  const bindGroup = (id, set) => document.querySelectorAll('#' + id + ' .scale-opt').forEach(b =>
    b.addEventListener('click', () => { set(b.dataset.v); refresh(); }));
  bindGroup('xQuality', v => { X.quality = v; });
  bindGroup('xDither', v => { X.dither = v; });
  bindGroup('xAudio', v => { X.mute = v === 'off'; });
  bindGroup('xImgFmt', v => { X.imgFmt = v; });
  bindGroup('xFit', v => { X.fit = v; });

  $('xW').addEventListener('input', () => {
    X.w = $('xW').value; X.manualW = true;
    const w = parseInt(X.w, 10) || 0;
    if (!X.manualH && w > 0 && state.vw) { X.h = Math.max(2, Math.round(w * state.vh / state.vw)); $('xH').value = X.h; }
    probeFail = ''; refresh();
  });
  $('xH').addEventListener('input', () => {
    X.h = $('xH').value; X.manualH = true;
    const h = parseInt(X.h, 10) || 0;
    if (!X.manualW && h > 0 && state.vw) { X.w = Math.max(2, Math.round(h * state.vw / state.vh)); $('xW').value = X.w; }
    probeFail = ''; refresh();
  });
  $('xFpsVal').addEventListener('input', () => { X.fpsVal = $('xFpsVal').value; probeFail = ''; refresh(); });

  /* Baris FPS di tab HD Enhance & Ubah Dimensi (0 = ikut sumber) */
  function paintFpsRows() {
    document.querySelectorAll('[data-fps-row]').forEach(row => {
      const key = row.dataset.fpsRow, cur = state.outFps[key] || 0;
      const items = [{ key: 0, label: 'ASLI', sub: state.file ? fmtFps(Math.min(MAX_FPS, srcFps())) + ' fps' : '', active: !cur }];
      K.FPS_PRESETS.forEach(f => items.push({ key: f, label: String(f), active: cur === f }));
      pickRow(row, items, v => { state.outFps[key] = v; paintFpsRows(); });
    });
  }

  document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => { if (b.dataset.tab === 'ekspor') refresh(); }));
  document.addEventListener('hidz:source', () => {
    if (X.lastFile !== state.file) {
      X.lastFile = state.file;
      X.manualW = X.manualH = false;
      X.touched.res = X.touched.fps = false;
      X.auto.res = X.auto.fps = false;
      if (X.res === 'custom') { X.w = state.vw; X.h = state.vh; $('xW').value = X.w; $('xH').value = X.h; }
      if (X.format === 'gif') applyFormat('gif');
      probeFail = '';
    }
    paintFpsRows();
    refresh();
  });

  /* ═══════════════════════════════════════════════
     PROSES
     ═══════════════════════════════════════════════ */

  /** Buka video sebagai sumber frame berukuran persis w×h (rotasi di metadata sudah diterapkan). */
  async function openFrames(MB, p) {
    const input = new MB.Input({ source: new MB.BlobSource(state.file), formats: libFormats(MB) });
    try {
      const vt = await input.getPrimaryVideoTrack();
      if (!vt) throw new Error('Video ini tidak punya jalur gambar yang bisa dibaca.');
      if (!(await vt.canDecode())) throw new Error('Browser ini tidak bisa membaca kodek video ini. Coba video MP4 (H.264).');
      const first = await vt.getFirstTimestamp();
      const sink = new MB.CanvasSink(vt, { width: p.w, height: p.h, fit: p.fit, poolSize: 2 });
      return { input, sink, first };
    } catch (e) { try { input.dispose(); } catch (x) { /* abaikan */ } throw e; }
  }

  /** Waktu tiap frame pada grid FPS yang rata: frame ke-i diambil dari detik i / fps. */
  function frameTimes(p, first) {
    const last = Math.max(first, state.dur - 0.0005);
    return Array.from({ length: p.frames }, (_, i) => Math.max(first, Math.min(i / p.fps, last)));
  }

  const pickEvenly = (n, k) => {
    if (n <= k) return Array.from({ length: n }, (_, i) => i);
    return Array.from({ length: k }, (_, i) => Math.round(i * (n - 1) / (k - 1)));
  };

  function makeWorkCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Kanvas tidak tersedia. Tutup tab lain lalu coba lagi.');
    return { c, ctx };
  }

  async function exportVideo(p) {
    const label = FORMAT_LABEL[p.fmt];
    const { blob, silent } = await renderVideo({
      w: p.w, h: p.h, outFps: p.fps, bps: p.bps, container: p.fmt,
      mute: X.mute, fit: p.fit, kind: 'same', exact: true,
    }, f => setProgress(f, 'MENGEKSPOR ' + label, `${fmtTime(f * state.dur)} / ${fmtTime(state.dur)}`, '📤'));
    const m = state.meta && state.meta.w ? state.meta : { w: p.w, h: p.h };
    return {
      blob, silent: silent && !X.mute, title: 'VIDEO BERHASIL DIEKSPOR', name: `hidzvideo-${m.w}x${m.h}-${fmtFps(p.fps)}fps`,
      chips: [`<span class="chip chip-pink">${label}</span>`,
              `<span class="chip chip-green">${m.w}×${m.h}</span>`,
              `<span class="chip chip-plain">${fmtSize(blob.size)}</span>`,
              X.mute && state.hasAudio ? '<span class="chip chip-plain">BISU</span>' : ''],
    };
  }

  async function exportGif(p) {
    const MB = await loadLib();
    const src = await openFrames(MB, p);
    let canceled = false;
    state.cancel = () => { canceled = true; };
    etaFrom = performance.now();
    try {
      const times = frameTimes(p, src.first);
      const { ctx } = makeWorkCanvas(p.w, p.h);
      const grab = canvas => { ctx.drawImage(canvas, 0, 0, p.w, p.h); return ctx.getImageData(0, 0, p.w, p.h).data; };

      /* Lintasan 1: palet warna dari beberapa frame contoh */
      setProgress(0.02, 'MENYIAPKAN PALET', 'membaca warna video...', '🎨');
      const pal = new K.GifPalette();
      const picks = pickEvenly(times.length, SAMPLE_FRAMES).map(i => times[i]);
      for await (const wc of src.sink.canvasesAtTimestamps(picks)) {
        if (canceled) throw new CanceledError();
        if (wc) pal.addFrame(grab(wc.canvas), p.w, p.h);
      }
      const gif = new K.GifWriter(p.w, p.h, pal.build(), { dither: X.dither, loop: 0 });

      /* Lintasan 2: semua frame. Jeda GIF dalam 1/100 detik, dibulatkan kumulatif agar total durasi tetap akurat. */
      const cs = i => Math.round(i * 100 / p.fps);
      let i = 0, last = null, carry = 0;
      for await (const wc of src.sink.canvasesAtTimestamps(times)) {
        if (canceled) throw new CanceledError();
        if (wc) last = grab(wc.canvas);
        const delay = cs(i + 1) - cs(i) + carry;
        if (last) { gif.addFrame(last, Math.max(1, delay)); carry = 0; } else carry = delay;
        i++;
        if (i % 3 === 0 || i === times.length) setProgress(0.06 + 0.92 * i / times.length, 'MEMBUAT GIF', `${i} / ${times.length} frame`, '✨');
      }
      if (!gif.frames) throw new Error('Tidak ada frame yang bisa dibaca dari video ini.');
      setProgress(0.99, 'MENGEMAS GIF', 'menyusun berkas...', '✨');
      await sleep(30);
      const blob = gif.finish();
      return {
        blob, kind: 'image', ext: 'gif', title: 'GIF BERHASIL DIBUAT', name: `hidzvideo-${p.w}x${p.h}-${fmtFps(p.fps)}fps`,
        chips: ['<span class="chip chip-pink">GIF</span>',
                `<span class="chip chip-green">${p.w}×${p.h}</span>`,
                `<span class="chip chip-plain">${fmtFps(p.fps)} FPS</span>`,
                `<span class="chip chip-plain">${times.length} FRAME</span>`,
                `<span class="chip chip-plain">${fmtSize(blob.size)}</span>`],
      };
    } finally {
      etaFrom = 0;
      try { src.input.dispose(); } catch (e) { /* abaikan */ }
    }
  }

  async function exportImages(p) {
    const MB = await loadLib();
    const src = await openFrames(MB, p);
    let canceled = false;
    state.cancel = () => { canceled = true; };
    etaFrom = performance.now();
    const jpg = X.imgFmt === 'jpg', ext = jpg ? 'jpg' : 'png';
    try {
      const times = frameTimes(p, src.first);
      const { c, ctx } = makeWorkCanvas(p.w, p.h);
      const pad = Math.max(4, String(times.length).length);
      const zip = new K.ZipWriter();
      let i = 0, last = null;
      for await (const wc of src.sink.canvasesAtTimestamps(times)) {
        if (canceled) throw new CanceledError();
        if (wc) {
          ctx.drawImage(wc.canvas, 0, 0, p.w, p.h);
          last = await new Promise(ok => c.toBlob(ok, jpg ? 'image/jpeg' : 'image/png', 0.92));
          if (!last) throw new Error('Gambar tidak bisa dibuat. Coba resolusi lebih kecil.');
        }
        i++;
        if (last) await zip.add(`frame_${String(i).padStart(pad, '0')}.${ext}`, last);
        if (i % 2 === 0 || i === times.length) setProgress(0.02 + 0.96 * i / times.length, 'MENGEKSTRAK FRAME', `${i} / ${times.length} gambar`, '🗂');
      }
      if (!zip.entries.length) throw new Error('Tidak ada frame yang bisa dibaca dari video ini.');
      setProgress(0.99, 'MENGEMAS ZIP', 'menyusun berkas...', '🗂');
      await sleep(30);
      const blob = zip.finish();
      return {
        blob, kind: 'file', ext: 'zip', title: 'GAMBAR BERHASIL DIEKSTRAK', name: `hidzvideo-frames-${p.w}x${p.h}-${fmtFps(p.fps)}fps`,
        chips: [`<span class="chip chip-pink">${ext.toUpperCase()} ZIP</span>`,
                `<span class="chip chip-green">${zip.entries.length} GAMBAR</span>`,
                `<span class="chip chip-plain">${p.w}×${p.h}</span>`,
                `<span class="chip chip-plain">${fmtFps(p.fps)} FPS</span>`,
                `<span class="chip chip-plain">${fmtSize(blob.size)}</span>`],
      };
    } finally {
      etaFrom = 0;
      try { src.input.dispose(); } catch (e) { /* abaikan */ }
    }
  }

  runners.ekspor = async function () {
    const p = plan();
    if (p.bad.length) throw new Error(p.bad[0]);
    if (p.fmt === 'gif') return exportGif(p);
    if (p.fmt === 'zip') return exportImages(p);
    return exportVideo(p);
  };

  paintFpsRows();
  refresh();
})();
