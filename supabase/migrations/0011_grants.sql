-- 0011: grant the PostgREST API roles access to the `tictactoe` schema.
--
-- A schema created via raw SQL (0000) is NOT auto-granted to Supabase's API
-- roles — exposing it in the dashboard only adds it to PostgREST's schema list.
-- Without these grants the service-role client gets "permission denied for
-- schema tictactoe" (42501) and every /api/* route returns 500.
--
-- RLS stays the security boundary: every table has RLS enabled with NO policies,
-- so anon/authenticated still get ZERO row access; only service_role (which
-- bypasses RLS) actually reads/writes. This mirrors the default `public` posture.

grant usage on schema tictactoe to anon, authenticated, service_role;

grant all on all tables in schema tictactoe to anon, authenticated, service_role;
grant all on all routines in schema tictactoe to anon, authenticated, service_role;
grant all on all sequences in schema tictactoe to anon, authenticated, service_role;

alter default privileges for role postgres in schema tictactoe
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema tictactoe
  grant all on routines to anon, authenticated, service_role;
alter default privileges for role postgres in schema tictactoe
  grant all on sequences to anon, authenticated, service_role;

notify pgrst, 'reload schema';
