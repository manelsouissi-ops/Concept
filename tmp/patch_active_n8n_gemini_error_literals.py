import json
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path


DB_PATH = Path(r"C:\Users\lotfi\.n8n\database.sqlite")
WORKFLOW_ID = "f866bd39869c4c11"
BACKUP_DIR = Path(r"C:\Users\lotfi\Documents\Concept\tmp\n8n-workflow-backups")

NODE_NAME = "Gemini Error Callback"
REQUEST_NODE_NAME = "HTTP Request \u2192 Gemini XML"

OLD_ERROR_TEXT = "Groq request failed"
NEW_ERROR_TEXT = "Gemini request failed"
OLD_STAGE = '"stage": "groq"'
NEW_STAGE = '"stage": "gemini"'


def utc_timestamp() -> str:
    return datetime.utcnow().strftime("%Y%m%d_%H%M%S")


def utc_sql_timestamp() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]


def backup_database() -> Path:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    backup_path = BACKUP_DIR / f"database_full_{utc_timestamp()}_before_gemini_error_literals.sqlite.bak"
    with sqlite3.connect(DB_PATH) as source:
        with sqlite3.connect(backup_path) as destination:
            source.backup(destination)
    return backup_path


def workflow_payload_from_row(row: sqlite3.Row) -> dict:
    return {
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


def backup_workflow_json(row: sqlite3.Row) -> Path:
    backup_path = BACKUP_DIR / f"{WORKFLOW_ID}_before_gemini_error_literals_{utc_timestamp()}.json"
    backup_path.write_text(
        json.dumps(workflow_payload_from_row(row), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return backup_path


def export_workflow_json(payload: dict) -> Path:
    export_path = BACKUP_DIR / f"{WORKFLOW_ID}_after_gemini_error_literals_{utc_timestamp()}.json"
    export_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return export_path


def require_node(nodes_by_name: dict[str, dict], name: str) -> dict:
    node = nodes_by_name.get(name)
    if node is None:
        raise RuntimeError(f"Node '{name}' not found in workflow {WORKFLOW_ID}")
    return node


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
    if not DB_PATH.exists():
        raise RuntimeError(f"Database not found at {DB_PATH}")

    db_backup_path = backup_database()

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

        workflow_backup_path = backup_workflow_json(row)

        nodes = json.loads(row["nodes"])
        connections = json.loads(row["connections"])
        settings = json.loads(row["settings"]) if row["settings"] else {}
        nodes_by_name = {node["name"]: node for node in nodes}

        callback_node = require_node(nodes_by_name, NODE_NAME)
        require_node(nodes_by_name, REQUEST_NODE_NAME)
        original_request_connections = json.dumps(connections[REQUEST_NODE_NAME], ensure_ascii=False, sort_keys=True)

        json_body = callback_node["parameters"]["jsonBody"]
        if OLD_ERROR_TEXT not in json_body or OLD_STAGE not in json_body:
            raise RuntimeError("Expected Gemini callback literals not found; refusing to patch unknown content")

        updated_json_body = json_body.replace(OLD_ERROR_TEXT, NEW_ERROR_TEXT, 1).replace(OLD_STAGE, NEW_STAGE, 1)
        callback_node["parameters"]["jsonBody"] = updated_json_body

        validate_connections(nodes, connections)

        old_version_id = row["versionId"]
        old_version_counter = int(row["versionCounter"] or 0)
        new_version_id = str(uuid.uuid4())
        new_version_counter = old_version_counter + 1
        now = utc_sql_timestamp()

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
                "db-update-gemini-error-literals",
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

        updated_row = cur.execute(
            """
            select id, name, active, nodes, connections, settings, updatedAt, versionId, activeVersionId, versionCounter
            from workflow_entity
            where id = ?
            """,
            (WORKFLOW_ID,),
        ).fetchone()
        updated_payload = workflow_payload_from_row(updated_row)

    export_path = export_workflow_json(updated_payload)

    updated_nodes_by_name = {node["name"]: node for node in updated_payload["nodes"]}
    updated_callback_node = require_node(updated_nodes_by_name, NODE_NAME)
    updated_request_connections = json.dumps(
        updated_payload["connections"][REQUEST_NODE_NAME],
        ensure_ascii=False,
        sort_keys=True,
    )

    verification = {
        "workflow_json_valid": True,
        "success_and_error_connections_unchanged": original_request_connections == updated_request_connections,
        "callback_error_text_updated": NEW_ERROR_TEXT in updated_callback_node["parameters"]["jsonBody"],
        "callback_stage_updated": NEW_STAGE in updated_callback_node["parameters"]["jsonBody"],
        "old_error_text_removed": OLD_ERROR_TEXT not in updated_callback_node["parameters"]["jsonBody"],
        "old_stage_removed": OLD_STAGE not in updated_callback_node["parameters"]["jsonBody"],
    }

    print(
        json.dumps(
            {
                "workflow_id": WORKFLOW_ID,
                "db_backup_path": str(db_backup_path),
                "workflow_backup_path": str(workflow_backup_path),
                "post_export_path": str(export_path),
                "old_version_id": old_version_id,
                "new_version_id": updated_payload["versionId"],
                "old_version_counter": old_version_counter,
                "new_version_counter": updated_payload["versionCounter"],
                "old_values": {
                    "error": OLD_ERROR_TEXT,
                    "stage": "groq",
                },
                "new_values": {
                    "error": NEW_ERROR_TEXT,
                    "stage": "gemini",
                },
                "verification": verification,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
