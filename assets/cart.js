// ── Shared cart / checkout logic ────────────────────────────────────────
// Loaded by both index.html (full catalog app) and every /s/*.html product
// page (single-product page). Keep this the ONLY copy of this logic —
// index.html and /s/ pages must never have their own separate versions.
//
// On index.html, product lookups fall back to the full `allProducts` array.
// On a /s/ page, there is no full catalog fetch — the single product's data
// is embedded inline as `window.__PRODUCT__` by the page generator.

const firebaseConfig = {
    apiKey:            "AIzaSyDmP8suwaaxxklzxLn3tYx0TsYTDAzaank",
    authDomain:        "khyber-traders.firebaseapp.com",
    projectId:         "khyber-traders",
    storageBucket:     "khyber-traders.firebasestorage.app",
    messagingSenderId: "292355832428",
    appId:             "1:292355832428:web:5983dcc70914cf18fb3649"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

const BASE_URL = 'https://animalhealth.pk';
let shopSettings = { minOrderValue: 0 };
let cart = [];
let _pdpPackSize = null;

// Cart persistence: items are self-contained snapshots (name, price, pack
// size, image, qty) taken at add-time, not live references to product data,
// so writing/reading the whole array is safe on both index.html and every
// /s/ page. Fails silently if storage is unavailable (private browsing,
// quota) -- the cart still works in-memory for that session either way.
const CART_STORAGE_KEY = 'kt_cart_v1';
function saveCartToStorage() {
    try { localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart)); } catch (e) {}
}
function restoreCartFromStorage() {
    try {
        const raw = localStorage.getItem(CART_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            cart = parsed.filter(x => x && typeof x === 'object' && typeof x.name === 'string' && typeof x.key === 'string');
        }
    } catch (e) {}
}

function parsePrice(str) {
    if (!str) return null;
    const m = str.replace(/,/g, '').match(/\d+/);
    return m ? parseInt(m[0]) : null;
}
function formatPKR(num) {
    return 'Rs. ' + num.toLocaleString('en-PK');
}

function findProduct(name) {
    if (window.__PRODUCT__ && window.__PRODUCT__.name === name) return window.__PRODUCT__;
    if (typeof allProducts !== 'undefined') return allProducts.find(x => x.name === name);
    return null;
}

