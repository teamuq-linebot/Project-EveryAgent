#!/usr/bin/env python3
"""
scan-special-records-v2.py
Refined analysis focusing on:
1. More details on interrupt records (surrounding context)
2. Properly distinguish truncated turns from tool-use turns
3. away_summary records - what are they?
4. bridge-session records shape
5. Full type/subtype table confirmed
"""

import json
import os
from collections import defaultdict, Counter

BASE = r"C:\Users\david\.claude\projects\C--teamuq-teamuq-electron"
MAIN_FILES = [
    os.path.join(BASE, "e88a4519-c477-4a05-8705-068ec8dc34cf.jsonl"),
    os.path.join(BASE, "b0ad8488-0140-4e3b-b5a6-9e3cb77bfefa.jsonl"),
    os.path.join(BASE, "677a1f0a-9614-4913-a444-4dbbf13673dc.jsonl"),
    os.path.join(BASE, "36eb7446-75ad-4c30-86fd-c878e1ea79a6.jsonl"),
    os.path.join(BASE, "44f61fc1-6c16-4998-90eb-49698f34c998.jsonl"),
    os.path.join(BASE, "9613fe4a-3ee8-4cda-93c9-25734400bb46.jsonl"),
]

MAX_STR = 200

def trunc(s, n=MAX_STR):
    s = str(s)
    return s[:n] + "..." if len(s) > n else s

def safe_str(obj, n=MAX_STR):
    try:
        s = json.dumps(obj, ensure_ascii=False)
    except Exception:
        s = str(obj)
    return trunc(s, n)

# ---- Storage ----
away_summary_samples = []
bridge_session_samples = []
interrupt_context = []  # with surrounding records
true_truncations = []   # assistant ends a complete turn (not tool_use) without turn_duration
tool_use_without_duration = []  # tool_use assistant records - these are mid-stream, expected no duration

type_subtype_all = Counter()

def is_tool_use_only(assistant_rec):
    """True if assistant message only contains tool_use blocks (no text)."""
    msg = assistant_rec.get("message", {})
    content = msg.get("content", [])
    if not isinstance(content, list):
        return False
    types = [b.get("type") for b in content if isinstance(b, dict)]
    # If all blocks are tool_use, it's a tool dispatch record
    return all(t == "tool_use" for t in types) if types else False

def has_text_content(assistant_rec):
    """True if assistant message has at least one text block."""
    msg = assistant_rec.get("message", {})
    content = msg.get("content", [])
    if isinstance(content, str) and content:
        return True
    if isinstance(content, list):
        for b in content:
            if isinstance(b, dict) and b.get("type") == "text" and b.get("text", "").strip():
                return True
    return False

def scan_file(path):
    lines = []
    fname = os.path.basename(path)
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

    for i, rec in enumerate(lines):
        rtype = rec.get("type", "")
        rsubtype = rec.get("subtype", "")
        type_subtype_all[(rtype, rsubtype)] += 1

        # away_summary
        if rtype == "system" and rsubtype == "away_summary":
            if len(away_summary_samples) < 5:
                away_summary_samples.append({
                    "file": fname,
                    "line_idx": i,
                    "record": {k: trunc(str(v)) for k,v in rec.items()},
                })

        # bridge-session
        if rtype == "bridge-session":
            if len(bridge_session_samples) < 3:
                bridge_session_samples.append({
                    "file": fname,
                    "line_idx": i,
                    "keys": list(rec.keys()),
                    "sample": {k: trunc(str(v), 100) for k,v in rec.items()},
                })

        # interrupt with context
        if rtype == "user":
            msg = rec.get("message", {})
            content = msg.get("content", "")
            text_content = ""
            if isinstance(content, str):
                text_content = content
            elif isinstance(content, list):
                for blk in content:
                    if isinstance(blk, dict) and blk.get("type") == "text":
                        text_content += blk.get("text", "")
                    elif isinstance(blk, str):
                        text_content += blk
            if "[Request interrupted" in text_content:
                ctx = {
                    "file": fname,
                    "line_idx": i,
                    "type": rtype,
                    "subtype": rsubtype,
                    "isMeta": rec.get("isMeta"),
                    "message_role": msg.get("role", "") if isinstance(msg, dict) else "",
                    "content_text": trunc(text_content, 150),
                    "prev_record": None,
                    "next_record": None,
                }
                if i > 0:
                    p = lines[i-1]
                    ctx["prev_record"] = {
                        "type": p.get("type"), "subtype": p.get("subtype"),
                        "snippet": safe_str(p.get("message", p), 120)
                    }
                if i+1 < len(lines):
                    n2 = lines[i+1]
                    ctx["next_record"] = {
                        "type": n2.get("type"), "subtype": n2.get("subtype"),
                        "snippet": safe_str(n2.get("message", n2), 120)
                    }
                interrupt_context.append(ctx)

        # True truncation analysis:
        # Assistant with TEXT content not followed by turn_duration
        if rtype == "assistant" and has_text_content(rec) and not is_tool_use_only(rec):
            if i + 1 < len(lines):
                nxt = lines[i + 1]
                nxt_type = nxt.get("type", "")
                nxt_sub = nxt.get("subtype", "")
                if not (nxt_type == "system" and nxt_sub == "turn_duration"):
                    if nxt_type != "assistant":  # not a continuation stream
                        true_truncations.append({
                            "file": fname,
                            "assistant_idx": i,
                            "has_text": True,
                            "is_tool_use_only": False,
                            "assistant_snippet": safe_str(rec.get("message", {}).get("content", ""), 150),
                            "next_type": nxt_type,
                            "next_subtype": nxt_sub,
                            "next_snippet": safe_str(nxt.get("message", nxt), 150),
                        })
            else:
                # EOF
                true_truncations.append({
                    "file": fname,
                    "assistant_idx": i,
                    "has_text": True,
                    "is_tool_use_only": False,
                    "assistant_snippet": safe_str(rec.get("message", {}).get("content", ""), 150),
                    "next_type": "EOF",
                    "next_subtype": "",
                    "next_snippet": "",
                })

    return lines

