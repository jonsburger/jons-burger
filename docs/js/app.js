'use strict';
/* JONS Burger — site do cliente (GitHub Pages + Supabase). Produtos e preços vêm do banco; o banco recalcula o total ao criar o pedido. */
const $ = (s) => document.querySelector(s);
const brl = (c) => 'R$ ' + (c / 100).toFixed(2).replace('.', ',');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduce = matchMedia('(prefers-reduced-motion:reduce)').matches;

/* ====== CONFIGURAÇÃO EDITÁVEL (imagens do cardápio; preços ficam em src/catalog.js no servidor) ====== */
const PRODUCT_IMG = { baratinho: 'img/c4.jpg', salada: 'img/sal.jpg', bacon: 'img/c5.jpg', chicken: 'img/chk.jpg', monster: 'img/jons_monster.jpg', mineirinho: 'img/mineirinho.jpg' };
const GALLERY = [['img/p4.jpg', 'JONS Baratinho'], ['img/p5.jpg', 'JONS Bacon Crisp'], ['img/p6.jpg', 'JONS Monster'], ['img/fly.jpg', 'Cardápio'], ['img/p7.jpg', 'JONS Salada'], ['img/p8.jpg', 'JONS Chicken Smash'], ['img/jons_mineirinho.jpg', 'JONS Mineirinho']];
const MARQUEE = 'ARTESANAL ★ PARACATU – MG ★ 17H ÀS 23H ★ MAIONESE ESPECIAL ★ JONS MONSTER ★ ';
const POLL_MS = 10000;
/* ================================================================================================= */

let site = { whatsapp: '5538999207706', address: '' };
let MENU = [];
let cart = {};
let lastFocus = null;
let last = null;            // { number, token, order, pix } do último pedido deste navegador
let pollTimer = null;
const LS = 'jons_last_order';
const store = { get() { try { return JSON.parse(localStorage.getItem(LS)); } catch { return null; } }, set(v) { try { localStorage.setItem(LS, JSON.stringify(v)); } catch {} }, del() { try { localStorage.removeItem(LS); } catch {} } };
const PAY_LABEL = { aguardando: 'Aguardando pagamento', pago: 'Pago', cancelado: 'Cancelado' };
const ST_LABEL = { recebido: 'Recebido', preparo: 'Em preparo', pronto: 'Pronto', entregue: 'Entregue', cancelado: 'Cancelado' };
const count = () => Object.values(cart).reduce((a, b) => a + b, 0);
const total = () => Object.entries(cart).reduce((s, [id, q]) => s + (MENU.find((p) => p.id === id)?.price_cents || 0) * q, 0);

