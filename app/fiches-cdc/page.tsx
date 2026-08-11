import { redirect } from "next/navigation";
import { CommercialCdcWorkspace } from "@/components/commercial-secondary-workspaces.tsx";
import { buildCdcWorkspace, getCommercialSecondaryRecords } from "@/lib/appels-offres/commercial-secondary-workspaces.ts";
import { requireAreaAccessForPage } from "@/lib/auth/server.ts";
export default async function Page() { const user = await requireAreaAccessForPage("appels_offres"); if (user.role !== "COMMERCIAL") redirect("/forbidden"); return <CommercialCdcWorkspace {...buildCdcWorkspace(await getCommercialSecondaryRecords(user))} />; }
