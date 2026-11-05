'use strict';
const $ = (s) => document.querySelector(s);
const brl = (c) => 'R$ ' + (c / 100).toFixed(2).replace('.', ',');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ST = { recebido: 'Recebido', preparo: 'Em preparo', pronto: 'Pronto', entregue: 'Entregue', cancelado: 'Cancelado' };
const PAY = { aguardando: 'Aguardando pagamento', pago: 'Pago', cancelado: 'Cancelado' };
const COLS = [['Novos (recebidos)', ['recebido'], ''], ['Em preparo', ['preparo'], 'pr'], ['Prontos', ['pronto'], 'rd'], ['Entregues / cancelados', ['entregue', 'cancelado'], 'fn']];
const NEXT = { recebido: [['preparo', 'Marcar EM PREPARO']], preparo: [['pronto', 'Marcar PRONTO']], pronto: [['entregue', 'Marcar ENTREGUE']], entregue: [], cancelado: [] };
let tab = 'orders', orders = [], maxId = null, sound = false, openId = null, timer = null, newIds = new Set(), baseTitle = document.title;

const hhmm = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
const stamp = (iso) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const today = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('on'), 2200); }
const REST_ERR = { ERR_TRANSICAO: [409, 'Essa mudança de status não é permitida.'], ERR_CANCELADO: [409, 'Pedido cancelado não aceita alteração de pagamento.'], ERR_NAO_ENCONTRADO: [404, 'Pedido não encontrado.'], ERR_NAO_AUTORIZADO: [403, 'Sem permissão de administrador.'] };
const SEL = 'select=*,order_items(name,unit_price_cents,quantity)';
const mapOrder = (o) => ({ id: o.id, number: o.public_number, created_at: o.created_at, updated_at: o.updated_at, status: o.status, payment_status: o.payment_status, total_cents: o.total_cents, subtotal_cents: o.subtotal_cents, customer_name: o.customer_name, customer_phone: o.customer_phone, notes: o.notes, paid_at: o.paid_at, items: (o.order_items || []).map((i) => ({ name: i.name, quantity: i.quantity, unit_price_cents: i.unit_price_cents })) });
function dayRange(date) { const d = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : today(); const f = new Date(d + 'T00:00:00-03:00'); return { date: d, from: f.toISOString(), to: new Date(f.getTime() + 864e5).toISOString() }; }
function summarize(list) {
  const s = { count: list.length, byStatus: { recebido: 0, preparo: 0, pronto: 0, entregue: 0, cancelado: 0 }, registeredCents: 0, paidCents: 0, pendingCents: 0 };
  for (const o of list) { s.byStatus[o.status]++; if (o.status === 'cancelado') continue; s.registeredCents += o.total_cents; if (o.payment_status === 'pago') s.paidCents += o.total_cents; else s.pendingCents += o.total_cents; }
  return s;
}
async function isAdmin() { const r = await SB.rest('GET', '/rest/v1/admins?select=user_id', { auth: true }); return r.ok && Array.isArray(r.body) && r.body.length > 0; }
const kick = () => { showLogin(); throw new Error('401'); };
const eventsOf = async (id) => { const e = await SB.rest('GET', `/rest/v1/order_events?select=kind,detail,actor,created_at&order_id=eq.${id}&order=id`, { auth: true }); return e.ok ? e.body : []; };
/* Camada de acesso do painel (Supabase Auth + REST/RPC). As permissões são decididas pelo banco (RLS + is_admin()). */
async function api(method, url, body) {
  if (!SB.configured) return { ok: false, status: 500, body: { message: 'Painel ainda não configurado (veja docs/config.js).' } };
  if (url === '/api/admin/login') {
    const l = await SB.login(body.username, body.password);
    if (!l.ok) return { ok: false, status: 401, body: { message: l.status === 0 ? 'Sem conexão.' : 'E-mail ou senha incorretos.' } };
    if (!(await isAdmin())) { await SB.logout(); return { ok: false, status: 403, body: { message: 'Esta conta não tem permissão de administrador.' } }; }
    return { ok: true, status: 200, body: {} };
  }
  if (url === '/api/admin/logout') { await SB.logout(); return { ok: true, status: 200, body: {} }; }
  if (url === '/api/admin/me') return SB.hasSession() && (await isAdmin()) ? { ok: true, status: 200, body: {} } : { ok: false, status: 401, body: {} };
  if (!SB.hasSession()) kick();
  if (method === 'GET' && url.startsWith('/api/admin/orders?')) {
    const sp = new URLSearchParams(url.split('?')[1]), dr = dayRange(sp.get('date'));
    const r = await SB.rest('GET', `/rest/v1/orders?${SEL}&created_at=gte.${encodeURIComponent(dr.from)}&created_at=lt.${encodeURIComponent(dr.to)}&order=id.desc&limit=500`, { auth: true });
    if (r.status === 401 || r.status === 403) kick();
    if (!r.ok) return { ok: false, status: r.status, body: { message: 'Falha ao carregar.' } };
    const all = r.body.map(mapOrder), st = sp.get('status'), q = (sp.get('q') || '').toLowerCase().replace(/^#/, '');
    const orders = all.filter((o) => (!st || o.status === st) && (!q || o.number.includes(q) || o.customer_name.toLowerCase().includes(q) || o.customer_phone.includes(q)));
    return { ok: true, status: 200, body: { date: dr.date, summary: summarize(all), orders } };
  }
  const m = url.match(/^\/api\/admin\/orders\/(\d+)$/);
  if (m && method === 'GET') {
    const r = await SB.rest('GET', `/rest/v1/orders?${SEL}&id=eq.${m[1]}`, { auth: true });
    if (r.status === 401 || r.status === 403) kick();
    if (!r.ok || !r.body.length) return { ok: false, status: 404, body: { message: 'Pedido não encontrado.' } };
    return { ok: true, status: 200, body: { order: mapOrder(r.body[0]), events: await eventsOf(m[1]) } };
  }
  if (m && method === 'PATCH') {
    const id = +m[1];
    const r = body.status ? await SB.rpc('admin_set_status', { p_id: id, p_status: body.status }, true) : await SB.rpc('admin_set_payment', { p_id: id, p_paid: body.payment_status === 'pago' }, true);
    if (!r.ok) {
      if (r.status === 401) kick();
      const k = Object.keys(REST_ERR).find((x) => String((r.body && r.body.message) || '').includes(x)); const [st, msg] = REST_ERR[k] || [400, 'Erro ao atualizar.'];
      return { ok: false, status: st, body: { message: msg } };
    }
    return { ok: true, status: 200, body: { order: r.body, events: await eventsOf(id) } };
  }
  return { ok: false, status: 404, body: { message: 'Rota inexistente.' } };
}
function showLogin() { clearInterval(timer); $('#app').hidden = true; $('#login').hidden = false; $('#u').focus(); }
function showApp() { $('#login').hidden = true; $('#app').hidden = false; refresh(); clearInterval(timer); timer = setInterval(() => { if (!document.hidden) refresh(); }, 8000); }

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault(); $('#lerr').textContent = '';
  const r = await api('POST', '/api/admin/login', { username: $('#u').value, password: $('#p').value });
  if (!r.ok) { $('#lerr').textContent = r.body?.message || 'Não foi possível entrar.'; return; }
  $('#p').value = ''; showApp();
});
$('#out').onclick = async () => { try { await api('POST', '/api/admin/logout', {}); } catch {} orders = []; maxId = null; showLogin(); };
$('#fDate').value = today();
['fDate', 'fStatus'].forEach((id) => $('#' + id).addEventListener('change', () => { maxId = null; refresh(); }));
let qT; $('#fQ').addEventListener('input', () => { clearTimeout(qT); qT = setTimeout(refresh, 300); });
$('#snd').onclick = () => { sound = !sound; $('#snd').textContent = (sound ? '🔔' : '🔕') + ' Som'; $('#snd').setAttribute('aria-pressed', sound); if (sound) beep(); };
function beep() { try { const c = new (window.AudioContext || window.webkitAudioContext)(), o = c.createOscillator(), g = c.createGain(); o.connect(g); g.connect(c.destination); o.frequency.value = 880; g.gain.setValueAtTime(.2, c.currentTime); g.gain.exponentialRampToValueAtTime(.001, c.currentTime + .6); o.start(); o.stop(c.currentTime + .6); } catch {} }

