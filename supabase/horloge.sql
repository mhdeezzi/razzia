-- Horloge de Razzia : toutes les 5 minutes, Supabase appelle le site, qui relance les matchs NBA qui débutent dans
-- 5 à 30 minutes (compositions annoncées) et recalcule les bilans NBA et tennis. Les tâches planifiées de GitHub
-- partent avec des heures de retard ; celles de Supabase partent à l'heure.
--
-- À coller une seule fois dans Supabase : SQL Editor, New query, Run. Aucune clé à fournir : l'adresse appelée est
-- publique et ne fait rien de plus qu'un visiteur du site.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Relancer ce script remplace l'horloge existante au lieu d'en créer une deuxième.
select cron.unschedule('razzia-horloge') where exists (select 1 from cron.job where jobname = 'razzia-horloge');

select cron.schedule(
  'razzia-horloge',
  '*/5 * * * *',
  $$ select net.http_get(url := 'https://simbet-mu.vercel.app/api/sim?tick=1', timeout_milliseconds := 25000) $$
);

-- Vérifier que l'horloge tourne (après 5 à 10 minutes) : les derniers appels et leur réponse.
-- select status_code, left(content::text, 200), created from net._http_response order by created desc limit 5;
