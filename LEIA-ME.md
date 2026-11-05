# JONS Burger — site + pedidos com serviços 100% gratuitos
**GitHub (código) + GitHub Pages (site) + Supabase Free (banco, login e regras de segurança).** Sem servidor Node, sem hospedagem paga.

---
## 1. Como funciona (arquitetura)
```
Cliente (celular/PC) ──► Site estático no GitHub Pages (pasta docs/)
                              │  fala direto com o Supabase usando só a chave PÚBLICA
                              ▼
                    Supabase (PostgreSQL + Auth)
                      • RLS: visitante só lê cardápio
                      • create_order(): grava o pedido e CALCULA o total com os preços do banco
                      • get_order_status(): cliente só vê o próprio pedido (número + código secreto)
                      • admin_set_status()/admin_set_payment(): só quem está na tabela "admins"
Proprietário ──► /admin/ ──► login (Supabase Auth) ──► lê pedidos, muda status, confirma Pix, edita preços/Pix
```
- **Não precisamos de Edge Function** hoje: as regras que exigem confiança (calcular total, trocar status) rodam **dentro do PostgreSQL** (funções `security definer`), de graça e sem outro servidor. Existe só um esqueleto desativado (`supabase/functions/pix-webhook`) para o dia em que houver um provedor de Pix com webhook.
- **Chaves:** o site usa apenas a chave **pública** (publishable/anon). A chave `service_role`/`secret` **nunca** é usada nem deve ser colocada no site.
- **Pix:** manual. O cliente vê a chave, o recebedor e o valor exato; **só o administrador marca "Pago"**. Nada é confirmado automaticamente.

## 2. Serviços e limites gratuitos que importam (confira nas páginas oficiais; mudam com o tempo)
| Serviço | O que usamos | Limites relevantes |
|---|---|---|
| **GitHub** | guardar o código e o histórico | repositório público gratuito |
| **GitHub Pages** | hospedar o site | site até 1 GB; limite "suave" de 100 GB/mês de banda; só repositórios **públicos** no plano gratuito. **Atenção:** os termos do GitHub dizem que o Pages não deve ser usado como hospedagem gratuita para negócio/e-commerce. Para o **PIT (demonstração)** serve bem; para **vender de verdade**, use a alternativa abaixo. |
| **Supabase Free** | banco PostgreSQL, login do admin | 500 MB de banco, 5 GB de tráfego, 50 mil usuários ativos/mês, 2 projetos ativos; **projeto é pausado após 7 dias sem atividade** (os dados não são apagados; você reativa no painel); **sem backup automático** no plano gratuito |
| **Netlify** (alternativa) | hospedar a mesma pasta `docs/` | plano gratuito por créditos (300/mês, limite rígido; ~15 GB de banda); uso comercial permitido no plano gratuito |

**Pausa do Supabase:** com pedidos todo dia o projeto fica ativo. Para fins de semana/feriados parados, o repositório traz `.github/workflows/keepalive.yml`, que faz uma leitura leve 2x por semana (precisa de 2 *secrets*, veja o Passo 11). Não há garantia absoluta de que isso evite a pausa; fique de olho.

## 3. Estrutura de arquivos
```
docs/                        ← o SITE (é esta pasta que o GitHub Pages publica)
  index.html  config.js  config.example.js
  css/site.css   js/app.js (site do cliente)   js/sb.js (acesso ao Supabase)
  img/ (fotos, logo, og.jpg)
  admin/ index.html  admin.js  admin.css   ← painel do proprietário
supabase/
  schema.sql                 ← cria tabelas, RLS, funções e o cardápio (rodar 1x)
  primeiro-admin.sql         ← registra o 1º administrador
  verificar-seguranca.sql    ← testes de segurança para rodar no SQL Editor
  functions/pix-webhook/     ← esqueleto desativado (futuro)
.github/workflows/keepalive.yml
tests/                       ← testes automáticos de interface (opcional)
LEIA-ME.md
```

## 4. Passo a passo (do zero)
> Os nomes de menus podem mudar um pouco nos sites; o caminho geral é o mesmo.

