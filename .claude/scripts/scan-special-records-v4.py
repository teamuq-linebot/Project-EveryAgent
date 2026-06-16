#!/usr/bin/env python3
"""
scan-special-records-v4.py
- Get FULL raw record for both interrupt entries (no truncation)
- Show bridgeSessionId distinct values and sequence ranges
- Check away_summary parentUuid → matches preceding turn_duration uuid?
"""

import json
import os
from collections import Counter, defaultdict

BASE = r"C:\Users\david\.claude\projects\C--teamuq-teamuq-electron"
MAIN_FILES = [
    os.path.join(BASE, "e88a4519-c477-4a05-8705-068ec8dc34cf.jsonl"),
    os.path.join(BASE, "b0ad8488-0140-4e3b-b5a6-9e3cb77bfefa.jsonl"),
    os.path.join(BASE, "677a1f0a-9614-4913-a444-4dbbf13673dc.jsonl"),
]

def scan_file(path):
    lines = []
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except Exception:
                continue
            lines.append(rec)
    return lines

all_interrupt_full = []
bridge_ids = defaultdict(list)  # file -> list of (idx, bridgeSessionId, lastSeq)
away_checks = []

for fpath in MAIN_FILES:
    fname = os.path.basename(fpath)
    if not os.path.exists(fpath):
        continue
    lines = scan_file(fpath)
    for i, rec in enumerate(lines):
        rtype = rec.get("type", "")
        rsubtype = rec.get("subtype", "")

        # interrupt full record
        if rtype == "user":
            msg = rec.get("message", {})
            content = msg.get("content", "")
            text = ""
            if isinstance(content, str):
                text = content
            elif isinstance(content, list):
                for b in content:
                    if isinstance(b, dict) and b.get("type") == "text":
                        text += b.get("text", "")
            if "[Request interrupted" in text:
                all_interrupt_full.append({
                    "file": fname,
                    "line_idx": i,
                    "full_record_minus_message": {k: v for k, v in rec.items() if k != "message"},
                    "message": msg,
                })

        # bridge-session stats
        if rtype == "bridge-session":
            bridge_ids[fname].append({
                "idx": i,
                "bridgeSessionId": rec.get("bridgeSessionId"),
                "lastSequenceNum": rec.get("lastSequenceNum"),
            })

        # away_summary → check if parentUuid matches preceding turn_duration uuid
        if rtype == "system" and rsubtype == "away_summary":
            parent_uuid = rec.get("parentUuid")
            # find the turn_duration with this uuid
            found_td = None
            for j in range(i-1, max(i-50, -1), -1):
                prev = lines[j]
                if prev.get("type") == "system" and prev.get("subtype") == "turn_duration":
                    if prev.get("uuid") == parent_uuid:
                        found_td = {"uuid_match": True, "durationMs": prev.get("durationMs"), "messageCount": prev.get("messageCount")}
                    else:
                        found_td = {"uuid_match": False, "found_td_uuid": prev.get("uuid"), "expected": parent_uuid}
                    break
            away_checks.append({
                "file": fname,
                "line_idx": i,
                "away_uuid": rec.get("uuid"),
                "parentUuid": parent_uuid,
                "turn_duration_check": found_td,
                "content_preview": rec.get("content", "")[:100],
            })

# Bridge stats
bridge_stats = {}
for fname, entries in bridge_ids.items():
    distinct_ids = Counter(e["bridgeSessionId"] for e in entries)
    seq_nums = sorted(set(e["lastSequenceNum"] for e in entries))
    bridge_stats[fname] = {
        "total_bridge_records": len(entries),
        "distinct_bridgeSessionIds": dict(distinct_ids),
        "lastSequenceNum_values_sample": seq_nums[:10],
        "lastSequenceNum_max": max(seq_nums) if seq_nums else None,
    }

OUT = r"C:\teamuq\teamuq-electron\output\sw\special-records-research-20260604"

with open(os.path.join(OUT, "raw-results-v4.txt"), "w", encoding="utf-8") as out:
    out.write("=== INTERRUPT RECORDS FULL ===\n\n")
    for item in all_interrupt_full:
        out.write(json.dumps(item, ensure_ascii=False, indent=2) + "\n\n")

    out.write("\n=== BRIDGE-SESSION STATS BY FILE ===\n\n")
    out.write(json.dumps(bridge_stats, ensure_ascii=False, indent=2) + "\n\n")

    out.write("\n=== AWAY_SUMMARY → PARENT_UUID CHECK ===\n\n")
    for item in away_checks:
        out.write(json.dumps(item, ensure_ascii=False, indent=2) + "\n\n")

print("Done.")
for item in all_interrupt_full:
    print("INTERRUPT:", item["file"], "idx:", item["line_idx"])
    print("  top-level keys:", list(item["full_record_minus_message"].keys()))
    print("  message keys:", list(item["message"].keys()))
    print("  content:", repr(str(item["message"].get("content", ""))[:150]))
