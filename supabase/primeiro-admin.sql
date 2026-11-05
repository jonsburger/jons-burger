-- =====================================================================================
-- PRIMEIRO ADMINISTRADOR (rode UMA vez, depois de criar o usuário no painel do Supabase)
-- 1) Supabase > Authentication > Users > Add user > Create new user
--    (informe e-mail e uma senha forte; marque "Auto Confirm User").
-- 2) Troque o e-mail abaixo pelo MESMO e-mail do passo 1 e clique em Run.
-- A senha NUNCA fica em código: ela existe só no Supabase Auth.
-- =====================================================================================
insert into public.admins (user_id)
select id from auth.users where email = 'COLOQUE_AQUI_O_EMAIL_DO_ADMIN'
on conflict do nothing;

-- Conferência: deve listar 1 linha com o e-mail do administrador.
select a.user_id, u.email from public.admins a join auth.users u on u.id = a.user_id;
