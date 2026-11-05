-- =====================================================================================
-- JONS Burger — banco de dados (Supabase / PostgreSQL)
-- COMO USAR: Supabase > SQL Editor > New query > cole TODO este arquivo > Run.
-- Pode ser executado de novo com segurança (não apaga pedidos; não sobrescreve preços já editados).
--
-- DESENHO DE SEGURANÇA
--  * Todas as tabelas têm RLS (Row Level Security) ligado.
--  * O visitante (anon) só consegue LER produtos ativos e configurações públicas.
--  * O visitante NÃO lê nem grava diretamente em orders/order_items/order_events.
--    Ele só cria pedidos pela função create_order() e consulta o próprio pedido pela
--    função get_order_status() (exige número + código secreto do pedido).
--  * create_order() ignora preços do navegador: lê os preços da tabela products e calcula o total.
--  * Quem administra é quem estiver na tabela admins (usuário do Supabase Auth). Os pedidos só podem
--    ser lidos por admins; status e pagamento só mudam pelas funções admin_set_status/admin_set_payment.
--  * Nenhuma chave service_role é necessária no site. Ela NUNCA deve ir para o navegador.
-- =====================================================================================

-- ---------- 1. TABELAS ----------
create table if not exists public.products (
  id           text primary key check (id ~ '^[a-z0-9_-]{1,40}$'),
  name         text not null check (char_length(name) between 1 and 80),
  note         text not null default '',
  description  text not null default '',
  price_cents  integer not null check (price_cents between 0 and 1000000),
  category     text not null check (category in ('burger', 'side')),
  featured     boolean not null default false,
  sort         integer not null default 0,
  active       boolean not null default true
);

create table if not exists public.store_settings (
  key        text primary key,
  value      text not null default '',
  is_public  boolean not null default false   -- false = só admin lê (ex.: chave Pix)
);

create table if not exists public.admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create sequence if not exists public.order_number_seq;

create table if not exists public.orders (
  id              bigint generated always as identity primary key,
  public_number   text not null unique default lpad(nextval('public.order_number_seq')::text, 4, '0'),
  public_token    text not null default replace(gen_random_uuid()::text, '-', ''),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  customer_name   text not null check (char_length(customer_name) between 2 and 80),
  customer_phone  text not null check (customer_phone ~ '^[0-9]{10,11}$'),
  notes           text not null default '' check (char_length(notes) <= 300),
  subtotal_cents  integer not null check (subtotal_cents >= 0),
  total_cents     integer not null check (total_cents >= 0),
  status          text not null default 'recebido' check (status in ('recebido', 'preparo', 'pronto', 'entregue', 'cancelado')),
  payment_status  text not null default 'aguardando' check (payment_status in ('aguardando', 'pago', 'cancelado')),
  paid_at         timestamptz
);
create index if not exists idx_orders_created on public.orders (created_at);
create index if not exists idx_orders_status  on public.orders (status);

create table if not exists public.order_items (
  id                bigint generated always as identity primary key,
  order_id          bigint not null references public.orders (id) on delete cascade,
  product_id        text not null,
  name              text not null,                       -- nome no momento do pedido
  unit_price_cents  integer not null check (unit_price_cents >= 0),  -- preço no momento do pedido
  quantity          integer not null check (quantity between 1 and 20)
);
create index if not exists idx_items_order on public.order_items (order_id);

