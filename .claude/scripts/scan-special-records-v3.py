#!/usr/bin/env python3
"""
scan-special-records-v3.py
- Get all 9 true truncation instances in full detail
- Examine bridge-session sequence to understand session resume pattern
- Show all queue-operation samples
- Show mode / permission-mode samples
"""

import json
import os
from collections import Counter

BASE = r"C:\Users\david\.claude\projects\C--teamuq-teamuq-electron"
MAIN_FILES = [
    os.path.join(BASE, "e88a4519-c477-4a05-8705-068ec8dc34cf.jsonl"),
    os.path.join(BASE, "b0ad8488-0140-4e3b-b5a6-9e3cb77bfefa.jsonl"),
    os.path.join(BASE, "677a1f0a-9614-4913-a444-4dbbf13673dc.jsonl"),
    os.path.join(BASE, "36eb7446-75ad-4c30-86fd-c878e1ea79a6.jsonl"),
    os.path.join(BASE, "44f61fc1-6c16-4998-90eb-49698f34c998.jsonl"),
    os.path.join(BASE, "9613fe4a-3ee8-4cda-93c9-25734400bb46.jsonl"),
]

MAX_STR = 300

def trunc(s, n=MAX_STR):
    s = str(s)
    return s[:n] + "..." if len(s) > n else s

def safe_str(obj, n=MAX_STR):
    try:
        s = json.dumps(obj, ensure_ascii=False)
    except Exception:
        s = str(obj)
    return trunc(s, n)

def is_tool_use_only(rec):
    msg = rec.get("message", {})
    content = msg.get("content", [])
    if not isinstance(content, list):
        return False
    types = [b.get("type") for b in content if isinstance(b, dict)]
    return all(t == "tool_use" for t in types) if types else False

def has_text_content(rec):
    msg = rec.get("message", {})
    content = msg.get("content", [])
    if isinstance(content, str) and content:
        return True
    if isinstance(content, list):
        for b in content:
            if isinstance(b, dict) and b.get("type") == "text" and b.get("text", "").strip():
                return True
    return False

def get_text(rec):
    msg = rec.get("message", {})
    content = msg.get("content", [])
    if isinstance(content, str):
        return content[:300]
    texts = []
    if isinstance(content, list):
        for b in content:
            if isinstance(b, dict) and b.get("type") == "text":
                texts.append(b.get("text", "")[:200])
    return " | ".join(texts)[:300]

true_truncations = []
bridge_sequence = []
queue_ops = []
mode_samples = []
perm_samples = []
last_prompt_samples = []
file_snap_samples = []

def scan_file(path):
    fname = os.path.basename(path)
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

    # bridge session sequence (first 10 in file)
    bcount = 0
    for i, rec in enumerate(lines):
        if rec.get("type") == "bridge-session":
            if len(bridge_sequence) < 6 and fname == "e88a4519-c477-4a05-8705-068ec8dc34cf.jsonl":
                bridge_sequence.append({"file": fname, "idx": i, "rec": rec})
            bcount += 1

        if rec.get("type") == "queue-operation" and len(queue_ops) < 3:
            queue_ops.append({"file": fname, "idx": i, "rec": rec})

        if rec.get("type") == "mode" and len(mode_samples) < 2:
            mode_samples.append({"file": fname, "idx": i, "rec": rec})

        if rec.get("type") == "permission-mode" and len(perm_samples) < 2:
            perm_samples.append({"file": fname, "idx": i, "rec": rec})

        if rec.get("type") == "last-prompt" and len(last_prompt_samples) < 2:
            last_prompt_samples.append({"file": fname, "idx": i, "rec": rec})

        if rec.get("type") == "file-history-snapshot" and len(file_snap_samples) < 2:
            file_snap_samples.append({"file": fname, "idx": i,
                                       "keys": list(rec.keys()),
                                       "sample_keys_values": {k: trunc(str(v), 100) for k, v in rec.items() if k != "snapshot"}})

        # true truncation
        if rec.get("type") == "assistant" and has_text_content(rec) and not is_tool_use_only(rec):
            if i + 1 < len(lines):
                nxt = lines[i+1]
                nxt_type = nxt.get("type", "")
                nxt_sub = nxt.get("subtype", "")
                if not (nxt_type == "system" and nxt_sub == "turn_duration"):
                    if nxt_type != "assistant":
                        true_truncations.append({
                            "file": fname,
                            "assistant_idx": i,
                            "assistant_text": get_text(rec),
                            "stop_reason": rec.get("message", {}).get("stop_reason", ""),
                            "next_type": nxt_type,
                            "next_subtype": nxt_sub,
                            "next_content_summary": trunc(safe_str(nxt.get("message", nxt), 200)),
                            "promptSource": nxt.get("promptSource", "") if nxt_type == "user" else "",
                        })
            else:
                true_truncations.append({
                    "file": fname,
                    "assistant_idx": i,
                    "assistant_text": get_text(rec),
                    "stop_reason": rec.get("message", {}).get("stop_reason", ""),
                    "next_type": "EOF",
                    "next_subtype": "",
                    "next_content_summary": "",
                    "promptSource": "",
                })

for fpath in MAIN_FILES:
    if os.path.exists(fpath):
        print(f"Scanning {os.path.basename(fpath)}", flush=True)
        scan_file(fpath)

OUT = r"C:\teamuq\teamuq-electron\output\sw\special-records-research-20260604"

with open(os.path.join(OUT, "raw-results-v3.txt"), "w", encoding="utf-8") as out:

    out.write("=== ALL TRUE TRUNCATIONS (9 total) ===\n\n")
    for item in true_truncations:
        out.write(json.dumps(item, ensure_ascii=False, indent=2) + "\n\n")

    out.write("\n=== BRIDGE-SESSION SEQUENCE (first 6 in main file) ===\n\n")
    for item in bridge_sequence:
        out.write(json.dumps(item, ensure_ascii=False, indent=2) + "\n\n")

    out.write("\n=== QUEUE-OPERATION SAMPLES ===\n\n")
    for item in queue_ops:
        out.write(json.dumps(item, ensure_ascii=False, indent=2) + "\n\n")

    out.write("\n=== MODE SAMPLES ===\n\n")
    for item in mode_samples:
        out.write(json.dumps(item, ensure_ascii=False, indent=2) + "\n\n")

    out.write("\n=== PERMISSION-MODE SAMPLES ===\n\n")
    for item in perm_samples:
        out.write(json.dumps(item, ensure_ascii=False, indent=2) + "\n\n")

    out.write("\n=== LAST-PROMPT SAMPLES ===\n\n")
    for item in last_prompt_samples:
        out.write(json.dumps(item, ensure_ascii=False, indent=2) + "\n\n")

    out.write("\n=== FILE-HISTORY-SNAPSHOT SAMPLES ===\n\n")
    for item in file_snap_samples:
        out.write(json.dumps(item, ensure_ascii=False, indent=2) + "\n\n")

print("Done. Written to raw-results-v3.txt")
print("True truncations:", len(true_truncations))
