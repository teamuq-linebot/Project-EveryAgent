#!/usr/bin/env python3
"""
scan-special-records.py
Scan Claude Code JSONL conversation files for special record types:
  1. AskUserQuestion tool_use / tool_result
  2. [Request interrupted variants
  3. Abrupt session end (assistant turn not followed by turn_duration)
  4. All distinct (type, subtype) combinations

Usage: python3 scan-special-records.py
"""

import json
import os
import sys
from collections import defaultdict, Counter

# ---- Config ----
BASE = r"C:\Users\david\.claude\projects\C--teamuq-teamuq-electron"
MAIN_FILES = [
    os.path.join(BASE, "e88a4519-c477-4a05-8705-068ec8dc34cf.jsonl"),
    os.path.join(BASE, "b0ad8488-0140-4e3b-b5a6-9e3cb77bfefa.jsonl"),
    os.path.join(BASE, "677a1f0a-9614-4913-a444-4dbbf13673dc.jsonl"),
    os.path.join(BASE, "36eb7446-75ad-4c30-86fd-c878e1ea79a6.jsonl"),
    os.path.join(BASE, "44f61fc1-6c16-4998-90eb-49698f34c998.jsonl"),
    os.path.join(BASE, "9613fe4a-3ee8-4cda-93c9-25734400bb46.jsonl"),
]

MAX_STR_LEN = 300  # truncate long strings in samples

def trunc(s, n=MAX_STR_LEN):
    s = str(s)
    return s[:n] + "..." if len(s) > n else s

def safe_json_str(obj, n=MAX_STR_LEN):
    try:
        s = json.dumps(obj, ensure_ascii=False)
    except Exception:
        s = str(obj)
    return trunc(s, n)

# ---- Storage ----
ask_tool_uses = []
ask_tool_results = []
interrupt_patterns = Counter()
interrupt_records = []
truncated_turns = []
type_subtype_counter = Counter()

def scan_file(path):
    """Scan a single JSONL file line-by-line."""
    lines = []
    if not os.path.exists(path):
        return
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

    # ---- Pass 1: type/subtype & AskUserQuestion & interrupt ----
    for i, rec in enumerate(lines):
        rtype = rec.get("type", "")
        rsubtype = rec.get("subtype", "")
        type_subtype_counter[(rtype, rsubtype)] += 1

        # --- AskUserQuestion tool_use ---
        if rtype == "assistant":
            msg = rec.get("message", {})
            content = msg.get("content", [])
            if isinstance(content, list):
                for blk in content:
                    if isinstance(blk, dict) and blk.get("type") == "tool_use":
                        if blk.get("name") == "AskUserQuestion":
                            ask_tool_uses.append({
                                "file": os.path.basename(path),
                                "line_idx": i,
                                "tool_use_id": blk.get("id", ""),
                                "input": blk.get("input", {}),
                            })

        # --- AskUserQuestion tool_result ---
        if rtype == "user":
            msg = rec.get("message", {})
            content = msg.get("content", [])
            if isinstance(content, list):
                for blk in content:
                    if isinstance(blk, dict) and blk.get("type") == "tool_result":
                        # find if this matches an AskUserQuestion id
                        tid = blk.get("tool_use_id", "")
                        known_ids = {a["tool_use_id"] for a in ask_tool_uses}
                        if tid in known_ids or True:  # collect all tool_results for now
                            raw_content = blk.get("content", "")
                            # check if this looks like an ask result
                            if isinstance(raw_content, list):
                                for c in raw_content:
                                    if isinstance(c, dict) and "AskUserQuestion" in str(c):
                                        ask_tool_results.append({
                                            "file": os.path.basename(path),
                                            "line_idx": i,
                                            "tool_use_id": tid,
                                            "content_sample": safe_json_str(raw_content),
                                        })
                                        break
                            elif isinstance(raw_content, str) and "[" in raw_content and "question" in raw_content.lower():
                                ask_tool_results.append({
                                    "file": os.path.basename(path),
                                    "line_idx": i,
                                    "tool_use_id": tid,
                                    "content_sample": trunc(raw_content),
                                })

        # --- Interrupt ---
        if rtype == "user":
            msg = rec.get("message", {})
            content = msg.get("content", "")
            if isinstance(content, str) and "[Request interrupted" in content:
                # extract the exact pattern variant
                idx = content.find("[Request interrupted")
                snippet = content[idx:idx+120]
                interrupt_patterns[snippet] += 1
                if len(interrupt_records) < 5:
                    interrupt_records.append({
                        "file": os.path.basename(path),
                        "line_idx": i,
                        "role": msg.get("role", ""),
                        "type": rtype,
                        "subtype": rsubtype,
                        "isMeta": rec.get("isMeta"),
                        "content_snippet": trunc(content),
                    })
            # also check content list
            if isinstance(content, list):
                for blk in content:
                    text = ""
                    if isinstance(blk, dict):
                        text = blk.get("text", "")
                    elif isinstance(blk, str):
                        text = blk
                    if "[Request interrupted" in text:
                        idx = text.find("[Request interrupted")
                        snippet = text[idx:idx+120]
                        interrupt_patterns[snippet] += 1
                        if len(interrupt_records) < 5:
                            interrupt_records.append({
                                "file": os.path.basename(path),
                                "line_idx": i,
                                "role": msg.get("role", ""),
                                "type": rtype,
                                "subtype": rsubtype,
                                "isMeta": rec.get("isMeta"),
                                "content_snippet": trunc(text),
                            })

    # ---- Pass 2: truncated turns (assistant not followed by turn_duration) ----
    for i, rec in enumerate(lines):
        if rec.get("type") == "assistant":
            # look at next record
            if i + 1 < len(lines):
                nxt = lines[i + 1]
                nxt_type = nxt.get("type", "")
                nxt_sub = nxt.get("subtype", "")
                # truncated if next is NOT a system/turn_duration
                if not (nxt_type == "system" and nxt_sub == "turn_duration"):
                    # Also not another assistant (streaming)
                    if nxt_type != "assistant":
                        truncated_turns.append({
                            "file": os.path.basename(path),
                            "assistant_idx": i,
                            "assistant_snippet": trunc(safe_json_str(rec.get("message", {}).get("content", ""), 150)),
                            "next_type": nxt_type,
                            "next_subtype": nxt_sub,
                            "next_snippet": trunc(safe_json_str(nxt.get("message", {}) or nxt, 150)),
                        })
            else:
                # file ends right after assistant
                truncated_turns.append({
                    "file": os.path.basename(path),
                    "assistant_idx": i,
                    "assistant_snippet": trunc(safe_json_str(rec.get("message", {}).get("content", ""), 150)),
                    "next_type": "EOF",
                    "next_subtype": "",
                    "next_snippet": "",
                })

