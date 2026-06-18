import { redirect } from "next/navigation";

import { requireHost, HostAuthError } from "@/lib/server/auth";
import { listTournamentsByOwner } from "@/lib/server/store";
import { no } from "@/lib/locale/no";
import { HostDashboard } from "./HostDashboard";

// OPTIONAL Sunday Account host dashboard. Middleware already bounces an
// unauthenticated visitor to /host/login, but we still resolve the host here so
// the allow-list (403) is enforced server-side — the ONE authz spot is
// requireHost(). A signed-in-but-not-allow-listed user is sent back to login
// rather than shown the dashboard. Anonymous play is untouched (different route).
export default async function HostPage() {
  let host: { id: string; email: string };
  try {
    host = await requireHost();
  } catch (err) {
    if (err instanceof HostAuthError) redirect("/host/login");
    throw err;
  }

  const tournaments = await listTournamentsByOwner(host.id);
  return (
    <HostDashboard
      email={host.email}
      initial={tournaments}
      strings={no.hostAuth}
    />
  );
}