create table if not exists public.order_events (
  id          bigint generated always as identity primary key,
  order_id    bigint not null references public.orders (id) on delete cascade,
  kind        text not null,
  detail      text not null default '',
  actor       text not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_events_order on public.order_events (order_id);

-- ---------- 2. FUNÇÃO AUXILIAR: QUEM É ADMIN ----------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------- 3. RLS ----------
alter table public.products       enable row level security;
alter table public.store_settings enable row level security;
alter table public.admins         enable row level security;
alter table public.orders         enable row level security;
alter table public.order_items    enable row level security;
alter table public.order_events   enable row level security;

-- Privilégios mínimos (a RLS ainda filtra por cima disto)
revoke all on public.orders, public.order_items, public.order_events, public.admins from anon;
revoke insert, update, delete, truncate on public.orders, public.order_items, public.order_events, public.admins from authenticated;
revoke insert, update, delete, truncate on public.products, public.store_settings from anon;

drop policy if exists products_public_read on public.products;
create policy products_public_read on public.products for select to anon, authenticated using (active = true);
drop policy if exists products_admin_all on public.products;
create policy products_admin_all on public.products for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists settings_public_read on public.store_settings;
create policy settings_public_read on public.store_settings for select to anon, authenticated using (is_public = true);
drop policy if exists settings_admin_all on public.store_settings;
create policy settings_admin_all on public.store_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists admins_self_read on public.admins;
create policy admins_self_read on public.admins for select to authenticated using (user_id = auth.uid());

drop policy if exists orders_admin_read on public.orders;
create policy orders_admin_read on public.orders for select to authenticated using (public.is_admin());
drop policy if exists order_items_admin_read on public.order_items;
create policy order_items_admin_read on public.order_items for select to authenticated using (public.is_admin());
drop policy if exists order_events_admin_read on public.order_events;
create policy order_events_admin_read on public.order_events for select to authenticated using (public.is_admin());
-- (não há policy de INSERT/UPDATE/DELETE em orders/items/events: só as funções abaixo escrevem nelas)

-- ---------- 4. FUNÇÕES INTERNAS (ninguém chama pela API) ----------
create or replace function public.pix_json()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'configured', coalesce((select value from public.store_settings where key = 'pix_key'), '') <> ''
                  and coalesce((select value from public.store_settings where key = 'pix_receiver'), '') <> '',
    'key',       nullif((select value from public.store_settings where key = 'pix_key'), ''),
    'keyType',   nullif((select value from public.store_settings where key = 'pix_key_type'), ''),
    'receiver',  nullif((select value from public.store_settings where key = 'pix_receiver'), ''));
$$;

create or replace function public.order_public_json(p_id bigint)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'number', o.public_number, 'created_at', o.created_at, 'status', o.status, 'payment_status', o.payment_status,
    'subtotal_cents', o.subtotal_cents, 'total_cents', o.total_cents,
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', i.name, 'quantity', i.quantity, 'unit_price_cents', i.unit_price_cents) order by i.id)
                       from public.order_items i where i.order_id = o.id), '[]'::jsonb))
  from public.orders o where o.id = p_id;
$$;

create or replace function public.admin_order_json(p_id bigint)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', o.id, 'number', o.public_number, 'created_at', o.created_at, 'updated_at', o.updated_at,
    'customer_name', o.customer_name, 'customer_phone', o.customer_phone, 'notes', o.notes,
    'subtotal_cents', o.subtotal_cents, 'total_cents', o.total_cents,
    'status', o.status, 'payment_status', o.payment_status, 'paid_at', o.paid_at,
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', i.name, 'quantity', i.quantity, 'unit_price_cents', i.unit_price_cents) order by i.id)
                       from public.order_items i where i.order_id = o.id), '[]'::jsonb))
  from public.orders o where o.id = p_id;
$$;

revoke all on function public.pix_json(), public.order_public_json(bigint), public.admin_order_json(bigint) from public, anon, authenticated;

