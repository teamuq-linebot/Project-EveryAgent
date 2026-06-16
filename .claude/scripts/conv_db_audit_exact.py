"""精確查主檔 conv_messages（不用 LIKE，用完整路徑）"""
import sqlite3
import json
import os

DB_PATH = r"C:\Users\david\.teamuq\conversations.db"
MAIN_FILE = r"C:\Users\david\.claude\projects\C--teamuq-teamuq-electron\e88a4519-c477-4a05-8705-068ec8dc34cf.jsonl"

uri = "file:" + DB_PATH.replace("\\", "/") + "?mode=ro"
con = sqlite3.connect(uri, uri=True)
cur = con.cursor()

# 精確查主檔的 conv_messages
r = cur.execute(
    "SELECT COUNT(*), MIN(seq), MAX(seq) FROM conv_messages WHERE file = ?",
    (MAIN_FILE,)
).fetchone()
count_msg, min_seq, max_seq = r
print(f"主檔精確 COUNT / MIN(seq) / MAX(seq) : {count_msg} / {min_seq} / {max_seq}")

# next_seq 取主檔
ns = cur.execute(
    "SELECT next_seq FROM conv_state WHERE file = ?",
    (MAIN_FILE,)
).fetchone()
next_seq_val = ns[0] if ns else None
print(f"主檔 next_seq : {next_seq_val}")

if next_seq_val is not None:
    purged = next_seq_val - count_msg
    print(f"被清掉筆數   : {purged}  (next_seq={next_seq_val} - COUNT={count_msg})")
    if purged > 0:
        print(f"保留窗       : seq [{min_seq} … {max_seq}]，最舊保留 seq={min_seq}")
    else:
        print(f"保留窗       : 無清除，全量保留（count==next_seq）")

# MIN(seq) 那筆 data
if min_seq is not None:
    d = cur.execute(
        "SELECT data FROM conv_messages WHERE file = ? AND seq = ?",
        (MAIN_FILE, min_seq)
    ).fetchone()
    if d:
        raw = d[0]
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8", errors="replace")
        try:
            obj = json.loads(raw)
            ts = obj.get("timestamp", "(無 timestamp)")
            body = (
                obj.get("content")
                or obj.get("text")
                or obj.get("message")
                or str(obj)
            )
            if isinstance(body, list):
                parts = [
                    item.get("text", str(item)) if isinstance(item, dict) else str(item)
                    for item in body
                ]
                body = " ".join(parts)
            snippet = str(body)[:60]
            print(f"\nMIN seq={min_seq} 訊息：")
            print(f"  timestamp : {ts}")
            print(f"  首 60 字  : {snippet!r}")
            print(f"  JSON keys : {list(obj.keys()) if isinstance(obj, dict) else '?'}")
        except json.JSONDecodeError as e:
            print(f"data 非標準 JSON：{e}")
            print(f"raw[:120] : {repr(str(raw)[:120])}")

con.close()
print("\n完成（唯讀，零寫入）")
