import json
import sqlite3
import uuid
from copy import deepcopy
from datetime import datetime
from pathlib import Path


DB_PATH = Path(r"C:\Users\lotfi\.n8n\database.sqlite")
SOURCE_WORKFLOW_ID = "cBL9p1cCLeZaN5cL"
NEW_WORKFLOW_NAME = "CDC Initiation - Fiche Projet XML"
WEBHOOK_PATH = "cdc-initiation-fiche-projet-xml"
GROQ_MAX_TOKENS = 6000

PROMPT_PREFIX = """Tu es un assistant qui lit un cahier des charges et produit une fiche projet standard au format XML.

Le document est à la fin. Exécute trois étapes dans l'ordre, puis rends un seul document XML.

ÉTAPE 1. Extraction
Pour chaque champ, donne la valeur exacte du dossier et sa source (page ou section).
N'invente rien. Si l'information manque, mets "Non trouvé".
Reprends les termes du dossier. Ne reformule pas les chiffres ni les dates.

ÉTAPE 2. Évaluation
Attribue trois notes de 1 à 5. Justifie chaque note avec des éléments du dossier.

Complexité technique.
1. Une seule discipline. 2. Peu de disciplines. 3. Plusieurs disciplines coordonnées. 4. Multi-disciplines avec modélisation. 5. Multi-sites, multi-composantes.

Difficulté terrain.
1. Site unique, accès facile. 2. Site urbain simple. 3. Bassin urbain avec contraintes. 4. Plusieurs sites sensibles. 5. Sites multiples, logistique lourde.

Risque de sous-dimensionnement.
Estime d'abord la charge réelle des livrables et des phases. Compare-la au volume demandé. Puis note.
1. Moyens largement suffisants. 2. Volume cohérent. 3. Volume tendu. 4. Charge élevée à surveiller. 5. Sous-dimensionnement probable.

ÉTAPE 3. Contrôle
Vérifie ta propre fiche.
Liste les champs "Non trouvé" et où chercher.
Signale les valeurs incohérentes entre elles.
Signale les dates et chiffres à revérifier.

SORTIE
Rends uniquement le document XML ci-dessous, rempli. Aucun texte avant ni après. Laisse reference_interne vide, je la remplis à la main. Garde exactement cette structure et ces noms de balises.

<?xml version="1.0" encoding="UTF-8"?>
<fiche_projet>
<reference_interne></reference_interne>
<extraction>
<reference_officielle source=""></reference_officielle>
<intitule_mission source=""></intitule_mission>
<client_maitre_ouvrage source=""></client_maitre_ouvrage>
<pays source=""></pays>
<zone_execution source=""></zone_execution>
<projet_rattachement source=""></projet_rattachement>
<source_financement source=""></source_financement>
<credit_financement source=""></credit_financement>
<secteur source=""></secteur>
<nature_prestation source=""></nature_prestation>
<type_procedure source=""></type_procedure>
<methode_selection source=""></methode_selection>
<type_proposition source=""></type_proposition>
<type_contrat source=""></type_contrat>
<date_emission source=""></date_emission>
<date_limite_depot source=""></date_limite_depot>
<langue_offre source=""></langue_offre>
<ponderation_technique_financiere source=""></ponderation_technique_financiere>
<note_technique_minimale source=""></note_technique_minimale>
<duree_totale source=""></duree_totale>
<volume_hommes_mois source=""></volume_hommes_mois>
<nombre_profils_experts source=""></nombre_profils_experts>
<phases_mission source=""></phases_mission>
<livrables_principaux source=""></livrables_principaux>
<nombre_livrables_structurants source=""></nombre_livrables_structurants>
<profils_cles source=""></profils_cles>
<disciplines_techniques source=""></disciplines_techniques>
<nombre_sites source=""></nombre_sites>
<contraintes_site source=""></contraintes_site>
<outils_methodes source=""></outils_methodes>
<moyens_materiels source=""></moyens_materiels>
<exigences_es source=""></exigences_es>
<normes_referentiels source=""></normes_referentiels>
<points_techniques_structurants source=""></points_techniques_structurants>
</extraction>
<evaluation>
<complexite_technique note="">
<justification></justification>
</complexite_technique>
<difficulte_terrain note="">
<justification></justification>
</difficulte_terrain>
<risque_sous_dimensionnement note="">
<charge_estimee></charge_estimee>
<justification></justification>
</risque_sous_dimensionnement>
</evaluation>
<controle>
<champs_non_trouves></champs_non_trouves>
<incoherences></incoherences>
<a_verifier></a_verifier>
</controle>
</fiche_projet>

Document:
"""


