'use strict';

// ── ZIP 自前実装 ────────────────────────────────────────────────
const ZipBuilder = (() => {
  const enc = s => new TextEncoder().encode(s);
  const u16 = n => [(n)&0xff,(n>>8)&0xff];
  const u32 = n => [(n)&0xff,(n>>8)&0xff,(n>>16)&0xff,(n>>24)&0xff];
  function crc32(buf){
    if(!crc32._t){const t=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let j=0;j<8;j++)c=c&1?(0xEDB88320^(c>>>1)):(c>>>1);t[i]=c;}crc32._t=t;}
    let c=0xFFFFFFFF;for(let i=0;i<buf.length;i++)c=crc32._t[(c^buf[i])&0xff]^(c>>>8);return(c^0xFFFFFFFF)>>>0;
  }
  function cat(...arrs){const t=arrs.reduce((s,a)=>s+a.length,0),o=new Uint8Array(t);let p=0;for(const a of arrs){o.set(a,p);p+=a.length;}return o;}
  return {
    create(){
      const entries=[];
      return {
        addFile(name,data){
          const nb=enc(name),crc=crc32(data),sz=data.length;
          const lh=new Uint8Array([0x50,0x4B,0x03,0x04,20,0,0,0,0,0,0,0,0,0,...u32(crc),...u32(sz),...u32(sz),...u16(nb.length),0,0]);
          const off=entries.reduce((s,e)=>s+e.lh.length+e.nb.length+e.data.length,0);
          entries.push({nb,lh,data,crc,sz,off});
        },
        build(){
          const parts=[];
          for(const e of entries){parts.push(e.lh,e.nb,e.data);}
          const cdOff=parts.reduce((s,p)=>s+p.length,0);
          const cds=[];
          for(const e of entries){
            const cd=new Uint8Array([0x50,0x4B,0x01,0x02,20,0,20,0,0,0,0,0,0,0,0,0,...u32(e.crc),...u32(e.sz),...u32(e.sz),...u16(e.nb.length),0,0,0,0,0,0,0,0,0,0,0,0,...u32(e.off)]);
            cds.push(cd,e.nb);
          }
          const cdSz=cds.reduce((s,p)=>s+p.length,0);
          const eocd=new Uint8Array([0x50,0x4B,0x05,0x06,0,0,0,0,...u16(entries.length),...u16(entries.length),...u32(cdSz),...u32(cdOff),0,0]);
          return cat(...parts,...cds,eocd);
        }
      };
    }
  };
})();

function dataURLtoBytes(dataURL){
  const b64=dataURL.split(',')[1];
  const bin=atob(b64);
  const bytes=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
  return bytes;
}

// ── 定数 ────────────────────────────────────────────────────────
const BUBBLE_PADDING=0.82,MIN_FS=8,MAX_FS=400,DEF_FS=28;

const LANG_CONFIG={
  ja:     {font:'"Noto Sans JP","Hiragino Sans","Yu Gothic",sans-serif', vertical:true},
  en:     {font:'"Bangers",sans-serif',                                  vertical:false},
  id_lang:{font:'"Bangers",sans-serif',                                  vertical:false},
  zh_tw:  {font:'"PingFang TC","Microsoft JhengHei","Noto Sans TC",sans-serif', vertical:true},
};

let pngFiles=[],jsonData=null,composedMap={};
const $=id=>document.getElementById(id);
const canvas=$('canvas'),ctx=canvas.getContext('2d');

// ── UI ─────────────────────────────────────────────────────────
$('pngInput').addEventListener('change',e=>{
  pngFiles=Array.from(e.target.files);
  const list=$('fileList');list.innerHTML='';
  pngFiles.forEach((f,i)=>{
    const el=document.createElement('div');el.className='file-item';
    el.innerHTML=`<span class="file-num">${i+1}</span>${f.name}`;
    list.appendChild(el);
  });
  composedMap={};$('downloadBtn').disabled=true;checkReady();
});

$('jsonText').addEventListener('input',()=>{
  const raw=$('jsonText').value.trim();
  if(!raw){jsonData=null;$('jsonStatus').textContent='';checkReady();return;}
  try{
    jsonData=JSON.parse(raw);
    $('jsonStatus').textContent=`✓ JSON OK — ${(jsonData.pages||[]).length} ページ`;
    $('jsonStatus').className='json-status ok';
  }catch(e){
    jsonData=null;
    $('jsonStatus').textContent='✗ '+e.message;
    $('jsonStatus').className='json-status ng';
  }
  composedMap={};$('downloadBtn').disabled=true;checkReady();
});

