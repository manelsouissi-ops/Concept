import type { FciModulePresentation } from "@/lib/appels-offres/fci/presentation.ts";
import {
  buildFciModuleActionGroups,
  type FciModuleActionKind
} from "./fci-module-actions-state.ts";

export type { FciModuleActionKind } from "./fci-module-actions-state.ts";

export function FciModuleActions({
  modulePresentation,
  isDirty,
  isBusy,
  pendingAction,
  onAction
}: {
  modulePresentation: FciModulePresentation;
  isDirty: boolean;
  isBusy: boolean;
  pendingAction: FciModuleActionKind | null;
  onAction: (action: FciModuleActionKind) => void;
}) {
  const groups = buildFciModuleActionGroups({
    modulePresentation,
    isDirty,
    isBusy,
    pendingAction
  });

  return (
    <div className="fci-module-actions" role="toolbar" aria-label="Actions du module FCI">
      {groups.map((group) => (
        <div key={group.key} className="fci-action-group" data-group={group.key}>
          <span className="sr-only">{group.label}</span>
          {group.buttons.map((button) => (
            <button
              key={button.action}
              type="button"
              className={button.className}
              onClick={() => onAction(button.action)}
              disabled={button.disabled}
            >
              {button.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
