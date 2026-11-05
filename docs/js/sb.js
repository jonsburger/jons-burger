'use strict';
/* Cliente mínimo do Supabase (sem bibliotecas): REST/RPC do PostgREST e login do Supabase Auth.
   Usa apenas a chave PÚBLICA. O token do administrador fica só em sessionStorage (some ao fechar a aba). */
(function () {
  const C = window.JONS_CONFIG || {};
  const URLBASE = String(C.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const KEY = String(C.SUPABASE_PUBLISHABLE_KEY || '').trim();
  const configured = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(URLBASE) && KEY.length > 20 && !/COLE_AQUI|SEU-PROJETO/.test(URLBASE + KEY);
  const SKEY = 'jons_admin_session';

  const getSess = () => { try { return JSON.parse(sessionStorage.getItem(SKEY)); } catch { return null; } };
  const setSess = (s) => { try { s ? sessionStorage.setItem(SKEY, JSON.stringify(s)) : sessionStorage.removeItem(SKEY); } catch {} };

  async function raw(method, path, { body, token, prefer } = {}) {
    if (!configured) return { ok: false, status: 0, body: { message: 'config' } };
    const h = { apikey: KEY };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (token) h.Authorization = 'Bearer ' + token;
    if (prefer) h.Prefer = prefer;
    try {
      const r = await fetch(URLBASE + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
      let j = null; try { j = await r.json(); } catch {}
      return { ok: r.ok, status: r.status, body: j };
    } catch { return { ok: false, status: 0, body: { message: 'Sem conexão.' } }; }
  }
  function store(j) { setSess({ access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000, email: j.user && j.user.email }); }
  async function token() {
    const s = getSess(); if (!s) return null;
    if (s.exp - Date.now() > 60000) return s.access;
    const r = await raw('POST', '/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: s.refresh } });
    if (r.ok && r.body && r.body.access_token) { store(r.body); return r.body.access_token; }
    setSess(null); return null;
  }
  window.SB = {
    configured,
    rest: async (method, path, opts = {}) => raw(method, path, { ...opts, token: opts.auth ? await token() : null }),
    rpc: async (fn, args, auth) => raw('POST', '/rest/v1/rpc/' + fn, { body: args || {}, token: auth ? await token() : null }),
    async login(email, password) {
      const r = await raw('POST', '/auth/v1/token?grant_type=password', { body: { email: String(email).trim(), password } });
      if (r.ok && r.body && r.body.access_token) { store(r.body); return { ok: true }; }
      return { ok: false, status: r.status };
    },
    async logout() { const t = await token(); if (t) await raw('POST', '/auth/v1/logout', { token: t, body: {} }); setSess(null); },
    hasSession: () => !!getSess(),
  };
})();
