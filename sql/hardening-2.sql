-- =========================================================
-- Patinhas — hardening parte 2 (rodar UMA vez no SQL Editor do Supabase).
-- Idempotente: pode rodar de novo sem erro.
--
-- Complementa hardening.sql (posse de linhas/arquivos) e antispam.sql.
-- Cobre os itens que ainda apareceram no teste de segurança de 24/07/2026:
--   1) contact_email das ONGs dumpável por anônimo.
--   2) site_visits / platform_feedback sem teto de tamanho (abuso de cota).
-- =========================================================


-- ---------------------------------------------------------
-- 1. E-mail das ONGs não é mais legível por visitante anônimo.
--
-- A policy de SELECT em profiles é `using (true)` (o mural precisa ler
-- org_name, cidade e WhatsApp de qualquer ONG). Mas RLS é por LINHA, não por
-- coluna — então o anônimo também conseguia puxar contact_email de todas as
-- ONGs numa requisição só (material pronto pra spam).
--
-- Correção: privilégio por COLUNA. O PostgREST respeita isto. O anônimo perde
-- acesso só à coluna do e-mail; todo o resto (nome, cidade, WhatsApp) continua
-- visível, e o mural segue funcionando. O próprio abrigo continua vendo o seu
-- e-mail na área logada (papel `authenticated`, não mexido aqui).
--
-- O WhatsApp segue público de propósito: é o canal que o mural usa no botão
-- "Quero adotar". Um número criado para receber contato de adoção é, por
-- design, para ser mostrado.
-- ---------------------------------------------------------

revoke select (contact_email) on public.profiles from anon;

-- Observação: um abrigo JÁ logado ainda enxerga o e-mail de outros abrigos
-- (RLS `using(true)` + coluna liberada para `authenticated`). Isso é risco de
-- "insider" (precisa criar conta), bem menor que o anônimo. Fechar exige trocar
-- a leitura pública por uma view/RPC sem a coluna e ajustar a tela de perfil do
-- admin — vale como próximo passo, não incluído aqui para não arriscar o site.


-- ---------------------------------------------------------
-- 2. Teto de tamanho nas tabelas de inserção anônima.
--
-- A chave publishable é pública (por design). Qualquer um insere em
-- site_visits e platform_feedback. Sem limite de tamanho, poucas requisições
-- com textos gigantes enchem a cota do plano free.
--
-- Se algum registro atual passar do limite, o ALTER falha — rode antes os
-- UPDATEs comentados no fim desta seção.
-- ---------------------------------------------------------

alter table platform_feedback
  drop constraint if exists platform_feedback_message_len,
  drop constraint if exists platform_feedback_page_len,
  drop constraint if exists platform_feedback_user_agent_len;

alter table platform_feedback
  add constraint platform_feedback_message_len
    check (char_length(message) between 1 and 2000),
  add constraint platform_feedback_page_len
    check (page is null or char_length(page) <= 300),
  add constraint platform_feedback_user_agent_len
    check (user_agent is null or char_length(user_agent) <= 400);

alter table site_visits
  drop constraint if exists site_visits_path_len,
  drop constraint if exists site_visits_referrer_len,
  drop constraint if exists site_visits_utm_len,
  drop constraint if exists site_visits_visitor_len;

alter table site_visits
  add constraint site_visits_path_len
    check (char_length(path) <= 300),
  add constraint site_visits_referrer_len
    check (referrer is null or char_length(referrer) <= 500),
  add constraint site_visits_utm_len
    check (
      (utm_source is null or char_length(utm_source) <= 100)
      and (utm_medium is null or char_length(utm_medium) <= 100)
      and (utm_campaign is null or char_length(utm_campaign) <= 100)
      and (device_type is null or char_length(device_type) <= 40)
    ),
  add constraint site_visits_visitor_len
    check (visitor_id is null or char_length(visitor_id) <= 64);

-- Se um ALTER acima reclamar de linha existente fora do limite, rode e repita:
--   update platform_feedback set message = left(message, 2000) where char_length(message) > 2000;
--   update platform_feedback set page = left(page, 300) where char_length(page) > 300;
--   update platform_feedback set user_agent = left(user_agent, 400) where char_length(user_agent) > 400;
--   update site_visits set path = left(path, 300) where char_length(path) > 300;
--   update site_visits set referrer = left(referrer, 500) where char_length(referrer) > 500;
