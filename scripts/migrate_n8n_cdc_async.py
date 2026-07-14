import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path


DB_PATH = Path(r"C:\Users\lotfi\.n8n\database.sqlite")
WORKFLOW_ID = "f866bd39869c4c11"
BACKUP_DIR = Path(r"C:\Users\lotfi\Documents\Concept\tmp\n8n-workflow-backups")
LOCAL_COMPLETE_SECRET = "cdc-complete-local-secret"
CALLBACK_BASE_URL = "http://localhost:3000"


def backup_workflow(row: sqlite3.Row) -> Path:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    backup_path = BACKUP_DIR / f"{WORKFLOW_ID}_async_migration_{timestamp}.json"
    payload = {
        "id": row["id"],
        "name": row["name"],
        "active": row["active"],
        "nodes": json.loads(row["nodes"]),
        "connections": json.loads(row["connections"]),
        "settings": json.loads(row["settings"]) if row["settings"] else {},
        "updatedAt": row["updatedAt"],
        "versionCounter": row["versionCounter"],
    }
    backup_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return backup_path


def require_node(nodes_by_name: dict[str, dict], name: str) -> dict:
    if name not in nodes_by_name:
        raise RuntimeError(f"Node '{name}' not found in workflow {WORKFLOW_ID}")
    return nodes_by_name[name]


def callback_url_expression() -> str:
    return (
        "={{ "
        f"'{CALLBACK_BASE_URL}/api/fiche/' + "
        "encodeURIComponent($('Prepare Upload Paths').first().json.code_interne || $json.code_interne) + "
        "'/complete' "
        "}}"
    )


def callback_headers() -> dict:
    return {
        "parameters": [
            {
                "name": "X-Complete-Secret",
                "value": f"={{ $env.N8N_COMPLETE_SECRET || '{LOCAL_COMPLETE_SECRET}' }}",
            }
        ]
    }


def make_http_callback_node(existing: dict, body_expression: str) -> dict:
    node = dict(existing)
    node["type"] = "n8n-nodes-base.httpRequest"
    node["typeVersion"] = 4.4
    node["parameters"] = {
        "method": "POST",
        "url": callback_url_expression(),
        "sendHeaders": True,
        "headerParameters": callback_headers(),
        "sendBody": True,
        "specifyBody": "json",
        "jsonBody": body_expression,
        "options": {
            "timeout": 30000,
        },
    }
    node.pop("onError", None)
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
    sys.stdout.reconfigure(encoding="utf-8")

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        row = cur.execute(
            """
            select id, name, active, nodes, connections, settings, updatedAt, versionCounter
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

        webhook = require_node(nodes_by_name, "Webhook CDC Initiation")
        webhook.setdefault("parameters", {})
        webhook["parameters"]["responseMode"] = "onReceived"

        respond_xml = require_node(nodes_by_name, "Respond XML JSON")
        marker_failed = require_node(nodes_by_name, "Marker Job Failed")
        marker_timeout = require_node(nodes_by_name, "Marker Timeout")

        respond_xml.update(
            make_http_callback_node(
                respond_xml,
                "={{ JSON.stringify({ xml: $json.xml, markdown: $json.markdown, executionId: $execution.id }) }}",
            )
        )
        marker_failed.update(
            make_http_callback_node(
                marker_failed,
                "={{ JSON.stringify({ error: 'Marker job failed for job_id ' + ($json.job_id || 'unknown') + ' (' + ($json.original_filename || 'unknown file') + '): ' + ($json.error || 'unknown error'), stage: 'marker', executionId: $execution.id }) }}",
            )
        )
        marker_timeout.update(
            make_http_callback_node(
                marker_timeout,
                "={{ JSON.stringify({ error: 'Marker timeout after 5 minutes (polls=' + ($json.marker_poll_count || 'unknown') + ', elapsed_ms=' + ($json.marker_elapsed_ms || 'unknown') + ')', stage: 'marker', executionId: $execution.id }) }}",
            )
        )

        validate_connections(nodes, connections)

        now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        version_counter = int(row["versionCounter"] or 0) + 1
        cur.execute(
            """
            update workflow_entity
            set nodes = ?, connections = ?, settings = ?, updatedAt = ?, versionCounter = ?
            where id = ?
            """,
            (
                json.dumps(nodes, ensure_ascii=False),
                json.dumps(connections, ensure_ascii=False),
                json.dumps(settings, ensure_ascii=False),
                now,
                version_counter,
                WORKFLOW_ID,
            ),
        )
        conn.commit()

    print(
        json.dumps(
            {
                "workflow_id": WORKFLOW_ID,
                "backup_path": str(backup_path),
                "updated_nodes": [
                    "Webhook CDC Initiation",
                    "Respond XML JSON",
                    "Marker Job Failed",
                    "Marker Timeout",
                ],
                "callback_base_url": CALLBACK_BASE_URL,
                "secret_source": "$env.N8N_COMPLETE_SECRET || local fallback",
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