# ---- Dedicated AskUserQuestion tool_result pass ----
# We'll do a second targeted scan matching tool_use_ids properly
def scan_ask_results(path):
    """Dedicated pass to find tool_results matching AskUserQuestion tool_use_ids."""
    if not os.path.exists(path):
        return
    # First gather all AskUserQuestion tool_use ids
    ask_ids = {}
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

    for rec in lines:
        if rec.get("type") == "assistant":
            msg = rec.get("message", {})
            content = msg.get("content", [])
            if isinstance(content, list):
                for blk in content:
                    if isinstance(blk, dict) and blk.get("type") == "tool_use":
                        if blk.get("name") == "AskUserQuestion":
                            ask_ids[blk.get("id", "")] = blk.get("input", {})

    if not ask_ids:
        return

    # Now find matching tool_results
    for i, rec in enumerate(lines):
        if rec.get("type") == "user":
            msg = rec.get("message", {})
            content = msg.get("content", [])
            if isinstance(content, list):
                for blk in content:
                    if isinstance(blk, dict) and blk.get("type") == "tool_result":
                        tid = blk.get("tool_use_id", "")
                        if tid in ask_ids:
                            ask_tool_results.append({
                                "file": os.path.basename(path),
                                "line_idx": i,
                                "tool_use_id": tid,
                                "matched_input": ask_ids[tid],
                                "content": blk.get("content", ""),
                                "is_error": blk.get("is_error", False),
                            })


# ---- Run ----
print("Scanning files...", flush=True)
for fpath in MAIN_FILES:
    if os.path.exists(fpath):
        print(f"  {os.path.basename(fpath)}", flush=True)
        scan_file(fpath)
        scan_ask_results(fpath)
    else:
        print(f"  MISSING: {fpath}", flush=True)

# ---- Output ----
OUT_DIR = r"C:\teamuq\teamuq-electron\output\sw\special-records-research-20260604"
os.makedirs(OUT_DIR, exist_ok=True)

def write_section(f, title, content):
    f.write(f"\n{'='*60}\n{title}\n{'='*60}\n{content}\n")

with open(os.path.join(OUT_DIR, "raw-results.txt"), "w", encoding="utf-8") as out:
    # Section 1: AskUserQuestion tool_use samples
    out.write("=== SECTION 1: AskUserQuestion tool_use samples ===\n\n")
    for item in ask_tool_uses[:10]:
        out.write(json.dumps(item, ensure_ascii=False, indent=2) + "\n\n")
    out.write(f"\nTOTAL AskUserQuestion tool_use found: {len(ask_tool_uses)}\n")

    # Section 1b: tool_result samples
    out.write("\n=== SECTION 1b: AskUserQuestion tool_result samples ===\n\n")
    for item in ask_tool_results[:10]:
        out.write(json.dumps(item, ensure_ascii=False, indent=2) + "\n\n")
    out.write(f"\nTOTAL matched tool_results found: {len(ask_tool_results)}\n")

    # Section 2: Interrupt patterns
    out.write("\n=== SECTION 2: Interrupt patterns ===\n\n")
    for pattern, count in interrupt_patterns.most_common():
        out.write(f"COUNT={count}: {repr(pattern)}\n")
    out.write("\n--- Sample interrupt records ---\n")
    for item in interrupt_records[:5]:
        out.write(json.dumps(item, ensure_ascii=False, indent=2) + "\n\n")

    # Section 3: Truncated turns
    out.write("\n=== SECTION 3: Truncated turns (no turn_duration after assistant) ===\n\n")
    out.write(f"Total instances: {len(truncated_turns)}\n\n")
    # Show first 10 for analysis
    for item in truncated_turns[:10]:
        out.write(json.dumps(item, ensure_ascii=False, indent=2) + "\n\n")

    # Section 4: type/subtype table
    out.write("\n=== SECTION 4: All (type, subtype) combinations ===\n\n")
    for (t, s), cnt in sorted(type_subtype_counter.items(), key=lambda x: -x[1]):
        out.write(f"type={t!r:30} subtype={s!r:30} count={cnt}\n")

print(f"\nResults written to: {OUT_DIR}")
print(f"AskUserQuestion tool_use found: {len(ask_tool_uses)}")
print(f"Matched tool_results found: {len(ask_tool_results)}")
print(f"Interrupt patterns found: {len(interrupt_patterns)}")
print(f"Total interrupt records: {sum(interrupt_patterns.values())}")
print(f"Truncated turn instances: {len(truncated_turns)}")
print(f"Distinct type/subtype combos: {len(type_subtype_counter)}")
