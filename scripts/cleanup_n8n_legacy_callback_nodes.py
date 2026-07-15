import json
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
DB_PATH = Path.home() / ".n8n" / "database.sqlite"
WORKFLOW_ID = "f866bd39869c4c11"
BACKUP_DIR = REPO_ROOT / "tmp" / "n8n-workflow-backups"
AUTHOR = "db-cleanup-legacy-callback-nodes"
NODES_TO_REMOVE = {
    "Marker Job Failed",
    "Marker Timeout",
    "Gemini Error Callback",
}


def utc_timestamp() -> str:
    return datetime.utcnow().strftime("%Y%m%d_%H%M%S")


def utc_sql_timestamp() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]


def new_version_id() -> str:
    return str(uuid.uuid4())


def backup_database() -> Path:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    backup_path = BACKUP_DIR / f"database_full_{utc_timestamp()}_before_n8n_legacy_callback_cleanup.sqlite.bak"
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


def backup_workflow_json(payload: dict, suffix: str) -> Path:
    path = BACKUP_DIR / f"{WORKFLOW_ID}_{suffix}_{utc_timestamp()}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def verify_payload(payload: dict) -> dict:
    workflow_blob = json.dumps(payload, ensure_ascii=False)
    names = [node["name"] for node in payload["nodes"]]
    return {
        "removed_nodes_absent": all(name not in names for name in NODES_TO_REMOVE),
        "no_localhost_callback_url": "http://localhost:3000" not in workflow_blob,
        "no_legacy_complete_secret": "N8N_COMPLETE_SECRET" not in workflow_blob,
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
            select id, name, active, nodes, connections, settings, description, nodeGroups, updatedAt, versionId, activeVersionId, versionCounter
            from workflow_entity
            where id = ?
            """,
            (WORKFLOW_ID,),
        ).fetchone()
        if row is None:
            raise RuntimeError(f"Workflow {WORKFLOW_ID} not found")

        current_payload = workflow_payload_from_row(row)
        before_backup_path = backup_workflow_json(current_payload, "before_n8n_legacy_callback_cleanup")

        old_version_id = row["versionId"]
        old_active_version_id = row["activeVersionId"]
        old_version_counter = int(row["versionCounter"] or 0)

        nodes = [node for node in current_payload["nodes"] if node["name"] not in NODES_TO_REMOVE]
        connections = current_payload["connections"]
        settings = current_payload["settings"]

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
        updated_payload = workflow_payload_from_row(updated_row)

    after_backup_path = backup_workflow_json(updated_payload, "after_n8n_legacy_callback_cleanup")
    verification = verify_payload(updated_payload)

    print(
        json.dumps(
            {
                "workflow_id": WORKFLOW_ID,
                "db_backup_path": str(db_backup_path),
                "before_backup_path": str(before_backup_path),
                "after_backup_path": str(after_backup_path),
                "old_version_id": old_version_id,
                "old_active_version_id": old_active_version_id,
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
