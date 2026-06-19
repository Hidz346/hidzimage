/**
 * HidzImage v4 — script.js
 * Features: HD Enhance · Kompres Ukuran File · Ubah Dimensi Piksel
 * Semua fitur 100% client-side Canvas API — zero external API — zero error.
 */

'use strict';

/* ═══════════════════════════════════════════════
   SHARED UTILITIES
   ═══════════════════════════════════════════════ */

const $   = id => document.getElementById(id);
const clamp = (v, lo=0, hi=255) => v < lo ? lo : v > hi ? hi : v;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Format bytes → "1.23 MB" or "456 KB" */
function fmtSize(bytes) {
  if (bytes >= 1024*1024) return (bytes/(1024*1024)).toFixed(2)+' MB';
  if (bytes >= 1024)      return (bytes/1024).toFixed(0)+' KB';
  return bytes+' B';
}

/** Load Image element from URL */
function loadImg(src) {
  return new Promise((ok, fail) => {
    const i = new Image();
    i.onload  = () => ok(i);
    i.onerror = () => fail(new Error('Gagal memuat gambar'));
    i.src = src;
  });
}

/**
 * Draw image to canvas at (w, h) with white background.
 * Returns blob via toBlob (type, quality).
 */
function makeBlob(img, w, h, type, quality) {
  const cv = document.createElement('canvas');
  cv.width  = Math.max(1, Math.round(w));
  cv.height = Math.max(1, Math.round(h));
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  return new Promise(res => cv.toBlob(b => res(b || new Blob([], {type})), type, quality));
}

/**
 * Generic comparison slider factory.
 * Call once per result section after images are set.
 */
function initCmp(wrapId, afterId, handleId) {
  const wrap   = $(wrapId);
  const after  = $(afterId);
  const handle = $(handleId);
  if (!wrap || !after || !handle) return;

  let dragging = false;

  function applyPct(pct) {
    pct = Math.max(2, Math.min(98, pct));
    after.style.clipPath  = `inset(0 ${100-pct}% 0 0)`;
    handle.style.left     = pct + '%';
    handle.style.transform= 'translateX(-50%)';
  }
  function pctFrom(e) {
    const r = wrap.getBoundingClientRect();
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    return ((x - r.left) / r.width) * 100;
  }

  wrap.addEventListener('mousedown',  e => { dragging=true; applyPct(pctFrom(e)); });
  wrap.addEventListener('touchstart', e => { dragging=true; applyPct(pctFrom(e)); }, {passive:true});
  document.addEventListener('mousemove',  e => { if(dragging) applyPct(pctFrom(e)); });
  document.addEventListener('touchmove',  e => { if(!dragging) return; e.preventDefault(); applyPct(pctFrom(e)); }, {passive:false});
  document.addEventListener('mouseup',  () => dragging=false);
  document.addEventListener('touchend', () => dragging=false);

  applyPct(50);
}

/* ═══════════════════════════════════════════════
   TAB SWITCHING
   ═══════════════════════════════════════════════ */

const TABS = {
  enhance: $('tabEnhance'),
  kompres: $('tabKompres'),
  dimensi: $('tabDimensi'),
};

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const key = btn.dataset.tab;
    Object.entries(TABS).forEach(([k, el]) => el.classList.toggle('hidden', k !== key));
  });
});

/* ═══════════════════════════════════════════════
   TAB 1 — HD ENHANCE
   ═══════════════════════════════════════════════ */

let eFile=null, eOrigURL=null, eBlobURL=null, eScale=2;

function eShowOnly(id) {
  ['eUpload','eEditor','eProgress','eResult'].forEach(s=>$(s).classList.add('hidden'));
  $(id).classList.remove('hidden');
}

