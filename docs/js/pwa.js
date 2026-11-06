'use strict';
/* Registra o service worker e controla o botão "Instalar o app" (Android/Chrome) e a dica do iPhone (Safari). */
(function () {
  const me = document.currentScript, sw = (me && me.dataset.sw) || 'sw.js';
  const secure = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
  if ('serviceWorker' in navigator && secure) addEventListener('load', () => navigator.serviceWorker.register(sw).catch(() => {}));

  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const btns = [...document.querySelectorAll('[data-install]')];
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  let deferred = null;
  const setHidden = (h) => btns.forEach((b) => (b.hidden = h));
  if (standalone) { setHidden(true); return; }
  if (ios) setHidden(false);                        // iOS não dispara o evento: mostramos a dica
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; setHidden(false); });
  addEventListener('appinstalled', () => { deferred = null; setHidden(true); });

  function hint() {
    if (document.getElementById('iosHint')) return;
    const d = document.createElement('div'); d.id = 'iosHint'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'Como instalar o app');
    d.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(14px + env(safe-area-inset-bottom,0px));z-index:200;background:#fff;color:#000;padding:16px 18px;font:600 17px/1.4 system-ui,sans-serif;box-shadow:0 10px 30px #000a';
    d.innerHTML = 'Para instalar no iPhone: toque em <b>Compartilhar</b> (o quadrado com a seta) e depois em <b>“Adicionar à Tela de Início”</b>. Use o Safari.<br><button type="button" style="margin-top:10px;padding:10px 18px;border:0;background:#ff7a00;font:700 16px system-ui;cursor:pointer">Entendi</button>';
    d.querySelector('button').onclick = () => d.remove(); document.body.appendChild(d); d.querySelector('button').focus();
  }
  btns.forEach((b) => b.addEventListener('click', async () => {
    if (deferred) { deferred.prompt(); try { await deferred.userChoice; } catch {} deferred = null; setHidden(true); }
    else if (ios) hint();
  }));
})();
