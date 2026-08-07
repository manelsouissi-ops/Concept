import { notFound } from "next/navigation";
import { SoftwareAnalysisWorkspace } from "@/components/software-analysis-workspace.tsx";
import { listSoftware } from "@/lib/administration/logiciels/repository.ts";
import { getAppelOffresDetailByCode } from "@/lib/appels-offres/repository.ts";
import { getSoftwareAnalysisDetailByCode } from "@/lib/appels-offres/software-analysis-repository.ts";
import { requireAreaAccessForPage } from "@/lib/auth/server.ts";

export default async function AppelOffresSoftwareAnalysisPage({
  params
}: {
  params: Promise<{ code: string }>;
}) {
  await requireAreaAccessForPage("appels_offres");
  const { code } = await params;
  const [appel, detail, catalogue] = await Promise.all([
    getAppelOffresDetailByCode(code, { includeArchived: true }),
    getSoftwareAnalysisDetailByCode(code).catch(() => null),
    listSoftware({ status: "active" })
  ]);

  if (!appel || !detail) {
    notFound();
  }

  return (
    <div className="page-stack">
      <SoftwareAnalysisWorkspace
        code={appel.code}
        title={appel.title}
        detail={detail}
        catalogue={catalogue}
        showDevelopmentImportOptions={process.env.NODE_ENV !== "production"}
      />
    </div>
  );
}