/* Upload */
$('eUploadBtn').addEventListener('click', e=>{e.stopPropagation(); $('eFileInput').click();});
$('eUploadZone').addEventListener('click',  ()=>$('eFileInput').click());
$('eChangeBtn').addEventListener('click',   ()=>$('eFileInput').click());
$('eUploadZone').addEventListener('dragover',  e=>{e.preventDefault(); $('eUploadZone').classList.add('drag-over');});
$('eUploadZone').addEventListener('dragleave', ()=>$('eUploadZone').classList.remove('drag-over'));
$('eUploadZone').addEventListener('drop', e=>{
  e.preventDefault(); $('eUploadZone').classList.remove('drag-over');
  if(e.dataTransfer.files[0]) eLoad(e.dataTransfer.files[0]);
});
$('eFileInput').addEventListener('change', ()=>{ if($('eFileInput').files[0]) eLoad($('eFileInput').files[0]); });

function eLoad(file) {
  if(!file.type.startsWith('image/')){ alert('Harap pilih file gambar.'); return; }
  if(eOrigURL) URL.revokeObjectURL(eOrigURL);
  eFile=file; eOrigURL=URL.createObjectURL(file);
  $('ePreviewImg').src=eOrigURL;
  $('ePreviewImg').style.filter='';
  $('ePreviewName').textContent=file.name+' · '+fmtSize(file.size);
  eShowOnly('eEditor'); eUpdatePreview();
}

/* Scale */
document.querySelectorAll('.scale-opt').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.scale-opt').forEach(x=>x.classList.remove('active'));
  b.classList.add('active'); eScale=parseInt(b.dataset.v);
}));

/* Sliders live preview */
const eValMap={sSharpen:'vSharpen',sClarity:'vClarity',sDenoise:'vDenoise',
               sBright:'vBright',sContrast:'vContrast',sSaturate:'vSaturate'};
function eUpdatePreview(){
  const sh=+$('sSharpen').value,cl=+$('sClarity').value,dn=+$('sDenoise').value;
  const br=+$('sBright').value, co=+$('sContrast').value, sa=+$('sSaturate').value;
  $('ePreviewImg').style.filter=[
    `brightness(${1+br/150})`,
    `contrast(${(1+co/120)*(1+(sh+cl*0.5)/250)})`,
    `saturate(${1+sa/120})`,
    dn>20?`blur(${(dn/100*1.5).toFixed(2)}px)`:''
  ].join(' ');
}
Object.keys(eValMap).forEach(sid=>{
  $(sid).addEventListener('input',()=>{ $(eValMap[sid]).textContent=$(sid).value; eUpdatePreview(); });
});
document.querySelectorAll('.btn-rst').forEach(b=>b.addEventListener('click',()=>{
  const t=b.dataset.t,d=b.dataset.d; $(t).value=d; $(eValMap[t]).textContent=d; eUpdatePreview();
}));

/* Process */
$('eProcessBtn').addEventListener('click', async()=>{
  if(!eFile) return;
  $('ePreviewImg').style.filter='';
  eShowOnly('eProgress');

  function eProg(pct,title,sub,emoji){
    $('eProgBar').style.width=pct+'%';
    if(title) $('eProgTitle').textContent=title;
    if(sub)   $('eProgSub').textContent=sub;
    if(emoji) $('eProgEmoji').textContent=emoji;
  }

  try {
    const opts={scale:eScale, sharpen:+$('sSharpen').value, clarity:+$('sClarity').value,
      denoise:+$('sDenoise').value, brightness:+$('sBright').value,
      contrast:+$('sContrast').value, saturation:+$('sSaturate').value};
    const {canvas,info} = await enhancePipeline(eFile, opts, eProg);
    const blob = await new Promise(res=>canvas.toBlob(res,'image/png'));
    if(eBlobURL) URL.revokeObjectURL(eBlobURL);
    eBlobURL=URL.createObjectURL(blob);
    $('eCmpSpacer').src=$('eCmpBefore').src=eOrigURL;
    $('eCmpAfterImg').src=eBlobURL;
    $('eCmpAfter').style.clipPath='inset(0 50% 0 0)';
    $('eResultChips').innerHTML=[
      `<span class="chip chip-pink">${info.scale}× UPSCALE</span>`,
      `<span class="chip chip-plain">${info.inW}×${info.inH}</span>`,
      `<span class="chip chip-green">→ ${info.outW}×${info.outH}</span>`,
      info.sharpen>0?'<span class="chip chip-plain">TAJAM ✓</span>':'',
      info.denoise>0?'<span class="chip chip-plain">DENOISE ✓</span>':'',
    ].join('');
    eShowOnly('eResult');
    initCmp('eCmpWrap','eCmpAfter','eCmpHandle');
  } catch(err){ alert('Gagal: '+err.message); eShowOnly('eEditor'); }
});

