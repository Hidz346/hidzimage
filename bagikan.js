/**
 * HidzImage — bagikan.js
 * Panduan singkat di setiap halaman hasil: cara mengirim ke WhatsApp / TikTok sekecil mungkin terkena kompres.
 * Kompresi dilakukan server platform dan tidak bisa dimatikan dari situs mana pun, jadi isinya jujur:
 * cara menekan penurunan kualitas, bukan janji menghilangkannya.
 * Dipakai index.html dan video.html; tidak bergantung pada skrip lain.
 */
(function () {
  'use strict';

  const RESULTS = ['eResult', 'kResult', 'dResult', 'rResult', 'aResult', 'vResult'];
  const TIPS = [
    ['WhatsApp', 'Kirim lewat ikon klip → <b>Dokumen</b>, lalu pilih file ini. Lewat Foto/Video biasa WhatsApp tetap mengompres, termasuk opsi “Kualitas HD”.'],
    ['TikTok · Reels', 'Aplikasi selalu meng-encode ulang. Pakai <b>TUJUAN UPLOAD</b> (MP4 H.264, 1080×1920) supaya penurunannya kecil, dan nyalakan opsi upload HD di aplikasi bila ada.'],
    ['Catatan', 'Kompresi platform tidak bisa dimatikan dari situs ini. Langkah di atas hanya menekan penurunan kualitasnya.'],
  ];

  function build() {
    const box = document.createElement('details');
    box.className = 'share-tip';
    const head = document.createElement('summary');
    head.textContent = '📤 KIRIM KE WHATSAPP / TIKTOK TANPA KOMPRES';
    const list = document.createElement('ul');
    TIPS.forEach(([label, html]) => {
      const li = document.createElement('li');
      li.innerHTML = '<b>' + label + ':</b> ' + html;
      list.appendChild(li);
    });
    box.append(head, list);
    return box;
  }

  RESULTS.forEach(id => {
    const section = document.getElementById(id);
    const actions = section && section.querySelector('.result-actions');
    if (actions) actions.parentNode.insertBefore(build(), actions);
  });
})();
