#!/usr/bin/env python3
"""
closewindow_full_analysis.py
三循環關窗實驗完整驗證腳本 (唯讀)
task_id: closewindow-exp-full-20260604
"""

import json
import os
from datetime import datetime

MAIN_JSONL = r"C:\Users\david\.claude\projects\C--teamuq-teamuq-electron\eb01f260-ac1b-49dc-b0a6-aaf0b781d538.jsonl"
SUBAGENT_DIR = r"C:\Users\david\.claude\projects\C--teamuq-teamuq-electron\eb01f260-ac1b-49dc-b0a6-aaf0b781d538\subagents"
OUTPUT_DIR = r"C:\teamuq\teamuq-electron\output\sw\closewindow-exp-full-20260604"

# ─── 1. Load JSONL ──────────────────────────────────────────────────────────

def load_jsonl(path):
    records = []
    with open(path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError as e:
                    records.append({'_parse_error': str(e), '_raw': line[:200]})
    return records

records = load_jsonl(MAIN_JSONL)
total = len(records)

# ─── 2. Build structured view ───────────────────────────────────────────────

def get_ts(r):
    return r.get('timestamp', '')

def get_type(r):
    return r.get('type', '')

def get_subtype(r):
    return r.get('subtype', '')

def get_model(r):
    msg = r.get('message', {})
    if isinstance(msg, dict):
        return msg.get('model', '')
    return ''

def get_stop_reason(r):
    msg = r.get('message', {})
    if isinstance(msg, dict):
        return msg.get('stop_reason', '')
    return ''

def get_content_text(r):
    msg = r.get('message', {})
    if isinstance(msg, dict):
        content = msg.get('content', '')
        if isinstance(content, str):
            return content[:120]
        if isinstance(content, list):
            parts = []
            for c in content:
                if isinstance(c, dict):
                    t = c.get('type', '')
                    if t == 'text':
                        parts.append(c.get('text', '')[:60])
                    elif t == 'tool_use':
                        parts.append(f"[tool_use:{c.get('name','')}]")
                    else:
                        parts.append(f"[{t}]")
            return ' '.join(parts)[:120]
    return ''

def get_is_meta(r):
    return r.get('isMeta', False)

def get_prompt_source(r):
    return r.get('promptSource', '')

def get_last_seq(r):
    if get_type(r) == 'bridge-session':
        return r.get('lastSequenceNum', None)
    return None

# ─── 3. Find bridge-session jumps (R_CLOSE candidates) ──────────────────────

bridge_seqs = []
for i, r in enumerate(records):
    if get_type(r) == 'bridge-session':
        seq = r.get('lastSequenceNum')
        if seq is not None:
            bridge_seqs.append((i+1, seq, get_ts(r)))  # idx is 1-based

# Detect jumps
jumps = []
prev_max = 0
for idx, seq, ts in bridge_seqs:
    if seq > prev_max:
        jumps.append((idx, prev_max, seq, ts))
        prev_max = seq

print("=== bridge-session jumps ===")
for idx, from_val, to_val, ts in jumps:
    print(f"  idx={idx}: {from_val} -> {to_val}  ts={ts}")

# ─── 4. Find R_META pairs ────────────────────────────────────────────────────

meta_pairs = []
for i, r in enumerate(records):
    if get_type(r) == 'user' and get_is_meta(r):
        msg = r.get('message', {})
        content = msg.get('content', '') if isinstance(msg, dict) else ''
        if isinstance(content, str) and 'Continue from where you left off' in content:
            idx_user = i + 1
            # Look for next assistant with synthetic model
            for j in range(i+1, min(i+5, len(records))):
                r2 = records[j]
                if get_type(r2) == 'assistant' and get_model(r2) == '<synthetic>':
                    content2 = get_content_text(r2)
                    stop2 = get_stop_reason(r2)
                    meta_pairs.append({
                        'user_idx': idx_user,
                        'user_ts': get_ts(r),
                        'asst_idx': j+1,
                        'asst_ts': get_ts(r2),
                        'stop_reason': stop2,
                        'content': content2,
                    })
                    break

print("\n=== R_META pairs ===")
for p in meta_pairs:
    print(f"  user_idx={p['user_idx']} ts={p['user_ts']} -> asst_idx={p['asst_idx']} model=<synthetic> stop={p['stop_reason']} content={p['content'][:60]!r}")

# ─── 5. Find typed 請繼續 messages ─────────────────────────────────────────

typed_continue = []
for i, r in enumerate(records):
    if get_type(r) == 'user' and get_prompt_source(r) == 'typed':
        msg = r.get('message', {})
        content = msg.get('content', '') if isinstance(msg, dict) else ''
        if isinstance(content, str) and '請繼續' in content:
            typed_continue.append({
                'idx': i+1,
                'ts': get_ts(r),
                'content': content,
            })

print("\n=== 用戶 typed 請繼續 ===")
for p in typed_continue:
    print(f"  idx={p['idx']} ts={p['ts']} content={p['content']!r}")

# ─── 6. Context window: ±5 records around each close point ──────────────────

def summarize_record(i, r):
    typ = get_type(r)
    ts = get_ts(r) or '(no-ts)'
    extra = ''
    if typ == 'user':
        ps = get_prompt_source(r)
        is_meta = get_is_meta(r)
        msg = r.get('message', {})
        content = msg.get('content', '') if isinstance(msg, dict) else ''
        if isinstance(content, list):
            # tool_result
            content_str = str(content)[:80]
        else:
            content_str = str(content)[:80]
        extra = f"promptSource={ps!r} isMeta={is_meta} content={content_str!r}"
    elif typ == 'assistant':
        extra = f"model={get_model(r)!r} stop={get_stop_reason(r)!r} content={get_content_text(r)[:60]!r}"
    elif typ == 'bridge-session':
        extra = f"lastSeq={r.get('lastSequenceNum')}"
    elif typ == 'queue-operation':
        extra = f"op={r.get('operation')} content={str(r.get('content',''))[:60]!r}"
    elif typ == 'last-prompt':
        extra = f"lastPrompt={str(r.get('lastPrompt',''))[:40]!r}"
    return f"  [{i+1:3d}] {ts[:23]} | {typ:<22} | {extra}"

# Close points: the indices just BEFORE the bridge-session jumps
# We need to find where each "close" happened. The jump at idx=X means the
# bridge-session record at idx=X shows the new (higher) value.
# The close happened between the previous bridge-session (still 0 or lower value)
# and this one. Let's find the midpoint = around the jump index.

# From the jumps list, we want ±5 around the FIRST occurrence of the new value
close_points = []
for idx, from_val, to_val, ts in jumps:
    if to_val > 0:  # Only real jumps (not initial 0)
        close_points.append((idx, from_val, to_val))

print("\n=== 關窗點前後 5 筆記錄 ===")
for cp_idx, from_val, to_val in close_points:
    print(f"\n--- 關窗點: bridge-session jump {from_val} -> {to_val} at idx={cp_idx} ---")
    start = max(0, cp_idx - 6)  # cp_idx is 1-based, list is 0-based
    end = min(len(records), cp_idx + 5)
    for i in range(start, end):
        marker = " <<<<< JUMP" if (i+1 == cp_idx) else ""
        print(summarize_record(i, records[i]) + marker)

# ─── 7. Load subagent files ──────────────────────────────────────────────────

subagent_files = [f for f in os.listdir(SUBAGENT_DIR) if f.endswith('.jsonl')]
subagent_files.sort()

print("\n=== subagent 檔案尾部分析 (R_SUBAGENT) ===")
subagent_results = {}
for fname in subagent_files:
    agent_id = fname.replace('.jsonl', '').replace('agent-', '')
    path = os.path.join(SUBAGENT_DIR, fname)
    sa_records = load_jsonl(path)
    total_sa = len(sa_records)

    # Check last 10 records
    tail = sa_records[max(0, total_sa-10):]
    has_rejected = False
    has_interrupted = False
    rejected_idx = None
    interrupted_idx = None

    for i, r in enumerate(tail):
        abs_idx = total_sa - len(tail) + i + 1
        typ = get_type(r)
        if typ == 'user':
            msg = r.get('message', {})
            content = msg.get('content', '') if isinstance(msg, dict) else ''
            if isinstance(content, list):
                for c in content:
                    if isinstance(c, dict) and c.get('type') == 'tool_result':
                        for part in c.get('content', []):
                            if isinstance(part, dict):
                                txt = part.get('text', '')
                                if 'User rejected tool use' in txt:
                                    has_rejected = True
                                    rejected_idx = abs_idx
                                if 'Request interrupted by user for tool use' in txt:
                                    has_interrupted = True
                                    interrupted_idx = abs_idx
        if typ == 'assistant':
            content_txt = get_content_text(r)
            if 'User rejected tool use' in content_txt:
                has_rejected = True
                rejected_idx = abs_idx
            if 'Request interrupted by user for tool use' in content_txt:
                has_interrupted = True
                interrupted_idx = abs_idx

    # Also check via toolUseResult
    for i, r in enumerate(tail):
        abs_idx = total_sa - len(tail) + i + 1
        tur = r.get('toolUseResult', {})
        if isinstance(tur, dict):
            stderr = tur.get('stderr', '') or ''
            stdout = tur.get('stdout', '') or ''
            combined = stderr + stdout
            if 'User rejected tool use' in combined or 'Request interrupted' in combined:
                has_rejected = True
                rejected_idx = abs_idx

    subagent_results[agent_id] = {
        'total': total_sa,
        'has_rejected': has_rejected,
        'has_interrupted': has_interrupted,
        'rejected_idx': rejected_idx,
        'interrupted_idx': interrupted_idx,
    }

    print(f"\nAgent {agent_id} ({total_sa} records):")
    print(f"  has_rejected={has_rejected} at idx={rejected_idx}")
    print(f"  has_interrupted={has_interrupted} at idx={interrupted_idx}")

    # Print last 5 records summary
    print("  Last 5 records:")
    for i, r in enumerate(sa_records[max(0, total_sa-5):]):
        abs_i = total_sa - min(5, total_sa) + i
        print(f"  " + summarize_record(abs_i, r))

# ─── 8. Check for R_SUBAGENT text in subagent last records ──────────────────

print("\n=== subagent 詳細尾部 JSON (最後 3 筆) ===")
for fname in subagent_files:
    agent_id = fname.replace('.jsonl', '').replace('agent-', '')
    path = os.path.join(SUBAGENT_DIR, fname)
    sa_records = load_jsonl(path)
    total_sa = len(sa_records)
    print(f"\n-- Agent {agent_id} last 3 --")
    for i, r in enumerate(sa_records[max(0, total_sa-3):]):
        abs_i = total_sa - min(3, total_sa) + i + 1
        print(f"  [{abs_i}] type={r.get('type')} keys={list(r.keys())[:8]}")
        # Show toolUseResult if present
        tur = r.get('toolUseResult')
        if tur:
            print(f"      toolUseResult: {str(tur)[:200]}")
        # Show message content
        msg = r.get('message', {})
        if isinstance(msg, dict):
            content = msg.get('content', '')
            if isinstance(content, list):
                for c in content:
                    if isinstance(c, dict) and c.get('type') == 'tool_result':
                        for part in c.get('content', []):
                            if isinstance(part, dict):
                                print(f"      tool_result text: {part.get('text','')[:200]!r}")
            else:
                print(f"      content: {str(content)[:200]!r}")

# ─── 9. Full correlation: close events vs R_META vs bridge jump ─────────────

print("\n=== 三次關窗綜合矩陣 ===")
print("Window close events detected:")
print(f"  R_CLOSE (bridge-session jumps): {len(close_points)} jumps found")
print(f"  R_META pairs: {len(meta_pairs)} pairs found")
print(f"  Typed 請繼續: {len(typed_continue)} instances")

# Cross-check: each R_META should precede a bridge jump
# Map: R_META pair -> closest bridge jump
print("\nCross-correlation R_META <-> bridge jump:")
for i, pair in enumerate(meta_pairs):
    user_idx = pair['user_idx']
    # Find nearest bridge jump after this user_idx
    for cp_idx, from_val, to_val in close_points:
        if cp_idx >= user_idx:
            print(f"  R_META pair #{i+1} at user_idx={user_idx} ts={pair['user_ts']} -> bridge jump {from_val}->{to_val} at idx={cp_idx}")
            break
    else:
        print(f"  R_META pair #{i+1} at user_idx={user_idx} -> NO subsequent bridge jump found!")

# ─── 10. Check if any R_META appears WITHOUT bridge jump (false positive test) ─

print("\n=== 誤報分析: R_META 出現是否全與 bridge-session 跳升配對 ===")
bridge_jump_indices = set(cp_idx for cp_idx, _, _ in close_points)

for i, pair in enumerate(meta_pairs):
    user_idx = pair['user_idx']
    # Find bridge jump within ±10 of this pair
    nearby_jump = None
    for cp_idx, from_val, to_val in close_points:
        if abs(cp_idx - user_idx) <= 15:
            nearby_jump = (cp_idx, from_val, to_val)
            break
    if nearby_jump:
        print(f"  R_META #{i+1} idx={user_idx}: PAIRED with bridge jump {nearby_jump[1]}->{nearby_jump[2]} at idx={nearby_jump[0]}")
    else:
        print(f"  R_META #{i+1} idx={user_idx}: NO nearby bridge jump -> POTENTIAL FALSE POSITIVE")

# ─── 11. Identify close "window" in time: time gap analysis ─────────────────

print("\n=== 시간 gap 분석 (최대 gap 위치) ===")
timestamped = [(i+1, get_ts(r)) for i, r in enumerate(records) if get_ts(r)]
if len(timestamped) > 1:
    gaps = []
    for k in range(1, len(timestamped)):
        idx1, ts1 = timestamped[k-1]
        idx2, ts2 = timestamped[k]
        try:
            t1 = datetime.fromisoformat(ts1.replace('Z', '+00:00'))
            t2 = datetime.fromisoformat(ts2.replace('Z', '+00:00'))
            gap_sec = (t2 - t1).total_seconds()
            if gap_sec > 0:
                gaps.append((idx1, idx2, ts1, ts2, gap_sec))
        except:
            pass

    gaps_sorted = sorted(gaps, key=lambda x: -x[4])
    print("Top 10 largest time gaps:")
    for g in gaps_sorted[:10]:
        print(f"  between idx={g[0]}({g[2][:23]}) and idx={g[1]}({g[3][:23]}): {g[4]:.1f}s")

print("\n=== 完成 ===")