def new_id() -> str:
    return str(uuid.uuid4())


def load_source_workflow(cursor: sqlite3.Cursor) -> dict:
    row = cursor.execute(
        """
        select name, nodes, connections, settings, pinData, nodeGroups
        from workflow_entity
        where id = ?
        """,
        (SOURCE_WORKFLOW_ID,),
    ).fetchone()
    if row is None:
        raise RuntimeError(f"Source workflow {SOURCE_WORKFLOW_ID} not found")
    return {
        "name": row[0],
        "nodes": json.loads(row[1]),
        "connections": json.loads(row[2]),
        "settings": json.loads(row[3]) if row[3] else {},
        "pinData": row[4] if row[4] is not None else "{}",
        "nodeGroups": row[5] if row[5] is not None else "[]",
    }


def select_nodes(source_nodes: list[dict]) -> dict[str, dict]:
    wanted = {
        "Prepare Upload Paths",
        "Save Uploaded PDF",
        "Convert PDF via FastAPI Marker",
        "Wait 30s Before Marker Result",
        "Get Marker Result",
        "Check Marker Status",
        "Marker Job Failed",
        "Read Markdown as Text",
        "Code JS (anonymisation)",
        "HTTP Request → Ollama (anonymisation)",
        "Code JS (fusion Ollama)",
    }
    nodes = {}
    for node in source_nodes:
        if node["name"] in wanted:
            nodes[node["name"]] = deepcopy(node)
    missing = wanted.difference(nodes.keys())
    if missing:
        raise RuntimeError(f"Missing expected source nodes: {sorted(missing)}")
    return nodes


def build_validate_node() -> dict:
    return {
        "id": new_id(),
        "name": "Validate Webhook Input",
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [-1760, -80],
        "parameters": {
            "jsCode": """const item = $input.first();
const payload = item.json.body ?? item.json ?? {};
const codeInterne = String(payload.code_interne ?? '').trim();
const binary = item.binary ?? {};
const binaryKeys = Object.keys(binary);
const fileKey = binary.file ? 'file' : binaryKeys[0];

if (!codeInterne) {
  throw new Error("Champ code_interne manquant dans la requête multipart/form-data.");
}

if (!fileKey) {
  throw new Error("Champ file manquant dans la requête multipart/form-data.");
}

return [{
  json: {
    code_interne: codeInterne,
    file_field: fileKey,
  },
  binary,
}];"""
        },
    }


def build_webhook_node() -> dict:
    return {
        "id": new_id(),
        "name": "Webhook CDC Initiation",
        "type": "n8n-nodes-base.webhook",
        "typeVersion": 2.1,
        "position": [-1968, -80],
        "parameters": {
            "httpMethod": "POST",
            "path": WEBHOOK_PATH,
            "responseMode": "responseNode",
            "options": {},
        },
    }


def build_groq_node() -> dict:
    prompt_json = json.dumps(PROMPT_PREFIX, ensure_ascii=False)
    return {
        "id": new_id(),
        "name": "HTTP Request → Groq XML",
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.4,
        "position": [224, -80],
        "credentials": {
            "httpHeaderAuth": {
                "id": "62QeeUQCKHGytgLY",
                "name": "Groq API",
            }
        },
        "parameters": {
            "method": "POST",
            "url": "https://api.groq.com/openai/v1/chat/completions",
            "authentication": "genericCredentialType",
            "genericAuthType": "httpHeaderAuth",
            "sendHeaders": True,
            "headerParameters": {
                "parameters": [
                    {
                        "name": "Authorization",
                        "value": "=Bearer {{$credentials.groqApiKey}}",
                    }
                ]
            },
            "sendBody": True,
            "specifyBody": "json",
            "jsonBody": (
                "={{ (function() {\n"
                "  const documentText = $json.texte_anonymise_final || $json.texte_anonymise || '';\n"
                f"  const prompt = {prompt_json} + documentText;\n"
                "  return JSON.stringify({\n"
                "    model: 'llama-3.3-70b-versatile',\n"
                "    messages: [{ role: 'user', content: prompt }],\n"
                "    temperature: 0.1,\n"
                f"    max_tokens: {GROQ_MAX_TOKENS}\n"
                "  });\n"
                "})() }}"
            ),
            "options": {
                "response": {
                    "response": {
                        "responseFormat": "json",
                    }
                },
                "timeout": 600000,
            },
        },
    }


