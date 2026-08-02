import { PageHeader } from "@/components/page-header.tsx";
import { UserForm } from "@/components/user-form.tsx";
import { requireAreaAccessForPage } from "@/lib/auth/server.ts";
import { listDepartments } from "@/lib/users/repository.ts";

export default async function NewUserPage() {
  await requireAreaAccessForPage("administration");
  const departments = await listDepartments();

  return (
    <div className="page-stack">
      <PageHeader
        title="Creer un utilisateur"
        description="Ajoutez un nouveau profil interne avec son role, son departement et son statut initial."
      />

      <UserForm mode="create" departments={departments} />
    </div>
  );
}
