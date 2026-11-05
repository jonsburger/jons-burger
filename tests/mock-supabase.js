'use strict';
/* SIMULADOR do Supabase usado só nos testes de interface (não é o banco real!).
   Reproduz a lógica do supabase/schema.sql (RPCs, RLS, Auth) para exercitar o front-end sem internet. */
const crypto = require('node:crypto');
const rid = (p) => p + crypto.randomBytes(12).toString('hex');
function createMock() {
  const S = { products: [], settings: [], users: [], admins: new Set(), tokens: new Map(), refresh: new Map(), orders: [], items: [], events: [], seq: 0, log: [] };
  const P = (id, name, note, d, c, cat, f, s) => S.products.push({ id, name, note, description: d, price_cents: c, category: cat, featured: f, sort: s, active: true });
  const D = '120g, queijo prato e maionese especial.';
  P('baratinho', 'JONS Baratinho', '', D, 1200, 'burger', false, 1); P('salada', 'JONS Salada', '', D, 1500, 'burger', false, 2); P('bacon', 'JONS Bacon Crisp', '', D, 1800, 'burger', false, 3); P('chicken', 'JONS Chicken Smash', '', D, 1600, 'burger', false, 4);
  P('monster', 'JONS Monster', '', 'Duplo artesanal (240g), duplo cheddar cremoso, muito bacon, cebola caramelizada, maionese JONS e pão brioche.', 2200, 'burger', true, 5);
  P('bp', 'Batata Frita P', '150g', '', 800, 'side', false, 10); P('bg', 'Batata Frita G com Cheddar e Bacon', '', '', 1400, 'side', false, 11); P('ref', 'Refrigerante lata', '350ml', '', 600, 'side', false, 12); P('suco', 'Suco Natural Del Valle', '', '', 600, 'side', false, 13); P('agua', 'Água Mineral', '', '', 350, 'side', false, 14);
  [['whatsapp', '5538999207706', true], ['address', '', true], ['pix_key', '', false], ['pix_key_type', '', false], ['pix_receiver', '', false]].forEach(([key, value, is_public]) => S.settings.push({ key, value, is_public }));
  const addUser = (email, password, admin) => { const u = { id: crypto.randomUUID(), email, password }; S.users.push(u); if (admin) S.admins.add(u.id); return u; };
  const set = (k) => (S.settings.find((x) => x.key === k) || {}).value || '';
  const pix = () => ({ configured: !!(set('pix_key') && set('pix_receiver')), key: set('pix_key') || null, keyType: set('pix_key_type') || null, receiver: set('pix_receiver') || null });
  const pub = (o) => ({ number: o.public_number, created_at: o.created_at, status: o.status, payment_status: o.payment_status, subtotal_cents: o.subtotal_cents, total_cents: o.total_cents, items: S.items.filter((i) => i.order_id === o.id).map((i) => ({ name: i.name, quantity: i.quantity, unit_price_cents: i.unit_price_cents })) });
  const adm = (o) => ({ id: o.id, number: o.public_number, created_at: o.created_at, updated_at: o.updated_at, customer_name: o.customer_name, customer_phone: o.customer_phone, notes: o.notes, subtotal_cents: o.subtotal_cents, total_cents: o.total_cents, status: o.status, payment_status: o.payment_status, paid_at: o.paid_at, items: pub(o).items });
  const err = (status, message, code = 'P0001') => ({ status, body: { code, message } });
  const ev = (order_id, kind, detail, actor) => S.events.push({ order_id, kind, detail, actor, created_at: new Date().toISOString() });

  function rpc(fn, a, user, isAdmin) {
    if (fn === 'create_order') {
      const name = String(a.p_name || '').replace(/\s+/g, ' ').trim(); if (name.length < 2 || name.length > 80) return err(400, 'ERR_NOME');
      let ph = String(a.p_phone || '').replace(/\D/g, ''); if (ph.length > 11 && ph.startsWith('55')) ph = ph.slice(2); if (ph.length < 10 || ph.length > 11) return err(400, 'ERR_TELEFONE');
      const it = a.p_items; if (!Array.isArray(it) || it.length < 1 || it.length > 40) return err(400, 'ERR_ITENS');
      const m = new Map();
      for (const e of it) { if (!e || typeof e !== 'object' || typeof e.qty !== 'number' || !/^[0-9]{1,2}$/.test(String(e.qty)) || !/^[a-z0-9_-]{1,40}$/.test(e.id || '') || e.qty < 1 || e.qty > 20) return err(400, 'ERR_ITENS'); m.set(e.id, (m.get(e.id) || 0) + e.qty); }
      const rec = S.orders.filter((o) => Date.now() - Date.parse(o.created_at) < 600000);
      if (rec.filter((o) => o.customer_phone === ph).length >= 5 || rec.length >= 100) return err(400, 'ERR_LIMITE');
      let total = 0; for (const [id, q] of m) { const p = S.products.find((x) => x.id === id && x.active); if (!p) return err(400, 'ERR_PRODUTO'); total += p.price_cents * q; if (q > 20) return err(400, 'ERR_ITENS'); }
      const id = S.orders.length + 1, o = { id, public_number: String(++S.seq).padStart(4, '0'), public_token: rid('t'), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), customer_name: name, customer_phone: ph, notes: String(a.p_notes || '').trim().slice(0, 300), subtotal_cents: total, total_cents: total, status: 'recebido', payment_status: 'aguardando', paid_at: null };
      S.orders.push(o); for (const [pid, q] of m) { const p = S.products.find((x) => x.id === pid); S.items.push({ order_id: id, product_id: pid, name: p.name, unit_price_cents: p.price_cents, quantity: q }); }
      ev(id, 'criado', '', 'cliente'); return { status: 200, body: { token: o.public_token, order: pub(o), pix: pix() } };
    }
    if (fn === 'get_order_status') { let d = String(a.p_number || '').replace(/\D/g, ''); if (d.length < 4) d = d.padStart(4, '0'); const o = S.orders.find((x) => x.public_number === d && x.public_token === (a.p_token || '')); return { status: 200, body: o ? { order: pub(o), pix: pix() } : null }; }
    if (fn === 'admin_set_status' || fn === 'admin_set_payment') {
      if (!user) return err(401, 'permission denied for function ' + fn, '42501'); if (!isAdmin) return err(403, 'ERR_NAO_AUTORIZADO', '42501');
      const o = S.orders.find((x) => x.id === a.p_id); if (!o) return err(400, 'ERR_NAO_ENCONTRADO');
      if (fn === 'admin_set_status') {
        const ok = (o.status === 'recebido' && ['preparo', 'cancelado'].includes(a.p_status)) || (o.status === 'preparo' && ['pronto', 'cancelado'].includes(a.p_status)) || (o.status === 'pronto' && ['entregue', 'cancelado'].includes(a.p_status)); if (!ok) return err(400, 'ERR_TRANSICAO');
        ev(o.id, 'status', o.status + ' -> ' + a.p_status, user.email); o.status = a.p_status; if (a.p_status === 'cancelado' && o.payment_status === 'aguardando') o.payment_status = 'cancelado';
      } else {
        if (o.status === 'cancelado') return err(400, 'ERR_CANCELADO');
        if (a.p_paid && o.payment_status === 'aguardando') { o.payment_status = 'pago'; o.paid_at = new Date().toISOString(); } else if (!a.p_paid && o.payment_status === 'pago') { o.payment_status = 'aguardando'; o.paid_at = null; } else return err(400, 'ERR_TRANSICAO');
        ev(o.id, 'pagamento', 'pagamento alterado', user.email);
      }
      o.updated_at = new Date().toISOString(); return { status: 200, body: adm(o) };
    }
    return err(404, 'function not found', 'PGRST202');
  }
  function handle(method, url, headers, bodyText) {
    const u = new URL(url), p = u.pathname, q = u.searchParams;
    if (!headers.apikey) return err(401, 'No API key found in request', '401');
    const body = bodyText ? JSON.parse(bodyText) : null;
    const tk = (headers.authorization || '').replace('Bearer ', ''), user = S.tokens.get(tk) || null, isAdmin = !!user && S.admins.has(user.id);
    S.log.push(method + ' ' + p + (user ? ' [auth:' + user.email + ']' : ' [anon]'));
    if (p === '/auth/v1/token') {
      const g = q.get('grant_type'); let usr = null;
      if (g === 'password') usr = S.users.find((x) => x.email === body.email && x.password === body.password);
      if (g === 'refresh_token') usr = S.refresh.get(body.refresh_token);
      if (!usr) return { status: 400, body: { error: 'invalid_grant', error_description: 'Invalid login credentials' } };
      const access = rid('tok_'), refresh = rid('ref_'); S.tokens.set(access, usr); S.refresh.set(refresh, usr);
      return { status: 200, body: { access_token: access, refresh_token: refresh, expires_in: 3600, user: { id: usr.id, email: usr.email } } };
    }
    if (p === '/auth/v1/logout') { S.tokens.delete(tk); return { status: 204, body: null }; }
    let m = p.match(/^\/rest\/v1\/rpc\/(\w+)$/); if (m) return rpc(m[1], body || {}, user, isAdmin);
    m = p.match(/^\/rest\/v1\/(\w+)$/); if (!m) return err(404, 'not found', 'PGRST125'); const t = m[1];
    const eq = (k) => { const v = q.get(k); return v && v.startsWith('eq.') ? v.slice(3) : null; };
    if (method === 'GET') {
      if (t === 'products') { let r = S.products.filter((x) => isAdmin || x.active); if (eq('active')) r = r.filter((x) => String(x.active) === eq('active')); return { status: 200, body: r.sort((a, b) => a.sort - b.sort) }; }
      if (t === 'store_settings') return { status: 200, body: S.settings.filter((x) => isAdmin || x.is_public) };
      if (t === 'admins') return user ? { status: 200, body: isAdmin ? [{ user_id: user.id }] : [] } : err(401, 'permission denied for table admins', '42501');
      if (t === 'orders') {
        if (!user) return err(401, 'permission denied for table orders', '42501'); if (!isAdmin) return { status: 200, body: [] };
        const ge = q.getAll('created_at').find((x) => x.startsWith('gte.')), lt = q.getAll('created_at').find((x) => x.startsWith('lt.'));
        let r = S.orders.filter((o) => (!ge || o.created_at >= ge.slice(4)) && (!lt || o.created_at < lt.slice(3)) && (!eq('id') || String(o.id) === eq('id')));
        r = r.sort((a, b) => b.id - a.id).map((o) => ({ ...o, order_items: S.items.filter((i) => i.order_id === o.id) })); return { status: 200, body: r };
      }
      if (t === 'order_events') return user && isAdmin ? { status: 200, body: S.events.filter((e) => String(e.order_id) === eq('order_id')) } : (user ? { status: 200, body: [] } : err(401, 'permission denied', '42501'));
    }
    if (method === 'PATCH' && t === 'products') { if (!isAdmin) return { status: 200, body: [] }; const r = S.products.filter((x) => x.id === eq('id')); r.forEach((x) => Object.assign(x, body)); return { status: 200, body: r }; }
    if (method === 'POST' && t === 'products') { if (!isAdmin) return err(403, 'new row violates row-level security policy', '42501'); S.products.push({ ...body }); return { status: 201, body: null }; }
    if (method === 'POST' && t === 'store_settings') { if (!isAdmin) return err(403, 'new row violates row-level security policy', '42501'); for (const r of body) { const x = S.settings.find((s) => s.key === r.key); if (x) Object.assign(x, r); else S.settings.push(r); } return { status: 201, body: null }; }
    return err(404, 'not handled', 'PGRST000');
  }
  return { S, handle, addUser };
}
module.exports = { createMock };