### A) GitHub
1. **Passo 1 — Conta:** crie uma conta gratuita em github.com.
2. **Passo 2 — Repositório:** botão **New repository** → nome `jons-burger` → **Public** → *Create repository*.
3. **Passo 3 — Enviar os arquivos.** Opção fácil: no repositório, **Add file → Upload files** e arraste **o conteúdo** da pasta do projeto (as pastas `docs`, `supabase`, `tests` e o `LEIA-ME.md`) → *Commit changes*. (A pasta oculta `.github` pode não arrastar; ela é opcional, só para o keepalive. Alternativa completa: instale o **GitHub Desktop**, *File → Add local repository* e *Publish*; ou, no terminal: `git init`, `git add .`, `git commit -m "JONS Burger"`, `git branch -M main`, `git remote add origin https://github.com/SEU_USUARIO/jons-burger.git`, `git push -u origin main`.)

### B) Supabase
4. **Passo 4 — Projeto:** supabase.com → *Start your project* (entre com o GitHub) → **New project** → nome `jons-burger`, **defina uma senha do banco e guarde-a**, região **South America (São Paulo)**, plano **Free**.
5. **Passo 5 — Tabelas e regras:** menu **SQL Editor → New query** → cole **todo** o `supabase/schema.sql` → **Run**. Deve aparecer "Success". (Pode rodar de novo sem problemas.)
6. **Passo 6 — Login do administrador:** **Authentication → Users → Add user → Create new user**; informe **seu e-mail e uma senha forte**; marque **Auto Confirm User**. Depois, em **Authentication → Sign In / Providers**, **desligue o cadastro público** ("Allow new users to sign up").
7. **Passo 7 — Tornar esse usuário administrador:** SQL Editor → abra `supabase/primeiro-admin.sql`, troque `COLOQUE_AQUI_O_EMAIL_DO_ADMIN` pelo seu e-mail → **Run**. A última linha deve mostrar o seu e-mail. *(A senha nunca fica no código.)*
8. **Passo 8 — Copiar a URL e a chave pública:** **Project Settings → API Keys** (ou *API*): copie a **Project URL** (`https://xxxx.supabase.co`) e a chave **Publishable** (em contas antigas: **anon public**). **Nunca** copie a `service_role`/`secret`.

### C) Conectar e publicar
9. **Passo 9 — Preencher o `docs/config.js`:** no GitHub, abra `docs/config.js` → ícone do lápis → cole a URL e a chave nos dois campos → **Commit changes**. (Essas duas informações são públicas por natureza.)
10. **Passo 10 — Publicar:** repositório → **Settings → Pages** → *Build and deployment* → **Source: Deploy from a branch** → **Branch: main** e pasta **/docs** → **Save**. Em 1–2 minutos aparece o endereço `https://SEU_USUARIO.github.io/jons-burger/`. O painel fica em `.../admin/`.
11. **Passo 11 (opcional) — Keepalive:** repositório → **Settings → Secrets and variables → Actions → New repository secret**: crie `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` (os mesmos valores do Passo 8). Em **Actions**, rode o workflow uma vez ("Run workflow") para testar.

### D) Configurar o negócio (pelo painel)
12. Abra `/admin/`, entre com seu e-mail e senha. Vá em **Configurações (Pix)** e preencha **a sua chave Pix real, o tipo e o nome do recebedor**, confira o WhatsApp e, quando tiver, o **endereço**. Em **Produtos e preços** ajuste valores; pedidos antigos mantêm o preço da época.
13. **Fotos dos produtos:** os arquivos ficam em `docs/img/`. Para trocar uma foto, envie outra com o **mesmo nome** (GitHub → pasta `docs/img` → *Add file → Upload files*). Produto novo criado no painel aparece com o logotipo até você mapear uma foto em `PRODUCT_IMG` (`docs/js/app.js`).
14. **Compartilhamento (Open Graph):** com o endereço do site, abra `docs/index.html` e siga o comentário do `<head>` para ativar `og:image` e `og:url`.

