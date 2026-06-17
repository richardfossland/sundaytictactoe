// Team standings (lagturnering). Pure: team score = sum of its members'
// individual scores, so nothing extra is stored or recomputed server-side.

export interface TeamRow {
  team: string;
  score: number;
  players: number;
}

export function computeTeamStandings(
  teams: string[],
  players: { team?: string | null; score: number; status?: string }[],
): TeamRow[] {
  if (teams.length < 2) return [];
  const rows = new Map<string, TeamRow>(
    teams.map((t) => [t, { team: t, score: 0, players: 0 }]),
  );
  for (const p of players) {
    if (!p.team) continue;
    // Mirror computeStandings: a player who LEFT is dropped from the individual
    // board, so they must not still count toward their team's total either
    // (otherwise the two tables disagree). status is optional for callers that
    // only pass active players.
    if (p.status && p.status !== "active") continue;
    const row = rows.get(p.team);
    if (!row) continue;
    row.players++;
    row.score += Number(p.score) || 0;
  }
  return [...rows.values()].sort(
    (a, b) => b.score - a.score || a.team.localeCompare(b.team),
  );
}

/** Stable colour per team name (the four wizard presets + a gold fallback). */
export function teamColor(team: string): string {
  const colors: Record<string, string> = {
    Rød: "#e25b4d",
    Blå: "#4d8fe2",
    Grønn: "#5ec27a",
    Gul: "#ebb84b",
  };
  return colors[team] ?? "#ebb84b";
}
