# vendor/

## mediabunny.min.js

Pustaka [Mediabunny](https://github.com/Vanilagy/mediabunny) **v1.62.1** (lisensi **MPL-2.0**,
teks lengkap ada di `LICENSE-mediabunny.txt`). Dipakai oleh `video.js` sebagai mesin utama
pemrosesan video lewat WebCodecs (decode → proses frame → encode H.264/AAC, bukan merekam layar
secara real-time seperti versi lama).

- Bukan hasil edit: kode sumber Mediabunny dibundel apa adanya, hanya fitur yang dipakai
  (`Input`, `Output`, `Conversion`, `BlobSource`, `BufferTarget`, format MP4/WebM, `Quality`,
  `VideoSample`, `AudioSample`, helper pengecekan encoder) yang diekspor ke `globalThis.Mediabunny`.
- Dimuat sesuai kebutuhan oleh `loadLib()` di `video.js`, jadi halaman foto tidak ikut membebani.
- Bila file ini gagal dimuat atau browser tidak mendukung WebCodecs, `video.js` otomatis memakai
  mesin cadangan (perekaman real-time) dan hasil ditandai "MODE KOMPATIBILITAS".
- Untuk memperbarui: ganti file ini dengan bundel versi baru, lalu naikkan angka `?v=` pada
  konstanta `LIB_URL` di `video.js` supaya cache browser pengunjung diperbarui.

Kode sumber Mediabunny: https://github.com/Vanilagy/mediabunny (tag v1.62.1).
