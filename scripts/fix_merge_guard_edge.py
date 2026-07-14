import json
import sqlite3
import sys
import uuid
from datetime import datetime
from pathlib import Path


DB_PATH = Path(r"C:\Users\lotfi\.n8n\database.sqlite")
WORKFLOW_ID = "f866bd39869c4c11"
BACKUP_DIR = Path(r"C:\Users\lotfi\Documents\Concept\tmp\n8n-workflow-backups")


def backup_workflow(row: sqlite3.Row) -> Path:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    backup_path = BACKUP_DIR / f"{WORKFLOW_ID}_before_merge_fix_{timestamp}.json"
    payload = {
        "id": row["id"],
        "name": row["name"],
        "active": row["active"],
        "nodes": json.loads(row["nodes"]),
        "connections": json.loads(row["connections"]),
        "settings": json.loads(row["settings"]) if row["settings"] else {},
        "updatedAt": row["updatedAt"],
        "versionId": row["versionId"],
        "versionCounter": row["versionCounter"],
        "activeVersionId": row["activeVersionId"],
        "description": row["description"],
        "nodeGroups": row["nodeGroups"],
    }
    backup_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return backup_path


def validate_graph(nodes: list[dict], connections: dict) -> None:
    names = {node["name"] for node in nodes}
    for source, outputs in connections.items():
        if source not in names:
            raise RuntimeError(f"Missing source node in connections: {source}")
        for branch in outputs.get("main", []):
            for edge in branch:
                if edge["node"] not in names:
                    raise RuntimeError(f"Missing target node in connections: {source} -> {edge['node']}")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        row = cur.execute(
            """
            select id, name, active, nodes, connections, settings, updatedAt,
                   versionId, versionCounter, activeVersionId, description, nodeGroups
            from workflow_entity
            where id = ?
            """,
            (WORKFLOW_ID,),
        ).fetchone()
        if row is None:
            raise RuntimeError(f"Workflow {WORKFLOW_ID} not found")

        backup_path = backup_workflow(row)

        nodes = json.loads(row["nodes"])
        connections = json.loads(row["connections"])

        if "Increment Marker Poll Guard" not in connections:
            raise RuntimeError("Increment Marker Poll Guard missing from connections")
        if "Get Marker Result" not in connections:
            raise RuntimeError("Get Marker Result missing from connections")

        # Restore the edge dropped by fix_n8n_cdc_timeout_branch.py: the guard
        # counter must fan out to both the timeout check and the merge's second input.
        connections["Increment Marker Poll Guard"] = {
            "main": [[
                {"node": "Marker Timeout Reached?", "type": "main", "index": 0},
                {"node": "Merge Marker Result With Guard", "type": "main", "index": 1},
            ]]
        }

        # Confirm (not modify) that Get Marker Result -> Merge index 0 remains intact.
        get_marker_out = connections["Get Marker Result"]["main"][0]
        if not any(
            e["node"] == "Merge Marker Result With Guard" and e.get("index", 0) == 0
            for e in get_marker_out
        ):
            raise RuntimeError("Get Marker Result -> Merge Marker Result With Guard (index 0) edge is missing")

        validate_graph(nodes, connections)

        connections_json = json.dumps(connections, ensure_ascii=False)
        nodes_json = json.dumps(nodes, ensure_ascii=False)

        now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        version_counter = int(row["versionCounter"] or 0) + 1
        new_version_id = str(uuid.uuid4())
        old_active_version_id = row["activeVersionId"]

        conn.execute("BEGIN")

        cur.execute(
            """
            update workflow_entity
            set connections = ?, updatedAt = ?, versionCounter = ?, versionId = ?, activeVersionId = ?
            where id = ?
            """,
            (connections_json, now, version_counter, new_version_id, new_version_id, WORKFLOW_ID),
        )

        cur.execute(
            """
            insert into workflow_history
                (versionId, workflowId, authors, createdAt, updatedAt, nodes, connections, name, autosaved, description, nodeGroups)
            values (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
            """,
            (
                new_version_id,
                WORKFLOW_ID,
                "db-fix-merge-edge",
                now,
                now,
                nodes_json,
                connections_json,
                row["name"],
                row["description"],
                row["nodeGroups"],
            ),
        )

        cur.execute(
            """
            insert into workflow_publish_history (workflowId, versionId, event, createdAt)
            values (?, ?, 'activated', ?)
            """,
            (WORKFLOW_ID, new_version_id, now),
        )

        dep_rowcount = 0
        if old_active_version_id:
            cur.execute(
                """
                update workflow_dependency
                set publishedVersionId = ?
                where workflowId = ? and publishedVersionId = ?
                """,
                (new_version_id, WORKFLOW_ID, old_active_version_id),
            )
            dep_rowcount = cur.rowcount

        conn.commit()

    print(
        json.dumps(
            {
                "workflow_id": WORKFLOW_ID,
                "backup_path": str(backup_path),
                "old_active_version_id": old_active_version_id,
                "new_version_id": new_version_id,
                "updatedAt": now,
                "versionCounter": version_counter,
                "workflow_dependency_rows_updated": dep_rowcount,
                "increment_marker_poll_guard_connections": connections["Increment Marker Poll Guard"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
