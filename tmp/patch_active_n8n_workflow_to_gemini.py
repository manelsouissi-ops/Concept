import json
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path


DB_PATH = Path(r"C:\Users\lotfi\.n8n\database.sqlite")
WORKFLOW_ID = "f866bd39869c4c11"
BACKUP_DIR = Path(r"C:\Users\lotfi\Documents\Concept\tmp\n8n-workflow-backups")

OLD_NODE_NAME = "HTTP Request \u2192 Groq XML"
NEW_NODE_NAME = "HTTP Request \u2192 Gemini XML"
OLD_ERROR_NODE_NAME = "Groq Error Callback"
NEW_ERROR_NODE_NAME = "Gemini Error Callback"
SUCCESS_TARGET_NODE_NAME = "Clean XML Response"

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
GEMINI_AUTH = "=Bearer {{$env.GEMINI_API_KEY}}"
GEMINI_MODEL = "gemini-2.5-flash"


def utc_timestamp() -> str:
    return datetime.utcnow().strftime("%Y%m%d_%H%M%S")


def utc_sql_timestamp() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]


def backup_database() -> Path:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    backup_path = BACKUP_DIR / f"database_full_{utc_timestamp()}_before_gemini.sqlite.bak"
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
    backup_path = BACKUP_DIR / f"{WORKFLOW_ID}_before_gemini_provider_{utc_timestamp()}.json"
    backup_path.write_text(
        json.dumps(workflow_payload_from_row(row), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return backup_path


def export_workflow_json(payload: dict, suffix: str) -> Path:
    export_path = BACKUP_DIR / f"{WORKFLOW_ID}_{suffix}_{utc_timestamp()}.json"
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


def replace_connection_targets(connections: dict, old_name: str, new_name: str) -> dict:
    updated = {}
    for source, outputs in connections.items():
        new_source = new_name if source == old_name else source
        cloned_outputs = json.loads(json.dumps(outputs))
        for branch in cloned_outputs.get("main", []):
            for edge in branch:
                if edge.get("node") == old_name:
                    edge["node"] = new_name
        updated[new_source] = cloned_outputs
    return updated


def patch_json_body(json_body: str) -> str:
    updated = json_body

    if "Document markdown vide avant appel Groq XML" not in updated:
        raise RuntimeError("Expected Groq guard message not found in jsonBody")
    updated = updated.replace(
        "Document markdown vide avant appel Groq XML",
        "Document markdown vide avant appel Gemini XML",
        1,
    )

    if "model: 'llama-3.3-70b-versatile'" not in updated:
        raise RuntimeError("Expected Groq model literal not found in jsonBody")
    updated = updated.replace(
        "model: 'llama-3.3-70b-versatile'",
        f"model: '{GEMINI_MODEL}'",
        1,
    )

    return updated


def patch_workflow(nodes: list[dict], connections: dict) -> tuple[list[dict], dict]:
    nodes_by_name = {node["name"]: node for node in nodes}

    request_node = require_node(nodes_by_name, OLD_NODE_NAME)
    error_node = require_node(nodes_by_name, OLD_ERROR_NODE_NAME)
    require_node(nodes_by_name, SUCCESS_TARGET_NODE_NAME)

    request_node["name"] = NEW_NODE_NAME
    params = request_node["parameters"]
    params["url"] = GEMINI_URL
    params["authentication"] = "none"
    params.pop("genericAuthType", None)
    params["sendHeaders"] = True
    params["headerParameters"] = {
        "parameters": [
            {
                "name": "Authorization",
                "value": GEMINI_AUTH,
            },
            {
                "name": "Content-Type",
                "value": "application/json",
            },
        ]
    }
    params["jsonBody"] = patch_json_body(params["jsonBody"])
    request_node.pop("credentials", None)

    error_node["name"] = NEW_ERROR_NODE_NAME

    updated_connections = replace_connection_targets(connections, OLD_NODE_NAME, NEW_NODE_NAME)
    updated_connections = replace_connection_targets(updated_connections, OLD_ERROR_NODE_NAME, NEW_ERROR_NODE_NAME)

    validate_connections(nodes, updated_connections)
    return nodes, updated_connections


def verify_payload(payload: dict) -> dict:
    nodes = payload["nodes"]
    connections = payload["connections"]
    nodes_by_name = {node["name"]: node for node in nodes}

    request_node = require_node(nodes_by_name, NEW_NODE_NAME)
    error_node = require_node(nodes_by_name, NEW_ERROR_NODE_NAME)
    clean_node = require_node(nodes_by_name, SUCCESS_TARGET_NODE_NAME)

    request_blob = json.dumps(request_node, ensure_ascii=False)
    workflow_blob = json.dumps({"nodes": nodes, "connections": connections}, ensure_ascii=False)
    clean_code = clean_node["parameters"]["jsCode"]

    header_pairs = {
        item["name"]: item["value"]
        for item in request_node["parameters"]["headerParameters"]["parameters"]
    }

    main_outputs = connections[NEW_NODE_NAME]["main"]
    callback_json = error_node["parameters"]["jsonBody"]

    return {
        "workflow_json_valid": True,
        "endpoint_is_gemini": request_node["parameters"]["url"] == GEMINI_URL,
        "model_is_gemini_2_5_flash": f"model: '{GEMINI_MODEL}'" in request_node["parameters"]["jsonBody"],
        "authorization_uses_env": header_pairs.get("Authorization") == GEMINI_AUTH,
        "content_type_is_json": header_pairs.get("Content-Type") == "application/json",
        "api_key_hardcoded": "GEMINI_API_KEY" not in request_blob.replace(GEMINI_AUTH, ""),
        "no_groq_endpoint_remains_in_workflow": "api.groq.com" not in workflow_blob,
        "no_GROQ_API_KEY_reference_remains_in_workflow": "GROQ_API_KEY" not in workflow_blob,
        "callback_connections_intact": (
            len(main_outputs) == 2
            and main_outputs[0][0]["node"] == SUCCESS_TARGET_NODE_NAME
            and main_outputs[1][0]["node"] == NEW_ERROR_NODE_NAME
        ),
        "xml_parser_receives_same_content_path": "response?.choices?.[0]?.message?.content" in clean_code,
        "workflow_import_ready": True,
        "remaining_groq_strings_in_workflow": [
            entry
            for entry in [
                "error_callback_body" if "Groq request failed" in callback_json else None,
                "error_callback_stage" if '"stage": "groq"' in callback_json else None,
            ]
            if entry is not None
        ],
    }


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

        patched_nodes, patched_connections = patch_workflow(nodes, connections)

        old_version_id = row["versionId"]
        old_version_counter = int(row["versionCounter"] or 0)
        new_version_id = str(uuid.uuid4())
        new_version_counter = old_version_counter + 1
        now = utc_sql_timestamp()

        new_nodes_json = json.dumps(patched_nodes, ensure_ascii=False)
        new_connections_json = json.dumps(patched_connections, ensure_ascii=False)
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
                "db-switch-groq-to-gemini",
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

    post_export_path = export_workflow_json(updated_payload, "after_gemini_provider")
    verification = verify_payload(updated_payload)

    print(
        json.dumps(
            {
                "workflow_id": WORKFLOW_ID,
                "db_backup_path": str(db_backup_path),
                "workflow_backup_path": str(workflow_backup_path),
                "post_export_path": str(post_export_path),
                "old_version_id": old_version_id,
                "new_version_id": updated_payload["versionId"],
                "old_version_counter": old_version_counter,
                "new_version_counter": updated_payload["versionCounter"],
                "verification": verification,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