function getCleanSlug(name) {
    if (!name) return '';
    return name.toLowerCase().replace(/&/g, 'and').replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

// Mirrors cat_title() in sync_products.yml so share captions match the
// category-page headings instead of shouting in ALL CAPS.
function catTitle(cat) {
    return (cat || '').replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .replace(/\bAnd\b/g, 'and').replace(/\bFor\b/g, 'for').replace(/\bOf\b/g, 'of');
}

async function fetchSettings() {
    try {
        const doc = await db.collection('settings').doc('shop').get();
        if (doc.exists) shopSettings = { ...shopSettings, ...doc.data() };
        const note = document.getElementById('cart-min-order-note');
        if (note && shopSettings.minOrderValue > 0) {
            note.innerHTML = 'Minimum order value for delivery: <strong>' + formatPKR(shopSettings.minOrderValue) + '</strong><br>Delivery Charges Apply according to your area and vehicle';
            note.classList.remove('hidden');
        }
        const policyLine = document.getElementById('policy-min-order-line');
        const policyVal  = document.getElementById('policy-min-order');
        if (policyLine && policyVal && shopSettings.minOrderValue > 0) {
            policyVal.textContent = formatPKR(shopSettings.minOrderValue);
            policyLine.classList.remove('hidden');
        }
        const coLine = document.getElementById('checkout-min-order-line');
        const coVal  = document.getElementById('checkout-min-order');
        if (coLine && coVal && shopSettings.minOrderValue > 0) {
            coVal.textContent = formatPKR(shopSettings.minOrderValue);
            coLine.classList.remove('hidden');
        }
        if (typeof generateTiles === 'function' && typeof allProducts !== 'undefined' && allProducts.length) generateTiles();
    } catch (e) { /* settings not yet configured — silent */ }
}

function openCart() {
    document.getElementById('cart-overlay').classList.remove('hidden');
    document.getElementById('cart-drawer').classList.add('open');
    renderCart();
    const list = document.getElementById('cart-items-list');
    if (list && !list._scrollBound) {
        list.addEventListener('scroll', updateCartScrollFade);
        list._scrollBound = true;
    }
    if (typeof trapFocus === 'function') trapFocus(document.getElementById('cart-drawer'));
}
function closeCart() {
    if (typeof releaseFocusTrap === 'function') releaseFocusTrap();
    document.getElementById('cart-overlay').classList.add('hidden');
    document.getElementById('cart-drawer').classList.remove('open');
}
window.addToCart = function(name, packSize) {
    const p = findProduct(name);
    if (!p || p.inStock === false) return;
    if (p.packSizes && p.packSizes.length > 1 && !packSize) {
        if (typeof closeCategoryModal === 'function') closeCategoryModal();
        if (typeof openProductDetailPage === 'function') { openProductDetailPage(p); return; }
        return;
    }
    const ps  = packSize || (p.packSizes && p.packSizes.length === 1 ? p.packSizes[0] : null);
    const key = name + (ps ? '‖' + ps.size : '');
    const minQty = p.minQty || 1;
    const existing = cart.find(x => x.key === key);
    if (existing) { existing.qty++; } else {
        cart.push({ key, name: p.name, category: p.category, packSize: ps, priceDisplay: ps ? ps.price : (p.priceDisplay || ''), image: p.images[0] || '', minQty, qty: minQty });
    }
    if (typeof gtag !== 'undefined') {
        gtag('event', 'add_to_cart', {
            item_name: p.name,
            item_category: p.category,
            value: parsePrice(ps ? ps.price : p.priceDisplay) || undefined,
            currency: 'PKR'
        });
    }
    saveCartToStorage();
    updateCartBadge();
    openCart();
};
window.removeFromCart = function(idx) {
    cart.splice(idx, 1);
    saveCartToStorage();
    updateCartBadge();
    renderCart();
};
window.updateCartQty = function(idx, qty) {
    const item = cart[idx];
    if (!item) return;
    const min = item.minQty || 1;
    if (qty < 1 && min === 1) { window.removeFromCart(idx); return; }
    if (qty < min) {
        item.qty = min;
        showCartToast('Minimum order: ' + min + ' units for this item');
    } else {
        item.qty = qty;
    }
    saveCartToStorage();
    updateCartBadge();
    renderCart();
};
function showCartToast(text) {
    const toast = document.getElementById('cart-toast');
    if (!toast) return;
    toast.textContent = text;
    toast.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.add('hidden'), 2200);
}
function updateCartBadge() {
    const total = cart.reduce((s, x) => s + x.qty, 0);
    const badge = document.getElementById('cart-badge');
    if (badge) {
        badge.textContent = total > 9 ? '9+' : String(total);
        total > 0 ? badge.classList.remove('hidden') : badge.classList.add('hidden');
    }
}
function updateCartScrollFade() {
    const list = document.getElementById('cart-items-list');
    const fade = document.getElementById('cart-scroll-fade');
    if (!list || !fade) return;
    const canScroll = list.scrollHeight > list.clientHeight + 4;
    const atBottom  = list.scrollHeight - list.scrollTop <= list.clientHeight + 8;
    fade.style.opacity = (canScroll && !atBottom) ? '1' : '0';
}
function renderCart() {
    const filled = document.getElementById('cart-filled');
    const empty  = document.getElementById('cart-empty-state');
    const list   = document.getElementById('cart-items-list');
    if (cart.length === 0) { filled.classList.add('hidden'); empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');
    filled.classList.remove('hidden');
    let totalAmt = 0, allPriced = cart.length > 0;
    list.innerHTML = cart.map((item, idx) => {
        const unitPrice = parsePrice(item.priceDisplay);
        if (unitPrice !== null) totalAmt += unitPrice * item.qty;
        else allPriced = false;
        return `<div class="flex items-center gap-2 bg-gray-50 border border-gray-100 p-2">
            ${item.image ? `<img src="${item.image}" class="w-12 h-12 object-cover flex-shrink-0 border border-gray-200">` : '<div class="w-12 h-12 bg-gray-200 flex-shrink-0 flex items-center justify-center"><i class="fas fa-box-open text-gray-300 text-sm"></i></div>'}
            <div class="flex-1 min-w-0">
                <div class="font-bold text-brand-dark text-[11px] leading-tight line-clamp-2">${item.name}</div>
                ${item.packSize ? '<div class="text-[9px] text-gray-600 font-semibold mt-0.5">' + item.packSize.size + '</div>' : '<div class="text-[9px] text-gray-600 capitalize mt-0.5">' + item.category + '</div>'}
                ${item.priceDisplay ? '<div class="text-[10px] font-bold text-brand-maroon">' + item.priceDisplay + (item.qty > 1 ? ' ×' + item.qty : '') + '</div>' : ''}
                ${(item.minQty || 1) > 1 ? '<div class="text-[8px] text-amber-700 font-bold uppercase tracking-wide mt-0.5">Min ' + item.minQty + ' units</div>' : ''}
            </div>
            <div class="flex items-center gap-0.5 flex-shrink-0">
                <button onclick="window.updateCartQty(${idx},${item.qty-1})" class="w-7 h-7 bg-gray-200 hover:bg-brand-maroon hover:text-white font-bold text-sm flex items-center justify-center transition">−</button>
                <span class="w-6 text-center text-xs font-bold">${item.qty}</span>
                <button onclick="window.updateCartQty(${idx},${item.qty+1})" class="w-7 h-7 bg-gray-200 hover:bg-brand-maroon hover:text-white font-bold text-sm flex items-center justify-center transition">+</button>
                <button onclick="window.removeFromCart(${idx})" class="w-7 h-7 text-gray-300 hover:text-red-500 text-sm flex items-center justify-center transition ml-0.5"><i class="fas fa-trash-alt"></i></button>
            </div>
        </div>`;
    }).join('') + (cart.length > 0 ? `<div class="flex justify-between items-center border-t border-dashed border-gray-300 pt-2 mt-1 px-1">
            <span class="text-[10px] font-bold text-gray-700 uppercase tracking-widest">Estimated Total</span>
            <span class="text-sm font-bold text-brand-maroon">${totalAmt > 0 ? (allPriced ? formatPKR(totalAmt) : '~ ' + formatPKR(totalAmt) + '+') : '—'}</span>
        </div>` : '');
    setTimeout(updateCartScrollFade, 0);
}
function clearCart() {
    if (!cart.length) return;
    cart = [];
    saveCartToStorage();
    updateCartBadge();
    renderCart();
}
function openCheckout() {
    if (!cart.length) return;
    let totalAmt = 0, allPriced = true;
    const rows = cart.map(item => {
        const up = parsePrice(item.priceDisplay);
        if (up !== null) totalAmt += up * item.qty; else allPriced = false;
        return `<div class="flex justify-between items-start gap-3 px-4 py-2.5 border-b border-gray-50">
            <div class="min-w-0">
                <div class="text-xs font-semibold text-brand-dark leading-snug">${item.name}${item.packSize ? ' <span class="text-gray-500 font-normal">(' + item.packSize.size + ')</span>' : ''}</div>
                <div class="text-[11px] text-gray-600 mt-0.5">${item.qty} × ${item.priceDisplay || 'price on confirmation'}</div>
            </div>
            <div class="text-xs font-bold text-brand-maroon whitespace-nowrap pt-0.5">${up !== null ? formatPKR(up * item.qty) : '—'}</div>
        </div>`;
    }).join('');
    document.getElementById('checkout-items').innerHTML = rows +
        `<div class="flex justify-between items-center px-4 py-3 bg-gray-50">
            <span class="text-[10px] font-bold uppercase tracking-widest text-gray-700">${allPriced ? 'Total' : 'Approx. Total'}</span>
            <span class="text-base font-bold text-brand-maroon">${totalAmt > 0 ? formatPKR(totalAmt) + (allPriced ? '' : '+') : '—'}</span>
        </div>`;
    document.getElementById('checkout-screen').classList.remove('hidden');
    if (typeof gtag !== 'undefined') gtag('event', 'begin_checkout', { value: totalAmt, currency: 'PKR' });
    if (typeof trapFocus === 'function') trapFocus(document.getElementById('checkout-screen'));
}
function closeCheckout() {
    if (typeof releaseFocusTrap === 'function') releaseFocusTrap();
    document.getElementById('checkout-screen').classList.add('hidden');
}
function checkoutViaWhatsApp() {
    if (!cart.length) return;
    const nameEl = document.getElementById('cart-customer-name');
    const phoneEl = document.getElementById('cart-customer-phone');
    const cityEl = document.getElementById('cart-customer-city');
    const addressEl = document.getElementById('cart-customer-address');
    const name    = nameEl.value.trim();
    const phone   = phoneEl.value.trim();
    const city    = cityEl.value.trim();
    const address = addressEl.value.trim();
    const missing = [];
    if (!name) missing.push(['Name', nameEl]);
    if (!phone) missing.push(['Contact number', phoneEl]);
    if (!city) missing.push(['City / Area', cityEl]);
    if (!address) missing.push(['Delivery address', addressEl]);
    if (missing.length) {
        alert('Please fill in: ' + missing.map(m => m[0]).join(', '));
        missing[0][1].focus();
        return;
    }
    const itemCount = cart.reduce((s, x) => s + x.qty, 0);
    let totalAmt = 0, allPriced = cart.length > 0;
    const lines = cart.map((x, i) => {
        const up = parsePrice(x.priceDisplay);
        if (up !== null) totalAmt += up * x.qty; else allPriced = false;
        const packStr = x.packSize ? ' (' + x.packSize.size + ')' : '';
        let detail = '';
        if (x.priceDisplay) {
            if (x.qty > 1 && up !== null) {
                detail = '\n   Qty: ' + x.qty + ' x ' + x.priceDisplay + ' = *' + formatPKR(up * x.qty) + '*';
            } else if (x.qty > 1) {
                detail = '\n   Qty: ' + x.qty + ' x ' + x.priceDisplay;
            } else {
                detail = '  — ' + x.priceDisplay;
            }
        } else if (x.qty > 1) {
            detail = '\n   Qty: ' + x.qty;
        }
        return (i+1) + '. ' + x.name + packStr + detail;
    }).join('\n');
    const SEP = '──────────';
    let msg = '🛒 *Order Request — Khyber Traders*\n' + SEP + '\n';
    msg += '👤 ' + name + '\n';
    msg += '📞 ' + phone + '\n';
    msg += '📍 ' + city + (address ? ', ' + address : '') + '\n';
    msg += SEP + '\n';
    msg += '*Items (' + itemCount + ' unit' + (itemCount !== 1 ? 's' : '') + '):*\n' + lines + '\n' + SEP + '\n';
    if (totalAmt > 0) msg += '💰 ' + (allPriced ? 'Total' : 'Approx. Total') + ': *' + formatPKR(totalAmt) + (allPriced ? '' : '+') + '*\n' + SEP + '\n';
    msg += 'Please confirm availability and payment details.';
    msg += '\n' + SEP + '\n';
    msg += '📋 *Order & Delivery Terms*\n';
    if (shopSettings.minOrderValue > 0) msg += '• Minimum order for delivery: *' + formatPKR(shopSettings.minOrderValue) + '*\n';
    msg += '• Delivery charges depend on area and vehicle\n';
    msg += '• Order will be dispatched after payment confirmation\n';
    msg += '• Delivery time will be confirmed by our WhatsApp representative\n';
    msg += '• Cold chain items (vaccines) are only delivered within Karachi';
    window.open('https://wa.me/923352999006?text=' + encodeURIComponent(msg), '_blank');
    if (typeof gtag !== 'undefined') gtag('event', 'generate_lead', { method: 'whatsapp_cart', value: itemCount });
    clearCart();
    closeCheckout();
    closeCart();
}
window.inquireProduct = function(name, category, link) {
    const text = '❓ *Question about:* ' + name + '\n🔗 ' + link + '\n\nHi, I’d like to know more about this product before ordering.';
    window.open('https://wa.me/923352999006?text=' + encodeURIComponent(text), '_blank');
    if (typeof gtag !== 'undefined') gtag('event', 'generate_lead', { item_name: name, item_category: category });
};
window.checkoutProduct = function(name, packSize) {
    window.addToCart(name, packSize);
    if (cart.length) openCheckout();
};
window.shareProductNative = async (event, name) => {
    const p = findProduct(name);
    if (!p) return;
    const slug = getCleanSlug(name);
    const shareLink = `https://animalhealth.pk/s/${slug}.html`;
    const imgUrl = (p.images && p.images[0]) || '';
    const cleanDesc = (p.desc || '').replace(/<[^>]*>?/gm, '').trim();
    if (typeof gtag !== 'undefined') gtag('event', 'share', { method: 'whatsapp', content_type: 'product', content_id: name });
    const btn = event.currentTarget;
    const priceLine = (p.packSizes && p.packSizes.length)
        ? `\n💰 ${p.packSizes.map(ps => `${ps.size}: ${ps.price}`).join(', ')}`
        : p.priceDisplay ? `\n💰 ${p.priceDisplay}` : '';
    const descLine = cleanDesc ? `\n📝 ${cleanDesc}` : '';
    const caption = p.isResource
        ? `📄 *${name.replace('Useful Information - ', '')}*\nFree downloadable reference chart\n\n📥 ${shareLink}\n\n_Khyber Traders — Wholesale Veterinary Pharmacy, Karachi_`
        : `📦 *${name}*\n📂 ${catTitle(p.category)}${priceLine}${descLine}\n\n🔗 ${shareLink}\n\n_Khyber Traders — Wholesale Veterinary Pharmacy, Karachi_`;
    btn.classList.add('btn-loading');
    try {
        if (imgUrl && navigator.canShare && navigator.share) {
            const tempImg = new Image();
            tempImg.crossOrigin = "anonymous";
            tempImg.src = imgUrl + (imgUrl.includes('?') ? '&' : '?') + 't=' + new Date().getTime();
            await new Promise((res, rej) => {
                tempImg.onload = res;
                tempImg.onerror = rej;
                setTimeout(rej, 4500);
            });
            const canvas = document.getElementById('share-canvas');
            canvas.width = tempImg.width;
            canvas.height = tempImg.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(tempImg, 0, 0);
            const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.8));
            const file = new File([blob], `${slug}.jpg`, { type: 'image/jpeg' });
            if (navigator.canShare({ files: [file] })) {
                await navigator.share({ files: [file], text: caption });
                btn.classList.remove('btn-loading');
                return;
            }
        }
        if (navigator.share) await navigator.share({ text: caption });
        else { await navigator.clipboard.writeText(caption); alert("Details copied!"); }
    } catch (e) {
        if (e && e.name === 'AbortError') { btn.classList.remove('btn-loading'); return; }
        window.open(`https://wa.me/?text=${encodeURIComponent(caption)}`, '_blank');
    }
    btn.classList.remove('btn-loading');
};

