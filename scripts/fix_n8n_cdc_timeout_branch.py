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
    backup_path = BACKUP_DIR / f"{WORKFLOW_ID}_timeout_fix_{timestamp}.json"
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


def ensure_node(nodes: list[dict], node: dict) -> None:
    for index, existing in enumerate(nodes):
        if existing["name"] == node["name"]:
            nodes[index] = node
            return
    nodes.append(node)


def make_if_node(node_id: str, name: str, position: list[int]) -> dict:
    return {
        "id": node_id,
        "name": name,
        "type": "n8n-nodes-base.if",
        "typeVersion": 2.2,
        "position": position,
        "parameters": {
            "conditions": {
                "options": {
                    "caseSensitive": True,
                    "leftValue": "",
                    "typeValidation": "strict",
                    "version": 2,
                },
                "conditions": [
                    {
                        "leftValue": "={{ $json.marker_timed_out }}",
                        "rightValue": True,
                        "operator": {
                            "type": "boolean",
                            "operation": "true",
                            "singleValue": True,
                        },
                    }
                ],
                "combinator": "and",
            },
            "options": {},
        },
    }


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

        increment_guard = require_node(nodes_by_name, "Increment Marker Poll Guard")
        increment_guard["parameters"]["jsCode"] = """const item = $input.first();
const now = Date.now();
const pollCount = Number(item.json.marker_poll_count ?? 0) + 1;
const startedAt = Number(item.json.marker_started_at ?? now);
const maxPolls = Number(item.json.marker_max_polls ?? 10);
const maxElapsedMs = Number(item.json.marker_max_elapsed_ms ?? 300000);
const elapsedMs = now - startedAt;
const timedOut = pollCount >= maxPolls || elapsedMs >= maxElapsedMs;

return [{
  json: {
    ...item.json,
    marker_timed_out: timedOut,
    marker_poll_count: pollCount,
    marker_started_at: startedAt,
    marker_max_polls: maxPolls,
    marker_max_elapsed_ms: maxElapsedMs,
    marker_elapsed_ms: elapsedMs,
    marker_last_poll_at: now,
  },
  binary: item.binary,
}];"""

        marker_timeout = require_node(nodes_by_name, "Marker Timeout")
        marker_timeout["position"] = [48, 800]
        marker_timeout["parameters"]["jsCode"] = """const item = $input.first();
throw new Error(`Marker timeout after 5 minutes (polls=${item.json.marker_poll_count}, elapsed_ms=${item.json.marker_elapsed_ms})`);"""

        timeout_if = make_if_node(
            "2e0f2f7d-c6d3-4880-9929-b4cd609d4b12",
            "Marker Timeout Reached?",
            [-176, 608],
        )
        ensure_node(nodes, timeout_if)

        # Rebuild only the affected part of the graph, preserving the working downstream flow.
        connections["Wait 30s Before Marker Result"] = {
            "main": [[{"node": "Increment Marker Poll Guard", "type": "main", "index": 0}]]
        }
        connections["Increment Marker Poll Guard"] = {
            "main": [[{"node": "Marker Timeout Reached?", "type": "main", "index": 0}]]
        }
        connections["Marker Timeout Reached?"] = {
            "main": [
                [{"node": "Marker Timeout", "type": "main", "index": 0}],
                [{"node": "Get Marker Result", "type": "main", "index": 0}],
            ]
        }

        # Keep the visible timeout branch independent from the status switch.
        connections["Get Marker Result"] = {
            "main": [[{"node": "Merge Marker Result With Guard", "type": "main", "index": 0}]]
        }
        connections["Merge Marker Result With Guard"] = {
            "main": [[{"node": "Check Marker Status", "type": "main", "index": 0}]]
        }
        connections["Check Marker Status"] = {
            "main": [
                [{"node": "Read Markdown as Text", "type": "main", "index": 0}],
                [{"node": "Wait 30s Before Marker Result", "type": "main", "index": 0}],
                [{"node": "Marker Job Failed", "type": "main", "index": 0}],
            ]
        }

        validate_graph(nodes, connections)

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
                    "Increment Marker Poll Guard",
                    "Marker Timeout",
                    "Marker Timeout Reached?",
                ],
                "timeout_policy": {
                    "poll_interval_seconds": 30,
                    "max_polls": 10,
                    "max_elapsed_ms": 300000,
                    "comparison": "pollCount >= maxPolls OR elapsedMs >= maxElapsedMs",
                },
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