function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('on'), 2000); }
function bump() { const b = $('#cartBtn'); b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }
const ERRS = {
  ERR_NOME: ['name', 'Informe seu nome (2 a 80 caracteres).'], ERR_TELEFONE: ['phone', 'Informe um telefone válido com DDD.'],
  ERR_ITENS: ['items', 'Item ou quantidade inválida (1 a 20 por item).'], ERR_PRODUTO: [null, 'Um dos produtos não está disponível. Atualize a página.'],
  ERR_LIMITE: [null, 'Muitos pedidos em pouco tempo. Aguarde alguns minutos.'],
};
function sbErr(b) {
  const m = (b && b.message) || ''; const k = Object.keys(ERRS).find((x) => m.includes(x));
  if (!k) return { message: m === 'Sem conexão.' ? 'Sem conexão. Tente novamente.' : 'Não foi possível concluir agora. Tente novamente.' };
  const [f, t] = ERRS[k]; return f ? { message: t, fields: { [f]: t } } : { message: t };
}
/* Camada de acesso: traduz as chamadas do site para o Supabase (REST/RPC). Preços e totais são decididos pelo banco. */
async function api(method, url, body) {
  if (!SB.configured) return { ok: false, status: 0, body: { message: 'Site ainda não configurado (veja docs/config.js).' } };
  if (method === 'GET' && url === '/api/menu') {
    const r = await SB.rest('GET', '/rest/v1/products?select=id,name,note,description,price_cents,category,featured&active=eq.true&order=sort');
    return { ok: r.ok, status: r.status, body: r.ok ? { items: r.body } : r.body };
  }
  if (method === 'GET' && url === '/api/config') {
    const r = await SB.rest('GET', '/rest/v1/store_settings?select=key,value');
    if (!r.ok) return r; const o = Object.fromEntries(r.body.map((x) => [x.key, x.value]));
    return { ok: true, status: 200, body: { whatsapp: String(o.whatsapp || '').replace(/\D/g, '') || site.whatsapp, address: o.address || '' } };
  }
  if (method === 'POST' && url === '/api/orders') {
    const r = await SB.rpc('create_order', { p_name: body.name, p_phone: body.phone, p_notes: body.notes, p_items: body.items });
    return r.ok ? r : { ok: false, status: r.status, body: sbErr(r.body) };
  }
  const m = url.match(/^\/api\/orders\/(\d+)\?token=(.+)$/);
  if (method === 'GET' && m) {
    const r = await SB.rpc('get_order_status', { p_number: m[1], p_token: decodeURIComponent(m[2]) });
    if (r.ok && r.body) return r;
    return { ok: false, status: r.ok ? 404 : r.status, body: { message: 'Pedido não encontrado.' } };
  }
  return { ok: false, status: 404, body: { message: 'Rota inexistente.' } };
}

/* ---------- menu / carrinho ---------- */
function add(id, btn) {
  if (!MENU.some((p) => p.id === id)) return;
  cart[id] = Math.min(20, (cart[id] || 0) + 1); render(); toast('✔ Adicionado ao pedido'); bump();
  if (btn) { const o = btn.textContent; btn.classList.add('ok'); btn.textContent = 'ADICIONADO ✔'; setTimeout(() => { btn.classList.remove('ok'); btn.textContent = o; }, 900); }
}
function render() {
  const ids = Object.keys(cart).filter((k) => cart[k] > 0 && MENU.some((p) => p.id === k));
  $('#items').innerHTML = ids.length ? ids.map((id) => {
    const p = MENU.find((x) => x.id === id), q = cart[id];
    return `<div class="it"><div><b>${esc(p.name)}</b><small>${brl(p.price_cents)} cada</small><br><button class="rm" data-rm="${id}">remover</button></div>
    <div class="q"><button data-d="${id}" aria-label="Diminuir ${esc(p.name)}">−</button><b aria-label="Quantidade">${q}</b><button data-u="${id}" aria-label="Aumentar ${esc(p.name)}">+</button></div></div>`;
  }).join('') : '<div class="empty">Seu pedido está vazio.<br>Escolha um hambúrguer no cardápio.</div>';
  const n = count(), t = total();
  $('#cnt').textContent = n; $('#sub').textContent = brl(t); $('#tot').textContent = brl(t);
  const open = $('#cart').classList.contains('on');
  const f = $('#fab'); f.classList.toggle('on', n > 0 && !open); f.textContent = `Ver pedido · ${n} · ${brl(t)}`;
  $('#orderHero').textContent = n ? `FINALIZAR PEDIDO (${n})` : 'FAÇA SEU PEDIDO';
  $('#send').disabled = !n;
  $('#lastLink').hidden = !last;
  if (last) $('#lastLink').textContent = `Ver meu pedido #${last.number}`;
}
$('#items').addEventListener('click', (e) => {
  const t = e.target;
  if (t.dataset.u) cart[t.dataset.u] = Math.min(20, cart[t.dataset.u] + 1);
  if (t.dataset.d) { cart[t.dataset.d] = Math.max(0, cart[t.dataset.d] - 1); if (!cart[t.dataset.d]) delete cart[t.dataset.d]; }
  if (t.dataset.rm) delete cart[t.dataset.rm];
  render();
});

