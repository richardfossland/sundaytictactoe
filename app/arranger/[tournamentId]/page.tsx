import { BoardClient } from "./BoardClient";

export default async function HostBoardPage({
  params,
}: {
  params: Promise<{ tournamentId: string }>;
}) {
  const { tournamentId } = await params;
  return <BoardClient tournamentId={tournamentId} />;
}
