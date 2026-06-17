-- SundayTicTacToe lives in a DEDICATED `tictactoe` schema on the SHARED Supabase
-- project (the same project hosts SundayChess on `public`, plus harvest/market/
-- turnering on their own schemas). Every following migration is schema-qualified
-- to `tictactoe`.
--
-- IMPORTANT (one-time, on the hosted project): add `tictactoe` to the project's
-- Exposed schemas (Dashboard → Project Settings → API → Exposed schemas), or
-- every PostgREST request from the app returns PGRST106 "schema must be one of…".
create schema if not exists tictactoe;
