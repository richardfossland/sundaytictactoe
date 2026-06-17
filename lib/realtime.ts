// Realtime channel + event names. Shared by client (subscribe) and server
// (broadcast). Keep payloads minimal — they are hints to refetch authoritative
// state, never the source of truth (spec §7).

export const channels = {
  lobby: (tournamentId: string) => `lobby:${tournamentId}`,
  game: (gameId: string) => `game:${gameId}`,
  // tournament-wide move feed for the teacher's live-games view (one channel,
  // scales to many games)
  spectate: (tournamentId: string) => `spectate:${tournamentId}`,
  // presence: students advertise they're connected (keyed by playerId) so the
  // host can see who's online in the lobby and drop ghosts.
  presence: (tournamentId: string) => `presence:${tournamentId}`,
};

export const events = {
  // lobby channel
  roster: "roster", // a player joined/left → refetch players
  tournament: "tournament", // status/round changed → refetch tournament
  // game channel
  position: "position", // a move was applied
  result: "result", // game resolved (override/bye/timeout/end)
} as const;
