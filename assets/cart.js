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
}
function closeCart() {
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
    updateCartBadge();
    openCart();
};
window.removeFromCart = function(idx) {
    cart.splice(idx, 1);
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
    if (!badge) return;
    badge.textContent = total > 9 ? '9+' : String(total);
    total > 0 ? badge.classList.remove('hidden') : badge.classList.add('hidden');
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
                ${item.priceDisplay ? '<div class="text-[10px] font-bold text-brand-maroon">' + item.priceDisplay + (item.qty > 1 ? ' \xD7' + item.qty : '') + '</div>' : ''}
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
}
function closeCheckout() {
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
    msg += '• Delivery time will be confirmed by our WhatsApp representative';
    window.open('https://wa.me/923352999006?text=' + encodeURIComponent(msg), '_blank');
    if (typeof gtag !== 'undefined') gtag('event', 'generate_lead', { method: 'whatsapp_cart', value: itemCount });
}
// A quick pre-order question -- distinct from placing an order. Opens
// WhatsApp immediately with no form, since asking a question shouldn't
// require delivery details.
window.inquireProduct = function(name, category, link) {
    const text = '❓ *Question about:* ' + name + '\n🔗 ' + link +
        '\n\nHi, I’d like to know more about this product before ordering.';
    window.open('https://wa.me/923352999006?text=' + encodeURIComponent(text), '_blank');
    if (typeof gtag !== 'undefined') gtag('event', 'generate_lead', { item_name: name, item_category: category });
};

// The real "place an order" action: add the item to the cart, then go
// straight to the checkout screen (order terms + delivery details form)
// instead of bypassing it with a bare single-item WhatsApp message.
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
