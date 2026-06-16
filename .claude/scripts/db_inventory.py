# db_inventory.py -- 本機 DB 全盤點（唯讀）
# - 列出 ~/.teamuq/ 下所有檔案（含 .db / -wal / -shm，附大小）
# - 對每個 .db：PRAGMA user_version、sqlite_master schema、每表 row count
# - conversations.db 特別盤點：
#     conv_segments 是否存在、conv_state.ui_read_seq 欄是否存在
#     conv_messages 總筆數與 SUM(LENGTH(data))
# 執行：python db_inventory.py

import os
import sqlite3
import json

TEAMUQ_HOME = os.path.join(os.path.expanduser("~"), ".teamuq")
OUTPUT_JSON = "C:\\teamuq\\teamuq-electron\\output\\sw\\db-inventory-20260604\\inventory.json"

result = {
    "teamuq_home": TEAMUQ_HOME,
    "files": [],
    "databases": {},
    "conversations_db_analysis": {},
}

# ── 1. 列出所有檔案 ──────────────────────────────────────────────────────────
print(f"\n=== 掃描目錄：{TEAMUQ_HOME} ===")
if not os.path.isdir(TEAMUQ_HOME):
    print(f"[WARN] 目錄不存在：{TEAMUQ_HOME}")
    result["teamuq_home_exists"] = False
else:
    result["teamuq_home_exists"] = True
    for root, dirs, files in os.walk(TEAMUQ_HOME):
        for fname in sorted(files):
            fpath = os.path.join(root, fname)
            try:
                size = os.path.getsize(fpath)
            except Exception:
                size = -1
            rel = os.path.relpath(fpath, TEAMUQ_HOME)
            entry = {"rel_path": rel, "abs_path": fpath, "size_bytes": size}
            result["files"].append(entry)
            print(f"  {rel:<50s}  {size:>12,} bytes")

# ── 2. 對每個 .db 進行 schema 盤點 ──────────────────────────────────────────
db_files = [f for f in result["files"] if f["rel_path"].endswith(".db")]
print(f"\n=== .db 檔案數：{len(db_files)} ===")

for entry in db_files:
    db_path = entry["abs_path"]
    db_name = entry["rel_path"]
    print(f"\n--- DB: {db_name} ---")
    db_info = {"path": db_path, "tables": {}}

    try:
        uri = "file:" + db_path.replace("\\", "/") + "?mode=ro"
        conn = sqlite3.connect(uri, uri=True)
        cursor = conn.cursor()

        # user_version
        cursor.execute("PRAGMA user_version")
        uv = cursor.fetchone()[0]
        db_info["user_version"] = uv
        print(f"  user_version = {uv}")

        # sqlite_master → table schema
        cursor.execute(
            "SELECT type, name, sql FROM sqlite_master "
            "WHERE type IN ('table','index','view','trigger') ORDER BY type, name"
        )
        objects = cursor.fetchall()
        tables_only = [o for o in objects if o[0] == "table"]
        other_objects = [o for o in objects if o[0] != "table"]

        db_info["schema_objects"] = [
            {"type": o[0], "name": o[1], "sql": o[2]} for o in objects
        ]

        for _, tname, tsql in tables_only:
            print(f"  TABLE: {tname}")
            if tsql:
                print(f"    DDL: {tsql[:200]}{'...' if len(tsql or '')>200 else ''}")
            # row count
            try:
                cursor.execute(f'SELECT COUNT(*) FROM "{tname}"')
                cnt = cursor.fetchone()[0]
            except Exception as e:
                cnt = f"ERROR:{e}"
            db_info["tables"][tname] = {"row_count": cnt}
            print(f"    rows = {cnt}")

        for otype, oname, osql in other_objects:
            print(f"  {otype.upper()}: {oname}")

        conn.close()

    except Exception as e:
        db_info["error"] = str(e)
        print(f"  [ERROR] {e}")

    result["databases"][db_name] = db_info