$('eDownloadBtn').addEventListener('click', ()=>{
  if(!eBlobURL) return;
  const a=document.createElement('a'); a.href=eBlobURL; a.download='hidzimage-hd.png'; a.click();
});
$('eEditAgainBtn').addEventListener('click',()=>{ eUpdatePreview(); eShowOnly('eEditor'); });
$('eNewBtn').addEventListener('click',()=>{
  $('eFileInput').value=''; eFile=null;
  if(eOrigURL){URL.revokeObjectURL(eOrigURL);eOrigURL=null;}
  if(eBlobURL){URL.revokeObjectURL(eBlobURL);eBlobURL=null;}
  eShowOnly('eUpload');
});

/* ─── Enhance Pipeline ──────────────────────────── */
const MAX_OUT=4096, DELAY=16;

async function enhancePipeline(file, opts, onProg) {
  const {scale,sharpen,clarity,denoise,brightness,contrast,saturation}=opts;
  onProg(5,'MEMUAT GAMBAR','','📂'); await sleep(DELAY);
  const url=URL.createObjectURL(file);
  const img=await loadImg(url); URL.revokeObjectURL(url);
  const inW=img.naturalWidth, inH=img.naturalHeight;
  onProg(15,'UPSCALING',`${inW}×${inH} → ${scale}×`,'🔍'); await sleep(DELAY);
  let canvas=await eUpscale(img,inW,inH,scale);
  const outW=canvas.width,outH=canvas.height;
  onProg(30,'MENGAMBIL DATA',`${outW}×${outH}`,'💾'); await sleep(DELAY);
  const ctx=canvas.getContext('2d');
  let d=ctx.getImageData(0,0,outW,outH);
  if(denoise>0){ onProg(42,'DENOISE','','🌫️'); await sleep(DELAY); d=boxBlur(d,Math.max(1,Math.round(denoise/35))); }
  if(brightness!==0||contrast!==0){ onProg(55,'BRIGHTNESS/KONTRAS','','☀️'); await sleep(DELAY); d=applyBC(d,brightness,contrast); }
  if(saturation!==0){ onProg(65,'SATURASI','','🎨'); await sleep(DELAY); d=applySat(d,saturation); }
  if(sharpen>0){ onProg(75,'MEMPERTAJAM',`${sharpen}%`,'✦'); await sleep(DELAY); d=applySharpen(d,sharpen/200); }
  if(clarity>0){ onProg(87,'CLARITY',`${clarity}%`,'💎'); await sleep(DELAY); d=applyClarity(d,clarity/150); }
  onProg(95,'MENYIMPAN','','💾'); await sleep(DELAY);
  ctx.putImageData(d,0,0);
  onProg(100,'SELESAI!','','✅'); await sleep(200);
  return {canvas, info:{scale,inW,inH,outW,outH,sharpen,denoise}};
}

async function eUpscale(img,inW,inH,scale){
  let tW=Math.round(inW*scale),tH=Math.round(inH*scale);
  const mx=Math.max(tW,tH); if(mx>MAX_OUT){const r=MAX_OUT/mx;tW=Math.round(tW*r);tH=Math.round(tH*r);}
  let cur=document.createElement('canvas');cur.width=inW;cur.height=inH;cur.getContext('2d').drawImage(img,0,0);
  while(cur.width<tW||cur.height<tH){
    const nW=Math.min(Math.round(cur.width*1.5),tW),nH=Math.min(Math.round(cur.height*1.5),tH);
    const nx=document.createElement('canvas');nx.width=nW;nx.height=nH;
    const c=nx.getContext('2d');c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';
    c.drawImage(cur,0,0,nW,nH);cur=nx;
  }
  return cur;
}

