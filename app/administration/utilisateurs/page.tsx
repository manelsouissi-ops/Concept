import Link from "next/link";
import { PageHeader } from "@/components/page-header.tsx";
import { UserListView } from "@/components/user-list-view.tsx";
import { requireAreaAccessForPage } from "@/lib/auth/server.ts";
import { listDepartments, listUsers } from "@/lib/users/repository.ts";

export default async function UsersPage() {
  await requireAreaAccessForPage("administration");
  const [users, departments] = await Promise.all([
    listUsers({ status: "all" }),
    listDepartments()
  ]);

  return (
    <div className="page-stack">
      <PageHeader
        title="Utilisateurs"
        description="Pilotez les profils, les roles, les departements et les statuts du referentiel identite."
        actions={
          <Link href="/administration/utilisateurs/nouveau" className="button button-primary">
            Creer un utilisateur
          </Link>
        }
      />

      <UserListView users={users} departments={departments} />
    </div>
  );
}
