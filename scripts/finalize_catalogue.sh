#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
p=Path('index.html'); s=p.read_text()
if '<!-- FINAL_SINGLE_CATALOGUE -->' not in s:
 css='''<style id="kt-single-catalogue-css">
#tiles-container,#search-results,#category-modal{display:none!important}
#kt-home-catalogue{display:block}
#kt-category-nav{display:flex;align-items:center;gap:8px;margin:12px auto;max-width:1100px}
#kt-category-strip{display:flex;gap:8px;overflow-x:auto;scroll-behavior:smooth;scrollbar-width:none;flex:1;padding:3px 0}
#kt-category-strip::-webkit-scrollbar{display:none}
#kt-category-strip button{white-space:nowrap;border:1px solid #ddd;background:#fff;padding:9px 12px;font-size:11px;font-weight:700;color:#333;cursor:pointer}
#kt-category-strip button.active{background:#3b1118;color:#fff;border-color:#3b1118}
#kt-cat-prev,#kt-cat-next{width:34px;height:34px;border:1px solid #ddd;background:#fff;font-weight:800;flex:0 0 auto;cursor:pointer}
#kt-home-catalogue .kt-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}
.kt-card{background:#fff;border:1px solid #e5e7eb;display:flex;flex-direction:column;min-width:0;overflow:hidden}
.kt-card img{width:100%;aspect-ratio:1/1;object-fit:contain;background:#f8f8f8}
.kt-card-body{padding:11px;display:flex;flex-direction:column;flex:1}
.kt-card-name{font-weight:800;font-size:14px;line-height:1.25;color:#321016;margin-bottom:4px}
.kt-card-cat{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#7b1e2b;font-weight:800;margin-bottom:6px}
.kt-moq{font-size:10px;color:#8a5a00;font-weight:800;background:#fff8e6;border:1px solid #f0d58a;padding:4px 6px;margin-bottom:7px}
.kt-packs{display:flex;flex-wrap:wrap;gap:5px;margin:3px 0 9px}
.kt-pack{border:1px solid #d1d5db;background:#fff;padding:5px 7px;font-size:10px;font-weight:800;cursor:pointer}
.kt-pack.active{border-color:#7b1e2b;background:#fff3f5;color:#7b1e2b}
.kt-add{margin-top:auto;width:100%;border:0;background:#7b1e2b;color:#fff;padding:9px 7px;font-size:10px;font-weight:800;text-transform:uppercase;cursor:pointer}
.kt-add:disabled{background:#ddd;color:#999;cursor:not-allowed}
#kt-order-bar{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:140;width:min(560px,calc(100% - 24px));background:#321016;color:#fff;border:1px solid #8a5a00;box-shadow:0 10px 30px rgba(0,0,0,.25);padding:10px 13px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-radius:999px}
#kt-order-bar button{border:0;background:#d6ad4d;color:#321016;font-weight:900;padding:8px 13px;border-radius:999px;cursor:pointer}
@media(max-width:700px){#kt-home-catalogue .kt-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.kt-card-name{font-size:12px}.kt-card-body{padding:8px}.kt-add{padding:8px 5px;font-size:9px}}
</style>'''
 block='''<!-- FINAL_SINGLE_CATALOGUE -->
<section id="kt-home-catalogue" aria-label="Wholesale product catalogue">
<div id="kt-category-nav"><button id="kt-cat-prev" type="button" aria-label="Previous categories">‹</button><div id="kt-category-strip" role="tablist"></div><button id="kt-cat-next" type="button" aria-label="Next categories">›</button></div>
<div id="kt-catalogue-count" class="text-xs text-gray-500 mb-3 text-left"></div><div id="kt-catalogue-grid" class="kt-grid"></div>
</section>
<div id="kt-order-bar" aria-label="Your Order"><span>0 products selected</span><button type="button" onclick="openCart()">View Order</button></div>
'''
 marker='<!-- How to Order note -- kept below the catalogue'
 if marker not in s: raise SystemExit('catalogue insertion marker not found')
 s=s.replace(marker,css+block+marker,1)
 if 'assets/catalogue.js' not in s:s=s.replace('</body>','<script src="assets/catalogue.js"></script>\n</body>',1)
 p.write_text(s)