function buildMenu() {
  const burgers = MENU.filter((p) => p.category === 'burger'), sides = MENU.filter((p) => p.category === 'side');
  const M = burgers.find((b) => b.featured);
  if (M) { $('#mdesc').textContent = M.description; $('#mprice').textContent = brl(M.price_cents); }
  $('#burgers').innerHTML = burgers.map((b, i) => `<article class="item rv"><span class="no">0${i + 1}</span>
    <div class="nm"><h3>${esc(b.name)}${b.featured ? '<span class="tg">O CHEFE DA CASA</span>' : ''}</h3><p>${esc(b.description)}</p></div>
    <div class="th"><img src="${PRODUCT_IMG[b.id] || 'img/logo.jpg'}" alt="${esc(b.name)}" loading="lazy" width="280" height="170"></div>
    <div class="pc"><span class="price">${brl(b.price_cents)}</span><button class="add" data-add="${b.id}" aria-label="Adicionar ${esc(b.name)} ao pedido">ADICIONAR</button></div></article>`).join('');
  $('#sides').innerHTML = sides.map((s) => `<div class="li"><span class="n">${esc(s.name)}<small>${esc(s.note)}</small></span><span class="d"></span><span class="price">${brl(s.price_cents)}</span><button class="add" data-add="${s.id}" aria-label="Adicionar ${esc(s.name)} ao pedido">ADICIONAR</button></div>`).join('');
  document.querySelectorAll('#burgers .rv,#sides').forEach((el) => io.observe(el));
}
async function loadMenu() {
  const r = await api('GET', '/api/menu');
  if (r.ok && r.body?.items?.length) { MENU = r.body.items; buildMenu(); render(); return; }
  $('#burgers').innerHTML = '<div class="empty">Não foi possível carregar o cardápio agora.<br><button class="btn p" id="retry" style="margin-top:16px">TENTAR DE NOVO</button></div>';
  $('#retry').onclick = loadMenu;
}
document.body.addEventListener('click', (e) => { const b = e.target.closest('[data-add]'); if (b) add(b.dataset.add, b); });

/* ---------- painéis: foco, ARIA, Escape ---------- */
function panel(el, show, focusSel) {
  el.classList.toggle('on', show); el.setAttribute('aria-hidden', String(!show));
  if (show) { lastFocus = document.activeElement; setTimeout(() => (el.querySelector(focusSel) || el).focus({ preventScroll: true }), 60); }
  else if (lastFocus) lastFocus.focus({ preventScroll: true });
  document.body.style.overflow = show ? 'hidden' : '';
}
function openCart(v) {
  if (v) closeNav(true);
  if (v) { if (!count() && last) showDone(); else showCart(); }
  else stopPoll();
  panel($('#cart'), v, '#close'); $('#ov').classList.toggle('on', v); render();
}
function closeNav(quiet) {
  const n = $('#nav'); if (!n.classList.contains('on')) return;
  n.classList.remove('on'); n.setAttribute('aria-hidden', 'true'); $('#menuBtn').setAttribute('aria-expanded', 'false'); $('#menuBtn').textContent = 'Menu';
  document.body.style.overflow = ''; if (!quiet) $('#menuBtn').focus();
}
$('#cartBtn').onclick = () => openCart(true); $('#fab').onclick = () => openCart(true);
$('#close').onclick = $('#ov').onclick = () => openCart(false);
$('#menuBtn').onclick = () => {
  const o = !$('#nav').classList.contains('on');
  $('#nav').classList.toggle('on', o); $('#nav').setAttribute('aria-hidden', String(!o)); $('#menuBtn').setAttribute('aria-expanded', String(o));
  $('#menuBtn').textContent = o ? 'Fechar' : 'Menu'; document.body.style.overflow = o ? 'hidden' : ''; if (o) $('#nav a').focus();
};
$('#nav').onclick = (e) => { if (e.target.tagName === 'A') closeNav(true); };
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if ($('#cart').classList.contains('on')) openCart(false); else closeNav(); }
  if (e.key === 'Tab' && $('#cart').classList.contains('on')) {
    const f = [...$('#cart').querySelectorAll('button,input,textarea,a[href]')].filter((x) => !x.disabled && x.offsetParent !== null);
    if (!f.length) return; const a = f[0], z = f[f.length - 1];
    if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
  }
});
$('#orderHero').onclick = () => { if (count() > 0) openCart(true); else $('#cardapio').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' }); };
$('#contactBtn').onclick = () => window.open(`https://wa.me/${site.whatsapp}?text=${encodeURIComponent('Olá, JONS Burger! Gostaria de mais informações.')}`, '_blank', 'noopener');

/* ---------- checkout ---------- */
function showCart() { $('#viewCart').hidden = false; $('#viewDone').hidden = true; $('#cartTitle').textContent = 'Seu pedido'; stopPoll(); }
$('#lastLink').onclick = () => showDone();
$('#orderForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#formErr'); err.textContent = '';
  if (!count()) { err.textContent = 'Adicione ao menos um item.'; return; }
  const btn = $('#send'); btn.disabled = true; const old = btn.textContent; btn.textContent = 'ENVIANDO…';
  const body = { name: $('#cname').value, phone: $('#cphone').value, notes: $('#obs').value, items: Object.entries(cart).map(([id, qty]) => ({ id, qty })) };
  let r; try { r = await api('POST', '/api/orders', body); } catch { r = { ok: false, body: { message: 'Sem conexão. Tente novamente.' } }; }
  btn.textContent = old; btn.disabled = !count();
  if (!r.ok) { err.textContent = r.body?.fields ? Object.values(r.body.fields).join(' ') : (r.body?.message || 'Não foi possível enviar o pedido.'); return; }
  last = { number: r.body.order.number, token: r.body.token, order: r.body.order, pix: r.body.pix };
  store.set({ number: last.number, token: last.token });
  cart = {}; $('#obs').value = ''; render(); showDone(); toast('✔ Pedido enviado!');
});