## 5. Checklist de testes (faça depois de publicar)
- [ ] Site abre em `https://…github.io/jons-burger/` e mostra o cardápio com preços (se aparecer erro de configuração, revise o Passo 9).
- [ ] Adicionar, aumentar, diminuir e remover itens; total correto.
- [ ] Fazer um pedido de teste com seu nome/telefone → aparece **número do pedido** e **Pix** com seus dados.
- [ ] Entrar em `/admin/`; o pedido aparece; abrir detalhes; **Confirmar pagamento**; mudar para *Em preparo → Pronto → Entregue*.
- [ ] No site do cliente (mesmo celular), o status muda para "Pago"/"Em preparo" em até ~10 s.
- [ ] Alterar um preço no painel; recarregar o site; ver o preço novo.
- [ ] **Segurança:** janela anônima em `/admin/` exige login; no Supabase rode `supabase/verificar-seguranca.sql` (bloco a bloco) e compare com o "ESPERADO".
- [ ] Cancelar o pedido de teste; conferir que pagamento cancelado não pode ser confirmado.
- [ ] Testar no celular real (Android e iPhone) e em tela de 320 px.
- [ ] Apagar os pedidos de teste antes de abrir ao público (Supabase → Table Editor → `orders` → apagar linhas; itens e eventos somem junto).

## 6. Rotina e backup
- **Backup:** o plano gratuito **não tem backup automático**. Faça toda semana: Supabase → **Table Editor → orders** (e `order_items`) → **Export → CSV**. O esquema já está no repositório (`schema.sql`).
- **Projeto pausado?** Supabase → *Restore project*. Dados preservados.
- **Atualizar o site:** edite o arquivo no GitHub e faça *Commit*; o Pages republica sozinho.
- **Privacidade (LGPD):** o sistema guarda nome e telefone de clientes; informe isso aos clientes e apague dados antigos quando não precisar mais.

## 7. Se o GitHub Pages não servir (uso comercial real): Netlify
O site é só HTML/CSS/JS, então a mesma pasta `docs/` funciona no Netlify: entre em app.netlify.com → **Add new site → Deploy manually** → arraste a pasta `docs`. Nada muda no Supabase. (Se usar domínio próprio ou outro endereço, nada a ajustar; o login por e-mail/senha não depende de redirecionamentos.)

## 8. Segurança — o que é público e o que é secreto
- Público (pode ficar no repositório): `docs/config.js` (URL + chave pública), todo o código e o SQL.
- Secreto: senha do banco, chave `service_role`/`secret`, senha do administrador. **Nada disso está no projeto.**
- Limite conhecido: o pedido é público (qualquer pessoa pode tentar criar). O banco limita 5 pedidos por telefone e 100 por 10 min, mas **não há CAPTCHA**; se houver abuso, avise para adicionarmos Cloudflare Turnstile.

## 9. Relatório honesto de testes
**Feito (neste ambiente):**
- Sintaxe de todo o JavaScript conferida.
- 50 verificações de interface com Chromium (Playwright) contra um **simulador** do Supabase (`tests/mock-supabase.js`) que reproduz a lógica do `schema.sql`: cardápio, carrinho, pedido, Pix (com e sem configuração), preço adulterado ignorado, anônimo sem acesso a pedidos/funções de admin, código errado não revela pedido, login (senha errada, usuário não-admin, admin), lista/detalhe, pagamento manual, status, edição de preço e produto novo, Pix/endereço nas configurações, atualização automática, sessão, logout, site servido em subpasta (como no GitHub Pages), larguras de 320 a 1440 px, Escape, `prefers-reduced-motion`.
- Resultado: 50 OK, 0 falhas (depois de corrigir um bug de tela de login que o teste encontrou).

**NÃO testado (precisa de você):**
- O **`schema.sql` num PostgreSQL/Supabase real**: não havia PostgreSQL neste ambiente, então o SQL foi revisado, mas **não executado**. Se o *Run* acusar erro, copie a mensagem e me envie.
- Supabase Auth e a API reais, o deploy no GitHub Pages, o workflow keepalive, o Pix real e celulares reais.
- Concorrência (vários pedidos simultâneos) e o comportamento da pausa por inatividade.
- Rode `supabase/verificar-seguranca.sql` para confirmar as regras RLS no banco real.

## 10. Dados que ainda dependem de você
1. Chave Pix, tipo e nome do recebedor (painel → Configurações).
2. E-mail e senha do administrador (Passo 6) e URL + chave pública do Supabase (Passo 8).
3. Endereço oficial (opcional, painel → Configurações).
4. Endereço final do site (para `og:image`/`og:url`) e decisão: GitHub Pages (demonstração) ou Netlify (venda real).
5. Logotipo/fotos com a marca JONS (ainda mostram "ONS"; troque os arquivos de `docs/img/`).
