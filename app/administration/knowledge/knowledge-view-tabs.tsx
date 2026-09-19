import Link from "next/link";
import type { KnowledgeView } from "./knowledge-view.ts";

const TABS: { key: KnowledgeView; label: string }[] = [
  { key: "cdc", label: "CDC validés" },
  { key: "archives", label: "Cartographie des archives" }
];

export default function KnowledgeViewTabs({ active }: { active: KnowledgeView }) {
  return (
    <div className="tabs-list" role="tablist" aria-label="Sections de la base de connaissances">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={`/administration/knowledge?view=${tab.key}`}
          role="tab"
          aria-selected={active === tab.key}
          className={active === tab.key ? "tab-button active" : "tab-button"}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
