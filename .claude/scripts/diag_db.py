#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""唯讀診斷 conversations.db（mode=ro）。禁寫入。"""
import os
import sqlite3
import sys

DB = r"C:\Users\david\.teamuq\conversations.db"
TARGET = r"C:\Users\david\.claude\projects\C--teamuq-teamuq-electron\e88a4519-c477-4a05-8705-068ec8dc34cf.jsonl"

def main():
    out = []
    # WAL 大小
    for suffix in ("", "-wal", "-shm"):
        p = DB + suffix
        if os.path.exists(p):
            out.append(f"FILE {p} size={os.path.getsize(p)}")
        else:
            out.append(f"FILE {p} MISSING")

    uri = f"file:{DB}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    cur = conn.cursor()

    cur.execute("PRAGMA user_version")
    out.append("user_version=" + str(cur.fetchone()[0]))

    cur.execute("PRAGMA journal_mode")
    out.append("journal_mode=" + str(cur.fetchone()[0]))

    cur.execute("SELECT name, type FROM sqlite_master WHERE type IN ('table','index') ORDER BY name")
    out.append("OBJECTS: " + str(cur.fetchall()))

    # conv_state 全列
    try:
        cur.execute("SELECT file, consumed_pos, next_seq, ui_read_seq FROM conv_state")
        rows = cur.fetchall()
        out.append(f"conv_state rows={len(rows)}")
        for r in rows:
            out.append("  state| file=...%s consumed_pos=%s next_seq=%s ui_read_seq=%s" % (r[0][-50:], r[1], r[2], r[3]))
    except Exception as e:
        out.append("conv_state ERR " + repr(e))

    # conv_segments 對主檔
    try:
        cur.execute("SELECT COUNT(*) FROM conv_segments WHERE file = ?", (TARGET,))
        out.append("conv_segments(target) count=" + str(cur.fetchone()[0]))
        cur.execute(
            "SELECT seg_no, start_seq, end_seq, label, is_command, msg_count, start_pos, end_pos "
            "FROM conv_segments WHERE file = ? ORDER BY seg_no ASC LIMIT 3", (TARGET,))
        for r in cur.fetchall():
            out.append("  seg| no=%s start_seq=%s end_seq=%s label=%r is_cmd=%s msg_count=%s start_pos=%s end_pos=%s" % r)
    except Exception as e:
        out.append("conv_segments(target) ERR " + repr(e))

    # conv_segments 全表 count + 各檔分佈
    try:
        cur.execute("SELECT COUNT(*) FROM conv_segments")
        out.append("conv_segments TOTAL count=" + str(cur.fetchone()[0]))
        cur.execute("SELECT file, COUNT(*) FROM conv_segments GROUP BY file ORDER BY COUNT(*) DESC LIMIT 10")
        for r in cur.fetchall():
            out.append("  segfile| ...%s -> %s segs" % (r[0][-50:], r[1]))
    except Exception as e:
        out.append("conv_segments TOTAL ERR " + repr(e))

    # 主檔 conv_state 精確查
    try:
        cur.execute("SELECT file, consumed_pos, next_seq, ui_read_seq FROM conv_state WHERE file = ?", (TARGET,))
        r = cur.fetchone()
        out.append("TARGET state: " + repr(r))
    except Exception as e:
        out.append("TARGET state ERR " + repr(e))

    # 目標 JSONL 實際大小
    if os.path.exists(TARGET):
        out.append("TARGET jsonl size=" + str(os.path.getsize(TARGET)))
    else:
        out.append("TARGET jsonl MISSING")

    conn.close()
    print("\n".join(out))

if __name__ == "__main__":
    main()
