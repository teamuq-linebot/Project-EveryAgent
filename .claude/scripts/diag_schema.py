#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""唯讀檢視實際 schema DDL（含 WAL 應用後）。"""
import sqlite3

DB = r"C:\Users\david\.teamuq\conversations.db"

def dump(uri_extra, label):
    print("==== %s ====" % label)
    try:
        conn = sqlite3.connect("file:%s?%s" % (DB, uri_extra), uri=True)
        cur = conn.cursor()
        cur.execute("PRAGMA user_version")
        print("user_version =", cur.fetchone()[0])
        cur.execute("SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name")
        for name, sql in cur.fetchall():
            print("--- table", name, "---")
            print(sql)
        # 欄位明細
        for t in ("conv_state", "conv_segments"):
            try:
                cur.execute("PRAGMA table_info(%s)" % t)
                cols = [r[1] for r in cur.fetchall()]
                print("%s columns: %s" % (t, cols))
            except Exception as e:
                print("%s table_info ERR %r" % (t, e))
        conn.close()
    except Exception as e:
        print("CONN ERR", repr(e))

# mode=ro 會套用 WAL（只要 wal 檔在）
dump("mode=ro", "mode=ro (applies WAL on read)")
# immutable=1 強制忽略 WAL，只看主 DB 檔本體
dump("mode=ro&immutable=1", "immutable=1 (main DB file only, ignores WAL)")
