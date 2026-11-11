'use strict';
/* Service worker do app do CLIENTE (JONS Burger).
   Regras de segurança/atualização:
   - Só trata arquivos do PRÓPRIO site (GET). Supabase (pedidos, cardápio, preços) NUNCA passa por aqui nem é guardado.
   - Nunca guarda o painel (/admin/).
   - Páginas, JS e CSS: sempre tenta a rede primeiro (você publica e o cliente vê a versão nova). O cache só entra se estiver sem internet.
   - Imagens: mostra a guardada e atualiza em segundo plano. */
const V = 'jons-cliente-v2';
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

/* Notificações push: mostra o aviso e, ao tocar, abre/volta para o app. */
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'JONS Burger', { body: d.body || '', icon: 'img/pwa-192.png', badge: 'img/pwa-192.png', tag: d.tag || 'jons-pedido', renotify: true, data: { url: d.url || './' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => { const c = cs.find((x) => x.url.startsWith(self.registration.scope)); return c ? c.focus() : clients.openWindow(target); }));
});