-- ---------- 5. FUNÇÕES PÚBLICAS: CLIENTE ----------
-- Cria o pedido. Recebe SOMENTE nome, telefone, observações e [{"id":"monster","qty":2}, ...].
-- Preços e total vêm da tabela products. Erros: ERR_NOME, ERR_TELEFONE, ERR_ITENS, ERR_PRODUTO, ERR_LIMITE.
create or replace function public.create_order(p_name text, p_phone text, p_notes text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text; v_phone text; v_notes text; v_el jsonb;
  v_n int; v_found int; v_total int; v_maxq int;
  v_id bigint; v_number text; v_token text;
begin
  v_name := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  if char_length(v_name) < 2 or char_length(v_name) > 80 then raise exception 'ERR_NOME' using errcode = 'P0001'; end if;

  v_phone := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if length(v_phone) > 11 and left(v_phone, 2) = '55' then v_phone := substr(v_phone, 3); end if;
  if length(v_phone) < 10 or length(v_phone) > 11 then raise exception 'ERR_TELEFONE' using errcode = 'P0001'; end if;

  v_notes := left(btrim(coalesce(p_notes, '')), 300);

  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'ERR_ITENS' using errcode = 'P0001'; end if;
  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 40 then raise exception 'ERR_ITENS' using errcode = 'P0001'; end if;
  for v_el in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_el) <> 'object' then raise exception 'ERR_ITENS' using errcode = 'P0001'; end if;
    if jsonb_typeof(v_el -> 'qty') is distinct from 'number' then raise exception 'ERR_ITENS' using errcode = 'P0001'; end if;
    if coalesce(v_el ->> 'qty', '') !~ '^[0-9]{1,2}$' then raise exception 'ERR_ITENS' using errcode = 'P0001'; end if;
    if coalesce(v_el ->> 'id', '') !~ '^[a-z0-9_-]{1,40}$' then raise exception 'ERR_ITENS' using errcode = 'P0001'; end if;
    if (v_el ->> 'qty')::int < 1 or (v_el ->> 'qty')::int > 20 then raise exception 'ERR_ITENS' using errcode = 'P0001'; end if;
  end loop;

  -- freio simples contra abuso (o endpoint é público): por telefone e geral
  if (select count(*) from public.orders where customer_phone = v_phone and created_at > now() - interval '10 minutes') >= 5
     or (select count(*) from public.orders where created_at > now() - interval '10 minutes') >= 100 then
    raise exception 'ERR_LIMITE' using errcode = 'P0001';
  end if;

  -- junta itens repetidos e confere com o cardápio oficial (apenas produtos ativos)
  with req as (
    select e ->> 'id' as id, sum((e ->> 'qty')::int)::int as qty
    from jsonb_array_elements(p_items) e group by 1
  )
  select count(*), count(p.id), coalesce(sum(p.price_cents * r.qty), 0), coalesce(max(r.qty), 0)
    into v_n, v_found, v_total, v_maxq
  from req r left join public.products p on p.id = r.id and p.active;

  if v_found <> v_n then raise exception 'ERR_PRODUTO' using errcode = 'P0001'; end if;
  if v_maxq > 20 then raise exception 'ERR_ITENS' using errcode = 'P0001'; end if;

  insert into public.orders (customer_name, customer_phone, notes, subtotal_cents, total_cents)
  values (v_name, v_phone, v_notes, v_total, v_total)
  returning id, public_number, public_token into v_id, v_number, v_token;

  with req as (
    select e ->> 'id' as id, sum((e ->> 'qty')::int)::int as qty
    from jsonb_array_elements(p_items) e group by 1
  )
  insert into public.order_items (order_id, product_id, name, unit_price_cents, quantity)
  select v_id, p.id, p.name, p.price_cents, r.qty
  from req r join public.products p on p.id = r.id and p.active;

  insert into public.order_events (order_id, kind, detail, actor) values (v_id, 'criado', '', 'cliente');

  return jsonb_build_object('token', v_token, 'order', public.order_public_json(v_id), 'pix', public.pix_json());
end;
$$;

