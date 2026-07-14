import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path


DB_PATH = Path(r"C:\Users\lotfi\.n8n\database.sqlite")
WORKFLOW_ID = "f866bd39869c4c11"
BACKUP_DIR = Path(r"C:\Users\lotfi\Documents\Concept\tmp\n8n-workflow-backups")
STALE_EXECUTION_IDS = (168, 169, 170, 171, 172)


def backup_workflow(row: sqlite3.Row) -> Path:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    backup_path = BACKUP_DIR / f"{WORKFLOW_ID}_before_responsemode_fix_{timestamp}.json"
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
    }
    backup_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return backup_path


def require_node(nodes_by_name: dict[str, dict], name: str) -> dict:
    if name not in nodes_by_name:
        raise RuntimeError(f"Node '{name}' not found in workflow {WORKFLOW_ID}")
    return nodes_by_name[name]


def count_respond_nodes(nodes: list[dict]) -> int:
    return sum(1 for node in nodes if node["type"] == "n8n-nodes-base.respondToWebhook")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        row = cur.execute(
            """
            select id, name, active, nodes, connections, settings, updatedAt, versionId, versionCounter, activeVersionId
            from workflow_entity
            where id = ?
            """,
            (WORKFLOW_ID,),
        ).fetchone()
        if row is None:
            raise RuntimeError(f"Workflow {WORKFLOW_ID} not found")

        backup_path = backup_workflow(row)
        nodes = json.loads(row["nodes"])
        nodes_by_name = {node["name"]: node for node in nodes}

        webhook = require_node(nodes_by_name, "Webhook CDC Initiation")
        webhook["parameters"] = {
            "httpMethod": "POST",
            "path": "cdc-initiation-fiche-projet-xml",
            "responseMode": "onReceived",
            "options": {},
        }

        targets = {
            "Respond XML JSON": require_node(nodes_by_name, "Respond XML JSON")["type"],
            "Marker Job Failed": require_node(nodes_by_name, "Marker Job Failed")["type"],
            "Marker Timeout": require_node(nodes_by_name, "Marker Timeout")["type"],
        }
        respond_count = count_respond_nodes(nodes)

        now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        version_counter = int(row["versionCounter"] or 0) + 1

        conn.execute("BEGIN")
        cur.execute(
            """
            update workflow_entity
            set nodes = ?, updatedAt = ?, versionCounter = ?
            where id = ?
            """,
            (
                json.dumps(nodes, ensure_ascii=False),
                now,
                version_counter,
                WORKFLOW_ID,
            ),
        )

        placeholders = ",".join("?" for _ in STALE_EXECUTION_IDS)
        deleted_execution_data = cur.execute(
            f"delete from execution_data where executionId in ({placeholders})",
            STALE_EXECUTION_IDS,
        ).rowcount
        conn.commit()

    print(
        json.dumps(
            {
                "workflow_id": WORKFLOW_ID,
                "backup_path": str(backup_path),
                "updatedAt": now,
                "versionCounter": version_counter,
                "webhookParameters": webhook["parameters"],
                "targetNodeTypes": targets,
                "respondToWebhookCount": respond_count,
                "deletedExecutionDataRows": deleted_execution_data,
                "deletedExecutionIds": list(STALE_EXECUTION_IDS),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