def build_clean_xml_node() -> dict:
    return {
        "id": new_id(),
        "name": "Clean XML Response",
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [448, -80],
        "parameters": {
            "jsCode": """const response = $input.first().json;
let xml = response?.choices?.[0]?.message?.content ?? '';
xml = String(xml).trim();
xml = xml.replace(/^```xml\\s*/i, '');
xml = xml.replace(/^```\\s*/i, '');
xml = xml.replace(/\\s*```$/i, '');
xml = xml.trim();

const fusion = $('Code JS (fusion Ollama)').first().json;
const markdown = fusion.texte_anonymise_final || fusion.texte_anonymise || '';

return [{
  json: {
    xml,
    markdown,
  },
}];"""
        },
    }


def build_respond_node() -> dict:
    return {
        "id": new_id(),
        "name": "Respond XML JSON",
        "type": "n8n-nodes-base.respondToWebhook",
        "typeVersion": 1.5,
        "position": [672, -80],
        "parameters": {
            "respondWith": "json",
            "responseBody": "={{ JSON.stringify({ xml: $json.xml, markdown: $json.markdown }) }}",
            "options": {
                "responseCode": 200,
            },
        },
    }


def rewrite_prepare_upload_paths(node: dict) -> dict:
    node = deepcopy(node)
    node["id"] = new_id()
    node["position"] = [-1536, -80]
    node["parameters"]["jsCode"] = """// Compute deterministic, collision-free paths for this run
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

const inputItem = $input.first();
const codeInterne = inputItem.json.code_interne;
const requestedFileKey = inputItem.json.file_field;
const binaryKey = requestedFileKey && inputItem.binary?.[requestedFileKey]
  ? requestedFileKey
  : Object.keys(inputItem.binary || {})[0];
const meta = binaryKey ? inputItem.binary[binaryKey] : null;
const safeOriginalName = meta && meta.fileName
  ? meta.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
  : 'cdc.pdf';

if (!binaryKey) {
  throw new Error("Aucun fichier PDF trouvé dans la requête webhook.");
}

const incomingDir = 'C:\\\\Users\\\\lotfi\\\\.n8n-files\\\\incoming';
const markerBaseOutputDir = 'C:\\\\Users\\\\lotfi\\\\.n8n-files\\\\marker_output';

const pdfFileName = `${ts}_${safeOriginalName}`;
const pdfPath = `${incomingDir}\\\\${pdfFileName}`;
const mdOutputDir = `${markerBaseOutputDir}\\\\${ts}`;

return [{
  json: {
    code_interne: codeInterne,
    binaryKey,
    pdfFileName,
    pdfPath,
    mdOutputDir
  },
  binary: inputItem.binary
}];"""
    return node


def reuse_node(node: dict, position: tuple[int, int]) -> dict:
    cloned = deepcopy(node)
    cloned["id"] = new_id()
    cloned["position"] = [position[0], position[1]]
    return cloned


def build_workflow_nodes(source_nodes: dict[str, dict]) -> list[dict]:
    return [
        build_webhook_node(),
        build_validate_node(),
        rewrite_prepare_upload_paths(source_nodes["Prepare Upload Paths"]),
        reuse_node(source_nodes["Save Uploaded PDF"], (-1312, -80)),
        reuse_node(source_nodes["Convert PDF via FastAPI Marker"], (-1088, -80)),
        reuse_node(source_nodes["Wait 30s Before Marker Result"], (-864, -80)),
        reuse_node(source_nodes["Get Marker Result"], (-640, -80)),
        reuse_node(source_nodes["Check Marker Status"], (-416, -80)),
        reuse_node(source_nodes["Marker Job Failed"], (-192, 144)),
        reuse_node(source_nodes["Read Markdown as Text"], (-192, -80)),
        reuse_node(source_nodes["Code JS (anonymisation)"], (-32, -80)),
        reuse_node(source_nodes["HTTP Request → Ollama (anonymisation)"], (64, -80)),
        reuse_node(source_nodes["Code JS (fusion Ollama)"], (160, -80)),
        build_groq_node(),
        build_clean_xml_node(),
        build_respond_node(),
    ]