function showDone() {
  if (!last) return showCart();
  $('#viewCart').hidden = true; $('#viewDone').hidden = false; $('#cartTitle').textContent = `Pedido #${last.number}`;
  const o = last.order, p = last.pix || {};
  const pixHtml = p.configured ? `
    <div class="pix"><h4>Pague com Pix</h4>
      <div class="pl">Chave Pix${p.keyType ? ' (' + esc(p.keyType) + ')' : ''}</div><div class="mono" id="pixKey">${esc(p.key)}</div>
      <div class="pl">Recebedor</div><div><b>${esc(p.receiver)}</b></div>
      <div class="pl">Valor exato</div><div class="mono">${brl(o.total_cents)}</div>
      <div class="row2"><button class="add" data-copy="${esc(p.key)}" data-msg="Chave Pix copiada">COPIAR CHAVE</button><button class="add" data-copy="${(o.total_cents / 100).toFixed(2).replace('.', ',')}" data-msg="Valor copiado">COPIAR VALOR</button></div>
      <ol><li>Abra o app do seu banco e escolha <b>Pix → Pix Copia e Cola / Chave</b>.</li><li>Cole a chave e confira o nome do recebedor.</li><li>Digite exatamente <b>${brl(o.total_cents)}</b> e pague.</li><li>A JONS Burger confirma o pagamento manualmente — o status abaixo muda quando for confirmado.</li></ol>
    </div>` : `<div class="pix"><h4>Pagamento via Pix</h4><p>A chave Pix ainda não foi configurada neste site. Fale com a JONS Burger pelo WhatsApp para combinar o pagamento do pedido #${esc(o.number)}.</p></div>`;
  const wa = `https://wa.me/${site.whatsapp}?text=${encodeURIComponent(`Olá, JONS Burger! Segue o comprovante do pedido #${o.number} (${brl(o.total_cents)}).`)}`;
  $('#viewDone').innerHTML = `
    <div class="done-scroll">
      <p class="ok-msg">Pedido recebido! Guarde o número <b>#${esc(o.number)}</b>.</p>
      <div class="badges"><span class="bd pay-${o.payment_status}" id="bPay">${PAY_LABEL[o.payment_status]}</span><span class="bd" id="bSt">${ST_LABEL[o.status]}</span></div>
      <ul class="sumry">${o.items.map((i) => `<li><span>${i.quantity}× ${esc(i.name)}</span><span>${brl(i.unit_price_cents * i.quantity)}</span></li>`).join('')}</ul>
      <div class="tot g"><span>Total</span><span>${brl(o.total_cents)}</span></div>
      ${pixHtml}
    </div>
    <a class="btn s" href="${wa}" target="_blank" rel="noopener" style="justify-content:center;margin-top:10px">ENVIAR COMPROVANTE NO WHATSAPP</a>
    <button class="btn p" id="newOrder" style="justify-content:center;margin-top:10px">FAZER NOVO PEDIDO</button>`;
  $('#newOrder').onclick = () => { last = null; store.del(); showCart(); render(); };
  startPoll();
}
$('#viewDone').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-copy]'); if (!b) return;
  try { await navigator.clipboard.writeText(b.dataset.copy); } catch { const t = document.createElement('textarea'); t.value = b.dataset.copy; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch {} t.remove(); }
  toast('✔ ' + b.dataset.msg);
});
async function refreshLast() {
  if (!last) return;
  const r = await api('GET', `/api/orders/${last.number}?token=${encodeURIComponent(last.token)}`);
  if (r.status === 404) { last = null; store.del(); if (!$('#viewDone').hidden) showCart(); render(); return; }
  if (!r.ok) return;
  last.order = r.body.order; last.pix = r.body.pix;
  const p = $('#bPay'), s = $('#bSt');
  if (p) { p.textContent = PAY_LABEL[last.order.payment_status]; p.className = 'bd pay-' + last.order.payment_status; }
  if (s) s.textContent = ST_LABEL[last.order.status];
}
function startPoll() { stopPoll(); pollTimer = setInterval(() => { if (!document.hidden) refreshLast(); }, POLL_MS); }
function stopPoll() { clearInterval(pollTimer); pollTimer = null; }

