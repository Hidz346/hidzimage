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
;(function(){
  function bindLiveFilter(imgId,ids){
    var el=document.getElementById(imgId);
    if(!el)return;
    function upd(){
      var b=Number((document.getElementById(ids.b)||{}).value||0);
      var c=Number((document.getElementById(ids.c)||{}).value||0);
      var s=Number((document.getElementById(ids.s)||{}).value||0);
      var sh=Number((document.getElementById(ids.sh)||{}).value||0);
      var cl=Number((document.getElementById(ids.cl)||{}).value||0);
      var br=(100+b)/100,ct=(100+c+cl*0.25+sh*0.12)/100,sa=(100+s)/100;
      el.style.filter='brightness('+br.toFixed(2)+') contrast('+ct.toFixed(2)+') saturate('+sa.toFixed(2)+')';
    }
    Object.keys(ids).forEach(function(k){
      var inp=document.getElementById(ids[k]);
      if(inp)inp.addEventListener('input',upd);
    });
    document.querySelectorAll('.btn-rst').forEach(function(btn){
      btn.addEventListener('click',function(){setTimeout(upd,10);});
    });
  }
  bindLiveFilter('ePreviewImg',{b:'sBright',c:'sContrast',s:'sSaturate',sh:'sSharpen',cl:'sClarity'});
  bindLiveFilter('vPreview',{b:'vBright',c:'vContrast',s:'vSaturate',sh:'vSharpen',cl:'vClean'});
  window.addEventListener('storage',function(e){
    if(e.key==='hidz_theme'){
      var d=e.newValue==='dark';
      document.body.classList.toggle('dark',d);
      var m=document.getElementById('iconMoon'),s=document.getElementById('iconSun');
      if(m)m.classList.toggle('hidden',d);
      if(s)s.classList.toggle('hidden',!d);
    }
  });
})();
