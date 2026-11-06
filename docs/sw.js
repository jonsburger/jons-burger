'use strict';
/* Service worker do app do CLIENTE (JONS Burger).
   Regras de segurança/atualização:
   - Só trata arquivos do PRÓPRIO site (GET). Supabase (pedidos, cardápio, preços) NUNCA passa por aqui nem é guardado.
   - Nunca guarda o painel (/admin/).
   - Páginas, JS e CSS: sempre tenta a rede primeiro (você publica e o cliente vê a versão nova). O cache só entra se estiver sem internet.
   - Imagens: mostra a guardada e atualiza em segundo plano. */
const V = 'jons-cliente-v1';
const PRECACHE = ['offline.html', 'img/pwa-192.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url); if (u.origin !== location.origin) return;
  if (u.pathname.includes('/admin/')) return;
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r).catch(() => caches.match('offline.html')));
    return;
  }
  if (r.destination === 'image' || /\/img\//.test(u.pathname)) {
    e.respondWith(caches.open(V).then(async (c) => {
      const hit = await c.match(r);
      const net = fetch(r).then((res) => { if (res.ok) c.put(r, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  e.respondWith(fetch(r).then((res) => { if (res.ok && /\.(js|css|webmanifest)$/.test(u.pathname)) { const cp = res.clone(); caches.open(V).then((c) => c.put(r, cp)); } return res; }).catch(() => caches.match(r)));
});
