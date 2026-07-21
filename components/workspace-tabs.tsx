import type { ReactNode } from "react";

export type WorkspaceTabConfig = {
  key: string;
  label: string;
  count?: number;
};

export function WorkspaceTabs({
  tabs,
  activeKey,
  onSelect
}: {
  tabs: WorkspaceTabConfig[];
  activeKey: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="workspace-tabs-scroll">
      <div className="tabs-list workspace-tabs-list" role="tablist" aria-label="Sections du workspace">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeKey === tab.key}
            className={activeKey === tab.key ? "tab-button active" : "tab-button"}
            onClick={() => onSelect(tab.key)}
          >
            <span>{tab.label}</span>
            {typeof tab.count === "number" ? (
              <span className="workspace-tab-count">{tab.count}</span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
