'use strict';
/* Testes de interface (Playwright + Chromium) contra o SIMULADOR do Supabase.  Uso: node tests/e2e.js */
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require(process.env.PW_PATH || 'playwright');
const { createMock } = require('./mock-supabase');
const DOCS = path.join(__dirname, '..', 'docs'), SUB = '/jons-burger';
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.jpg': 'image/jpeg' };
const MOCKURL = 'https://mockproj.supabase.co', KEY = 'sb_publishable_' + 'x'.repeat(24);
(async () => {
  const out = []; const ok = (n, c, d = '') => out.push((c ? 'OK   ' : 'FALHA') + ' ' + n + (d ? ' — ' + d : ''));
  const srv = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (!p.startsWith(SUB + '/')) { r.writeHead(404); return r.end(); } p = p.slice(SUB.length); if (p.endsWith('/')) p += 'index.html'; const f = path.join(DOCS, p); if (!f.startsWith(DOCS) || !fs.existsSync(f)) { r.writeHead(404); return r.end('404'); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f)); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const BASE = `http://127.0.0.1:${srv.address().port}${SUB}`;
  const mock = createMock(); mock.addUser('dono@jons.test', 'senha-forte-123', true); mock.addUser('intruso@jons.test', 'outra-senha-123', false);
  const br = await chromium.launch(); const errs = [];
  async function newCtx(opts = {}, configured = true) {
    const ctx = await br.newContext(opts);
    await ctx.route(`${MOCKURL}/**`, async (route) => { const rq = route.request(); const r = mock.handle(rq.method(), rq.url(), rq.headers(), rq.postData()); await route.fulfill({ status: r.status, contentType: 'application/json', body: r.body === null ? 'null' : JSON.stringify(r.body), headers: { 'access-control-allow-origin': '*' } }); });
    await ctx.route('**/jons-burger/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: configured ? `window.JONS_CONFIG={SUPABASE_URL:"${MOCKURL}",SUPABASE_PUBLISHABLE_KEY:"${KEY}"};` : 'window.JONS_CONFIG={SUPABASE_URL:"",SUPABASE_PUBLISHABLE_KEY:""};' }));
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    return ctx;
  }
  const watch = (pg, tag) => { pg.on('pageerror', (e) => errs.push(tag + ' pageerror ' + e.message)); pg.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d|ERR_FAILED|fonts/.test(m.text())) errs.push(tag + ' console ' + m.text()); }); };

  // ---- 0. sem configuração ----
  { const c = await newCtx({}, false), p = await c.newPage(); watch(p, 'semcfg'); await p.goto(BASE + '/'); await p.waitForTimeout(800);
    ok('sem config.js preenchido: site não quebra e avisa', /não foi possível carregar o cardápio/i.test(await p.innerText('#burgers'))); await c.close(); }

  // ---- 1. cliente (celular, subpasta /jons-burger/ como no GitHub Pages) ----
  const cc = await newCtx({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }), pg = await cc.newPage(); watch(pg, 'cliente');
  await pg.goto(BASE + '/'); await pg.waitForSelector('#burgers .item');
  ok('cardápio carregado do banco (5 burgers + 5 acompanhamentos)', (await pg.$$('#burgers .item')).length === 5 && (await pg.$$('#sides .li')).length === 5);
  ok('imagens com caminho relativo carregam na subpasta', await pg.evaluate(() => [...document.images].filter((i) => i.complete && i.src.includes('/img/')).every((i) => i.naturalWidth > 0)));
  ok('preço do Monster vem do banco (R$ 22,00)', (await pg.textContent('#mprice')) === 'R$ 22,00');
  await pg.click('#orderHero'); await pg.waitForTimeout(600); ok('hero vazio leva ao cardápio', (await pg.evaluate(() => scrollY)) > 300);
  await pg.click('[data-add="monster"] >> nth=0'); await pg.click('[data-add="baratinho"]'); await pg.click('[data-add="bp"]');
  await pg.click('#orderHero'); await pg.waitForTimeout(500); ok('hero com itens abre o carrinho', await pg.$eval('#cart', (e) => e.classList.contains('on')));
  ok('total R$ 42,00', (await pg.textContent('#tot')) === 'R$ 42,00');
  await pg.click('[data-u="monster"]'); ok('aumentar → R$ 64,00', (await pg.textContent('#tot')) === 'R$ 64,00');
  await pg.click('[data-d="monster"]'); await pg.click('[data-rm="bp"]'); ok('diminuir e remover → R$ 34,00', (await pg.textContent('#tot')) === 'R$ 34,00');
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(300); ok('Escape fecha o carrinho', !(await pg.$eval('#cart', (e) => e.classList.contains('on'))));
  await pg.click('#cartBtn'); await pg.click('#send'); await pg.waitForTimeout(300); ok('validação exibida (nome/telefone)', /nome/i.test(await pg.textContent('#formErr')));
  await pg.fill('#cname', 'Cliente E2E'); await pg.fill('#cphone', '(38) 99999-1111'); await pg.fill('#obs', 'bem passado'); await pg.click('#send'); await pg.waitForSelector('#viewDone:not([hidden]) .pix');
  const num = (await pg.textContent('#cartTitle')).replace(/\D/g, ''); ok('pedido criado com número', /^\d{4}$/.test(num), '#' + num);
  ok('Pix não configurado: aviso (nada inventado)', /ainda não foi configurada/.test(await pg.innerText('#viewDone')));
  ok('gravado c/ preço do banco', mock.S.orders[0].total_cents === 3400 && mock.S.orders[0].customer_phone === '38999991111');
  ok('sem botão "já paguei"', !/já paguei/i.test(await pg.innerText('#viewDone')));
  // adulteração direta pela API pública
  const tam = await pg.evaluate(async () => (await SB.rpc('create_order', { p_name: 'Hacker', p_phone: '38911112222', p_notes: '', p_items: [{ id: 'monster', qty: 1, price: 1, price_cents: 1, unit_price_cents: 1 }] })).body.order.total_cents);
  ok('preço adulterado no navegador é ignorado (total do banco R$ 22,00)', tam === 2200, String(tam));
  const priv = await pg.evaluate(async () => ({ orders: (await SB.rest('GET', '/rest/v1/orders?select=*')).status, items: (await SB.rest('GET', '/rest/v1/order_items?select=*')).status, adminfn: (await SB.rpc('admin_set_payment', { p_id: 1, p_paid: true })).status, settings: (await SB.rest('GET', '/rest/v1/store_settings?select=key')).body.map((x) => x.key), wrong: (await SB.rpc('get_order_status', { p_number: '0001', p_token: 'errado' })).body }));
  ok('anônimo NÃO lê pedidos', priv.orders === 401); ok('anônimo NÃO chama funções de admin', priv.adminfn === 401);
  ok('anônimo NÃO vê chave Pix nas configurações', !priv.settings.some((k) => k.startsWith('pix_'))); ok('token errado não retorna pedido', priv.wrong === null);
  await pg.reload(); await pg.waitForSelector('#burgers .item'); await pg.click('#cartBtn'); ok('após recarregar, reabre o pedido (código guardado no navegador)', /Pedido #/.test(await pg.textContent('#cartTitle')));
  await pg.screenshot({ path: '/tmp/sb_pix_pending.png' });

  // ---- 2. admin ----
  const ac = await newCtx({ viewport: { width: 1280, height: 800 } }), ap = await ac.newPage(); watch(ap, 'admin'); ap.on('dialog', (d) => d.accept());
  await ap.goto(BASE + '/admin/'); await ap.waitForSelector('#loginForm:visible'); ok('painel exige login (sem sessão)', !(await ap.isVisible('#app')));
  await ap.fill('#u', 'dono@jons.test'); await ap.fill('#p', 'errada'); await ap.click('#loginForm button'); await ap.waitForTimeout(400); ok('senha errada → erro', /incorretos/.test(await ap.textContent('#lerr')));
  await ap.fill('#u', 'intruso@jons.test'); await ap.fill('#p', 'outra-senha-123'); await ap.click('#loginForm button'); await ap.waitForTimeout(500);
  ok('usuário logado mas NÃO-admin é barrado', /permissão/.test(await ap.textContent('#lerr')) && !(await ap.isVisible('#app')));
  await ap.fill('#u', 'dono@jons.test'); await ap.fill('#p', 'senha-forte-123'); await ap.click('#loginForm button'); await ap.waitForSelector('#cols .card');
  ok('admin vê pedidos do dia', (await ap.$$('#cols .card')).length === 2 && (await ap.textContent('#sCount')) === '2');
  ok('login escondido após entrar', !(await ap.isVisible('#login')));
  const card = ap.locator('#cols .card', { hasText: 'Cliente E2E' }); await card.click(); await ap.waitForSelector('#dlg[open]');
  const dt = await ap.innerText('#dBody'); ok('detalhe: nome, telefone, obs, itens', ['Cliente E2E', '(38) 99999-1111', 'bem passado', 'JONS Monster'].every((s) => dt.includes(s)));
  await ap.click('[data-pay="pago"]'); await ap.waitForSelector('text=Desfazer confirmação'); await ap.click('[data-st="preparo"]'); await ap.waitForSelector('[data-st="pronto"]');
  await ap.screenshot({ path: '/tmp/sb_admin_dlg.png' }); await ap.keyboard.press('Escape'); await ap.waitForTimeout(300);
  ok('pagamento manual confirmado e pedido em preparo', mock.S.orders[0].payment_status === 'pago' && mock.S.orders[0].status === 'preparo' && (await ap.textContent('#sPaid')) === 'R$ 34,00');
  ok('histórico registra o admin', mock.S.events.some((e) => e.kind === 'pagamento' && e.actor === 'dono@jons.test'));
  await pg.evaluate(() => refreshLast()); await pg.waitForTimeout(500); ok('cliente vê "Pago" e "Em preparo"', (await pg.textContent('#bPay')) === 'Pago' && (await pg.textContent('#bSt')) === 'Em preparo');
  // Pix
  await ap.click('#tabSettings'); await ap.fill('#sPixKey', 'chave-teste@jons.test'); await ap.selectOption('#sPixType', 'E-mail'); await ap.fill('#sPixRecv', 'JONS TESTE'); await ap.fill('#sAddr', 'Endereço de teste, 123'); await ap.click('#setForm button'); await ap.waitForTimeout(500);
  ok('admin salva Pix e endereço', mock.S.settings.find((s) => s.key === 'pix_key').value === 'chave-teste@jons.test');
  // preço
  await ap.click('#tabProducts'); await ap.waitForSelector('#plist .prow'); await ap.fill('#p_monster', '25,50'); await ap.locator('.prow[data-id="monster"] .psave').click(); await ap.waitForTimeout(500);
  await ap.fill('#npName', 'JONS Veggie'); await ap.fill('#npDesc', 'Teste'); await ap.fill('#npPrice', '19,90'); await ap.click('#npAdd'); await ap.waitForTimeout(600);
  ok('admin altera preço e cria produto', mock.S.products.find((p) => p.id === 'monster').price_cents === 2550 && mock.S.products.some((p) => p.id === 'jons-veggie' && p.price_cents === 1990));
  ok('pedido antigo mantém o preço da hora', mock.S.items.find((i) => i.order_id === 1 && i.product_id === 'monster').unit_price_cents === 2200);
  // cliente novo pedido: preço novo + Pix visível
  await pg.click('#newOrder'); await pg.keyboard.press('Escape'); await pg.reload(); await pg.waitForSelector('#burgers .item');
  ok('site mostra novo preço do Monster e o produto novo', (await pg.textContent('#mprice')) === 'R$ 25,50' && (await pg.textContent('#burgers')).includes('JONS Veggie'));
  await pg.click('[data-add="agua"]'); await pg.click('#cartBtn'); await pg.fill('#cname', 'Segundo'); await pg.fill('#cphone', '38988887777'); await pg.click('#send'); await pg.waitForSelector('#viewDone .pix .mono');
  const dn = await pg.innerText('#viewDone'); ok('Pix configurado aparece (chave, recebedor, valor exato)', dn.includes('chave-teste@jons.test') && dn.includes('JONS TESTE') && dn.includes('R$ 3,50'));
  await pg.screenshot({ path: '/tmp/sb_pix_ok.png' });
  await ap.click('#tabOrders'); await ap.waitForFunction(() => document.querySelectorAll('#cols .card').length >= 3, null, { timeout: 15000 }); ok('painel recebe o novo pedido sozinho (atualização automática)', true);
  // sessão e logout
  await ap.reload(); await ap.waitForSelector('#cols .card'); ok('sessão persiste ao recarregar a aba', await ap.isVisible('#app'));
  await ap.click('#out'); await ap.waitForSelector('#login:not([hidden])'); ok('logout: painel some', !(await ap.isVisible('#app')));
  const after = await ap.evaluate(async () => (await SB.rest('GET', '/rest/v1/orders?select=*', { auth: true })).status); ok('após logout não lê pedidos', after === 401);
  await ap.screenshot({ path: '/tmp/sb_admin_login.png' });
  ok('nenhuma chamada usou chave service_role (só apikey pública)', !mock.S.log.some((l) => /service_role/.test(l)));

  // ---- 3. responsividade / movimento ----
  for (const [w, h] of [[320, 640], [360, 780], [390, 844], [430, 932], [768, 1024], [1280, 800], [1440, 900]]) {
    const c = await newCtx({ viewport: { width: w, height: h } }), p = await c.newPage(); await p.goto(BASE + '/'); await p.waitForSelector('#burgers .item'); await p.waitForTimeout(500);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    const bad = await p.evaluate(() => { const W = innerWidth; return [...document.querySelectorAll('header *, #burgers .item *, #sides *, .hero *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > W + 1 || r.left < -1) && !e.closest('.mq,.big,.badge,.bgi'); }).length; });
    ok(`${w}px: sem rolagem horizontal e sem itens cortados`, over <= 1 && bad === 0, `sobra ${over}px, cortados ${bad}`);
    if (w === 320) { await p.screenshot({ path: '/tmp/sb_home_320.png' }); await p.click('#menuBtn'); await p.waitForTimeout(700); await p.keyboard.press('Escape'); await p.waitForTimeout(300); ok('Escape fecha o menu', !(await p.$eval('#nav', (e) => e.classList.contains('on')))); }
    await c.close();
  }
  const rc = await newCtx({ reducedMotion: 'reduce' }), rp = await rc.newPage(); await rp.goto(BASE + '/'); await rp.waitForTimeout(400);
  ok('prefers-reduced-motion desliga animações', await rp.evaluate(() => getComputedStyle(document.querySelector('.badge')).animationName === 'none'));
  ok('sem erros de JavaScript', errs.length === 0, errs.join(' | '));
  console.log(out.join('\n')); console.log(`\n${out.filter((x) => x.startsWith('OK')).length} OK, ${out.filter((x) => x.startsWith('FALHA')).length} FALHA`);
  await br.close(); srv.close(); process.exit(out.some((x) => x.startsWith('FALHA')) ? 1 : 0);
})().catch((e) => { console.error('ERRO NO TESTE', e); process.exit(2); });
