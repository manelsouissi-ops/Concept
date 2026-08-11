import { redirect } from "next/navigation";
import { CommercialFciWorkspace } from "@/components/commercial-secondary-workspaces.tsx";
import { buildFciWorkspace, getCommercialSecondaryRecords } from "@/lib/appels-offres/commercial-secondary-workspaces.ts";
import { requireAreaAccessForPage } from "@/lib/auth/server.ts";
export default async function Page() { const user = await requireAreaAccessForPage("appels_offres"); if (user.role !== "COMMERCIAL") redirect("/forbidden"); return <CommercialFciWorkspace {...buildFciWorkspace(await getCommercialSecondaryRecords(user))} />; }