-- Consulta o status do PRÓPRIO pedido: exige número + código secreto. Sem acerto, retorna null.
create or replace function public.get_order_status(p_number text, p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_id bigint; v_digits text;
begin
  v_digits := regexp_replace(coalesce(p_number, ''), '\D', '', 'g');
  if length(v_digits) < 4 then v_digits := lpad(v_digits, 4, '0'); end if;
  select id into v_id from public.orders where public_number = v_digits and public_token = coalesce(p_token, '');
  if v_id is null then return null; end if;
  return jsonb_build_object('order', public.order_public_json(v_id), 'pix', public.pix_json());
end;
$$;

-- ---------- 6. FUNÇÕES DO ADMINISTRADOR (checam is_admin() por dentro) ----------
create or replace function public.admin_set_status(p_id bigint, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cur text; v_actor text;
begin
  if not public.is_admin() then raise exception 'ERR_NAO_AUTORIZADO' using errcode = '42501'; end if;
  select status into v_cur from public.orders where id = p_id for update;
  if not found then raise exception 'ERR_NAO_ENCONTRADO' using errcode = 'P0001'; end if;
  if not ((v_cur = 'recebido' and p_status in ('preparo', 'cancelado'))
       or (v_cur = 'preparo'  and p_status in ('pronto', 'cancelado'))
       or (v_cur = 'pronto'   and p_status in ('entregue', 'cancelado'))) then
    raise exception 'ERR_TRANSICAO' using errcode = 'P0001';
  end if;
  update public.orders
     set status = p_status, updated_at = now(),
         payment_status = case when p_status = 'cancelado' and payment_status = 'aguardando' then 'cancelado' else payment_status end
   where id = p_id;
  v_actor := coalesce((select email from auth.users where id = auth.uid()), 'admin');
  insert into public.order_events (order_id, kind, detail, actor) values (p_id, 'status', v_cur || ' -> ' || p_status, v_actor);
  return public.admin_order_json(p_id);
end;
$$;

-- p_paid = true  : aguardando -> pago (confirmação MANUAL do Pix)
-- p_paid = false : pago -> aguardando (desfazer engano)
create or replace function public.admin_set_payment(p_id bigint, p_paid boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_st text; v_pay text; v_actor text;
begin
  if not public.is_admin() then raise exception 'ERR_NAO_AUTORIZADO' using errcode = '42501'; end if;
  select status, payment_status into v_st, v_pay from public.orders where id = p_id for update;
  if not found then raise exception 'ERR_NAO_ENCONTRADO' using errcode = 'P0001'; end if;
  if v_st = 'cancelado' then raise exception 'ERR_CANCELADO' using errcode = 'P0001'; end if;
  if p_paid and v_pay = 'aguardando' then
    update public.orders set payment_status = 'pago', paid_at = now(), updated_at = now() where id = p_id;
  elsif (not p_paid) and v_pay = 'pago' then
    update public.orders set payment_status = 'aguardando', paid_at = null, updated_at = now() where id = p_id;
  else
    raise exception 'ERR_TRANSICAO' using errcode = 'P0001';
  end if;
  v_actor := coalesce((select email from auth.users where id = auth.uid()), 'admin');
  insert into public.order_events (order_id, kind, detail, actor)
  values (p_id, 'pagamento', v_pay || ' -> ' || case when p_paid then 'pago (pix_manual)' else 'aguardando' end, v_actor);
  return public.admin_order_json(p_id);
end;
$$;

-- ---------- 7. QUEM PODE EXECUTAR O QUÊ ----------
revoke all on function public.create_order(text, text, text, jsonb)  from public, anon, authenticated;
revoke all on function public.get_order_status(text, text)           from public, anon, authenticated;
revoke all on function public.admin_set_status(bigint, text)         from public, anon, authenticated;
revoke all on function public.admin_set_payment(bigint, boolean)     from public, anon, authenticated;
grant execute on function public.create_order(text, text, text, jsonb) to anon, authenticated;
grant execute on function public.get_order_status(text, text)          to anon, authenticated;
grant execute on function public.admin_set_status(bigint, text)        to authenticated;
grant execute on function public.admin_set_payment(bigint, boolean)    to authenticated;

-- ---------- 8. CARDÁPIO OFICIAL (preços em centavos; edite depois pelo painel) ----------
insert into public.products (id, name, note, description, price_cents, category, featured, sort) values
  ('baratinho', 'JONS Baratinho',     '',      '120g, queijo prato e maionese especial.', 1200, 'burger', false, 1),
  ('salada',    'JONS Salada',        '',      '120g, queijo prato e maionese especial.', 1500, 'burger', false, 2),
  ('bacon',     'JONS Bacon Crisp',   '',      '120g, queijo prato e maionese especial.', 1800, 'burger', false, 3),
  ('chicken',   'JONS Chicken Smash', '',      '120g, queijo prato e maionese especial.', 1600, 'burger', false, 4),
  ('monster',   'JONS Monster',       '',      'Duplo artesanal (240g), duplo cheddar cremoso, muito bacon, cebola caramelizada, maionese JONS e pão brioche.', 2200, 'burger', true, 5),
  ('bp',        'Batata Frita P',                     '150g',  '', 800,  'side', false, 10),
  ('bg',        'Batata Frita G com Cheddar e Bacon', '',      '', 1400, 'side', false, 11),
  ('ref',       'Refrigerante lata',                  '350ml', '', 600,  'side', false, 12),
  ('suco',      'Suco Natural Del Valle',             '',      '', 600,  'side', false, 13),
  ('agua',      'Água Mineral',                       '',      '', 350,  'side', false, 14)
on conflict (id) do nothing;

-- Configurações (a chave Pix e o endereço ficam VAZIOS de propósito: preencha pelo painel > Configurações)
insert into public.store_settings (key, value, is_public) values
  ('whatsapp',     '5538999207706', true),
  ('address',      '',              true),
  ('pix_key',      '',              false),
  ('pix_key_type', '',              false),
  ('pix_receiver', '',              false)
on conflict (key) do nothing;