async function refresh() {
  if (tab !== 'orders') return;
  const qs = new URLSearchParams({ date: $('#fDate').value || today(), status: $('#fStatus').value, q: $('#fQ').value.trim() });
  let r; try { r = await api('GET', '/api/admin/orders?' + qs); } catch { return; }
  if (!r.ok) { $('#upd').textContent = 'Falha ao atualizar'; return; }
  const ids = r.body.orders.map((o) => o.id), top = ids.length ? Math.max(...ids) : 0;
  if (maxId !== null && top > maxId) {
    r.body.orders.filter((o) => o.id > maxId).forEach((o) => newIds.add(o.id));
    if (sound) beep(); toast('Novo pedido!'); document.title = '(!) Novo pedido — JONS';
  } else if (!document.hidden && !newIds.size) document.title = baseTitle;
  maxId = Math.max(maxId ?? 0, top);
  orders = r.body.orders; paint(r.body.summary);
  $('#upd').textContent = 'Atualizado ' + new Date().toLocaleTimeString('pt-BR');
  if (openId) { const o = orders.find((x) => x.id === openId); if (o && $('#dlg').open && !busy) fillDialog(o, null); }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { document.title = baseTitle; refresh(); } });

function paint(s) {
  $('#sCount').textContent = s.count; $('#sReg').textContent = brl(s.registeredCents); $('#sPaid').textContent = brl(s.paidCents); $('#sPend').textContent = brl(s.pendingCents);
  $('#cols').innerHTML = COLS.map(([title, sts, cls]) => {
    const list = orders.filter((o) => sts.includes(o.status)).sort((a, b) => (sts[0] === 'entregue' ? b.id - a.id : a.id - b.id));
    return `<section class="col ${cls}" aria-label="${title}"><h2><span>${title}</span><span>${list.length}</span></h2><div>${list.length ? list.map(card).join('') : '<p class="empty">Nenhum pedido.</p>'}</div></section>`;
  }).join('');
}
function card(o) {
  const items = o.items.map((i) => `${i.quantity}× ${esc(i.name)}`).join(', ');
  return `<button class="card ${newIds.has(o.id) ? 'new' : ''}" data-id="${o.id}"><span class="t">${hhmm(o.created_at)}</span><span class="n">#${esc(o.number)}</span>
    <div><b>${esc(o.customer_name)}</b></div><div class="it">${items}</div>
    <div class="f"><b>${brl(o.total_cents)}</b><span class="bd ${o.payment_status}">${PAY[o.payment_status]}</span></div></button>`;
}
$('#cols').addEventListener('click', async (e) => {
  const c = e.target.closest('.card'); if (!c) return;
  const id = +c.dataset.id; newIds.delete(id); c.classList.remove('new');
  const o = orders.find((x) => x.id === id); openId = id; fillDialog(o, null);
  if (!$('#dlg').open) $('#dlg').showModal();
  const r = await api('GET', '/api/admin/orders/' + id); if (r.ok) fillDialog(r.body.order, r.body.events);
});
let busy = false, lastEvents = null;
function fillDialog(o, events) {
  if (events) lastEvents = events;
  const wa = '55' + o.customer_phone.replace(/\D/g, '');
  const fmt = (p) => p.length === 11 ? `(${p.slice(0, 2)}) ${p.slice(2, 7)}-${p.slice(7)}` : `(${p.slice(0, 2)}) ${p.slice(2, 6)}-${p.slice(6)}`;
  const pay = o.status === 'cancelado' ? '' : o.payment_status === 'aguardando' ? '<button class="b ok" data-pay="pago">Confirmar pagamento (Pix recebido)</button>' : o.payment_status === 'pago' ? '<button class="b" data-pay="aguardando">Desfazer confirmação</button>' : '';
  const st = (NEXT[o.status] || []).map(([k, l]) => `<button class="b main" data-st="${k}">${l}</button>`).join('');
  const cancel = NEXT[o.status]?.length ? '<button class="b bad" data-st="cancelado">Cancelar pedido</button>' : '';
  $('#dBody').innerHTML = `<div class="dh"><h2 id="dT">Pedido #${esc(o.number)}</h2><button class="b" id="dX" aria-label="Fechar">✕</button></div>
    <dl><dt>Horário</dt><dd>${stamp(o.created_at)}</dd><dt>Cliente</dt><dd>${esc(o.customer_name)}</dd>
    <dt>Telefone</dt><dd><a href="https://wa.me/${wa}" target="_blank" rel="noopener">${esc(fmt(o.customer_phone.replace(/\D/g, '')))}</a> (WhatsApp)</dd>
    <dt>Preparo</dt><dd><span class="bd">${ST[o.status]}</span></dd><dt>Pagamento</dt><dd><span class="bd ${o.payment_status}">${PAY[o.payment_status]}</span>${o.paid_at ? ' em ' + stamp(o.paid_at) : ''}</dd>
    <dt>Observações</dt><dd>${o.notes ? esc(o.notes) : '<span style="color:var(--mut)">—</span>'}</dd></dl>
    <ul class="lines">${o.items.map((i) => `<li><span>${i.quantity}× ${esc(i.name)} <small style="color:var(--mut)">(${brl(i.unit_price_cents)})</small></span><b>${brl(i.unit_price_cents * i.quantity)}</b></li>`).join('')}</ul>
    <div class="tt"><span>Total</span><span>${brl(o.total_cents)}</span></div>
    <div class="acts">${pay}${st}${cancel}</div>
    ${lastEvents ? `<div class="ev">${lastEvents.map((e) => `${stamp(e.created_at)} — ${esc(e.kind)} ${esc(e.detail)} (${esc(e.actor)})`).join('<br>')}</div>` : ''}`;
}
$('#dlg').addEventListener('close', () => { openId = null; lastEvents = null; });
$('#dlg').addEventListener('click', async (e) => {
  if (e.target === $('#dlg') || e.target.id === 'dX') return $('#dlg').close();
  const b = e.target.closest('[data-st],[data-pay]'); if (!b || busy) return;
  const body = b.dataset.st ? { status: b.dataset.st } : { payment_status: b.dataset.pay };
  if (body.status === 'cancelado' && !confirm('Cancelar este pedido? Essa ação não pode ser desfeita.')) return;
  if (body.payment_status === 'pago' && !confirm('Confirmar que o Pix deste pedido foi recebido na conta?')) return;
  busy = true; document.querySelectorAll('#dlg .acts .b').forEach((x) => (x.disabled = true));
  const r = await api('PATCH', '/api/admin/orders/' + openId, body); busy = false;
  if (!r.ok) { toast(r.body?.message || 'Erro ao atualizar'); fillDialog(orders.find((x) => x.id === openId), lastEvents); return; }
  lastEvents = r.body.events; fillDialog(r.body.order, null); toast('✔ Atualizado'); refresh();
});

