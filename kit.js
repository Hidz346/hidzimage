/**
 * HidzImage — kit.js
 * Perkakas bersama untuk Studio Ekspor (dipakai video.html dan index.html).
 *  - preset resolusi & FPS, hitungan dimensi, bitrate, dan perkiraan ukuran
 *  - GifWriter : encoder GIF89a (palet global median-cut, dither terurut, hanya piksel yang berubah)
 *  - ZipWriter : ZIP tanpa kompresi untuk urutan gambar (PNG/JPG sudah terkompresi)
 *  - loadMediabunny() : memuat pustaka video lokal (vendor/mediabunny.min.js) saat dibutuhkan
 * Tidak menyentuh DOM selain loadMediabunny, sehingga bagian lainnya bisa diuji di Node.
 */
(function (root) {
  'use strict';

  /* ═══════════════════════════════════════════════
     PRESET & HITUNGAN
     ═══════════════════════════════════════════════ */

  /** Resolusi dinamai menurut sisi pendek (video tegak 720p = 720 × 1280), seperti kebiasaan di aplikasi video. */
  const RES_PRESETS = [1080, 720, 540, 480, 360, 270, 180];
  const FPS_PRESETS = [60, 50, 30, 25, 24, 15, 12, 10];
  const GIF_MAX_FPS = 50;                       // GIF menyimpan jeda dalam 1/100 detik; di bawah 2 centidetik browser memperlambatnya
  const VIDEO_MAX_FPS = 60;
  const QUALITY = {                              // bit per piksel per frame (H.264 pada 30 fps)
    hemat:    { bpp: 0.045, floor: 0 },
    seimbang: { bpp: 0.075, floor: 0.9 },
    tinggi:   { bpp: 0.11,  floor: 1.25 },
    maksimal: { bpp: 0.17,  floor: 1.8 },
  };

  const even = n => Math.max(2, 2 * Math.round(n / 2));

  /** Dimensi hasil bila sisi pendek dijadikan `short` px; rasio terjaga dan kedua sisi genap (syarat encoder H.264). */
  function sizeForShort(srcW, srcH, short) {
    const k = short / Math.min(srcW, srcH);
    return { w: even(srcW * k), h: even(srcH * k) };
  }

  /**
   * Bitrate video (bit/detik). Bitrate patokan naik sedikit pada FPS tinggi (bukan linear: antar-frame lebih efisien),
   * dan untuk kualitas tinggi tidak pernah di bawah bitrate sumber (dikecilkan sebanding bila dimensi/FPS dikurangi).
   */
  function videoBitrate(o) {
    const q = QUALITY[o.quality] || QUALITY.seimbang;
    let bps = o.w * o.h * 30 * Math.pow(Math.max(1, o.fps) / 30, 0.8) * q.bpp;
    if (o.srcBps && o.srcW && o.srcH) {
      const pix = Math.min(1, (o.w * o.h) / (o.srcW * o.srcH));
      const rate = o.srcFps ? Math.min(1, o.fps / o.srcFps) : 1;
      bps = Math.max(bps, q.floor * o.srcBps * pix * rate);
    }
    return Math.round(Math.min(45e6, Math.max(250e3, bps)));
  }

  /** Perkiraan ukuran file (byte) untuk MP4/WebM; null untuk format yang ukurannya bergantung isi (GIF, gambar). */
  function estimateBytes(o) {
    if (o.format !== 'mp4' && o.format !== 'webm') return null;
    const audio = o.hasAudio && !o.mute ? (o.audioBps || 128000) : 0;
    return Math.round((videoBitrate(o) + audio) * o.dur / 8 * 1.02);
  }

  /** Pemeriksaan kewajaran sebelum GIF dibuat. Mengembalikan pesan eror, atau null bila aman. */
  function gifProblem(w, h, frames) {
    if (frames > 3000) return 'GIF terlalu panjang (lebih dari 3000 frame). Pendekkan durasi atau turunkan FPS.';
    if (w * h * frames > 1.2e9) return 'GIF sebesar ini terlalu berat untuk browser. Kecilkan resolusi, turunkan FPS, atau pendekkan durasi.';
    return null;
  }
  /** Pemeriksaan kewajaran untuk urutan gambar dalam ZIP (ZIP biasa dibatasi 4 GB). */
  function framesProblem(w, h, frames, fmt) {
    if (frames > 9999) return 'Terlalu banyak frame (lebih dari 9999). Turunkan FPS atau pendekkan durasi.';
    const bytes = frames * w * h * (fmt === 'jpg' ? 0.3 : 1.7);
    if (bytes > 1.5e9) return 'Hasilnya diperkirakan lebih dari 1,5 GB. Kecilkan resolusi, turunkan FPS, atau pakai JPG.';
    return null;
  }

  /* ═══════════════════════════════════════════════
     PUSTAKA VIDEO
     ═══════════════════════════════════════════════ */

  let libPromise = null;
  function loadMediabunny(url) {
    if (root.Mediabunny) return Promise.resolve(root.Mediabunny);
    if (!libPromise) {
      libPromise = new Promise((ok, fail) => {
        const s = document.createElement('script');
        s.src = url;
        s.onload = () => (root.Mediabunny ? ok(root.Mediabunny) : fail(new Error('Pustaka video tidak lengkap.')));
        s.onerror = () => { libPromise = null; s.remove(); fail(new Error('Pustaka video gagal dimuat.')); };
        document.head.appendChild(s);
      });
    }
    return libPromise;
  }

  /* ═══════════════════════════════════════════════
     GIF
     ═══════════════════════════════════════════════ */

  /* Matriks Bayer 8×8: dither terurut stabil antar-frame, jadi tidak berkedip dan frame selisihnya kecil. */
  const BAYER = [
     0, 32,  8, 40,  2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26,
    12, 44,  4, 36, 14, 46,  6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
     3, 35, 11, 43,  1, 33,  9, 41, 51, 19, 59, 27, 49, 17, 57, 25,
    15, 47,  7, 39, 13, 45,  5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
  ];
  const DITHER = { tanpa: 0, seimbang: 7, halus: 12 };
  const TRANSPARENT = 255;                       // indeks palet yang dicadangkan untuk "piksel tidak berubah"

  /**
   * Palet 255 warna dari beberapa frame contoh. Histogram RGB555 lalu median-cut:
   * kotak dengan populasi/rentang terbesar dibelah di median berbobot sepanjang sumbu terpanjang.
   */
  class GifPalette {
    constructor() { this.hist = new Uint32Array(32768); }

    /** Tambahkan frame contoh (RGBA) ke histogram. Tidak semua piksel dibaca, cukup ±40 ribu per frame. */
    addFrame(rgba, w, h) {
      const n = w * h, step = Math.max(1, Math.floor(n / 40000)) | 1, hist = this.hist;
      for (let p = 0; p < n; p += step) {
        const i = p * 4;
        hist[((rgba[i] >> 3) << 10) | ((rgba[i + 1] >> 3) << 5) | (rgba[i + 2] >> 3)]++;
      }
    }

    /** @returns {{palette:Uint8Array, lut:Uint8Array}} palet 256 entri (768 byte) dan tabel RGB555 → indeks palet */
    build() {
      const hist = this.hist, list = [];
      for (let i = 0; i < 32768; i++) if (hist[i]) list.push(i);
      const bins = Int32Array.from(list.length ? list : [0]);
      if (!list.length) hist[0] = 1;
      const W = [1, 1.15, 0.85];                                   // bobot kepekaan mata: R, G, B
      const chan = (bin, c) => c === 0 ? (bin >> 10) & 31 : c === 1 ? (bin >> 5) & 31 : bin & 31;

      const makeBox = (s, e) => {
        let count = 0; const lo = [31, 31, 31], hi = [0, 0, 0];
        for (let k = s; k < e; k++) {
          const b = bins[k]; count += hist[b];
          for (let c = 0; c < 3; c++) { const v = chan(b, c); if (v < lo[c]) lo[c] = v; if (v > hi[c]) hi[c] = v; }
        }
        let axis = 0, ext = -1;
        for (let c = 0; c < 3; c++) { const x = (hi[c] - lo[c]) * W[c]; if (x > ext) { ext = x; axis = c; } }
        return { s, e, count, axis, score: ext * Math.sqrt(count) };
      };

      const boxes = [makeBox(0, bins.length)];
      while (boxes.length < TRANSPARENT) {
        let pick = -1, best = 0;
        for (let k = 0; k < boxes.length; k++) {
          const b = boxes[k];
          if (b.e - b.s > 1 && b.score > best) { best = b.score; pick = k; }
        }
        if (pick < 0) break;
        const b = boxes[pick], ax = b.axis;
        bins.subarray(b.s, b.e).sort((x, y) => chan(x, ax) - chan(y, ax));
        let acc = 0, cut = b.s + 1;
        for (let k = b.s; k < b.e - 1; k++) {
          acc += hist[bins[k]];
          cut = k + 1;
          if (acc * 2 >= b.count) break;
        }
        boxes.splice(pick, 1, makeBox(b.s, cut), makeBox(cut, b.e));
      }

      const palette = new Uint8Array(768), n = boxes.length;
      boxes.forEach((b, k) => {
        let r = 0, g = 0, bl = 0, tot = 0;
        for (let j = b.s; j < b.e; j++) {
          const bin = bins[j], c = hist[bin];
          r += ((bin >> 10) & 31) * c; g += ((bin >> 5) & 31) * c; bl += (bin & 31) * c; tot += c;
        }
        palette[k * 3] = Math.round(r / tot * 255 / 31);
        palette[k * 3 + 1] = Math.round(g / tot * 255 / 31);
        palette[k * 3 + 2] = Math.round(bl / tot * 255 / 31);
      });

      /* Indeks palet terdekat untuk setiap warna RGB555 (juga yang tidak ada di contoh, karena dither menggeser warna). */
      const lut = new Uint8Array(32768);
      for (let i = 0; i < 32768; i++) {
        const r = ((i >> 10) & 31) * 255 / 31, g = ((i >> 5) & 31) * 255 / 31, b = (i & 31) * 255 / 31;
        let bestK = 0, bestD = Infinity;
        for (let k = 0; k < n; k++) {
          const dr = r - palette[k * 3], dg = g - palette[k * 3 + 1], db = b - palette[k * 3 + 2];
          const d = dr * dr * W[0] + dg * dg * W[1] + db * db * W[2];
          if (d < bestD) { bestD = d; bestK = k; }
        }
        lut[i] = bestK;
      }
      return { palette, lut };
    }
  }

  /** Kompresi LZW khas GIF (kode 9–12 bit, tabel di-reset saat penuh). Hasil: kode ukuran minimum + sub-blok + penutup. */
  const lzwTable = new Int32Array(1 << 20);       // kunci (kode<<8 | byte) → (generasi<<12 | kode)
  let lzwGen = 0;
  function lzwEncode(pixels, count) {
    const minCode = 8, clear = 1 << minCode, eoi = clear + 1;
    let out = new Uint8Array(Math.max(1024, count >> 1)), p = 0;
    const need = extra => {
      if (p + extra <= out.length) return;
      const bigger = new Uint8Array(Math.max(out.length * 2, p + extra));
      bigger.set(out.subarray(0, p));
      out = bigger;
    };

    if (++lzwGen >= (1 << 19)) { lzwTable.fill(0); lzwGen = 1; }
    let gen = lzwGen << 12;
    let nextCode = eoi + 1, codeSize = minCode + 1, cur = 0, curBits = 0;

    out[p++] = minCode;
    let blockAt = p++;                                            // posisi byte panjang sub-blok berjalan
    const flushBytes = final => {
      while (curBits >= 8 || (final && curBits > 0)) {
        need(300);
        out[p++] = cur & 255; cur >>>= 8; curBits = Math.max(0, curBits - 8);
        if (p === blockAt + 256) { out[blockAt] = 255; blockAt = p++; }
      }
    };
    const emit = code => { cur |= code << curBits; curBits += codeSize; flushBytes(false); };

    emit(clear);
    let prefix = pixels[0];
    for (let i = 1; i < count; i++) {
      const k = pixels[i], key = (prefix << 8) | k, v = lzwTable[key];
      if ((v & ~4095) === gen && v !== 0) { prefix = v & 4095; continue; }
      emit(prefix);
      if (nextCode === 4096) {
        emit(clear);
        nextCode = eoi + 1; codeSize = minCode + 1;
        if (++lzwGen >= (1 << 19)) { lzwTable.fill(0); lzwGen = 1; }
        gen = lzwGen << 12;
      } else {
        if (nextCode >= (1 << codeSize)) codeSize++;
        lzwTable[key] = gen | nextCode++;
      }
      prefix = k;
    }
    emit(prefix);
    emit(eoi);
    flushBytes(true);
    need(4);
    if (blockAt + 1 === p) { out[blockAt] = 0; }                 // sub-blok sudah dibuka tapi kosong → jadi penutup
    else { out[blockAt] = p - blockAt - 1; out[p++] = 0; }
    return out.subarray(0, p);
  }

  /**
   * Penulis GIF animasi. Frame pertama ditulis penuh; frame berikutnya hanya persegi panjang yang berubah,
   * dan piksel yang sama persis dengan frame sebelumnya dijadikan transparan agar LZW memadatkannya.
   * Frame yang identik dengan sebelumnya tidak ditulis; jedanya ditambahkan ke frame sebelumnya.
   */
  class GifWriter {
    /**
     * @param {number} w lebar  @param {number} h tinggi
     * @param {{palette:Uint8Array, lut:Uint8Array}} pal hasil GifPalette.build()
     * @param {{dither?:'tanpa'|'seimbang'|'halus', loop?:number}} [opt] loop 0 = tanpa henti
     */
    constructor(w, h, pal, opt = {}) {
      if (w < 1 || h < 1 || w > 65535 || h > 65535) throw new RangeError('Ukuran GIF tidak valid.');
      this.w = w; this.h = h; this.lut = pal.lut;
      const amp = DITHER[opt.dither] != null ? DITHER[opt.dither] : DITHER.seimbang;
      this.offsets = new Int16Array(64).map((_, i) => amp ? Math.round(((BAYER[i] + 0.5) / 64 - 0.5) * 2 * amp) : 0);
      this.cur = new Uint8Array(w * h);
      this.prev = null;
      this.pending = null;
      this.frames = 0;

      const head = new Uint8Array(13 + 768 + 19);
      let p = 0;
      for (const ch of 'GIF89a') head[p++] = ch.charCodeAt(0);
      head[p++] = w & 255; head[p++] = w >> 8; head[p++] = h & 255; head[p++] = h >> 8;
      head[p++] = 0xF7; head[p++] = 0; head[p++] = 0;                // palet global 256 warna, latar = indeks 0
      head.set(pal.palette, p); p += 768;
      head.set([0x21, 0xFF, 0x0B, ...'NETSCAPE2.0'.split('').map(c => c.charCodeAt(0)), 3, 1,
        (opt.loop || 0) & 255, ((opt.loop || 0) >> 8) & 255, 0], p);
      this.parts = [head];
    }

    /** Petakan RGBA (w×h, opak) ke indeks palet dengan dither terurut. */
    _quantize(rgba) {
      const { w, h, lut, offsets, cur } = this;
      let i = 0, o = 0;
      for (let y = 0; y < h; y++) {
        const row = (y & 7) << 3;
        for (let x = 0; x < w; x++, i += 4) {
          const t = offsets[row | (x & 7)];
          let r = rgba[i] + t, g = rgba[i + 1] + t, b = rgba[i + 2] + t;
          r = r < 0 ? 0 : r > 255 ? 255 : r; g = g < 0 ? 0 : g > 255 ? 255 : g; b = b < 0 ? 0 : b > 255 ? 255 : b;
          cur[o++] = lut[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)];
        }
      }
    }

    _writePending() {
      const f = this.pending;
      if (!f) return;
      const delay = Math.min(65535, Math.max(1, f.delay));
      const gce = new Uint8Array([0x21, 0xF9, 4, 0x05, delay & 255, delay >> 8, TRANSPARENT, 0]);
      const desc = new Uint8Array([0x2C, f.x & 255, f.x >> 8, f.y & 255, f.y >> 8, f.w & 255, f.w >> 8, f.h & 255, f.h >> 8, 0]);
      this.parts.push(gce, desc, f.data);
      this.pending = null;
    }

    /** @param {Uint8ClampedArray} rgba piksel frame @param {number} delayCs lama tampil (1/100 detik) */
    addFrame(rgba, delayCs) {
      const { w, h, cur, prev } = this;
      this._quantize(rgba);
      let x0 = 0, y0 = 0, x1 = w - 1, y1 = h - 1;
      if (prev) {
        x0 = w; y0 = h; x1 = -1; y1 = -1;
        for (let y = 0; y < h; y++) {
          const row = y * w;
          for (let x = 0; x < w; x++) {
            if (cur[row + x] !== prev[row + x]) {
              if (x < x0) x0 = x;
              if (x > x1) x1 = x;
              if (y < y0) y0 = y;
              y1 = y;
            }
          }
        }
        if (x1 < 0) {                                              // identik: perpanjang frame sebelumnya
          this.pending.delay += delayCs;
          return;
        }
      }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1, sub = new Uint8Array(bw * bh);
      for (let y = 0; y < bh; y++) {
        const src = (y0 + y) * w + x0, dst = y * bw;
        if (prev) for (let x = 0; x < bw; x++) sub[dst + x] = cur[src + x] === prev[src + x] ? TRANSPARENT : cur[src + x];
        else sub.set(cur.subarray(src, src + bw), dst);
      }
      this._writePending();
      this.pending = { x: x0, y: y0, w: bw, h: bh, delay: delayCs, data: lzwEncode(sub, sub.length).slice() };
      if (!this.prev) this.prev = new Uint8Array(w * h);
      this.prev.set(cur);
      this.frames++;
    }

    finish() {
      this._writePending();
      this.parts.push(new Uint8Array([0x3B]));
      return new Blob(this.parts, { type: 'image/gif' });
    }
  }

  /* ═══════════════════════════════════════════════
     ZIP (tanpa kompresi)
     ═══════════════════════════════════════════════ */

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  class ZipWriter {
    constructor() {
      this.parts = []; this.entries = []; this.offset = 0;
      const d = new Date();
      this.time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
      this.date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    }

    /** @param {string} name nama berkas di dalam ZIP  @param {Blob} blob isinya */
    async add(name, blob) {
      if (this.entries.length >= 65000 || this.offset + blob.size > 3.9e9) throw new Error('Isi ZIP melebihi batas (4 GB atau 65 ribu berkas).');
      const crc = crc32(new Uint8Array(await blob.arrayBuffer()));
      const nm = new TextEncoder().encode(name);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034B50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, this.time, true); h.setUint16(12, this.date, true);
      h.setUint32(14, crc, true); h.setUint32(18, blob.size, true); h.setUint32(22, blob.size, true);
      h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
      this.parts.push(new Uint8Array(h.buffer), nm, blob);
      this.entries.push({ nm, crc, size: blob.size, offset: this.offset });
      this.offset += 30 + nm.length + blob.size;
    }

    finish() {
      const central = [];
      let cdSize = 0;
      for (const e of this.entries) {
        const c = new DataView(new ArrayBuffer(46));
        c.setUint32(0, 0x02014B50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
        c.setUint16(10, 0, true); c.setUint16(12, this.time, true); c.setUint16(14, this.date, true);
        c.setUint32(16, e.crc, true); c.setUint32(20, e.size, true); c.setUint32(24, e.size, true);
        c.setUint16(28, e.nm.length, true);
        c.setUint32(42, e.offset, true);
        central.push(new Uint8Array(c.buffer), e.nm);
        cdSize += 46 + e.nm.length;
      }
      const end = new DataView(new ArrayBuffer(22));
      end.setUint32(0, 0x06054B50, true);
      end.setUint16(8, this.entries.length, true); end.setUint16(10, this.entries.length, true);
      end.setUint32(12, cdSize, true); end.setUint32(16, this.offset, true);
      return new Blob([...this.parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
    }
  }

  root.HidzKit = {
    RES_PRESETS, FPS_PRESETS, GIF_MAX_FPS, VIDEO_MAX_FPS, QUALITY,
    even, sizeForShort, videoBitrate, estimateBytes, gifProblem, framesProblem,
    loadMediabunny, GifPalette, GifWriter, ZipWriter, crc32,
  };
})(typeof window !== 'undefined' ? window : globalThis);
