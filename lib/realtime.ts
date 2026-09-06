// Realtime channel + event names. Shared by client (subscribe) and server
// (broadcast). Keep payloads minimal — they are hints to refetch authoritative
// state, never the source of truth (spec §7). What ENFORCES that in the
// consumers lives in lib/realtimeTrust.ts; read its header before touching a
// broadcast handler.

/** Every topic is prefixed with the APP, because the Supabase project is shared
 * with the sister apps and Realtime topics are a single flat namespace across
 * it. `lib/realtime.ts` was byte-identical in SundayChess, so both apps were
 * subscribing to the SAME `game:<uuid>` topics: distinct id spaces today, but
 * one seeded/imported id away from two games talking to each other. The prefix
 * makes the namespaces disjoint by construction. Sister apps use their own
 * (`chess:`). Client and server both build topics through these helpers, so one
 * deploy moves both ends together. */
const APP = "ttt";

export const channels = {
  lobby: (tournamentId: string) => `${APP}:lobby:${tournamentId}`,
  game: (gameId: string) => `${APP}:game:${gameId}`,
  // tournament-wide move feed for the teacher's live-games view (one channel,
  // scales to many games)
  spectate: (tournamentId: string) => `${APP}:spectate:${tournamentId}`,
  // presence: students advertise they're connected (keyed by playerId) so the
  // host can see who's online in the lobby and drop ghosts.
  presence: (tournamentId: string) => `${APP}:presence:${tournamentId}`,
};

export const events = {
  // lobby channel
  roster: "roster", // a player joined/left → refetch players
  tournament: "tournament", // status/round changed → refetch tournament
  // game channel
  position: "position", // a move was applied
  result: "result", // game resolved (override/bye/timeout/end)
} as const;