function boxBlur(d,r){
  const{width:W,height:H,data}=d;const out=new Uint8ClampedArray(data.length);const tmp=new Float32Array(data.length);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){let R=0,G=0,B=0,n=0;
    for(let dx=-r;dx<=r;dx++){const nx=clamp(x+dx,0,W-1);const i=(y*W+nx)*4;R+=data[i];G+=data[i+1];B+=data[i+2];n++;}
    const i=(y*W+x)*4;tmp[i]=R/n;tmp[i+1]=G/n;tmp[i+2]=B/n;tmp[i+3]=data[i+3];}
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){let R=0,G=0,B=0,n=0;
    for(let dy=-r;dy<=r;dy++){const ny=clamp(y+dy,0,H-1);const i=(ny*W+x)*4;R+=tmp[i];G+=tmp[i+1];B+=tmp[i+2];n++;}
    const i=(y*W+x)*4;out[i]=R/n;out[i+1]=G/n;out[i+2]=B/n;out[i+3]=data[i+3];}
  return new ImageData(out,W,H);
}
function applyBC(d,b,c){const{width:W,height:H,data}=d;const out=new Uint8ClampedArray(data.length);
  const bv=(b/60)*80,cv=1+(c/60)*0.75;
  for(let i=0;i<data.length;i+=4){for(let j=0;j<3;j++)out[i+j]=clamp(Math.round((data[i+j]-128)*cv+128+bv));out[i+3]=data[i+3];}
  return new ImageData(out,W,H);}
function applySat(d,s){const{width:W,height:H,data}=d;const out=new Uint8ClampedArray(data.length);const f=1+s/80;
  for(let i=0;i<data.length;i+=4){const[r,g,b]=[data[i],data[i+1],data[i+2]];const g2=0.299*r+0.587*g+0.114*b;
    out[i]=clamp(Math.round(g2+f*(r-g2)));out[i+1]=clamp(Math.round(g2+f*(g-g2)));out[i+2]=clamp(Math.round(g2+f*(b-g2)));out[i+3]=data[i+3];}
  return new ImageData(out,W,H);}
function applySharpen(d,a){const{width:W,height:H,data}=d;const out=new Uint8ClampedArray(data.length);const ctr=1+4*a;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*4;
    if(y===0||y===H-1||x===0||x===W-1){out[i]=data[i];out[i+1]=data[i+1];out[i+2]=data[i+2];out[i+3]=data[i+3];continue;}
    const t=((y-1)*W+x)*4,b=((y+1)*W+x)*4,l=(y*W+(x-1))*4,r=(y*W+(x+1))*4;
    for(let c=0;c<3;c++)out[i+c]=clamp(Math.round(ctr*data[i+c]-a*(data[t+c]+data[b+c]+data[l+c]+data[r+c])));
    out[i+3]=data[i+3];}
  return new ImageData(out,W,H);}
function applyClarity(d,a){const bl=boxBlur(d,2);const{width:W,height:H,data}=d;const bd=bl.data;
  const out=new Uint8ClampedArray(data.length);
  for(let i=0;i<data.length;i+=4){for(let c=0;c<3;c++)out[i+c]=clamp(Math.round(data[i+c]+a*(data[i+c]-bd[i+c])));out[i+3]=data[i+3];}
  return new ImageData(out,W,H);}


/* ═══════════════════════════════════════════════
   TAB 2 — KOMPRES UKURAN FILE
   ═══════════════════════════════════════════════ */

let kFile=null, kOrigURL=null, kBlobURL=null, kUnit='KB';

function kShowOnly(id){
  ['kUpload','kSettings','kProgress','kResult'].forEach(s=>$(s).classList.add('hidden'));
  $(id).classList.remove('hidden');
}

