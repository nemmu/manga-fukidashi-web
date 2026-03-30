'use strict';

// ── 画像処理 ───────────────────────────────────────────────────
function hexToRgb(hex){const m=hex.trim().match(/^#?([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/);return m?[parseInt(m[1],16),parseInt(m[2],16),parseInt(m[3],16)]:null;}

function detectRegions(data,W,H,tr,tg,tb,tol,minA){
  const total=W*H,mask=new Uint8Array(total);
  for(let i=0;i<total;i++){const b=i<<2;if(Math.abs(data[b]-tr)<=tol&&Math.abs(data[b+1]-tg)<=tol&&Math.abs(data[b+2]-tb)<=tol)mask[i]=1;}
  const vis=new Uint8Array(total),regs=[];
  for(let s=0;s<total;s++){
    if(!mask[s]||vis[s])continue;
    const px=[],q=[s];let h=0;vis[s]=1;
    while(h<q.length){const c=q[h++];px.push(c);const cy=(c/W)|0,cx=c%W;
      if(cy>0){const n=c-W;if(mask[n]&&!vis[n]){vis[n]=1;q.push(n);}}
      if(cy<H-1){const n=c+W;if(mask[n]&&!vis[n]){vis[n]=1;q.push(n);}}
      if(cx>0){const n=c-1;if(mask[n]&&!vis[n]){vis[n]=1;q.push(n);}}
      if(cx<W-1){const n=c+1;if(mask[n]&&!vis[n]){vis[n]=1;q.push(n);}}}
    if(px.length<minA)continue;
    let x1=W,y1=H,x2=0,y2=0;
    for(const p of px){const py=(p/W)|0,pxv=p%W;if(pxv<x1)x1=pxv;if(py<y1)y1=py;if(pxv>x2)x2=pxv;if(py>y2)y2=py;}
    regs.push({bbox:[x1,y1,x2-x1,y2-y1],pixels:px});
  }
  return regs;
}

function dilate(pixels,W,H,d){
  if(d<=0)return pixels;
  const res=new Set(pixels);
  for(const p of pixels){const cy=(p/W)|0,cx=p%W;
    for(let dy=-d;dy<=d;dy++)for(let dx=-d;dx<=d;dx++){
      if(dx*dx+dy*dy>d*d)continue;
      const nx=cx+dx,ny=cy+dy;
      if(nx<0||nx>=W||ny<0||ny>=H)continue;
      res.add(ny*W+nx);
    }}
  return[...res];
}

function sortRegs(regs,H,manga){
  if(manga){const sh=Math.max(1,(H*0.15)|0);return[...regs].sort((a,b)=>{const as=(a.bbox[1]/sh)|0,bs=(b.bbox[1]/sh)|0;return as!==bs?as-bs:b.bbox[0]-a.bbox[0];});}
  return[...regs].sort((a,b)=>a.bbox[1]!==b.bbox[1]?a.bbox[1]-b.bbox[1]:a.bbox[0]-b.bbox[0]);
}

function wrapText(ctx,text,maxW){
  const cjk=/[\u3000-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(text);
  if(cjk){const ls=[];let c='';for(const ch of text){const t=c+ch;if(ctx.measureText(t).width<=maxW)c=t;else{if(c)ls.push(c);c=ch;}}if(c)ls.push(c);return ls.length?ls:[text];}
  const ws=text.split(/\s+/).filter(Boolean);if(!ws.length)return[text];
  const ls=[];let c='';for(const w of ws){const t=c?`${c} ${w}`:w;if(ctx.measureText(t).width<=maxW)c=t;else{if(c)ls.push(c);c=w;}}if(c)ls.push(c);return ls.length?ls:[text];
}

function fitText(ctx,text,font,bW,bH,scale){
  const eW=Math.max(1,(bW*BUBBLE_PADDING)|0),eH=Math.max(1,(bH*BUBBLE_PADDING)|0);
  let sz=Math.min(Math.max(DEF_FS,eH/1.35),MAX_FS)*(scale/100);
  const step=Math.max(1,(sz-MIN_FS)/20);
  while(sz>MIN_FS){ctx.font=`bold ${sz|0}px ${font}`;const ls=wrapText(ctx,text,eW);if(((sz*1.35)|0)*ls.length<=eH&&Math.max(...ls.map(l=>ctx.measureText(l).width))<=eW)break;sz-=step;}
  sz=Math.min(sz+step,MAX_FS);
  while(sz>=MIN_FS){ctx.font=`bold ${sz|0}px ${font}`;const ls=wrapText(ctx,text,eW);if(((sz*1.35)|0)*ls.length<=eH&&Math.max(...ls.map(l=>ctx.measureText(l).width))<=eW)return{sz,ls};sz-=1;}
  ctx.font=`bold ${MIN_FS}px ${font}`;return{sz:MIN_FS,ls:wrapText(ctx,text,eW)};
}

// !? 組み合わせを1文字に変換（縦書き・横書き共通）
function normalizeSpecialChars(text){
  return text
    .replace(/！？/g, '\u2049') // ⁉ U+2049
    .replace(/？！/g, '\u2049') // ⁉
    .replace(/！！/g, '\u203C') // ‼ U+203C
    .replace(/!!/g,  '\u203C')
    .replace(/!\?/g, '\u2049')
    .replace(/\?!/g, '\u2049');
}

// 縦書き: 句読点をUnicode縦書き形に変換（回転で対処するものは除外）
function toVerticalChars(text){
  const map={
    '\u3001':'\uFE11','\u3002':'\uFE12',
  };
  return text.split('').map(c=>map[c]||c).join('');
}

// 横向きになりやすい文字（回転が必要）: Unicodeエスケープで確実に指定
function needsRotate(c){
  const code=c.codePointAt(0);
  // … U+2026, ー U+30FC, 〜 U+301C, ～ U+FF5E, — U+2014, ― U+2015
  // () U+0028/0029, （） U+FF08/FF09, 「」U+300C/300D, 『』U+300E/300F
  const rotateSet=new Set([
    0x2026,0x30FC,0x301C,0xFF5E,0x2014,0x2015,
    0x0028,0x0029,0xFF08,0xFF09,
    0x300C,0x300D,0x300E,0x300F,
  ]);
  return rotateSet.has(code);
}

// Y座標ごとの実際の吹き出し左端・右端・幅を pixels から計算
function buildRowWidths(pixels, W, bbox){
  const[bx,by,bw,bh]=bbox;
  const rowMinX=new Float32Array(bh).fill(bx+bw);
  const rowMaxX=new Float32Array(bh).fill(bx);
  for(const p of pixels){
    const py=(p/W)|0, px=p%W;
    const row=py-by;
    if(row<0||row>=bh) continue;
    if(px<rowMinX[row]) rowMinX[row]=px;
    if(px>rowMaxX[row]) rowMaxX[row]=px;
  }
  const widths=new Float32Array(bh);
  for(let r=0;r<bh;r++){
    widths[r]=rowMaxX[r]>rowMinX[r] ? rowMaxX[r]-rowMinX[r] : bw;
  }
  // minX/maxXも返す
  widths._minX=rowMinX;
  widths._maxX=rowMaxX;
  widths._by=by;
  widths._bh=bh;
  return widths;
}

// rowWidths の下位30パーセンタイル（狭い方を重視）
function medianWidth(rowWidths){
  const arr=Array.from(rowWidths).filter(w=>w>10); // ノイズ除外
  if(!arr.length) return 0;
  arr.sort((a,b)=>a-b);
  return arr[Math.floor(arr.length*0.30)]; // 下位30%
}

// Y座標での実際の幅・左端・右端
function getRowInfo(rowWidths, bbox, y){
  const[bx,by,bw,bh]=bbox;
  const row=Math.round(y-by);
  if(!rowWidths||row<0||row>=bh) return {w:bw,minX:bx,maxX:bx+bw};
  const w=rowWidths[row]||bw;
  const minX=rowWidths._minX?rowWidths._minX[row]:bx;
  const maxX=rowWidths._maxX?rowWidths._maxX[row]:bx+bw;
  return {w,minX,maxX};
}

function drawH(ctx,text,font,bbox,color,scale,rowWidths){
  text=normalizeSpecialChars(text);
  const[x,y,w,h]=bbox;
  const forced=text.split('\n');
  const eH=Math.max(1,(h*BUBBLE_PADDING)|0);
  const medW=(rowWidths ? medianWidth(rowWidths) : w)*BUBBLE_PADDING;
  const maxSz=Math.min(eH/1.35,medW,MAX_FS)*(scale/100);

  let bestSz=MIN_FS,bestLines=[];
  for(let sz=maxSz;sz>=MIN_FS;sz-=1){
    ctx.font=`bold ${sz|0}px ${font}`;
    const lh=sz*1.35;
    const lines=forced.flatMap(l=>wrapText(ctx,l,medW));
    if(lh*lines.length>eH) continue;
    const startY=y+(h-lh*lines.length)/2;
    let fits=true;
    for(let li=0;li<lines.length;li++){
      const lineY=startY+li*lh+lh/2;
      const info=getRowInfo(rowWidths,bbox,lineY);
      const availW=info.w*BUBBLE_PADDING;
      if(ctx.measureText(lines[li]).width>availW){fits=false;break;}
    }
    if(fits){bestSz=sz;bestLines=lines;break;}
  }
  if(!bestLines.length){
    ctx.font=`bold ${MIN_FS}px ${font}`;
    bestLines=forced.flatMap(l=>wrapText(ctx,l,medW));
    bestSz=MIN_FS;
  }
  ctx.font=`bold ${bestSz|0}px ${font}`;
  ctx.fillStyle=color;ctx.textBaseline='top';ctx.textAlign='left';
  const lh=bestSz*1.35,th=lh*bestLines.length,ys=y+(h-th)/2;
  for(let i=0;i<bestLines.length;i++){
    const lineY=ys+i*lh+lh/2;
    const info=getRowInfo(rowWidths,bbox,lineY);
    // 実際の行中心を使って配置
    const centerX=(info.minX+info.maxX)/2;
    const lw=ctx.measureText(bestLines[i]).width;
    ctx.fillText(bestLines[i],centerX-lw/2,ys+i*lh);
  }
}

function drawV(ctx,text,font,bbox,color,scale,rowWidths){
  text=normalizeSpecialChars(text);
  const[bx,by,bw,bh]=bbox;
  text=toVerticalChars(text);
  const medW=(rowWidths ? medianWidth(rowWidths) : bw)*BUBBLE_PADDING;
  const eH=bh*BUBBLE_PADDING;

  // 吹き出しの中心X（中央値行の中心）
  let centerX=bx+bw/2;
  if(rowWidths&&rowWidths._minX&&rowWidths._maxX){
    // 中央付近の行の中心を使う
    const mid=Math.floor(bh/2);
    const lo=Math.max(0,mid-Math.floor(bh*0.1));
    const hi=Math.min(bh-1,mid+Math.floor(bh*0.1));
    let sumCx=0,cnt=0;
    for(let r=lo;r<=hi;r++){
      if(rowWidths._maxX[r]>rowWidths._minX[r]){
        sumCx+=(rowWidths._minX[r]+rowWidths._maxX[r])/2;
        cnt++;
      }
    }
    if(cnt>0) centerX=sumCx/cnt;
  }
  const oX=centerX-medW/2;
  const oY=by+(bh-eH)/2;

  const forcedCols=text.split('\n');
  const allChars=forcedCols.join('');
  const hasForcedBreak=forcedCols.length>1;

  function getMaxCw(sz){
    ctx.font=`bold ${sz|0}px ${font}`;
    let max=0;
    for(const c of allChars) max=Math.max(max,ctx.measureText(c).width);
    return max*1.1;
  }

  let fs=MIN_FS;
  const maxSz=Math.min(medW,eH,MAX_FS)*(scale/100);
  for(let sz=maxSz;sz>=MIN_FS;sz-=1){
    const cw=getMaxCw(sz);
    const ch=sz*1.1;
    let cols;
    if(hasForcedBreak){
      cols=forcedCols;
    } else {
      const cpc=Math.max(1,Math.floor(eH/ch));
      cols=[];
      for(let i=0;i<allChars.length;i+=cpc) cols.push(allChars.slice(i,i+cpc));
    }
    const maxLen=Math.max(...cols.map(c=>c.length));
    if(cols.length*cw<=medW && maxLen*ch<=eH){fs=sz;break;}
  }
  fs=Math.max(fs|0,MIN_FS);

  const cw=getMaxCw(fs);
  const ch=fs*1.1;

  let cols;
  if(hasForcedBreak){
    cols=forcedCols.map(s=>s.split(''));
  } else {
    const cpc=Math.max(1,Math.floor(eH/ch));
    cols=[];
    for(let i=0;i<allChars.length;i+=cpc) cols.push(allChars.slice(i,i+cpc).split(''));
  }

  const numCols=cols.length;
  const totalW=numCols*cw;
  // 中心から左右に展開
  const startX=centerX+totalW/2-cw/2;

  ctx.font=`bold ${fs}px ${font}`;
  ctx.fillStyle=color;ctx.textBaseline='middle';ctx.textAlign='center';

  for(let ci=0;ci<cols.length;ci++){
    const col=cols[ci];
    const x=startX-ci*cw;
    for(let ri=0;ri<col.length;ri++){
      const c=col[ri];
      const y=oY+ri*ch+ch/2;
      if(y>oY+eH) continue;
      if(needsRotate(c)){
        ctx.save();ctx.translate(x,y);ctx.rotate(Math.PI/2);ctx.fillText(c,0,0);ctx.restore();
      } else {
        ctx.fillText(c,x,y);
      }
    }
  }
}

async function renderOne(file,bubbles,langKey,params,forceHorizontal){
  const{tr,tg,tb,tol,minA,dil,scale,manga,color}=params;
  const bmp=await createImageBitmap(file);
  const{width:W,height:H}=bmp;
  canvas.width=W;canvas.height=H;
  ctx.drawImage(bmp,0,0);bmp.close();
  const id=ctx.getImageData(0,0,W,H),{data}=id;
  const regs=detectRegions(data,W,H,tr,tg,tb,tol,minA);
  if(!regs.length)return null;
  const sorted=sortRegs(regs,H,manga);
  if(sorted.length!==bubbles.length)return null;
  for(const r of sorted){const d=dilate(r.pixels,W,H,dil);for(const p of d){const i=p<<2;data[i]=data[i+1]=data[i+2]=255;data[i+3]=255;}}
  ctx.putImageData(id,0,0);
  const cfg=LANG_CONFIG[langKey]||LANG_CONFIG.en;
  const font=cfg.font;
  const vertical=forceHorizontal?false:cfg.vertical;
  try{await document.fonts.load(`bold ${DEF_FS}px ${font}`);}catch(_){}
  for(let i=0;i<sorted.length;i++){
    const t=bubbles[i][langKey]||'';if(!t)continue;
    const rowWidths=buildRowWidths(sorted[i].pixels,W,sorted[i].bbox);
    if(vertical)drawV(ctx,t,font,sorted[i].bbox,color,scale,rowWidths);
    else drawH(ctx,t,font,sorted[i].bbox,color,scale,rowWidths);
  }
  return canvas.toDataURL('image/png');
}
