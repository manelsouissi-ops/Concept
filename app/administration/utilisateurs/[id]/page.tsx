import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header.tsx";
import { UserDetailView } from "@/components/user-detail-view.tsx";
import { requireAreaAccessForPage } from "@/lib/auth/server.ts";
import { getUserById } from "@/lib/users/repository.ts";

export default async function UserDetailPage({
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

  const user = await getUserById(userId);
  if (!user) {
    notFound();
  }

  return (
    <div className="page-stack">
      <PageHeader
        title={user.displayName}
        description="Consultez les informations du profil, son statut d'acces et ses preferences."
        actions={
          <>
            <Link href="/administration/utilisateurs" className="button button-secondary">
              Retour a la liste
            </Link>
            <Link
              href={`/administration/utilisateurs/${user.id}/modifier`}
              className="button button-primary"
            >
              Modifier
            </Link>
          </>
        }
      />

      <UserDetailView user={user} />
    </div>
  );
}
