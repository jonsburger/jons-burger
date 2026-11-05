-- =====================================================================================
-- VERIFICAÇÃO DE SEGURANÇA (RLS) — rode DEPOIS do schema.sql, UM BLOCO POR VEZ, no SQL Editor.
-- Cada bloco simula um tipo de usuário e termina com ROLLBACK (não grava nada).
-- Resultado esperado está escrito acima de cada bloco.
-- =====================================================================================

-- 1) ESPERADO: lista os 10 produtos do cardápio (visitante pode ler produtos ativos).
begin; set local role anon; select id, name, price_cents from public.products order by sort; rollback;

-- 2) ESPERADO: ERRO "permission denied for table orders" (visitante NÃO lê pedidos).
begin; set local role anon; select * from public.orders; rollback;

-- 3) ESPERADO: ERRO "permission denied for function admin_set_status" (visitante NÃO usa funções de admin).
begin; set local role anon; select public.admin_set_status(1, 'preparo'); rollback;

-- 4) ESPERADO: somente whatsapp e address (a chave Pix NÃO aparece para o visitante).
begin; set local role anon; select key from public.store_settings; rollback;

-- 5) ESPERADO: retorna JSON com token e total_cents = 2200 mesmo o "preço" falso enviado (o banco usa o preço oficial).
--    (Nada fica gravado por causa do rollback.)
begin; set local role anon;
select public.create_order('Teste Seguranca', '38999990000', '', '[{"id":"monster","qty":1,"price":1}]'::jsonb);
rollback;

-- 6) ESPERADO: ERR_NOME (validação no servidor).
begin; set local role anon; select public.create_order('', '38999990000', '', '[{"id":"monster","qty":1}]'::jsonb); rollback;

-- 7) ESPERADO: ERR_PRODUTO (produto inexistente).
begin; set local role anon; select public.create_order('Teste', '38999990000', '', '[{"id":"nao-existe","qty":1}]'::jsonb); rollback;

-- 8) ESPERADO: ERRO de permissão (visitante não escreve em products).
begin; set local role anon; update public.products set price_cents = 1 where id = 'monster'; rollback;

-- 9) ESPERADO: NULL (consulta com código errado não revela pedido algum).
begin; set local role anon; select public.get_order_status('0001', 'codigo-errado'); rollback;