# ---- Also check the away_summary full structure ----
away_summary_full = []

all_lines_by_file = {}
for fpath in MAIN_FILES:
    if os.path.exists(fpath):
        print(f"Scanning {os.path.basename(fpath)}", flush=True)
        all_lines_by_file[fpath] = scan_file(fpath)

# Get full away_summary records
for fpath, lines in all_lines_by_file.items():
    for i, rec in enumerate(lines):
        if rec.get("type") == "system" and rec.get("subtype") == "away_summary":
            away_summary_full.append({
                "file": os.path.basename(fpath),
                "line_idx": i,
                "full_record": rec,
                "prev": lines[i-1] if i > 0 else None,
                "next": lines[i+1] if i+1 < len(lines) else None,
            })
            if len(away_summary_full) >= 3:
                break
    if len(away_summary_full) >= 3:
        break

OUT = r"C:\teamuq\teamuq-electron\output\sw\special-records-research-20260604"
os.makedirs(OUT, exist_ok=True)

with open(os.path.join(OUT, "raw-results-v2.txt"), "w", encoding="utf-8") as out:

    out.write("=== INTERRUPT RECORDS WITH CONTEXT ===\n\n")
    for item in interrupt_context:
        out.write(json.dumps(item, ensure_ascii=False, indent=2) + "\n\n")
    out.write(f"Total interrupt records: {len(interrupt_context)}\n\n")

    out.write("=== TRUE TRUNCATIONS (assistant with text, no turn_duration follows) ===\n\n")
    out.write(f"Total: {len(true_truncations)}\n\n")
    # Separate by next_type
    by_next = defaultdict(list)
    for t in true_truncations:
        by_next[t["next_type"]].append(t)
    for nxt_type, items in sorted(by_next.items()):
        out.write(f"\n--- next_type={nxt_type!r} ({len(items)} instances) ---\n")
        for item in items[:3]:
            out.write(json.dumps(item, ensure_ascii=False, indent=2) + "\n\n")

    out.write("\n=== AWAY_SUMMARY RECORDS ===\n\n")
    for item in away_summary_full:
        out.write("=== away_summary record ===\n")
        out.write(json.dumps(item["full_record"], ensure_ascii=False, indent=2) + "\n")
        out.write("--- prev ---\n")
        out.write(json.dumps(item["prev"], ensure_ascii=False, indent=2) + "\n")
        out.write("--- next ---\n")
        out.write(json.dumps(item["next"], ensure_ascii=False, indent=2) + "\n\n")

    out.write("\n=== BRIDGE-SESSION RECORDS ===\n\n")
    for item in bridge_session_samples:
        out.write(json.dumps(item, ensure_ascii=False, indent=2) + "\n\n")

    out.write("\n=== FULL TYPE/SUBTYPE TABLE ===\n\n")
    for (t, s), cnt in sorted(type_subtype_all.items(), key=lambda x: -x[1]):
        out.write(f"type={t!r:35} subtype={s!r:30} count={cnt}\n")

print(f"\nWritten to {OUT}/raw-results-v2.txt")
print(f"interrupt_context: {len(interrupt_context)}")
print(f"true_truncations: {len(true_truncations)}")

# Summarize true truncation breakdown
by_next_type = Counter(t["next_type"] for t in true_truncations)
print("True truncations by next_type:", dict(by_next_type))
print("away_summary samples:", len(away_summary_full))