c=Path('assets/cart.js'); cs=c.read_text(); sig='window.addToCart = function(name, packSize) {'
if sig not in cs: raise SystemExit('expected cart addToCart signature not found')
cs=cs.replace(sig,'window.addToCart = function(name, packSize, openDrawer = true) {',1); needle='    openCart();\n};'
if needle not in cs: raise SystemExit('expected cart openCart tail not found')
cs=cs.replace(needle,'    if (openDrawer) openCart();',1)
c.write_text(cs)
PY
cat > assets/catalogue.js <<'EOF'
(() => {
 const S={category:'',search:'',packs:new Map()};
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const products=()=>typeof allProducts!=='undefined'?allProducts.filter(p=>!p.isResource):[];
 const countCart=()=>{try{return JSON.parse(localStorage.getItem('kt_cart_v1')||'[]').reduce((n,x)=>n+(Number(x.qty)||0),0)}catch(e){return 0}};
 const bar=()=>{const n=countCart(),e=document.querySelector('#kt-order-bar span');if(e)e.textContent=`${n} product${n===1?'':'s'} selected`};
 const refreshBarLater=()=>setTimeout(()=>{const n=countCart(),e=document.querySelector('#kt-order-bar span');if(e)e.textContent=`${n} product${n===1?'':'s'} selected`},500);
 const scrollCats=(dir)=>{const st=document.getElementById('kt-category-strip');if(!st)return;const max=Math.max(0,st.scrollWidth-st.clientWidth);st.scrollLeft=Math.max(0,Math.min(max,st.scrollLeft+dir*st.clientWidth));};
 const render=()=>{const grid=document.getElementById('kt-catalogue-grid');if(!grid)return;const cats=[...new Set(products().map(p=>p.category))],strip=document.getElementById('kt-category-strip');strip.innerHTML=['',...cats].map(c=>`<button type="button" data-cat="${esc(c)}" class="${S.category===c?'active':''}">${esc(c||'All Products')}</button>`).join('');strip.querySelectorAll('button').forEach(b=>b.onclick=()=>{S.category=b.dataset.cat;render()}); const q=S.search.trim().toLowerCase(),list=products().filter(p=>(!S.category||p.category===S.category)&&(!q||[p.name,p.category,p.desc].join(' ').toLowerCase().includes(q))); document.getElementById('kt-catalogue-count').textContent=`${list.length} product${list.length===1?'':'s'}`+(S.category?' · '+S.category:'')+(S.search?' · “'+S.search+'”':''); grid.innerHTML=list.map(p=>{const packs=p.packSizes||[],sel=S.packs.get(p.name)||packs[0]||null;return `<article class="kt-card"><img src="${esc(p.images?.[0]||'')}" alt="${esc(p.name)}" loading="lazy"><div class="kt-card-body"><div class="kt-card-name">${esc(p.name)}</div><div class="kt-card-cat">${esc(p.category)}</div>${(Number(p.minQty)||1)>1?`<div class="kt-moq">Minimum order: ${Number(p.minQty)} units</div>`:''}${packs.length?`<div class="kt-packs">${packs.map((x,i)=>`<button type="button" class="kt-pack ${sel===x?'active':''}" data-name="${esc(p.name)}" data-i="${i}">${esc(x.size)}${x.price?' · '+esc(x.price):''}</button>`).join('')}</div>`:''}<button type="button" class="kt-add" data-name="${esc(p.name)}" ${p.inStock===false?'disabled':''}>${p.inStock===false?'Out of Stock':'Add to Order'}</button></div></article>`}).join(''); grid.querySelectorAll('.kt-pack').forEach(b=>b.onclick=()=>{const p=products().find(x=>x.name===b.dataset.name);if(p)S.packs.set(p.name,(p.packSizes||[])[+b.dataset.i]);render()}); grid.querySelectorAll('.kt-add').forEach(b=>b.onclick=()=>{const p=products().find(x=>x.name===b.dataset.name);if(!p)return;window.addToCart(p.name,S.packs.get(p.name)||(p.packSizes||[])[0]||null,false);refreshBarLater();b.textContent='Added ✓';setTimeout(()=>{if(document.body.contains(b))b.textContent='Add to Order'},900)});bar()};
 const init=()=>{const s=document.getElementById('product-search');if(s){s.oninput=null;s.removeAttribute('oninput');s.addEventListener('input',()=>{S.search=s.value;render()})}document.getElementById('kt-cat-prev').onclick=()=>scrollCats(-1);document.getElementById('kt-cat-next').onclick=()=>scrollCats(1);bar();const t=setInterval(()=>{if(typeof allProducts!=='undefined'&&allProducts.length){clearInterval(t);render()}},200)};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
EOF
node --check assets/cart.js
node --check assets/catalogue.js
rm -rf node_modules package.json package-lock.json
