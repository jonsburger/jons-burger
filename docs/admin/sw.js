'use strict';
/* Service worker do app do PAINEL (proprietário).
   Não guarda NENHUM dado de pedidos/clientes: as chamadas ao Supabase são cross-origin e nem passam por aqui.
   Só guarda a página "sem conexão" e o ícone. Páginas, JS e CSS: sempre rede primeiro. */
const V = 'jons-painel-v1';
const PRECACHE = ['../offline.html', '../img/pwa-admin-192.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url); if (u.origin !== location.origin) return;
  if (r.mode === 'navigate') { e.respondWith(fetch(r).catch(() => caches.match('../offline.html'))); return; }
  if (/\.(js|css)$/.test(u.pathname)) { e.respondWith(fetch(r).catch(() => caches.match(r))); return; }
});