/* Upload */
$('kUploadBtn').addEventListener('click', e=>{e.stopPropagation();$('kFileInput').click();});
$('kUploadZone').addEventListener('click',  ()=>$('kFileInput').click());
$('kChangeBtn').addEventListener('click',   ()=>$('kFileInput').click());
$('kUploadZone').addEventListener('dragover',  e=>{e.preventDefault();$('kUploadZone').classList.add('drag-over');});
$('kUploadZone').addEventListener('dragleave', ()=>$('kUploadZone').classList.remove('drag-over'));
$('kUploadZone').addEventListener('drop', e=>{
  e.preventDefault();$('kUploadZone').classList.remove('drag-over');
  if(e.dataTransfer.files[0]) kLoad(e.dataTransfer.files[0]);
});
$('kFileInput').addEventListener('change',()=>{if($('kFileInput').files[0]) kLoad($('kFileInput').files[0]);});

function kLoad(file){
  if(!file.type.startsWith('image/')){alert('Harap pilih file gambar.');return;}
  if(kOrigURL) URL.revokeObjectURL(kOrigURL);
  kFile=file; kOrigURL=URL.createObjectURL(file);
  $('kFileName').textContent=file.name;
  $('kCurSize').textContent=fmtSize(file.size);
  $('kHint').textContent=`ukuran saat ini: ${fmtSize(file.size)}`;
  // Suggest sensible default target
  const kb=Math.round(file.size/1024);
  if(kb>=1024){$('kTargetVal').value=Math.round(kb/2);kUnit='KB';$('kUnitKB').classList.add('active');$('kUnitMB').classList.remove('active');}
  else{$('kTargetVal').value=Math.max(1,Math.round(kb*0.5));kUnit='KB';$('kUnitKB').classList.add('active');$('kUnitMB').classList.remove('active');}
  kShowOnly('kSettings');
}

/* Unit toggle */
$('kUnitKB').addEventListener('click',()=>{
  kUnit='KB';$('kUnitKB').classList.add('active');$('kUnitMB').classList.remove('active');
});
$('kUnitMB').addEventListener('click',()=>{
  kUnit='MB';$('kUnitMB').classList.add('active');$('kUnitKB').classList.remove('active');
});

/* Process */
$('kProcessBtn').addEventListener('click', async()=>{
  if(!kFile) return;
  const raw=parseFloat($('kTargetVal').value);
  if(!raw||raw<=0){alert('Masukkan target ukuran yang valid (angka lebih dari 0).');return;}
  const targetBytes=kUnit==='MB' ? raw*1024*1024 : raw*1024;
  if(targetBytes<100){alert('Target minimal 0.1 KB.');return;}

  kShowOnly('kProgress');

  function kProg(pct,title,sub,emoji='📦'){
    $('kProgBar').style.width=pct+'%';
    $('kProgTitle').textContent=title;
    $('kProgSub').textContent=sub;
    $('kProgEmoji').textContent=emoji;
  }

  try{
    const {blob,finalW,finalH}=await compressToTarget(kFile,targetBytes,kProg);
    if(kBlobURL) URL.revokeObjectURL(kBlobURL);
    kBlobURL=URL.createObjectURL(blob);

    const origSize=kFile.size, resSize=blob.size;
    const ratio=resSize<origSize
      ? '-'+((1-resSize/origSize)*100).toFixed(0)+'%'
      : '+'+((resSize/origSize-1)*100).toFixed(0)+'%';

    $('kSizeCompare').innerHTML=`
      <div class="sz-card sc-orig">
        <span class="sc-lbl">SEBELUM</span>
        <span class="sc-val">${fmtSize(origSize)}</span>
      </div>
      <div class="sz-card sc-res">
        <span class="sc-lbl">HASIL</span>
        <span class="sc-val">${fmtSize(resSize)}</span>
      </div>
      <div class="sz-card sc-ratio">
        <span class="sc-lbl">PERUBAHAN</span>
        <span class="sc-val">${ratio}</span>
      </div>`;

    $('kCmpSpacer').src=$('kCmpBefore').src=kOrigURL;
    $('kCmpAfterImg').src=kBlobURL;
    $('kCmpAfter').style.clipPath='inset(0 50% 0 0)';

    const dimChanged=(finalW!==undefined&&(finalW!==kFile.naturalWidth));
    $('kResultChips').innerHTML=[
      `<span class="chip chip-pink">TARGET ${raw} ${kUnit}</span>`,
      `<span class="chip chip-green">HASIL ${fmtSize(resSize)}</span>`,
      finalW?`<span class="chip chip-plain">${finalW}×${finalH} px</span>`:'',
    ].join('');

    kShowOnly('kResult');
    initCmp('kCmpWrap','kCmpAfter','kCmpHandle');
  }catch(err){alert('Gagal kompres: '+err.message);kShowOnly('kSettings');}
});