window.openCart = openCart;
window.closeCart = closeCart;
window.clearCart = clearCart;
window.openCheckout = openCheckout;
window.closeCheckout = closeCheckout;
window.checkoutViaWhatsApp = checkoutViaWhatsApp;

restoreCartFromStorage();
updateCartBadge();

/* Single homepage wholesale catalogue controller. */
(function initSingleHomepageCatalogue(){
  function isHome(){return !!document.getElementById('tiles-container') && !!document.getElementById('product-search');}
  if(!isHome()) return;
  const state={category:'All',query:'',qty:Object.create(null),installed:false};
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cat=p=>String(p.category||'Other').trim()||'Other';
  const products=()=>typeof allProducts!=='undefined'&&Array.isArray(allProducts)?allProducts:[];
  const key=p=>p.name;
  const minQty=p=>Math.max(1,Number(p.minQty)||1);
  const totalUnits=()=>cart.reduce((n,x)=>n+(Number(x.qty)||0),0);
  const showToast=text=>{let el=document.getElementById('kt-toast');if(!el){el=document.createElement('div');el.id='kt-toast';el.className='kt-toast';el.setAttribute('role','status');document.body.appendChild(el);}el.textContent=text;el.classList.add('show');clearTimeout(el._timer);el._timer=setTimeout(()=>el.classList.remove('show'),1800);};
  function installStyles(){if(document.getElementById('kt-single-catalogue-style'))return;const s=document.createElement('style');s.id='kt-single-catalogue-style';s.textContent=`
#category-modal{display:none!important}#search-results{display:none!important}#tiles-container.kt-source-hidden{display:none!important}
#kt-catalogue-controls{max-width:1280px;margin:0 auto;padding:0 24px 8px;text-align:left}#kt-category-nav{position:relative;display:flex;align-items:center;gap:6px}#kt-category-strip{display:flex;gap:7px;overflow-x:auto;padding:4px 0 8px;scrollbar-width:none;scroll-behavior:smooth;flex:1;min-width:0}#kt-category-strip::-webkit-scrollbar{display:none}.kt-cat{flex:0 0 auto;border:1px solid #d1d5db;background:#fff;border-radius:999px;padding:7px 13px;font:700 11px Manrope,sans-serif;cursor:pointer;color:#131313}.kt-cat.active{background:#131313;color:#fff;border-color:#131313}.kt-cat-arrow{flex:0 0 34px;width:34px;height:34px;border:1px solid #d1d5db;background:#fff;color:#131313;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;font:800 16px/1 Manrope,sans-serif;transition:background .15s,border-color .15s,opacity .15s;touch-action:manipulation}.kt-cat-arrow:hover:not(:disabled){background:#f3f4f6;border-color:#9ca3af}.kt-cat-arrow:disabled{opacity:.28;cursor:default}.kt-cat-arrow[hidden]{display:none}@media(max-width:767px){#kt-category-nav{gap:5px}.kt-cat-arrow{flex-basis:32px;width:32px;height:32px}}
#kt-home-catalogue{max-width:1280px;margin:0 auto;padding:8px 24px 110px;text-align:left}.kt-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;align-items:start}.kt-card{background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;display:flex;flex-direction:column;min-width:0}.kt-card:hover{border-color:#cfd2d6;box-shadow:0 7px 20px rgba(0,0,0,.06)}.kt-card-img{width:100%;height:190px;object-fit:contain;background:#fff;display:block;padding:10px}.kt-no-image{display:flex;align-items:center;justify-content:center;color:#9ca3af;font:600 12px Manrope,sans-serif;background:#f8f8f8}.kt-card-body{padding:12px;display:flex;flex-direction:column}.kt-card-meta{display:flex;justify-content:space-between;gap:8px;font:700 9px Manrope,sans-serif;text-transform:uppercase;letter-spacing:.07em;color:#6b7280;margin-bottom:7px}.kt-stock{color:#166534}.kt-stock.out{color:#b91c1c}.kt-card h3{font:800 15px/1.2 Archivo,Manrope,sans-serif;color:#131313;margin:0;min-height:36px}.kt-card-name-link{color:inherit;text-decoration:none}.kt-card-name-link:hover{color:#131313;text-decoration:underline}.kt-brand{font:600 10px Manrope,sans-serif;color:#6b7280;margin-top:4px;min-height:14px}.kt-desc{font:500 11px/1.4 Manrope,sans-serif;color:#4b5563;margin-top:6px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.kt-view-row{display:flex;gap:6px;margin-top:8px}.kt-view,.kt-share{flex:1;border:1px solid #d1d5db;background:#fff;color:#131313;border-radius:5px;padding:7px;font:700 10px Manrope,sans-serif;text-transform:uppercase;letter-spacing:.04em;cursor:pointer}.kt-view:hover,.kt-share:hover{border-color:#131313;background:#f7f7f7}.kt-share-cat{border:1px solid #d1d5db;background:#fff;color:#131313;border-radius:5px;padding:5px 10px;font:700 9px Manrope,sans-serif;text-transform:uppercase;letter-spacing:.04em;cursor:pointer;white-space:nowrap;flex:0 0 auto}.kt-share-cat:hover{border-color:#131313;background:#f7f7f7}.kt-packs{display:flex;flex-wrap:wrap;gap:5px;margin-top:10px}.kt-pack{border:1px solid #d1d5db;background:#fff;border-radius:5px;padding:7px 8px;font:700 10px/1.1 Manrope,sans-serif;color:#131313;cursor:pointer}.kt-pack:hover,.kt-pack.selected{border-color:#131313;background:#f7f7f7}.kt-pack span{display:block;color:#6b7280;font-size:9px;margin-top:2px}.kt-price{font:600 11px Manrope,sans-serif;color:#4b5563;margin-top:10px}.kt-buy-row{display:flex;gap:7px;margin-top:12px}.kt-qty{display:flex;align-items:center;border:1px solid #d1d5db;border-radius:5px;overflow:hidden;height:38px}.kt-qty-btn{width:31px;height:100%;border:0;background:#f3f4f6;font-size:17px;font-weight:800;cursor:pointer}.kt-qty-value{min-width:31px;text-align:center;font:800 12px Manrope,sans-serif}.kt-add{flex:1;height:38px;border:0;border-radius:5px;background:#131313;color:#fff;font:800 11px Manrope,sans-serif;cursor:pointer}.kt-add:hover{background:#000}.kt-add:disabled{opacity:.45;cursor:not-allowed}.kt-moq{font:700 9px Manrope,sans-serif;color:#92400e;text-transform:uppercase;letter-spacing:.05em;margin-top:6px}.kt-empty{padding:42px 20px;text-align:center;border:1px dashed #d1d5db;border-radius:8px;color:#6b7280;font:600 13px Manrope,sans-serif}
#kt-order-bar{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:80;width:min(680px,calc(100% - 24px));background:#131313;color:#fff;border:1px solid #333;border-radius:9px;box-shadow:0 12px 32px rgba(0,0,0,.24);display:none;align-items:center;justify-content:space-between;gap:14px;padding:11px 13px}#kt-order-bar.show{display:flex}.kt-review{border:0;border-radius:5px;background:#fff200;color:#131313;font:800 12px Manrope,sans-serif;padding:10px 15px;cursor:pointer;white-space:nowrap}.kt-added{background:#166534!important}.kt-toast{position:fixed;right:18px;bottom:78px;z-index:90;background:#131313;color:#fff;padding:10px 14px;border-radius:6px;font:700 12px Manrope,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.2);opacity:0;transform:translateY(8px);pointer-events:none;transition:.18s}.kt-toast.show{opacity:1;transform:translateY(0)}
@media(max-width:1023px){.kt-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:767px){#kt-catalogue-controls{padding:0 12px 6px}#kt-home-catalogue{padding:6px 12px 105px}.kt-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.kt-card-img{height:145px;padding:7px}.kt-card-body{padding:9px}.kt-card h3{font-size:13px;min-height:32px}.kt-desc{display:none}.kt-view,.kt-share{font-size:9px;padding:6px}.kt-share-cat{font-size:8px;padding:4px 8px}.kt-pack{padding:6px;font-size:9px}.kt-buy-row{gap:5px}.kt-qty-btn{width:27px}.kt-qty-value{min-width:26px}.kt-add{font-size:10px}#kt-order-bar{bottom:9px}.kt-toast{right:12px;bottom:70px}}
`;document.head.appendChild(s);}
  function ensureControls(){const search=document.getElementById('product-search');if(!search)return;if(!search.dataset.ktBound){search.dataset.ktBound='1';search.removeAttribute('oninput');search.setAttribute('aria-label','Search wholesale products');search.addEventListener('input',()=>{state.query=search.value.trim().toLowerCase();render();});}if(!document.getElementById('kt-catalogue-controls')){const c=document.createElement('div');c.id='kt-catalogue-controls';c.innerHTML='<div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><span style="font:800 10px Manrope,sans-serif;text-transform:uppercase;letter-spacing:.12em;color:#6b7280;padding:2px 0 3px">Browse categories</span><button type="button" id="kt-share-category" class="kt-share-cat" hidden>Share category</button></div><div id="kt-category-nav"><button type="button" class="kt-cat-arrow" id="kt-cat-prev" aria-label="Previous categories">‹</button><div id="kt-category-strip" role="tablist" aria-label="Product categories"></div><button type="button" class="kt-cat-arrow" id="kt-cat-next" aria-label="Next categories">›</button></div>';search.closest('.mb-4')?.insertAdjacentElement('afterend',c);}const source=document.getElementById('tiles-container');if(source)source.classList.add('kt-source-hidden');const oldHeading=document.querySelector('#products h2');if(oldHeading)oldHeading.textContent='Wholesale Catalogue';const oldEyebrow=oldHeading?.previousElementSibling;if(oldEyebrow)oldEyebrow.textContent='Products';if(!document.getElementById('kt-home-catalogue')){const root=document.createElement('div');root.id='kt-home-catalogue';root.setAttribute('aria-label','Wholesale product catalogue');(source||document.getElementById('products'))?.insertAdjacentElement('afterend',root);}if(!document.getElementById('kt-order-bar')){const bar=document.createElement('div');bar.id='kt-order-bar';bar.innerHTML='<div><strong id="kt-order-products">0 products</strong><span> · </span><span id="kt-order-units">0 units</span></div><button type="button" class="kt-review">Review order →</button>';document.body.appendChild(bar);bar.querySelector('.kt-review').addEventListener('click',()=>openCart());}}
  function categories(ps){const list=[...new Set(ps.map(cat))].sort((a,b)=>a.localeCompare(b));const strip=document.getElementById('kt-category-strip');if(!strip)return;strip.innerHTML=['All',...list].map(c=>`<button type="button" class="kt-cat ${state.category.toLowerCase()===c.toLowerCase()?'active':''}" data-cat="${esc(c)}">${esc(catTitle(c))}</button>`).join('');strip.querySelectorAll('.kt-cat').forEach(b=>b.addEventListener('click',()=>{state.category=b.dataset.cat;render();}));const shareBtn=document.getElementById('kt-share-category');if(shareBtn){if(state.category==='All'){shareBtn.hidden=true;}else{shareBtn.hidden=false;shareBtn.textContent='Share "'+catTitle(state.category)+'"';shareBtn.dataset.cat=state.category;}if(!shareBtn.dataset.bound){shareBtn.dataset.bound='1';shareBtn.addEventListener('click',(ev)=>{if(typeof shareCategory==='function'&&shareBtn.dataset.cat)shareCategory(ev,shareBtn.dataset.cat);});}}const prev=document.getElementById('kt-cat-prev'),next=document.getElementById('kt-cat-next');const sync=()=>{const overflow=strip.scrollWidth>strip.clientWidth+2;if(prev)prev.hidden=!overflow;if(next)next.hidden=!overflow;if(overflow){if(prev)prev.disabled=strip.scrollLeft<=2;if(next)next.disabled=strip.scrollLeft+strip.clientWidth>=strip.scrollWidth-2;}};if(prev&&!prev.dataset.bound){prev.dataset.bound='1';prev.addEventListener('click',()=>strip.scrollBy({left:-Math.max(180,strip.clientWidth*.65),behavior:'smooth'}));}if(next&&!next.dataset.bound){next.dataset.bound='1';next.addEventListener('click',()=>strip.scrollBy({left:Math.max(180,strip.clientWidth*.65),behavior:'smooth'}));}if(!strip.dataset.arrowBound){strip.dataset.arrowBound='1';strip.addEventListener('scroll',sync,{passive:true});window.addEventListener('resize',sync);}requestAnimationFrame(sync);}
  function filtered(ps){return ps.filter(p=>(state.category==='All'||cat(p).toLowerCase()===state.category.toLowerCase())&&(!state.query||[p.name,p.category,p.brand,p.type,p.desc,p.description,p.keywords].filter(Boolean).join(' ').toLowerCase().includes(state.query)));}
  function card(p){const id=key(p),min=minQty(p),q=state.qty[id]||min,packs=Array.isArray(p.packSizes)?p.packSizes:[],img=p.images?.[0]||'';const slug=getCleanSlug(p.name);const link=`https://animalhealth.pk/s/${slug}.html`;const plainDesc=(p.desc||'').replace(/\n+/g,' ').trim();const packHtml=packs.length?packs.map((x,i)=>`<button type="button" class="kt-pack" data-pack-index="${i}">${esc(x.size||'Pack')} <span>${esc(x.price||'')}</span></button>`).join(''):`<div class="kt-price">${esc(p.priceDisplay||'Price on confirmation')}</div>`;return `<article class="kt-card" data-name="${esc(p.name)}"><a href="${esc(link)}" target="_blank" rel="noopener" aria-label="${esc(p.name)} — full details">${img?`<img class="kt-card-img" loading="lazy" src="${esc(img)}" alt="${esc(p.name)}">`:'<div class="kt-card-img kt-no-image">Product image</div>'}</a><div class="kt-card-body"><div class="kt-card-meta"><span>${esc(catTitle(cat(p)))}</span><span class="kt-stock ${p.inStock===false?'out':''}">${p.inStock===false?'Out of stock':'In stock'}</span></div><h3><a href="${esc(link)}" target="_blank" rel="noopener" class="kt-card-name-link">${esc(p.name)}</a></h3>${p.brand?`<div class="kt-brand">${esc(p.brand)}</div>`:'<div class="kt-brand"></div>'}${plainDesc?`<p class="kt-desc">${esc(plainDesc)}</p>`:''}<div class="kt-packs">${packHtml}</div><div class="kt-view-row"><button type="button" class="kt-view">View full details</button><button type="button" class="kt-share" aria-label="Share ${esc(p.name)}">Share</button></div><div class="kt-buy-row"><div class="kt-qty"><button type="button" class="kt-qty-btn" data-dir="-">−</button><span class="kt-qty-value">${q}</span><button type="button" class="kt-qty-btn" data-dir="+">+</button></div><button type="button" class="kt-add" ${p.inStock===false?'disabled':''}>Add to order</button></div>${min>1?`<div class="kt-moq">Minimum ${min} units</div>`:''}</div></article>`;}
  function add(p,el){const packs=Array.isArray(p.packSizes)?p.packSizes:[],selected=el.querySelector('.kt-pack.selected'),ps=selected?packs[Number(selected.dataset.packIndex)]:packs.length===1?packs[0]:null;if(packs.length>1&&!ps){showToast('Choose a pack size first');return;}const qty=Math.max(minQty(p),state.qty[key(p)]||minQty(p)),k=p.name+(ps?'‖'+ps.size:'');const existing=cart.find(x=>x.key===k);if(existing)existing.qty+=qty;else cart.push({key:k,name:p.name,category:p.category,packSize:ps,priceDisplay:ps?ps.price:(p.priceDisplay||''),image:p.images?.[0]||'',minQty:minQty(p),qty});saveCartToStorage();updateCartBadge();updateOrderBar();const b=el.querySelector('.kt-add');b.classList.add('kt-added');b.textContent='✓ Added';showToast('Added to your order');setTimeout(()=>{b.classList.remove('kt-added');b.textContent='Add to order';},900);}
  function render(){const ps=products();if(!ps.length)return;ensureControls();categories(ps);const visible=filtered(ps),root=document.getElementById('kt-home-catalogue');if(!root)return;root.innerHTML=visible.length?`<div class="kt-grid">${visible.map(card).join('')}</div>`:'<div class="kt-empty">No products match your search. Try another product name, brand or category.</div>';root.querySelectorAll('.kt-card').forEach(el=>{const p=ps.find(x=>x.name===el.dataset.name);if(!p)return;el.querySelectorAll('.kt-pack').forEach(b=>b.addEventListener('click',()=>{el.querySelectorAll('.kt-pack').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');}));el.querySelectorAll('.kt-qty-btn').forEach(b=>b.addEventListener('click',()=>{const m=minQty(p),cur=state.qty[key(p)]||m;state.qty[key(p)]=b.dataset.dir==='+'?cur+1:Math.max(m,cur-1);el.querySelector('.kt-qty-value').textContent=state.qty[key(p)];}));el.querySelector('.kt-add')?.addEventListener('click',()=>add(p,el));el.querySelector('.kt-view')?.addEventListener('click',()=>{if(typeof openProductByName==='function')openProductByName(p.name);});el.querySelector('.kt-share')?.addEventListener('click',(ev)=>{if(typeof shareProductNative==='function')shareProductNative(ev,p.name);});});updateOrderBar();}
  function updateOrderBar(){const bar=document.getElementById('kt-order-bar');if(!bar)return;const units=totalUnits();bar.classList.toggle('show',units>0);document.getElementById('kt-order-products').textContent=cart.length+(cart.length===1?' product':' products');document.getElementById('kt-order-units').textContent=units+(units===1?' unit':' units');}
  function install(){if(state.installed)return;state.installed=true;installStyles();ensureControls();const legacy=window.addToCart;window.addToCart=function(name,pack){legacy(name,pack);if(document.getElementById('cart-drawer')?.classList.contains('open'))closeCart();updateOrderBar();};const oldQty=window.updateCartQty;window.updateCartQty=function(i,q){oldQty(i,q);updateOrderBar();};const oldRemove=window.removeFromCart;window.removeFromCart=function(i){oldRemove(i);updateOrderBar();};const oldClear=window.clearCart;window.clearCart=function(){oldClear();updateOrderBar();};render();}
  let tries=0;function boot(){if(!isHome())return;if(products().length){install();return;}if(++tries<40)setTimeout(boot,500);}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
