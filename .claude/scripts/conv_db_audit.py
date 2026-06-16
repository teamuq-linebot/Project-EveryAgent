"""
conv_db_audit.py — 唯讀診斷：對話快取 DB 進度盤點
task_id: conv-db-progress-audit-20260604

重要：
- 以唯讀模式開啟 SQLite（uri=True + mode=ro），不觸發 WAL checkpoint 寫入
- 不執行任何 INSERT / UPDATE / DELETE / PRAGMA (write-class)
"""

import sqlite3
import json
import os
import sys

DB_PATH = r"C:\Users\david\.teamuq\conversations.db"
TARGET_FILE_PATTERN = "%e88a4519%"
TARGET_FILE_FULL = r"C:\Users\david\.claude\projects\C--teamuq-teamuq-electron\e88a4519-c477-4a05-8705-068ec8dc34cf.jsonl"

def open_ro(path):
    """以唯讀 URI 模式開啟 SQLite，不會觸發任何寫入。"""
    uri = "file:" + path.replace("\\", "/") + "?mode=ro"
    return sqlite3.connect(uri, uri=True)

def section(title):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}")

def main():
    if not os.path.exists(DB_PATH):
        print(f"[ERROR] DB 不存在：{DB_PATH}")
        sys.exit(1)

    con = open_ro(DB_PATH)
    cur = con.cursor()

    # ── 1. conv_state：LIKE '%e88a4519%' ──────────────────────────
    section("1. conv_state — file LIKE '%e88a4519%'")
    rows = cur.execute(
        "SELECT file, consumed_pos, next_seq FROM conv_state WHERE file LIKE ?",
        (TARGET_FILE_PATTERN,)
    ).fetchall()
    if rows:
        print(f"{'file':<80} {'consumed_pos':>14} {'next_seq':>10}")
        print("-" * 108)
        for r in rows:
            print(f"{r[0]:<80} {r[1]:>14} {r[2]:>10}")
    else:
        print("  (無符合列)")

    # ── 2. 對照實體檔大小 ──────────────────────────────────────────
    section("2. 主檔實體大小 vs consumed_pos")
    if os.path.exists(TARGET_FILE_FULL):
        file_size = os.path.getsize(TARGET_FILE_FULL)
        print(f"  檔案路徑  : {TARGET_FILE_FULL}")
        print(f"  file_size : {file_size:,} bytes")
        # 找對應列
        main_row = None
        for r in rows:
            if "e88a4519-c477-4a05-8705-068ec8dc34cf" in r[0]:
                main_row = r
                break
        if main_row:
            consumed = main_row[1]
            delta = file_size - consumed
            pct = consumed / file_size * 100 if file_size > 0 else 0
            print(f"  consumed_pos : {consumed:,} bytes ({pct:.1f}% 已解析)")
            if delta == 0:
                print("  結論：consumed_pos == file_size → 解析完整 ✓")
            elif delta > 0:
                print(f"  結論：尚有 {delta:,} bytes 未解析（解析不完整）")
            else:
                print(f"  結論：consumed_pos 超出檔案大小 {-delta:,} bytes（異常）")
        else:
            print(f"  （conv_state 無主檔對應列，無法比對）")
    else:
        print(f"  [WARN] 主檔不存在：{TARGET_FILE_FULL}")

    # ── 3. conv_messages：主檔的 COUNT/MIN/MAX ────────────────────
    section("3. conv_messages — 主檔統計")
    # 先取主檔的 next_seq（用於計算被清量）
    main_next_seq = None
    for r in rows:
        if "e88a4519-c477-4a05-8705-068ec8dc34cf" in r[0]:
            main_next_seq = r[2]
            break

    msg_stats = cur.execute(
        "SELECT COUNT(*), MIN(seq), MAX(seq) FROM conv_messages WHERE file LIKE ?",
        (TARGET_FILE_PATTERN,)
    ).fetchone()
    count_msg, min_seq, max_seq = msg_stats
    print(f"  COUNT(*)   : {count_msg:,}")
    print(f"  MIN(seq)   : {min_seq}")
    print(f"  MAX(seq)   : {max_seq}")
    if main_next_seq is not None:
        # next_seq 是「下一條要寫入的 seq」，已寫過的 seq 範圍 = 0..(next_seq-1)
        total_ever = main_next_seq  # seq 從 0 開始；next_seq 即總筆數
        purged = total_ever - count_msg
        print(f"  next_seq   : {main_next_seq}（歷史總量）")
        print(f"  被清掉筆數 : {purged:,}  (next_seq − COUNT = {main_next_seq} − {count_msg})")
        if purged > 0:
            print(f"  保留窗     : seq [{min_seq} … {max_seq}]（最舊保留 seq={min_seq}）")
        else:
            print(f"  保留窗     : 無清除，全量保留")
    else:
        print(f"  （conv_state 無主檔列，無法計算被清量）")

    # ── 4. MIN(seq) 那筆的 timestamp 與首 60 字 ──────────────────
    section("4. DB 最舊保留訊息（seq = MIN）")
    if min_seq is not None:
        row_data = cur.execute(
            "SELECT data FROM conv_messages WHERE file LIKE ? AND seq = ?",
            (TARGET_FILE_PATTERN, min_seq)
        ).fetchone()
        if row_data:
            raw = row_data[0]
            # data 可能是 TEXT(JSON) 或 BLOB
            try:
                if isinstance(raw, bytes):
                    raw = raw.decode("utf-8", errors="replace")
                obj = json.loads(raw)
                ts = obj.get("timestamp", "(無 timestamp 欄位)")
                # 取訊息正文：常見欄位 content / text / message
                body = (
                    obj.get("content")
                    or obj.get("text")
                    or obj.get("message")
                    or str(obj)
                )
                if isinstance(body, list):
                    # anthropic 格式：content = [{type, text}, ...]
                    parts = []
                    for item in body:
                        if isinstance(item, dict):
                            parts.append(item.get("text", str(item)))
                        else:
                            parts.append(str(item))
                    body = " ".join(parts)
                snippet = str(body)[:60]
                print(f"  seq        : {min_seq}")
                print(f"  timestamp  : {ts}")
                print(f"  首 60 字   : {snippet!r}")
                # 列出全部頂層 key 供參考
                keys = list(obj.keys()) if isinstance(obj, dict) else "(非 dict)"
                print(f"  JSON keys  : {keys}")
            except json.JSONDecodeError as e:
                snippet = str(raw)[:120]
                print(f"  [WARN] data 非標準 JSON：{e}")
                print(f"  raw[:120]  : {snippet!r}")
        else:
            print("  （查無資料）")
    else:
        print("  （conv_messages 無主檔資料）")

    # ── 5. 全 DB 概況 ─────────────────────────────────────────────
    section("5. 全 DB 概況")
    total_state = cur.execute("SELECT COUNT(*) FROM conv_state").fetchone()[0]
    total_msgs  = cur.execute("SELECT COUNT(*) FROM conv_messages").fetchone()[0]
    print(f"  conv_state 總列數    : {total_state:,}")
    print(f"  conv_messages 總筆數 : {total_msgs:,}")

    print("\n  Top-5 檔案（依 conv_messages 筆數）：")
    top5 = cur.execute(
        "SELECT file, COUNT(*) AS cnt FROM conv_messages GROUP BY file ORDER BY cnt DESC LIMIT 5"
    ).fetchall()
    if top5:
        print(f"  {'file':<80} {'cnt':>8}")
        print("  " + "-" * 90)
        for r in top5:
            # 截短顯示
            f = r[0]
            if len(f) > 78:
                f = "..." + f[-75:]
            print(f"  {f:<80} {r[1]:>8}")
    else:
        print("  （無資料）")

    con.close()
    print(f"\n{'='*60}")
    print("  審計完成（DB 唯讀，零寫入）")
    print(f"{'='*60}\n")

if __name__ == "__main__":
    main()