def build_connections() -> dict:
    return {
        "Webhook CDC Initiation": {
            "main": [[{"node": "Validate Webhook Input", "type": "main", "index": 0}]]
        },
        "Validate Webhook Input": {
            "main": [[{"node": "Prepare Upload Paths", "type": "main", "index": 0}]]
        },
        "Prepare Upload Paths": {
            "main": [[{"node": "Save Uploaded PDF", "type": "main", "index": 0}]]
        },
        "Save Uploaded PDF": {
            "main": [[{"node": "Convert PDF via FastAPI Marker", "type": "main", "index": 0}]]
        },
        "Convert PDF via FastAPI Marker": {
            "main": [[{"node": "Wait 30s Before Marker Result", "type": "main", "index": 0}]]
        },
        "Wait 30s Before Marker Result": {
            "main": [[{"node": "Get Marker Result", "type": "main", "index": 0}]]
        },
        "Get Marker Result": {
            "main": [[{"node": "Check Marker Status", "type": "main", "index": 0}]]
        },
        "Check Marker Status": {
            "main": [
                [{"node": "Read Markdown as Text", "type": "main", "index": 0}],
                [{"node": "Wait 30s Before Marker Result", "type": "main", "index": 0}],
                [{"node": "Marker Job Failed", "type": "main", "index": 0}],
            ]
        },
        "Read Markdown as Text": {
            "main": [[{"node": "Code JS (anonymisation)", "type": "main", "index": 0}]]
        },
        "Code JS (anonymisation)": {
            "main": [[{"node": "HTTP Request → Ollama (anonymisation)", "type": "main", "index": 0}]]
        },
        "HTTP Request → Ollama (anonymisation)": {
            "main": [[{"node": "Code JS (fusion Ollama)", "type": "main", "index": 0}]]
        },
        "Code JS (fusion Ollama)": {
            "main": [[{"node": "HTTP Request → Groq XML", "type": "main", "index": 0}]]
        },
        "HTTP Request → Groq XML": {
            "main": [[{"node": "Clean XML Response", "type": "main", "index": 0}]]
        },
        "Clean XML Response": {
            "main": [[{"node": "Respond XML JSON", "type": "main", "index": 0}]]
        },
    }


def workflow_exists(cursor: sqlite3.Cursor) -> bool:
    row = cursor.execute(
        "select 1 from workflow_entity where name = ?",
        (NEW_WORKFLOW_NAME,),
    ).fetchone()
    return row is not None


def insert_workflow(cursor: sqlite3.Cursor, nodes: list[dict], settings: dict, pin_data: str, node_groups: str) -> dict:
    project_id_row = cursor.execute(
        "select projectId from shared_workflow where workflowId = ?",
        (SOURCE_WORKFLOW_ID,),
    ).fetchone()
    if project_id_row is None:
        raise RuntimeError("Could not determine owner project for source workflow")
    project_id = project_id_row[0]

    workflow_id = "".join(uuid.uuid4().hex[:16])[:16]
    version_id = new_id()
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]

    cursor.execute(
        """
        insert into workflow_entity (
            id, name, active, nodes, connections, settings, staticData, pinData,
            versionId, triggerCount, meta, parentFolderId, createdAt, updatedAt,
            isArchived, versionCounter, description, activeVersionId, nodeGroups, sourceWorkflowId
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            workflow_id,
            NEW_WORKFLOW_NAME,
            0,
            json.dumps(nodes, ensure_ascii=False),
            json.dumps(build_connections(), ensure_ascii=False),
            json.dumps(settings, ensure_ascii=False),
            None,
            pin_data,
            version_id,
            0,
            None,
            None,
            now,
            now,
            0,
            1,
            "Duplicate of GoNoGo - CDC Automatisation for CDC → Fiche Projet XML webhook generation.",
            None,
            node_groups,
            SOURCE_WORKFLOW_ID,
        ),
    )

    cursor.execute(
        """
        insert into shared_workflow (workflowId, projectId, role, createdAt, updatedAt)
        values (?, ?, ?, ?, ?)
        """,
        (workflow_id, project_id, "workflow:owner", now, now),
    )

    return {
        "workflow_id": workflow_id,
        "version_id": version_id,
        "project_id": project_id,
    }


def main() -> None:
    if not DB_PATH.exists():
        raise RuntimeError(f"Database not found at {DB_PATH}")

    with sqlite3.connect(DB_PATH) as connection:
        cursor = connection.cursor()
        if workflow_exists(cursor):
            raise RuntimeError(f"Workflow named '{NEW_WORKFLOW_NAME}' already exists")

        source = load_source_workflow(cursor)
        selected_nodes = select_nodes(source["nodes"])
        new_nodes = build_workflow_nodes(selected_nodes)
        metadata = insert_workflow(
            cursor,
            new_nodes,
            source["settings"],
            source["pinData"],
            source["nodeGroups"],
        )
        connection.commit()

    result = {
        "name": NEW_WORKFLOW_NAME,
        "workflow_id": metadata["workflow_id"],
        "webhook_test_url": f"http://localhost:5678/webhook-test/{WEBHOOK_PATH}",
        "webhook_production_url": f"http://localhost:5678/webhook/{WEBHOOK_PATH}",
        "max_tokens": GROQ_MAX_TOKENS,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