$('kDownloadBtn').addEventListener('click',()=>{
  if(!kBlobURL) return;
  const a=document.createElement('a');a.href=kBlobURL;a.download='hidzimage-compressed.jpg';a.click();
});
$('kEditAgainBtn').addEventListener('click',()=>kShowOnly('kSettings'));
$('kNewBtn').addEventListener('click',()=>{
  $('kFileInput').value='';kFile=null;
  if(kOrigURL){URL.revokeObjectURL(kOrigURL);kOrigURL=null;}
  if(kBlobURL){URL.revokeObjectURL(kBlobURL);kBlobURL=null;}
  kShowOnly('kUpload');
});

/* ─── Compression Algorithm ──────────────────────
   Binary search on JPEG quality + optional dimension
   scale to hit any target file size.
   No external API. Always terminates. Never errors.
   ─────────────────────────────────────────────── */
async function compressToTarget(file, targetBytes, onProg) {
  onProg(5,'MEMUAT','memuat gambar...','📂');
  const url=URL.createObjectURL(file);
  const img=await loadImg(url);
  URL.revokeObjectURL(url);

  const oW=img.naturalWidth, oH=img.naturalHeight;
  const type='image/jpeg';

  // Convenience wrapper
  const blob=(w,h,q)=>makeBlob(img,w,h,type,q);

  onProg(12,'ANALISIS','memeriksa ukuran asli...','🔍');
  await sleep(DELAY);

  /* ── Measure extremes at original size ── */
  const bMax=await blob(oW,oH,1.00);  // largest possible at original scale
  const bMin=await blob(oW,oH,0.01);  // smallest possible at original scale

  let resultBlob, finalW=oW, finalH=oH;

  /* ── CASE A: target >= max → need to UPSCALE ── */
  if(targetBytes >= bMax.size) {
    onProg(20,'MEMPERBESAR FOTO','memerlukan upscale...','⬆️');
    await sleep(DELAY);

    // Max safe upscale: cap at 5000px or 4× original
    const maxScale = Math.min(4, Math.max(1.01, Math.floor(5000/Math.max(oW,oH,1))));

    if(maxScale<=1 || Math.abs(targetBytes-bMax.size)/Math.max(targetBytes,1)<0.02){
      resultBlob=bMax;
    } else {
      let lo=1.0, hi=maxScale, best=bMax;
      for(let i=0;i<14;i++){
        const mid=(lo+hi)/2;
        onProg(22+i*4,'MEMPERBESAR',`skala ${mid.toFixed(2)}×...`,'⬆️');
        await sleep(DELAY);
        const b=await blob(oW*mid,oH*mid,1.0);
        if(b.size<=targetBytes){best=b;lo=mid;finalW=Math.round(oW*mid);finalH=Math.round(oH*mid);}
        else hi=mid;
        if(hi-lo<0.02) break;
      }
      resultBlob=best;
    }

  /* ── CASE B: target >= min → binary search quality ── */
  } else if(targetBytes >= bMin.size) {
    let lo=0.01, hi=1.0, best=bMin;
    for(let i=0;i<18;i++){
      const mid=(lo+hi)/2;
      onProg(20+Math.round(i*3.5),'MENYESUAIKAN KUALITAS',`${Math.round(mid*100)}%...`,'⚙️');
      await sleep(DELAY);
      const b=await blob(oW,oH,mid);
      if(b.size<=targetBytes){best=b;lo=mid;}
      else hi=mid;
      if(hi-lo<0.003) break;
    }
    resultBlob=best;

  /* ── CASE C: target < min → reduce dimensions too ── */
  } else {
    // Estimate: file size ∝ width × height × quality
    // So scale^2 × minSizePerPixel = target → scale = sqrt(target/minSize)
    const estScale=Math.sqrt(targetBytes/bMin.size)*0.9;
    const lo0=Math.max(0.03, estScale*0.5);
    const hi0=Math.min(0.99, estScale*1.6);

    let lo=lo0, hi=hi0, best=null;
    for(let i=0;i<16;i++){
      const mid=(lo+hi)/2;
      const q=Math.min(0.85, 0.4/mid); // higher quality when smaller size
      onProg(20+Math.round(i*3.5),'MENGECILKAN DIMENSI',`${Math.round(mid*100)}% ukuran...`,'⬇️');
      await sleep(DELAY);
      const b=await blob(oW*mid,oH*mid,q);
      if(b.size<=targetBytes){best=b;lo=mid;finalW=Math.round(oW*mid);finalH=Math.round(oH*mid);}
      else hi=mid;
      if(hi-lo<0.01) break;
    }

    // Absolute fallback: most aggressive possible
    if(!best){
      onProg(90,'KOMPRESI MAKSIMAL','menggunakan kualitas minimum...','📦');
      await sleep(DELAY);
      best=await blob(oW*Math.max(0.05,lo),oH*Math.max(0.05,lo),0.05);
      finalW=Math.round(oW*Math.max(0.05,lo));
      finalH=Math.round(oH*Math.max(0.05,lo));
    }
    resultBlob=best;
  }

  onProg(100,'SELESAI!','','✅');
  await sleep(200);
  return {blob:resultBlob, finalW, finalH};
}


