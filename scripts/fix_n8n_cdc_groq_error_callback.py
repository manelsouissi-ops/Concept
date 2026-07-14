import json
import sqlite3
import sys
import uuid
from datetime import datetime
from pathlib import Path


DB_PATH = Path(r"C:\Users\lotfi\.n8n\database.sqlite")
WORKFLOW_ID = "f866bd39869c4c11"
BACKUP_DIR = Path(r"C:\Users\lotfi\Documents\Concept\tmp\n8n-workflow-backups")

GROQ_NODE_NAME = "HTTP Request → Groq XML"
SUCCESS_TARGET_NODE_NAME = "Clean XML Response"
ERROR_CALLBACK_NODE_NAME = "Groq Error Callback"


def backup_workflow(row: sqlite3.Row) -> Path:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    backup_path = BACKUP_DIR / f"{WORKFLOW_ID}_before_groq_error_callback_{timestamp}.json"
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


def build_error_callback_node(position: list[int]) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "name": ERROR_CALLBACK_NODE_NAME,
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.4,
        "position": position,
        "parameters": {
            "method": "POST",
            "url": "={{ 'http://localhost:3000/api/fiche/' + $('Webhook CDC Initiation').item.json.body.code_interne + '/complete' }}",
            "sendHeaders": True,
            "headerParameters": {
                "parameters": [
                    {
                        "name": "X-Complete-Secret",
                        "value": "={{ $env.N8N_COMPLETE_SECRET }}",
                    },
                    {
                        "name": "Content-Type",
                        "value": "application/json",
                    },
                ]
            },
            "sendBody": True,
            "contentType": "json",
            "specifyBody": "json",
            "jsonBody": '={{ JSON.stringify({ "error": $json.error?.message || "Groq request failed", "stage": "groq", "executionId": $execution.id }) }}',
            "options": {
                "timeout": 30000,
            },
        },
    }


def validate_connections(nodes: list[dict], connections: dict) -> None:
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
        connections = json.loads(row["connections"])
        settings = json.loads(row["settings"]) if row["settings"] else {}
        nodes_by_name = {node["name"]: node for node in nodes}

        groq_node = require_node(nodes_by_name, GROQ_NODE_NAME)
        require_node(nodes_by_name, SUCCESS_TARGET_NODE_NAME)
        if ERROR_CALLBACK_NODE_NAME in nodes_by_name:
            raise RuntimeError(
                f"Node '{ERROR_CALLBACK_NODE_NAME}' already exists - aborting to avoid duplicate"
            )

        existing_main = connections.get(GROQ_NODE_NAME, {}).get("main", [])
        if len(existing_main) != 1:
            raise RuntimeError(
                f"Expected exactly one existing output branch on '{GROQ_NODE_NAME}', "
                f"found {len(existing_main)} - node has already changed, aborting to avoid clobbering"
            )

        before_on_error = groq_node.get("onError")
        if before_on_error is not None:
            raise RuntimeError(
                f"'{GROQ_NODE_NAME}' already has onError={before_on_error!r} set - aborting to avoid clobbering"
            )

        groq_pos = groq_node.get("position", [944, 656])
        error_node_position = [groq_pos[0], groq_pos[1] + 192]
        error_node = build_error_callback_node(error_node_position)
        nodes.append(error_node)
        nodes_by_name[ERROR_CALLBACK_NODE_NAME] = error_node

        groq_node["onError"] = "continueErrorOutput"

        connections[GROQ_NODE_NAME] = {
            "main": [
                existing_main[0],
                [
                    {
                        "node": ERROR_CALLBACK_NODE_NAME,
                        "type": "main",
                        "index": 0,
                    }
                ],
            ]
        }

        validate_connections(nodes, connections)

        old_version_id = row["versionId"]
        old_version_counter = int(row["versionCounter"] or 0)
        new_version_id = str(uuid.uuid4())
        new_version_counter = old_version_counter + 1
        now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        new_nodes_json = json.dumps(nodes, ensure_ascii=False)
        new_connections_json = json.dumps(connections, ensure_ascii=False)
        new_settings_json = json.dumps(settings, ensure_ascii=False)

        conn.execute("BEGIN")

        cur.execute(
            """
            update workflow_entity
            set nodes = ?, connections = ?, settings = ?, versionId = ?, activeVersionId = ?, versionCounter = ?, updatedAt = ?
            where id = ?
            """,
            (
                new_nodes_json,
                new_connections_json,
                new_settings_json,
                new_version_id,
                new_version_id,
                new_version_counter,
                now,
                WORKFLOW_ID,
            ),
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
                "db-fix-groq-error-callback",
                now,
                now,
                new_nodes_json,
                new_connections_json,
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
                "added_node": ERROR_CALLBACK_NODE_NAME,
                "updated_node": GROQ_NODE_NAME,
                "groq_node_onError": "continueErrorOutput",
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
