import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header.tsx";
import { UserForm } from "@/components/user-form.tsx";
import { requireAreaAccessForPage } from "@/lib/auth/server.ts";
import { getUserById, listDepartments } from "@/lib/users/repository.ts";

export default async function EditUserPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAreaAccessForPage("administration");
  const { id } = await params;
  const userId = Number(id);

  if (!Number.isInteger(userId) || userId <= 0) {
    notFound();
  }

  const [user, departments] = await Promise.all([getUserById(userId), listDepartments()]);
  if (!user) {
    notFound();
  }

  return (
    <div className="page-stack">
      <PageHeader
        title={`Modifier ${user.displayName}`}
        description="Ajustez le role, le departement, les preferences et le statut de ce profil."
      />

      <UserForm mode="edit" user={user} departments={departments} />
    </div>
  );
}
