import type { FciModulePresentation } from "@/lib/appels-offres/fci/presentation.ts";

export type FciModuleActionKind =
  | "save"
  | "validate"
  | "regenerate"
  | "download-docx"
  | "download-pdf"
  | "reset"
  | "history"
  | "refresh";

export type FciActionButtonView = {
  action: FciModuleActionKind;
  label: string;
  className: string;
  disabled: boolean;
};

export type FciActionGroupView = {
  key: "primary" | "secondary" | "export";
  label: string;
  buttons: FciActionButtonView[];
};

const ACTION_GROUPS: Array<{
  key: FciActionGroupView["key"];
  label: string;
  actions: FciModuleActionKind[];
}> = [
  {
    key: "primary",
    label: "Actions principales",
    actions: ["save", "validate", "regenerate"]
  },
  {
    key: "secondary",
    label: "Actions secondaires",
    actions: ["reset", "history", "refresh"]
  },
  {
    key: "export",
    label: "Exports",
    actions: ["download-docx", "download-pdf"]
  }
];

function getActionDefinition(
  action: FciModuleActionKind,
  input: {
    isDirty: boolean;
    isBusy: boolean;
    pendingAction: FciModuleActionKind | null;
    canEdit: boolean;
    canValidate: boolean;
    canRegenerate: boolean;
    canExport: boolean;
  }
): FciActionButtonView | null {
  switch (action) {
    case "save":
      if (!input.canEdit) {
        return null;
      }
      return {
        action,
        label: input.pendingAction === "save" ? "Enregistrement..." : "Enregistrer le brouillon",
        className: "button button-primary",
        disabled: !input.isDirty || input.isBusy
      };
    case "validate":
      if (!input.canValidate) {
        return null;
      }
      return {
        action,
        label: input.pendingAction === "validate" ? "Validation..." : "Marquer comme termine",
        className: "button button-secondary",
        disabled: input.isBusy || input.isDirty
      };
    case "regenerate":
      if (!input.canRegenerate) {
        return null;
      }
      return {
        action,
        label: input.pendingAction === "regenerate" ? "Relance..." : "Relancer la generation",
        className: "button button-ai",
        disabled: input.isBusy
      };
    case "reset":
      if (!input.canEdit) {
        return null;
      }
      return {
        action,
        label: "Reinitialiser les modifications",
        className: "button button-ghost",
        disabled: !input.isDirty || input.isBusy
      };
    case "history":
      return {
        action,
        label: "Voir l'historique",
        className: "button button-ghost",
        disabled: input.isBusy
      };
    case "refresh":
      return {
        action,
        label: "Actualiser",
        className: "button button-ghost",
        disabled: input.isBusy
      };
    case "download-docx":
      if (!input.canExport) {
        return null;
      }
      return {
        action,
        label: input.pendingAction === "download-docx" ? "Preparation Word..." : "Telecharger Word",
        className: "button button-ghost",
        disabled: input.isBusy
      };
    case "download-pdf":
      if (!input.canExport) {
        return null;
      }
      return {
        action,
        label: input.pendingAction === "download-pdf" ? "Preparation PDF..." : "Telecharger PDF",
        className: "button button-ghost",
        disabled: input.isBusy
      };
  }
}

export function buildFciModuleActionGroups(input: {
  modulePresentation: Pick<FciModulePresentation, "allowed_actions" | "latest_data" | "permissions">;
  isDirty: boolean;
  isBusy: boolean;
  pendingAction: FciModuleActionKind | null;
}) {
  const canEdit = input.modulePresentation.permissions.can_edit;
  const canValidate =
    input.modulePresentation.permissions.can_validate
    && input.modulePresentation.allowed_actions.includes("validate");
  const canRegenerate =
    input.modulePresentation.permissions.can_regenerate
    && input.modulePresentation.allowed_actions.includes("regenerate");
  const canExport = input.modulePresentation.latest_data != null;

  return ACTION_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    buttons: group.actions
      .map((action) =>
        getActionDefinition(action, {
          isDirty: input.isDirty,
          isBusy: input.isBusy,
          pendingAction: input.pendingAction,
          canEdit,
          canValidate,
          canRegenerate,
          canExport
        })
      )
      .filter((button): button is FciActionButtonView => button != null)
  })).filter((group) => group.buttons.length > 0);
}
