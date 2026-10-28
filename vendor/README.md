# vendor/

## mediabunny.min.js

Pustaka [Mediabunny](https://github.com/Vanilagy/mediabunny) **v1.62.1** (lisensi **MPL-2.0**,
teks lengkap ada di `LICENSE-mediabunny.txt`). Dipakai oleh `video.js` sebagai mesin utama
pemrosesan video lewat WebCodecs (decode → proses frame → encode H.264/AAC, bukan merekam layar
secara real-time seperti versi lama).

- Bukan hasil edit: kode sumber Mediabunny dibundel apa adanya, hanya fitur yang dipakai
  (`Input`, `Output`, `Conversion`, `BlobSource`, `BufferTarget`, format MP4/WebM, `Quality`,
  `VideoSample`, `AudioSample`, `CanvasSink`, `CanvasSource`, helper pengecekan encoder) yang
  diekspor ke `globalThis.Mediabunny`. `CanvasSink` membaca frame video pada waktu yang tepat (GIF dan
  urutan gambar di Studio Ekspor), `CanvasSource` menulis video dari kanvas (tab ANIMASI di halaman foto).
- Dimuat sesuai kebutuhan oleh `loadLib()` di `video.js` (dan `foto-animasi.js` untuk tab ANIMASI),
  jadi halaman tidak ikut membebani sebelum fitur itu dipakai.
- Bila file ini gagal dimuat atau browser tidak mendukung WebCodecs, `video.js` otomatis memakai
  mesin cadangan (perekaman real-time) dan hasil ditandai "MODE KOMPATIBILITAS".
- Untuk memperbarui: ganti file ini dengan bundel versi baru, lalu naikkan angka `?v=` pada
  konstanta `LIB_URL` di `video.js` dan `foto-animasi.js` supaya cache browser pengunjung diperbarui.

Kode sumber Mediabunny: https://github.com/Vanilagy/mediabunny (tag v1.62.1).
