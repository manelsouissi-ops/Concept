import json
import sqlite3
import sys
from pathlib import Path


DB_PATH = Path(r"C:\Users\lotfi\.n8n\database.sqlite")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row

        tables = [row[0] for row in conn.execute(
            "select name from sqlite_master where type='table' order by name"
        ).fetchall()]

        auth_dump: dict[str, object] = {"tables": tables}

        for table in [
            "user",
            "settings",
            "auth_identity",
            "user_api_keys",
            "oauth_clients",
            "oauth_access_tokens",
            "oauth_refresh_tokens",
            "api_key",
            "shared_credentials",
        ]:
            try:
                rows = [dict(row) for row in conn.execute(f"select * from {table}").fetchall()]
                auth_dump[table] = rows
            except Exception as error:
                auth_dump[table] = {"error": str(error)}

        print(json.dumps(auth_dump, ensure_ascii=False, default=str, indent=2))


if __name__ == "__main__":
    main()
