import json
import sqlite3
from datetime import datetime
from pathlib import Path


DB_PATH = Path(r"C:\Users\lotfi\.n8n\database.sqlite")
WORKFLOW_ID = "f866bd39869c4c11"
NODE_NAME = "HTTP Request → Groq XML"
OLD_LINE = "  const documentText = $json.texte_anonymise_final || $json.texte_anonymise || '';\n"
NEW_LINE = (
    "  const documentText = $json.texte_anonymise_final || $json.texte_anonymise || '';\n"
    "  if (!documentText.trim()) {\n"
    "    throw new Error('Document anonymisé vide avant appel Groq XML — vérifier les étapes Marker/anonymisation en amont.');\n"
    "  }\n"
)


def main() -> None:
    if not DB_PATH.exists():
        raise RuntimeError(f"Database not found at {DB_PATH}")

    with sqlite3.connect(DB_PATH) as connection:
        cursor = connection.cursor()
        row = cursor.execute(
            "select active, nodes from workflow_entity where id = ?",
            (WORKFLOW_ID,),
        ).fetchone()
        if row is None:
            raise RuntimeError(f"Workflow {WORKFLOW_ID} not found")

        active, nodes_raw = row
        nodes = json.loads(nodes_raw)

        target_node = None
        for node in nodes:
            if node.get("name") == NODE_NAME:
                target_node = node
                break

        if target_node is None:
            raise RuntimeError(f"Node '{NODE_NAME}' not found in workflow {WORKFLOW_ID}")

        json_body = target_node["parameters"]["jsonBody"]
        if NEW_LINE in json_body:
            updated = False
        else:
            if OLD_LINE not in json_body:
                raise RuntimeError("Expected documentText line not found; refusing to patch unknown node content")
            target_node["parameters"]["jsonBody"] = json_body.replace(OLD_LINE, NEW_LINE, 1)
            updated = True

        if updated:
            now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
            cursor.execute(
                "update workflow_entity set nodes = ?, updatedAt = ? where id = ?",
                (json.dumps(nodes, ensure_ascii=False), now, WORKFLOW_ID),
            )
            connection.commit()

    print(
        json.dumps(
            {
                "workflow_id": WORKFLOW_ID,
                "node_name": NODE_NAME,
                "updated": updated,
                "active": bool(active),
                "jsonBody": target_node["parameters"]["jsonBody"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
