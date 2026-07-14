import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path


DB_PATH = Path(r"C:\Users\lotfi\.n8n\database.sqlite")
WORKFLOW_ID = "f866bd39869c4c11"
BACKUP_DIR = Path(r"C:\Users\lotfi\Documents\Concept\tmp\n8n-workflow-backups")


def backup_workflow(row: sqlite3.Row) -> Path:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    backup_path = BACKUP_DIR / f"{WORKFLOW_ID}_before_responder_fix_{timestamp}.json"
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


def build_http_request_parameters(body_expression: str) -> dict:
    return {
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
        "jsonBody": body_expression,
        "options": {
            "timeout": 30000,
        },
    }


def convert_node(existing: dict, body_expression: str) -> None:
    existing["type"] = "n8n-nodes-base.httpRequest"
    existing["typeVersion"] = 4.4
    existing["parameters"] = build_http_request_parameters(body_expression)
    existing.pop("credentials", None)
    existing.pop("webhookId", None)
    existing.pop("disabled", None)
    existing.pop("onError", None)


def validate_connections(nodes: list[dict], connections: dict) -> None:
    names = {node["name"] for node in nodes}
    for source, outputs in connections.items():
        if source not in names:
            raise RuntimeError(f"Missing source node in connections: {source}")
        for branch in outputs.get("main", []):
            for edge in branch:
                if edge["node"] not in names:
                    raise RuntimeError(f"Missing target node in connections: {source} -> {edge['node']}")


def count_respond_nodes(nodes: list[dict]) -> int:
    return sum(1 for node in nodes if node["type"] == "n8n-nodes-base.respondToWebhook")


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

        before = {
            "Respond XML JSON": require_node(nodes_by_name, "Respond XML JSON")["type"],
            "Marker Job Failed": require_node(nodes_by_name, "Marker Job Failed")["type"],
            "Marker Timeout": require_node(nodes_by_name, "Marker Timeout")["type"],
            "respond_to_webhook_count": count_respond_nodes(nodes),
        }

        convert_node(
            require_node(nodes_by_name, "Respond XML JSON"),
            '={{ JSON.stringify({ "xml": $json.xml, "markdown": $json.markdown, "executionId": $execution.id }) }}',
        )
        convert_node(
            require_node(nodes_by_name, "Marker Job Failed"),
            '={{ JSON.stringify({ "error": $json.error || "Marker job failed", "stage": "marker", "executionId": $execution.id }) }}',
        )
        convert_node(
            require_node(nodes_by_name, "Marker Timeout"),
            '={{ JSON.stringify({ "error": "Marker timeout exceeded", "stage": "marker", "executionId": $execution.id }) }}',
        )

        validate_connections(nodes, connections)

        after = {
            "Respond XML JSON": require_node(nodes_by_name, "Respond XML JSON")["type"],
            "Marker Job Failed": require_node(nodes_by_name, "Marker Job Failed")["type"],
            "Marker Timeout": require_node(nodes_by_name, "Marker Timeout")["type"],
            "respond_to_webhook_count": count_respond_nodes(nodes),
        }

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
                "method": "direct_db_write",
                "before": before,
                "after": after,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
