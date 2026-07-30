import json
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path


DB_PATH = Path(r"C:\Users\lotfi\.n8n\database.sqlite")
WORKFLOW_ID = "f866bd39869c4c11"
BACKUP_DIR = Path(r"C:\Users\lotfi\Documents\Concept\tmp\n8n-workflow-backups")
AUTHOR = "db-update-gemini-3.6-flash"

GEMINI_NODE_NAME = "HTTP Request → Gemini XML"
TARGET_MODEL = "gemini-3.6-flash"
TARGET_CONTEXT_LITERAL = "llm_model: 'gemini-3.6-flash'"
OLD_CONTEXT_LITERAL = "llm_model: 'gemini-2.5-flash'"


def utc_timestamp() -> str:
    return datetime.utcnow().strftime("%Y%m%d_%H%M%S")


def utc_sql_timestamp() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]


def new_version_id() -> str:
    return str(uuid.uuid4())


def backup_database() -> Path:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    backup_path = BACKUP_DIR / f"database_before_gemini_3_6_flash_{utc_timestamp()}.sqlite.bak"
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


def export_workflow_json(payload: dict, suffix: str) -> Path:
    path = BACKUP_DIR / f"{WORKFLOW_ID}_{suffix}_{utc_timestamp()}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def require_node(nodes_by_name: dict[str, dict], name: str) -> dict:
    node = nodes_by_name.get(name)
    if node is None:
        raise RuntimeError(f"Node '{name}' not found in workflow {WORKFLOW_ID}")
    return node


def replace_once(text: str, old: str, new: str) -> str:
    if old not in text:
        raise RuntimeError(f"Expected literal not found: {old}")
    return text.replace(old, new, 1)


def patch_gemini_node(node: dict) -> None:
    json_body = node["parameters"]["jsonBody"]
    json_body = replace_once(json_body, "model: 'gemini-2.5-flash'", f"model: '{TARGET_MODEL}'")
    json_body = json_body.replace("    temperature: 0.1,\n", "")
    json_body = json_body.replace("    top_p: 1,\n", "")
    json_body = json_body.replace("    top_k: 1,\n", "")
    node["parameters"]["jsonBody"] = json_body


def patch_context_node(node: dict) -> None:
    js_code = node["parameters"]["jsCode"]
    js_code = replace_once(js_code, OLD_CONTEXT_LITERAL, TARGET_CONTEXT_LITERAL)
    node["parameters"]["jsCode"] = js_code


def validate_connections(nodes: list[dict], connections: dict) -> None:
    names = {node["name"] for node in nodes}
    for source, outputs in connections.items():
        if source not in names:
            raise RuntimeError(f"Missing source node in connections: {source}")
        if outputs is None:
            continue
        for branch in outputs.get("main", []):
            for edge in branch:
                if edge["node"] not in names:
                    raise RuntimeError(f"Missing target node in connections: {source} -> {edge['node']}")


def verify_payload(payload: dict) -> dict:
    nodes_by_name = {node["name"]: node for node in payload["nodes"]}
    gemini_node = require_node(nodes_by_name, GEMINI_NODE_NAME)
    context_node = require_node(nodes_by_name, "Build Canonical Context")
    json_body = gemini_node["parameters"]["jsonBody"]
    workflow_blob = json.dumps(payload, ensure_ascii=False)

    return {
        "workflow_json_valid": True,
        "node_present": GEMINI_NODE_NAME in nodes_by_name,
        "endpoint_is_openai_compatible": gemini_node["parameters"]["url"] == "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        "model_is_gemini_3_6_flash": f"model: '{TARGET_MODEL}'" in json_body,
        "temperature_removed": "temperature:" not in json_body,
        "top_p_removed": "top_p:" not in json_body,
        "top_k_removed": "top_k:" not in json_body,
        "authorization_uses_env": "{{$env.GEMINI_API_KEY}}" in workflow_blob,
        "context_llm_model_updated": TARGET_CONTEXT_LITERAL in context_node["parameters"]["jsCode"],
    }


def main() -> None:
    if not DB_PATH.exists():
        raise RuntimeError(f"Database not found at {DB_PATH}")

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    db_backup_path = backup_database()

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        entity_row = cur.execute(
            """
            select id, name, active, nodes, connections, settings, description, nodeGroups,
                   updatedAt, versionId, activeVersionId, versionCounter
            from workflow_entity
            where id = ?
            """,
            (WORKFLOW_ID,),
        ).fetchone()
        if entity_row is None:
            raise RuntimeError(f"Workflow {WORKFLOW_ID} not found")

        before_payload = workflow_payload_from_row(entity_row)
        before_export_path = export_workflow_json(before_payload, "before_gemini_3_6_flash")

        nodes = json.loads(entity_row["nodes"])
        connections = json.loads(entity_row["connections"])
        settings = json.loads(entity_row["settings"]) if entity_row["settings"] else {}

        nodes_by_name = {node["name"]: node for node in nodes}
        patch_gemini_node(require_node(nodes_by_name, GEMINI_NODE_NAME))
        patch_context_node(require_node(nodes_by_name, "Build Canonical Context"))
        validate_connections(nodes, connections)

        old_version_id = entity_row["versionId"]
        old_active_version_id = entity_row["activeVersionId"]
        old_version_counter = int(entity_row["versionCounter"] or 0)
        new_ver_id = new_version_id()
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
                new_ver_id,
                new_ver_id,
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
                new_ver_id,
                WORKFLOW_ID,
                AUTHOR,
                now,
                now,
                new_nodes_json,
                new_connections_json,
                entity_row["name"],
                0,
                entity_row["description"],
                entity_row["nodeGroups"],
            ),
        )

        cur.execute(
            """
            insert into workflow_publish_history (workflowId, versionId, event, userId, createdAt)
            values (?, ?, 'activated', NULL, ?)
            """,
            (WORKFLOW_ID, new_ver_id, now),
        )

        dependency_rows = cur.execute(
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
            (new_ver_id, WORKFLOW_ID, old_version_counter),
        )

        for dep in dependency_rows:
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
        after_payload = workflow_payload_from_row(updated_row)

    after_export_path = export_workflow_json(after_payload, "after_gemini_3_6_flash")
    verification = verify_payload(after_payload)

    print(
        json.dumps(
            {
                "workflow_id": WORKFLOW_ID,
                "db_backup_path": str(db_backup_path),
                "before_export_path": str(before_export_path),
                "after_export_path": str(after_export_path),
                "old_version_id": old_version_id,
                "old_active_version_id": old_active_version_id,
                "new_version_id": after_payload["versionId"],
                "old_version_counter": old_version_counter,
                "new_version_counter": after_payload["versionCounter"],
                "verification": verification,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