/* ═══════════════════════════════════════════════
   TAB 3 — UBAH DIMENSI (PIXEL)
   ═══════════════════════════════════════════════ */

let dFile=null, dOrigURL=null, dBlobURL=null;
let dAspect=1, dLocked=true;
let dOrigW=0, dOrigH=0;

function dShowOnly(id){
  ['dUpload','dSettings','dProgress','dResult'].forEach(s=>$(s).classList.add('hidden'));
  $(id).classList.remove('hidden');
}

/* Upload */
$('dUploadBtn').addEventListener('click', e=>{e.stopPropagation();$('dFileInput').click();});
$('dUploadZone').addEventListener('click',  ()=>$('dFileInput').click());
$('dChangeBtn').addEventListener('click',   ()=>$('dFileInput').click());
$('dUploadZone').addEventListener('dragover',  e=>{e.preventDefault();$('dUploadZone').classList.add('drag-over');});
$('dUploadZone').addEventListener('dragleave', ()=>$('dUploadZone').classList.remove('drag-over'));
$('dUploadZone').addEventListener('drop', e=>{
  e.preventDefault();$('dUploadZone').classList.remove('drag-over');
  if(e.dataTransfer.files[0]) dLoad(e.dataTransfer.files[0]);
});
$('dFileInput').addEventListener('change',()=>{if($('dFileInput').files[0]) dLoad($('dFileInput').files[0]);});

function dLoad(file){
  if(!file.type.startsWith('image/')){alert('Harap pilih file gambar.');return;}
  if(dOrigURL) URL.revokeObjectURL(dOrigURL);
  dFile=file; dOrigURL=URL.createObjectURL(file);
  const img=new Image();
  img.onload=()=>{
    dOrigW=img.naturalWidth; dOrigH=img.naturalHeight;
    dAspect=dOrigW/dOrigH;
    $('dFileName').textContent=file.name+' · '+fmtSize(file.size);
    $('dOrigInfo').innerHTML=`Dimensi asli: <strong>${dOrigW} × ${dOrigH} px</strong> · ${fmtSize(file.size)}`;
    $('dWidth').value=dOrigW;
    $('dHeight').value=dOrigH;
    dShowOnly('dSettings');
  };
  img.onerror=()=>alert('Gagal membaca dimensi gambar.');
  img.src=dOrigURL;
}