/* ---------- abas: produtos e configurações ---------- */
const brlIn = (c) => (c / 100).toFixed(2).replace('.', ',');
const parseBRL = (s) => { const n = Number(String(s).trim().replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) && n >= 0 && n <= 10000 ? Math.round(n * 100) : null; };
function setTab(t) {
  tab = t;
  [['orders', 'vOrders', 'tabOrders'], ['products', 'vProducts', 'tabProducts'], ['settings', 'vSettings', 'tabSettings']].forEach(([k, v, b]) => { $('#' + v).hidden = k !== t; $('#' + b).setAttribute('aria-selected', String(k === t)); });
  document.querySelector('.filters').style.visibility = t === 'orders' ? 'visible' : 'hidden';
  if (t === 'orders') refresh(); if (t === 'products') loadProducts(); if (t === 'settings') loadSettings();
}
$('#tabOrders').onclick = () => setTab('orders'); $('#tabProducts').onclick = () => setTab('products'); $('#tabSettings').onclick = () => setTab('settings');
let PRODUCTS = [];
async function loadProducts() {
  const r = await SB.rest('GET', '/rest/v1/products?select=*&order=sort', { auth: true });
  if (r.status === 401 || r.status === 403) return showLogin(); if (!r.ok) return toast('Falha ao carregar produtos');
  PRODUCTS = r.body;
  $('#plist').innerHTML = PRODUCTS.map((p) => `<div class="prow" data-id="${esc(p.id)}"><label class="sr" for="n_${esc(p.id)}">Nome</label><input id="n_${esc(p.id)}" class="pn" value="${esc(p.name)}" maxlength="80">
    <label class="sr" for="d_${esc(p.id)}">Descrição</label><input id="d_${esc(p.id)}" class="pd" value="${esc(p.description)}" maxlength="300" placeholder="Descrição">
    <label class="sr" for="p_${esc(p.id)}">Preço</label><input id="p_${esc(p.id)}" class="pp" value="${brlIn(p.price_cents)}" inputmode="decimal">
    <label class="chk"><input type="checkbox" class="pa" ${p.active ? 'checked' : ''}> Ativo</label><button class="b main psave">Salvar</button></div>`).join('');
}
$('#plist').addEventListener('click', async (e) => {
  const b = e.target.closest('.psave'); if (!b) return; const row = b.closest('.prow'), id = row.dataset.id;
  const name = row.querySelector('.pn').value.trim(), price = parseBRL(row.querySelector('.pp').value);
  if (!name) return toast('Informe o nome'); if (price === null) return toast('Preço inválido (ex.: 12,50)');
  b.disabled = true;
  const r = await SB.rest('PATCH', `/rest/v1/products?id=eq.${encodeURIComponent(id)}`, { auth: true, prefer: 'return=representation', body: { name, description: row.querySelector('.pd').value.trim(), price_cents: price, active: row.querySelector('.pa').checked } });
  b.disabled = false;
  if (r.status === 401) return showLogin();
  toast(r.ok && Array.isArray(r.body) && r.body.length ? '✔ Produto salvo' : 'Não foi possível salvar');
});
$('#npAdd').onclick = async () => {
  const name = $('#npName').value.trim(), price = parseBRL($('#npPrice').value);
  if (!name) return toast('Informe o nome'); if (price === null) return toast('Preço inválido (ex.: 19,90)');
  let id = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item';
  if (PRODUCTS.some((p) => p.id === id)) id = (id.slice(0, 34) + '-' + Date.now().toString(36).slice(-4));
  const sort = Math.max(0, ...PRODUCTS.map((p) => p.sort)) + 1;
  const r = await SB.rest('POST', '/rest/v1/products', { auth: true, prefer: 'return=minimal', body: { id, name, description: $('#npDesc').value.trim(), price_cents: price, category: $('#npCat').value, featured: false, sort, active: true } });
  if (r.status === 401) return showLogin();
  if (!r.ok) return toast('Não foi possível adicionar');
  ['npName', 'npDesc', 'npPrice'].forEach((x) => ($('#' + x).value = '')); toast('✔ Produto adicionado'); loadProducts();
};
async function loadSettings() {
  const r = await SB.rest('GET', '/rest/v1/store_settings?select=key,value', { auth: true });
  if (r.status === 401 || r.status === 403) return showLogin(); if (!r.ok) return toast('Falha ao carregar');
  const o = Object.fromEntries(r.body.map((x) => [x.key, x.value]));
  $('#sPixKey').value = o.pix_key || ''; $('#sPixType').value = o.pix_key_type || ''; $('#sPixRecv').value = o.pix_receiver || ''; $('#sWa').value = o.whatsapp || ''; $('#sAddr').value = o.address || '';
}
$('#setForm').addEventListener('submit', async (e) => {
  e.preventDefault(); const err = $('#setErr'); err.textContent = '';
  const key = $('#sPixKey').value.trim(), recv = $('#sPixRecv').value.trim(), wa = $('#sWa').value.replace(/\D/g, '');
  if (key && !recv) { err.textContent = 'Informe o nome do recebedor da chave Pix.'; return; }
  if (wa && !/^55\d{10,11}$/.test(wa)) { err.textContent = 'WhatsApp: use DDI+DDD+número, ex.: 5538999999999.'; return; }
  const rows = [{ key: 'pix_key', value: key, is_public: false }, { key: 'pix_key_type', value: $('#sPixType').value, is_public: false }, { key: 'pix_receiver', value: recv, is_public: false }, { key: 'whatsapp', value: wa, is_public: true }, { key: 'address', value: $('#sAddr').value.trim(), is_public: true }];
  const r = await SB.rest('POST', '/rest/v1/store_settings?on_conflict=key', { auth: true, prefer: 'resolution=merge-duplicates,return=minimal', body: rows });
  if (r.status === 401) return showLogin();
  if (!r.ok) { err.textContent = 'Não foi possível salvar.'; return; } toast('✔ Configurações salvas');
});

(async function init() { try { const r = await api('GET', '/api/admin/me'); if (r.ok) showApp(); else showLogin(); } catch { /* showLogin já chamado */ } })();