/* ---------- conteúdo estático e movimento ---------- */
$('#mq1').textContent = MARQUEE.repeat(6); $('#mq2').textContent = 'O SABOR QUE FALTAVA NA CIDADE! ★ '.repeat(8);
$('#gallery').innerHTML = GALLERY.map(([s, c]) => `<figure><img src="${s}" alt="${c}" loading="lazy"><figcaption>${c}</figcaption></figure>`).join('');
const io = new IntersectionObserver((es) => es.forEach((x) => { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); } }), { threshold: .1 });
document.querySelectorAll('.rv').forEach((el) => io.observe(el));
const px = [...document.querySelectorAll('[data-x],[data-y]')]; let tick = false;
function frame() {
  tick = false; $('#hd').classList.toggle('sc', scrollY > 40);
  if (reduce) return;
  px.forEach((e) => { const r = e.getBoundingClientRect(); if (r.bottom < -200 || r.top > innerHeight + 200) return; const c = r.top + r.height / 2 - innerHeight / 2; e.style.translate = `${(e.dataset.x || 0) * c}px ${(e.dataset.y || 0) * c}px`; });
}
addEventListener('scroll', () => { if (!tick) { tick = true; requestAnimationFrame(frame); } }, { passive: true }); frame();

/* ---------- inicialização ---------- */
(async function init() {
  render();
  api('GET', '/api/config').then((r) => { if (r.ok) { site = r.body; } $('#addr').textContent = site.address || 'Paracatu – MG'; });
  $('#addr').textContent = 'Paracatu – MG';
  await loadMenu();
  const s = store.get();
  if (s && s.number && s.token) {
    const r = await api('GET', `/api/orders/${encodeURIComponent(s.number)}?token=${encodeURIComponent(s.token)}`);
    if (r.ok) { last = { number: s.number, token: s.token, order: r.body.order, pix: r.body.pix }; render(); } else if (r.status === 404) store.del();
  }
})();
