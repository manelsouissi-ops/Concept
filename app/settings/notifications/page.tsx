import { PageHeader } from "@/components/page-header.tsx";
import { SettingsPlaceholder } from "@/components/settings-placeholder.tsx";
import { SETTINGS_SECTIONS } from "@/lib/users/settings.ts";

export default function SettingsNotificationsPage() {
  return (
    <div className="page-stack">
      <PageHeader
        title="Notifications"
        description="Preparez les prochains canaux d'alerte et les regles de suivi des dossiers sensibles."
      />

      <SettingsPlaceholder
        title="Centre de notifications"
        description="Les regles de notification, les preferences canal par canal et les resumés utilisateur s'integreront ici."
        activeSection="/settings/notifications"
        sections={SETTINGS_SECTIONS}
      />
    </div>
  );
}