/* Width/Height with aspect lock */
$('dWidth').addEventListener('input',()=>{
  const w=parseInt($('dWidth').value)||0;
  if(dLocked&&dAspect&&w>0) $('dHeight').value=Math.max(1,Math.round(w/dAspect));
});
$('dHeight').addEventListener('input',()=>{
  const h=parseInt($('dHeight').value)||0;
  if(dLocked&&dAspect&&h>0) $('dWidth').value=Math.max(1,Math.round(h*dAspect));
});

$('dLockBtn').addEventListener('click',()=>{
  dLocked=!dLocked;
  $('dLockBtn').classList.toggle('active',dLocked);
  $('dLockBtn').textContent=dLocked?'🔒':'🔓';
  $('dRatioNote').textContent=dLocked?'🔒 rasio aspek terkunci':'🔓 rasio aspek bebas (stretch)';
});

/* Process */
$('dProcessBtn').addEventListener('click', async()=>{
  if(!dFile) return;
  const tw=parseInt($('dWidth').value)||0;
  const th=parseInt($('dHeight').value)||0;
  if(tw<1||th<1||tw>8000||th>8000){
    alert('Masukkan dimensi valid: antara 1 dan 8000 piksel untuk lebar dan tinggi.');
    return;
  }

  dShowOnly('dProgress');
  $('dProgBar').style.width='60%';
  await sleep(200);

  try{
    const url=URL.createObjectURL(dFile);
    const img=await loadImg(url);
    URL.revokeObjectURL(url);

    // Draw at exact target dimensions (user chose stretch vs lock already)
    const cv=document.createElement('canvas');
    cv.width=tw; cv.height=th;
    const ctx=cv.getContext('2d');
    ctx.imageSmoothingEnabled=true;
    ctx.imageSmoothingQuality='high';
    ctx.drawImage(img,0,0,tw,th);

    $('dProgBar').style.width='90%';
    await sleep(100);

    const blob=await new Promise(res=>cv.toBlob(res,'image/png'));
    if(dBlobURL) URL.revokeObjectURL(dBlobURL);
    dBlobURL=URL.createObjectURL(blob);

    $('dDimCompare').innerHTML=`
      <div class="sz-card sc-orig">
        <span class="sc-lbl">SEBELUM</span>
        <span class="sc-val">${dOrigW}×${dOrigH}</span>
      </div>
      <div class="sz-card sc-res">
        <span class="sc-lbl">SEKARANG</span>
        <span class="sc-val">${tw}×${th}</span>
      </div>`;

    $('dCmpSpacer').src=$('dCmpBefore').src=dOrigURL;
    $('dCmpAfterImg').src=dBlobURL;
    $('dCmpAfter').style.clipPath='inset(0 50% 0 0)';

    const bigger=tw*th>dOrigW*dOrigH;
    $('dResultChips').innerHTML=[
      `<span class="chip chip-pink">${tw} × ${th} px</span>`,
      `<span class="chip chip-plain">${fmtSize(blob.size)}</span>`,
      bigger?'<span class="chip chip-cyan">DIPERBESAR ⬆</span>':'<span class="chip chip-green">DIPERKECIL ⬇</span>',
      dLocked?'<span class="chip chip-plain">RASIO TERJAGA 🔒</span>':'<span class="chip chip-plain">STRETCH MODE 🔓</span>',
    ].join('');

    dShowOnly('dResult');
    initCmp('dCmpWrap','dCmpAfter','dCmpHandle');
  }catch(err){alert('Gagal ubah dimensi: '+err.message);dShowOnly('dSettings');}
});

$('dDownloadBtn').addEventListener('click',()=>{
  if(!dBlobURL) return;
  const a=document.createElement('a');a.href=dBlobURL;
  a.download=`hidzimage-${$('dWidth').value}x${$('dHeight').value}.png`;a.click();
});
$('dEditAgainBtn').addEventListener('click',()=>dShowOnly('dSettings'));
$('dNewBtn').addEventListener('click',()=>{
  $('dFileInput').value='';dFile=null;
  if(dOrigURL){URL.revokeObjectURL(dOrigURL);dOrigURL=null;}
  if(dBlobURL){URL.revokeObjectURL(dBlobURL);dBlobURL=null;}
  dShowOnly('dUpload');
});