# ── 3. conversations.db 特別盤點 ─────────────────────────────────────────────
CONV_REL = "conversations.db"
CONV_PATH = os.path.join(TEAMUQ_HOME, "conversations.db")
print(f"\n=== conversations.db 特別盤點 ===")

conv_analysis = {
    "path": CONV_PATH,
    "exists": os.path.isfile(CONV_PATH),
}

if conv_analysis["exists"]:
    try:
        uri = "file:" + CONV_PATH.replace("\\", "/") + "?mode=ro"
        conn = sqlite3.connect(uri, uri=True)
        cursor = conn.cursor()

        # 取全部 table 名
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        all_tables = {r[0] for r in cursor.fetchall()}
        conv_analysis["all_tables"] = sorted(all_tables)
        print(f"  全部 table：{sorted(all_tables)}")

        # conv_segments 存在？
        has_conv_segments = "conv_segments" in all_tables
        conv_analysis["has_conv_segments"] = has_conv_segments
        print(f"  conv_segments 存在：{has_conv_segments}")

        # conv_state.ui_read_seq 欄存在？
        has_ui_read_seq = False
        if "conv_state" in all_tables:
            cursor.execute("PRAGMA table_info(conv_state)")
            cols = [row[1] for row in cursor.fetchall()]
            conv_analysis["conv_state_columns"] = cols
            has_ui_read_seq = "ui_read_seq" in cols
            print(f"  conv_state 欄位：{cols}")
        else:
            conv_analysis["conv_state_columns"] = []
            print(f"  conv_state 不存在")
        conv_analysis["has_ui_read_seq"] = has_ui_read_seq
        print(f"  conv_state.ui_read_seq 欄存在：{has_ui_read_seq}")

        # 版本判定
        if has_conv_segments and has_ui_read_seq:
            schema_version = "v5（新碼已重啟過：conv_segments + ui_read_seq 均存在）"
        elif has_conv_segments and not has_ui_read_seq:
            schema_version = "v5-partial（conv_segments 存在，但 ui_read_seq 缺失）"
        elif not has_conv_segments and has_ui_read_seq:
            schema_version = "v4+（無 conv_segments，但有 ui_read_seq）"
        else:
            schema_version = "v4（舊 schema：無 conv_segments 且無 ui_read_seq）"
        conv_analysis["schema_version_judgment"] = schema_version
        print(f"  Schema 版本判定：{schema_version}")

        # conv_messages 筆數與佔用
        if "conv_messages" in all_tables:
            cursor.execute("SELECT COUNT(*) FROM conv_messages")
            msg_count = cursor.fetchone()[0]
            cursor.execute("SELECT SUM(LENGTH(data)) FROM conv_messages")
            msg_data_bytes_row = cursor.fetchone()[0]
            msg_data_bytes = msg_data_bytes_row if msg_data_bytes_row is not None else 0
            conv_analysis["conv_messages_row_count"] = msg_count
            conv_analysis["conv_messages_data_bytes"] = msg_data_bytes
            print(f"  conv_messages：{msg_count} 筆，data 欄位總佔用 = {msg_data_bytes:,} bytes（{msg_data_bytes/1024/1024:.2f} MB）")
        else:
            conv_analysis["conv_messages_row_count"] = 0
            conv_analysis["conv_messages_data_bytes"] = 0
            print(f"  conv_messages：table 不存在")

        conn.close()

    except Exception as e:
        conv_analysis["error"] = str(e)
        print(f"  [ERROR] {e}")
else:
    print(f"  [WARN] {CONV_PATH} 不存在")

result["conversations_db_analysis"] = conv_analysis

# ── 4. 輸出 JSON ─────────────────────────────────────────────────────────────
os.makedirs(os.path.dirname(OUTPUT_JSON), exist_ok=True)
with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, indent=2)
print(f"\n=== JSON 已寫入：{OUTPUT_JSON} ===")
