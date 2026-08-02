import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header.tsx";
import { ProfileForm } from "@/components/profile-form.tsx";
import { resolveCurrentUserFromServerHeaders } from "@/lib/auth/current-user.ts";
import { getUserById, listDepartments } from "@/lib/users/repository.ts";

export default async function ProfilePage() {
  const currentUser = await resolveCurrentUserFromServerHeaders();
  const userId = Number(currentUser.id);

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
        title="Mon profil"
        description="Mettez a jour vos informations personnelles, votre langue et vos preferences locales."
      />

      <ProfileForm user={user} departments={departments} />
    </div>
  );
}
