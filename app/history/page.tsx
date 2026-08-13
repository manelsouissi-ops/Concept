import { redirect } from "next/navigation";
import { CommercialHistoryWorkspace } from "@/components/commercial-secondary-workspaces.tsx";
import { buildHistoryWorkspace, getCommercialSecondaryRecords } from "@/lib/appels-offres/commercial-secondary-workspaces.ts";
import { requireAreaAccessForPage } from "@/lib/auth/server.ts";
export default async function Page() {
  const user = await requireAreaAccessForPage("appels_offres");
  if (user.role === "DIRECTION_GENERALE") redirect("/decisions#decision-history");
  if (user.role !== "COMMERCIAL") redirect("/forbidden");
  return <CommercialHistoryWorkspace rows={buildHistoryWorkspace(await getCommercialSecondaryRecords(user))} />;
}
