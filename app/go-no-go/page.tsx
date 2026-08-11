import { redirect } from "next/navigation";
import { CommercialGoNoGoWorkspace } from "@/components/commercial-secondary-workspaces.tsx";
import { buildGoNoGoWorkspace, getCommercialSecondaryRecords } from "@/lib/appels-offres/commercial-secondary-workspaces.ts";
import { requireAreaAccessForPage } from "@/lib/auth/server.ts";
export default async function Page() { const user = await requireAreaAccessForPage("appels_offres"); if (user.role !== "COMMERCIAL") redirect("/forbidden"); return <CommercialGoNoGoWorkspace {...buildGoNoGoWorkspace(await getCommercialSecondaryRecords(user))} />; }