$('colorPicker').addEventListener('input',()=>{$('colorHex').value=$('colorPicker').value;});
$('colorHex').addEventListener('input',()=>{if(/^#[0-9a-fA-F]{6}$/.test($('colorHex').value))$('colorPicker').value=$('colorHex').value;});
$('tolerance').addEventListener('input',()=>{$('toleranceVal').textContent=$('tolerance').value;});
$('dilate').addEventListener('input',()=>{$('dilateVal').textContent=$('dilate').value+'px';});
$('fontScale').addEventListener('input',()=>{$('fontScaleVal').textContent=$('fontScale').value+'%';});
$('composeBtn').addEventListener('click',composeAll);
$('downloadBtn').addEventListener('click',downloadZip);

function getLangs(){return['ja','en','zh_tw','id_lang'].filter(l=>$('lang_'+l).checked);}

function checkReady(){
  const langs=getLangs(),pages=jsonData?.pages||[];
  const ok=pngFiles.length>0&&jsonData&&langs.length>0&&pngFiles.length===pages.length;
  $('composeBtn').disabled=!ok;
  if(!pngFiles.length)setStatus('PNG ファイルを選択してください');
  else if(!jsonData)setStatus('JSON を貼り付けてください');
  else if(!langs.length)setStatus('言語を1つ以上選択してください');
  else if(pngFiles.length!==pages.length)setStatus(`⚠ 画像 ${pngFiles.length} 枚 ≠ JSON pages ${pages.length} 件`,'error');
  else setStatus(`準備完了 — ${pngFiles.length} 枚 × ${langs.length} 言語`);
}

function setStatus(msg,type=''){const s=$('status');s.textContent=msg;s.className=type;}
function setProgress(cur,total,label){
  $('progressFill').style.width=(total>0?Math.round(cur/total*100):0)+'%';
  $('progressLabel').textContent=label||`${cur} / ${total}`;
  $('progressWrap').style.display='block';
}

// ── 合成 ───────────────────────────────────────────────────────
async function composeAll(){
  $('composeBtn').disabled=true;
  $('downloadBtn').disabled=true;
  composedMap={};
  const panel=$('previewPanel');
  panel.innerHTML='';
  setStatus('合成中...','processing');

  const langs=getLangs(),pages=jsonData.pages||[];
  const rgb=hexToRgb($('colorHex').value);
  if(!rgb){setStatus('無効なカラーコード','error');$('composeBtn').disabled=false;return;}

  const params={
    tr:rgb[0],tg:rgb[1],tb:rgb[2],
    tol:parseInt($('tolerance').value,10),
    minA:Math.max(1,parseInt($('minArea').value,10)||500),
    dil:parseInt($('dilate').value,10),
    scale:parseInt($('fontScale').value,10),
    manga:$('sortOrder').value==='manga',
    color:$('textColor').value,
  };

  const total=pngFiles.length*langs.length;
  let done=0,generated=0;

  const langGroups={};
  for(const lang of langs){
    const group=document.createElement('div');
    group.className='preview-lang-group';
    group.innerHTML=`<div class="preview-lang-title">${lang}</div><div class="preview-grid" id="grid_${lang}"></div>`;
    panel.appendChild(group);
    langGroups[lang]=group.querySelector(`#grid_${lang}`);
  }

  // 言語を外側、ページを内側にして言語ごとにまとめる
  for(const lang of langs){
    for(let pi=0;pi<pngFiles.length;pi++){
      const file=pngFiles[pi];
      const bubbles=(pages[pi]?.bubbles)||[];
      const base=`page${String(pi+1).padStart(2,'0')}`;
      const forceHorizontal=(pi===0);

      done++;
      setProgress(done,total,`${base}_${lang}`);
      await new Promise(r=>setTimeout(r,8));

      if(bubbles.length===0){
        const bmp=await createImageBitmap(file);
        canvas.width=bmp.width;canvas.height=bmp.height;
        ctx.drawImage(bmp,0,0);bmp.close();
        const dataURL=canvas.toDataURL('image/png');
        composedMap[`${base}_${lang}`]=dataURL;
        addPreview(langGroups[lang],dataURL,`${base}`);
        generated++;
        continue;
      }

      try{
        const dataURL=await renderOne(file,bubbles,lang,params,forceHorizontal);
        if(dataURL){
          composedMap[`${base}_${lang}`]=dataURL;
          addPreview(langGroups[lang],dataURL,base);
          generated++;
        }
      }catch(e){console.warn(e);}
    }
  }

  if(generated===0){setStatus('出力ファイルが0件です。設定を確認してください','error');}
  else{
    setStatus(`✓ 合成完了: ${generated} 件 — ZIP ダウンロードボタンを押してください`,'success');
    $('downloadBtn').disabled=false;
  }
  $('composeBtn').disabled=false;
}

function addPreview(grid,dataURL,label){
  const item=document.createElement('div');
  item.className='preview-item';
  item.innerHTML=`<img src="${dataURL}"><div class="preview-item-label">${label}</div>`;
  grid.appendChild(item);
}

// ── ダウンロード ───────────────────────────────────────────────
function downloadZip(){
  $('downloadBtn').disabled=true;
  const entries=Object.entries(composedMap);
  if(!entries.length){setStatus('合成データがありません','error');$('downloadBtn').disabled=false;return;}

  setStatus('ZIP を作成中...','processing');

  const zip=ZipBuilder.create();
  for(const[key,dataURL] of entries){
    zip.addFile(key+'.png', dataURLtoBytes(dataURL));
  }
  const blob=new Blob([zip.build()],{type:'application/zip'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download='fukidashi.zip';
  a.style.display='none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  setStatus(`✓ ZIP ダウンロード完了 — ${entries.length} 枚`,'success');
  $('downloadBtn').disabled=false;
}
