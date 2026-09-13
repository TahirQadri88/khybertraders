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

    const mobileBar = document.getElementById('mobile-cart-bar');
    const mobileCount = document.getElementById('mobile-cart-count');
    const mobilePlural = document.getElementById('mobile-cart-plural');
    if (mobileBar) {
        mobileBar.classList.toggle('hidden', total === 0);
        mobileBar.classList.toggle('flex', total > 0);
        if (mobileCount) mobileCount.textContent = total;
        if (mobilePlural) mobilePlural.textContent = total === 1 ? '' : 's';
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

// ── Premium wholesale ordering layer ────────────────────────────────────
// This layer keeps the existing Firebase/product architecture intact while
// making the buying journey faster: search → choose pack → set quantity →
// add → continue browsing → review order → WhatsApp.
(function initWholesaleUX() {
    const isHome = !!document.getElementById('tiles-container') || !!document.getElementById('products');
    if (!isHome) return;

    const style = document.createElement('style');
    style.textContent = `
      #kt-wholesale-bar{position:sticky;top:72px;z-index:35;background:#fff;border-bottom:1px solid #e5e7eb;box-shadow:0 4px 16px rgba(0,0,0,.05)}
      #kt-wholesale-inner{max-width:1280px;margin:auto;padding:10px 24px}
      #kt-wholesale-search{width:100%;height:46px;border:1px solid #d1d5db;border-radius:6px;padding:0 16px;font:600 14px Manrope, sans-serif;color:#131313;outline:none}
      #kt-wholesale-search:focus{border-color:#131313;box-shadow:0 0 0 2px rgba(19,19,19,.08)}
      #kt-category-strip{display:flex;gap:8px;overflow-x:auto;padding:9px 0 2px;scrollbar-width:none}
      #kt-category-strip::-webkit-scrollbar{display:none}
      .kt-cat{white-space:nowrap;border:1px solid #d1d5db;background:#fff;border-radius:999px;padding:7px 13px;font:700 11px Manrope,sans-serif;cursor:pointer}
      .kt-cat.active{background:#131313;color:#fff;border-color:#131313}
      #kt-order-bar{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:80;width:min(680px,calc(100% - 24px));background:#131313;color:#fff;border:1px solid #333;border-radius:10px;box-shadow:0 12px 35px rgba(0,0,0,.24);display:none;align-items:center;justify-content:space-between;gap:14px;padding:12px 14px}
      #kt-order-bar.show{display:flex}
      #kt-order-bar button{border:0;border-radius:6px;background:#fff200;color:#131313;font:800 12px Manrope,sans-serif;padding:10px 15px;cursor:pointer;white-space:nowrap}
      .kt-added{background:#131313!important;color:#fff!important}
      .kt-toast{position:fixed;right:18px;bottom:82px;z-index:90;background:#131313;color:#fff;padding:10px 14px;border-radius:6px;font:700 12px Manrope,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.2);opacity:0;transform:translateY(8px);pointer-events:none;transition:.18s}
      .kt-toast.show{opacity:1;transform:translateY(0)}
      @media(max-width:767px){#kt-wholesale-bar{top:0}#kt-wholesale-inner{padding:9px 12px}#kt-order-bar{bottom:10px}.kt-toast{right:12px;bottom:74px}}
    `;
    document.head.appendChild(style);

    let activeCategory = 'All';
    let lastProducts = null;
    const qtyState = Object.create(null);

    function getProducts() {
        return (typeof allProducts !== 'undefined' && Array.isArray(allProducts)) ? allProducts : [];
    }
    function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }
    function categoryName(p) { return String(p.category || 'Other').trim(); }
    function searchable(p) {
        return [p.name,p.category,p.brand,p.type,p.desc,p.description,p.keywords]
            .filter(Boolean).join(' ').toLowerCase();
    }
    function currentCartTotal() { return cart.reduce((s,x) => s + (Number(x.qty)||0), 0); }
    function currentCartProducts() { return cart.length; }

    function ensureUI() {
        if (!document.getElementById('kt-wholesale-bar')) {
            const bar = document.createElement('div');
            bar.id = 'kt-wholesale-bar';
            bar.innerHTML = `<div id="kt-wholesale-inner">
              <div style="display:flex;align-items:center;gap:10px">
                <input id="kt-wholesale-search" type="search" autocomplete="off" placeholder="Search products, brands or categories…" aria-label="Search wholesale products">
              </div>
              <div id="category-strip-label" style="font:800 10px Manrope,sans-serif;text-transform:uppercase;letter-spacing:.12em;color:#6b7280;padding-top:9px">Browse categories</div>
              <div id="kt-category-strip" role="tablist" aria-label="Product categories"></div>
            </div>`;
            const anchor = document.getElementById('products') || document.getElementById('tiles-container');
            if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(bar, anchor);
        }
        if (!document.getElementById('kt-order-bar')) {
            const orderBar = document.createElement('div');
            orderBar.id = 'kt-order-bar';
            orderBar.innerHTML = `<div><strong id="kt-order-products">0 products</strong><span> · </span><span id="kt-order-units">0 units</span></div><button type="button" id="kt-review-order">Review order →</button>`;
            document.body.appendChild(orderBar);
            document.getElementById('kt-review-order').addEventListener('click', () => window.openCart());
        }
        if (!document.getElementById('kt-toast')) {
            const toast = document.createElement('div');
            toast.id = 'kt-toast';
            toast.className = 'kt-toast';
            toast.setAttribute('role','status');
            document.body.appendChild(toast);
        }
        bindSearch();
    }

    let searchBound = false;
    function bindSearch() {
        if (searchBound) return;
        const input = document.getElementById('kt-wholesale-search');
        if (!input) return;
        searchBound = true;
        input.addEventListener('input', () => renderEnhancedCatalog());
    }

    function buildCategories(products) {
        const cats = [...new Set(products.map(categoryName).filter(Boolean))].sort((a,b) => a.localeCompare(b));
        const strip = document.getElementById('kt-category-strip');
        if (!strip) return;
        strip.innerHTML = ['All', ...cats].map(cat => `<button type="button" class="kt-cat ${activeCategory.toLowerCase()===cat.toLowerCase()?'active':''}" data-cat="${esc(cat)}">${esc(catTitle(cat))}</button>`).join('');
        strip.querySelectorAll('.kt-cat').forEach(btn => btn.addEventListener('click', () => { activeCategory = btn.dataset.cat; renderEnhancedCatalog(); }));
    }

    function filtered(products) {
        const q = (document.getElementById('kt-wholesale-search')?.value || '').trim().toLowerCase();
        return products.filter(p => {
            const catOk = activeCategory === 'All' || categoryName(p).toLowerCase() === activeCategory.toLowerCase();
            return catOk && (!q || searchable(p).includes(q));
        });
    }

    function packButtons(p, idx) {
        const packs = Array.isArray(p.packSizes) ? p.packSizes : [];
        if (!packs.length) return p.priceDisplay ? `<div class="kt-pack-label">${esc(p.priceDisplay)}</div>` : '<div class="kt-pack-label">Price on confirmation</div>';
        return packs.map((ps,i) => `<button type="button" class="kt-pack" data-name="${esc(p.name)}" data-pack-index="${i}">${esc(ps.size || 'Pack')} <span>${esc(ps.price || '')}</span></button>`).join('');
    }

    function card(p, idx) {
        const id = String(idx);
        const min = Number(p.minQty) || 1;
        const q = qtyState[id] || min;
        const image = p.images && p.images[0] ? p.images[0] : '';
        const stock = p.inStock === false ? 'Out of stock' : 'In stock';
        return `<article class="kt-card" data-product-index="${id}">
          ${image ? `<img class="kt-card-img" loading="lazy" src="${esc(image)}" alt="${esc(p.name)}">` : '<div class="kt-card-img kt-no-image">Product image</div>'}
          <div class="kt-card-body">
            <div class="kt-card-meta"><span>${esc(catTitle(categoryName(p)))}</span><span class="kt-stock ${p.inStock===false?'out':''}">${stock}</span></div>
            <h3>${esc(p.name)}</h3>
            ${p.brand ? `<div class="kt-brand">${esc(p.brand)}</div>` : ''}
            <div class="kt-packs">${packButtons(p,idx)}</div>
            <div class="kt-buy-row">
              <div class="kt-qty"><button type="button" class="kt-qty-btn" data-qty="minus">−</button><span class="kt-qty-value">${q}</span><button type="button" class="kt-qty-btn" data-qty="plus">+</button></div>
              <button type="button" class="kt-add" ${p.inStock===false?'disabled':''}>Add to order</button>
            </div>
            ${min>1 ? `<div class="kt-moq">Minimum ${min} units</div>` : ''}
          </div>
        </article>`;
    }

    function injectCardStyle() {
        if (document.getElementById('kt-card-style')) return;
        const s = document.createElement('style');
        s.id = 'kt-card-style';
        s.textContent = `
          #tiles-container.kt-hidden-source{display:none!important}
          #kt-enhanced-catalog{max-width:1280px;margin:0 auto;padding:18px 24px 110px}
          .kt-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}
          .kt-card{background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;display:flex;flex-direction:column;min-width:0;transition:box-shadow .16s,border-color .16s}
          .kt-card:hover{border-color:#cfd2d6;box-shadow:0 8px 24px rgba(0,0,0,.07)}
          .kt-card-img{width:100%;height:190px;object-fit:contain;background:#fff;display:block;padding:10px}
          .kt-no-image{display:flex;align-items:center;justify-content:center;color:#9ca3af;font:600 12px Manrope,sans-serif;background:#f8f8f8}
          .kt-card-body{padding:12px;display:flex;flex-direction:column;flex:1}
          .kt-card-meta{display:flex;justify-content:space-between;gap:8px;font:700 9px Manrope,sans-serif;text-transform:uppercase;letter-spacing:.08em;color:#6b7280;margin-bottom:7px}
          .kt-stock{color:#166534}.kt-stock.out{color:#b91c1c}
          .kt-card h3{font:800 15px/1.2 Archivo,Manrope,sans-serif;color:#131313;margin:0;min-height:36px}
          .kt-brand{font:600 10px Manrope,sans-serif;color:#6b7280;margin-top:4px;min-height:14px}
          .kt-packs{display:flex;flex-wrap:wrap;gap:5px;margin-top:10px}
          .kt-pack{border:1px solid #d1d5db;background:#fff;border-radius:5px;padding:7px 8px;font:700 10px/1.1 Manrope,sans-serif;color:#131313;cursor:pointer}
          .kt-pack:hover,.kt-pack.selected{border-color:#131313;background:#f7f7f7}
          .kt-pack span{display:block;color:#6b7280;font-size:9px;margin-top:2px}
          .kt-pack-label{font:600 11px Manrope,sans-serif;color:#4b5563;margin-top:10px}
          .kt-buy-row{display:flex;gap:7px;margin-top:auto;padding-top:12px}
          .kt-qty{display:flex;align-items:center;border:1px solid #d1d5db;border-radius:5px;overflow:hidden;height:38px}
          .kt-qty-btn{width:31px;height:100%;border:0;background:#f3f4f6;font-size:17px;font-weight:800;cursor:pointer}
          .kt-qty-value{min-width:31px;text-align:center;font:800 12px Manrope,sans-serif}
          .kt-add{flex:1;height:38px;border:0;border-radius:5px;background:#131313;color:#fff;font:800 11px Manrope,sans-serif;cursor:pointer}
          .kt-add:hover{background:#000}.kt-add:disabled{opacity:.45;cursor:not-allowed}
          .kt-moq{font:700 9px Manrope,sans-serif;color:#92400e;text-transform:uppercase;letter-spacing:.05em;margin-top:6px}
          .kt-empty{padding:40px 20px;text-align:center;border:1px dashed #d1d5db;border-radius:8px;color:#6b7280;font:600 13px Manrope,sans-serif}
          @media(max-width:1023px){.kt-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
          @media(max-width:767px){#kt-enhanced-catalog{padding:12px 12px 110px}.kt-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.kt-card-img{height:145px;padding:7px}.kt-card-body{padding:9px}.kt-card h3{font-size:13px;min-height:32px}.kt-pack{padding:6px 6px;font-size:9px}.kt-buy-row{gap:5px}.kt-qty-btn{width:27px}.kt-qty-value{min-width:26px}.kt-add{font-size:10px}}
        `;
        document.head.appendChild(s);
    }

    function renderEnhancedCatalog() {
        const products = getProducts();
        if (!products.length) return;
        ensureUI();
        injectCardStyle();
        buildCategories(products);
        const source = document.getElementById('tiles-container');
        if (source) source.classList.add('kt-hidden-source');
        let root = document.getElementById('kt-enhanced-catalog');
        if (!root) {
            root = document.createElement('section');
            root.id = 'kt-enhanced-catalog';
            root.setAttribute('aria-label','Wholesale product catalogue');
            const target = source || document.getElementById('products');
            if (target && target.parentNode) target.parentNode.insertBefore(root, target.nextSibling);
        }
        const visible = filtered(products);
        root.innerHTML = visible.length ? `<div class="kt-grid">${visible.map((p,i) => card(p, products.indexOf(p))).join('')}</div>` : '<div class="kt-empty">No products match your search. Try another product name, brand or category.</div>';
        root.querySelectorAll('.kt-card').forEach(el => {
            const idx = Number(el.dataset.productIndex);
            const p = products[idx];
            el.querySelectorAll('.kt-pack').forEach(btn => btn.addEventListener('click', () => {
                el.querySelectorAll('.kt-pack').forEach(x => x.classList.remove('selected'));
                btn.classList.add('selected');
                el.dataset.packIndex = btn.dataset.packIndex;
            }));
            el.querySelectorAll('.kt-qty-btn').forEach(btn => btn.addEventListener('click', () => {
                const min = Number(p.minQty) || 1;
                const cur = qtyState[idx] || min;
                const next = btn.dataset.qty === 'plus' ? cur + 1 : Math.max(min, cur - 1);
                qtyState[idx] = next;
                el.querySelector('.kt-qty-value').textContent = next;
            }));
            const add = el.querySelector('.kt-add');
            add?.addEventListener('click', () => {
                const min = Number(p.minQty) || 1;
                const packIndex = Number(el.dataset.packIndex);
                const ps = Array.isArray(p.packSizes) && Number.isInteger(packIndex) ? p.packSizes[packIndex] : (Array.isArray(p.packSizes) && p.packSizes.length === 1 ? p.packSizes[0] : null);
                if (Array.isArray(p.packSizes) && p.packSizes.length > 1 && !ps) {
                    showWholesaleToast('Choose a pack size first');
                    return;
                }
                const quantity = Math.max(min, qtyState[idx] || min);
                const key = p.name + (ps ? '‖' + ps.size : '');
                const existing = cart.find(x => x.key === key);
                if (existing) existing.qty += quantity;
                else cart.push({ key, name:p.name, category:p.category, packSize:ps, priceDisplay:ps ? ps.price : (p.priceDisplay || ''), image:(p.images && p.images[0]) || '', minQty:min, qty:quantity });
                saveCartToStorage();
                updateCartBadge();
                add.classList.add('kt-added');
                const old = add.textContent;
                add.textContent = '✓ Added';
                showWholesaleToast(`${p.name} added to your order`);
                setTimeout(() => { add.classList.remove('kt-added'); add.textContent = old; }, 900);
                updateWholesaleOrderBar();
            });
        });
        lastProducts = products;
        updateWholesaleOrderBar();
    }

    function updateWholesaleOrderBar() {
        const bar = document.getElementById('kt-order-bar');
        if (!bar) return;
        const products = currentCartProducts();
        const units = currentCartTotal();
        bar.classList.toggle('show', units > 0);
        const pEl = document.getElementById('kt-order-products');
        const uEl = document.getElementById('kt-order-units');
        if (pEl) pEl.textContent = products + (products === 1 ? ' product' : ' products');
        if (uEl) uEl.textContent = units + (units === 1 ? ' unit' : ' units');
    }
    function showWholesaleToast(text) {
        const toast = document.getElementById('kt-toast');
        if (!toast) return;
        toast.textContent = text;
        toast.classList.add('show');
        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => toast.classList.remove('show'), 1800);
    }

    // Replace the original add-to-cart behavior only after the original
    // function exists. The cart data model remains identical; the difference
    // is that adding from the catalogue no longer forcibly opens the drawer.
    const originalAdd = window.addToCart;
    if (typeof originalAdd === 'function') {
        window.addToCart = function(name, packSize) {
            originalAdd(name, packSize);
            // If the legacy handler opened the drawer, close it immediately.
            // This preserves its validation/analytics/storage behavior while
            // keeping the wholesale buyer on the catalogue.
            if (document.getElementById('cart-drawer')?.classList.contains('open')) closeCart();
            updateWholesaleOrderBar();
        };
    }

    const observer = new MutationObserver(() => {
        const products = getProducts();
        if (products.length && products !== lastProducts) renderEnhancedCatalog();
    });
    observer.observe(document.body, { childList:true, subtree:true });

    // Existing product loading is asynchronous. Retry briefly without a
    // permanent interval, then let the observer catch later DOM changes.
    let tries = 0;
    const boot = () => {
        if (getProducts().length) { renderEnhancedCatalog(); return; }
        if (++tries < 30) setTimeout(boot, 500);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
    else boot();

    // Keep the order bar synchronized when the legacy drawer changes quantity.
    const originalUpdateQty = window.updateCartQty;
    window.updateCartQty = function(idx, qty) {
        originalUpdateQty(idx, qty);
        updateWholesaleOrderBar();
    };
    const originalRemove = window.removeFromCart;
    window.removeFromCart = function(idx) {
        originalRemove(idx);
        updateWholesaleOrderBar();
    };
    const originalClear = window.clearCart;
    window.clearCart = function() {
        originalClear();
        updateWholesaleOrderBar();
    };
})();
