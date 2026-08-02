import Link from "next/link";
import { PageHeader } from "@/components/page-header.tsx";
import { SoftwareListView } from "@/components/software-list-view.tsx";
import { requireAreaAccessForPage } from "@/lib/auth/server.ts";
import { listSoftware } from "@/lib/administration/logiciels/repository.ts";

export default async function SoftwarePage() {
  await requireAreaAccessForPage("administration");
  const items = await listSoftware({ status: "all" });

  return (
    <div className="page-stack">
      <PageHeader
        title="Logiciels"
        description="Centralisez le catalogue technique de l'entreprise, ses usages bruts et les alias utiles au matching."
        actions={
          <>
            <Link href="/administration/logiciels/importer" className="button button-secondary">
              Mettre a jour le catalogue
            </Link>
            <Link href="/administration/logiciels/nouveau" className="button button-primary">
              Ajouter un logiciel
            </Link>
          </>
        }
      />

      <SoftwareListView items={items} />
    </div>
  );
}
