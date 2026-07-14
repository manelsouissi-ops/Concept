import json
import sqlite3
import sys
import uuid
from datetime import datetime
from pathlib import Path


DB_PATH = Path(r"C:\Users\lotfi\.n8n\database.sqlite")
WORKFLOW_ID = "f866bd39869c4c11"
BACKUP_DIR = Path(r"C:\Users\lotfi\Documents\Concept\tmp\n8n-workflow-backups")

OLD_MAX_POLLS = 10
NEW_MAX_POLLS = 40
OLD_MAX_ELAPSED_MS = 300000
NEW_MAX_ELAPSED_MS = 1200000  # 40 polls * 30s = 20 minutes

NEW_INIT_GUARD_JSCODE = """const item = $input.first();
const now = Date.now();

return [{
  json: {
    ...item.json,
    marker_poll_count: 0,
    marker_started_at: now,
    marker_max_polls: %d,
    marker_max_elapsed_ms: %d,
  },
  binary: item.binary,
}];""" % (NEW_MAX_POLLS, NEW_MAX_ELAPSED_MS)


def backup_workflow(row: sqlite3.Row) -> Path:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    backup_path = BACKUP_DIR / f"{WORKFLOW_ID}_before_poll_ceiling_raise_script_{timestamp}.json"
    payload = {
        "id": row["id"],
        "name": row["name"],
        "active": row["active"],
        "nodes": json.loads(row["nodes"]),
        "connections": json.loads(row["connections"]),
        "settings": json.loads(row["settings"]) if row["settings"] else {},
        "updatedAt": row["updatedAt"],
        "versionId": row["versionId"],
        "activeVersionId": row["activeVersionId"],
        "versionCounter": row["versionCounter"],
    }
    backup_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return backup_path


def require_node(nodes_by_name: dict[str, dict], name: str) -> dict:
    if name not in nodes_by_name:
        raise RuntimeError(f"Node '{name}' not found in workflow {WORKFLOW_ID}")
    return nodes_by_name[name]


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        row = cur.execute(
            """
            select id, name, active, nodes, connections, settings, staticData, pinData,
                   description, nodeGroups, updatedAt, versionId, activeVersionId, versionCounter
            from workflow_entity
            where id = ?
            """,
            (WORKFLOW_ID,),
        ).fetchone()
        if row is None:
            raise RuntimeError(f"Workflow {WORKFLOW_ID} not found")

        backup_path = backup_workflow(row)

        nodes = json.loads(row["nodes"])
        connections_json = row["connections"]
        nodes_by_name = {node["name"]: node for node in nodes}

        init_guard = require_node(nodes_by_name, "Init Marker Poll Guard")
        current_jscode = init_guard["parameters"]["jsCode"]
        if f"marker_max_polls: {OLD_MAX_POLLS}" not in current_jscode:
            raise RuntimeError(
                f"Expected 'marker_max_polls: {OLD_MAX_POLLS}' in Init Marker Poll Guard, "
                "node has already changed - aborting to avoid clobbering unexpected state"
            )
        init_guard["parameters"]["jsCode"] = NEW_INIT_GUARD_JSCODE

        old_version_id = row["versionId"]
        old_version_counter = int(row["versionCounter"] or 0)
        new_version_id = str(uuid.uuid4())
        new_version_counter = old_version_counter + 1
        now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        new_nodes_json = json.dumps(nodes, ensure_ascii=False)

        conn.execute("BEGIN")

        cur.execute(
            """
            update workflow_entity
            set nodes = ?, versionId = ?, activeVersionId = ?, versionCounter = ?, updatedAt = ?
            where id = ?
            """,
            (new_nodes_json, new_version_id, new_version_id, new_version_counter, now, WORKFLOW_ID),
        )

        cur.execute(
            """
            insert into workflow_history
                (versionId, workflowId, authors, createdAt, updatedAt, nodes, connections, name, autosaved, description, nodeGroups)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_version_id,
                WORKFLOW_ID,
                "db-fix-poll-ceiling-raise",
                now,
                now,
                new_nodes_json,
                connections_json,
                row["name"],
                0,
                row["description"],
                row["nodeGroups"],
            ),
        )

        cur.execute(
            """
            insert into workflow_publish_history (workflowId, versionId, event, userId, createdAt)
            values (?, ?, 'activated', NULL, ?)
            """,
            (WORKFLOW_ID, new_version_id, now),
        )

        old_dep_rows = cur.execute(
            """
            select dependencyType, dependencyKey, indexVersionId, dependencyInfo
            from workflow_dependency
            where workflowId = ? and workflowVersionId = ?
            """,
            (WORKFLOW_ID, old_version_counter),
        ).fetchall()

        cur.execute(
            """
            update workflow_dependency
            set publishedVersionId = ?
            where workflowId = ? and workflowVersionId = ?
            """,
            (new_version_id, WORKFLOW_ID, old_version_counter),
        )

        for dep in old_dep_rows:
            cur.execute(
                """
                insert into workflow_dependency
                    (workflowId, workflowVersionId, dependencyType, dependencyKey, indexVersionId, createdAt, dependencyInfo, publishedVersionId)
                values (?, ?, ?, ?, ?, ?, ?, NULL)
                """,
                (
                    WORKFLOW_ID,
                    new_version_counter,
                    dep["dependencyType"],
                    dep["dependencyKey"],
                    dep["indexVersionId"],
                    now,
                    dep["dependencyInfo"],
                ),
            )

        conn.commit()

    print(
        json.dumps(
            {
                "workflow_id": WORKFLOW_ID,
                "backup_path": str(backup_path),
                "updated_node": "Init Marker Poll Guard",
                "poll_ceiling": {
                    "old_max_polls": OLD_MAX_POLLS,
                    "new_max_polls": NEW_MAX_POLLS,
                    "old_max_elapsed_ms": OLD_MAX_ELAPSED_MS,
                    "new_max_elapsed_ms": NEW_MAX_ELAPSED_MS,
                },
                "old_version_id": old_version_id,
                "new_version_id": new_version_id,
                "old_version_counter": old_version_counter,
                "new_version_counter": new_version_counter,
                "dependency_rows_migrated": len(old_dep_rows),
                "updatedAt": now,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
