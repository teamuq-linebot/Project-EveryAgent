#!/usr/bin/env python3
"""
closewindow_deep_analysis.py
深度分析腳本：R_META修正、四跳升分類、R_SUBAGENT詳細、時間軸對齊
"""

import json
import os
from datetime import datetime

MAIN_JSONL = r"C:\Users\david\.claude\projects\C--teamuq-teamuq-electron\eb01f260-ac1b-49dc-b0a6-aaf0b781d538.jsonl"
SUBAGENT_DIR = r"C:\Users\david\.claude\projects\C--teamuq-teamuq-electron\eb01f260-ac1b-49dc-b0a6-aaf0b781d538\subagents"

def load_jsonl(path):
    records = []
    with open(path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    records.append(json.loads(line))
                except:
                    pass
    return records

records = load_jsonl(MAIN_JSONL)

# ─── A. Fix R_META search: isMeta is top-level field ───────────────────────

print("=== A. R_META 完整掃描 ===")
print("搜尋條件: type=user AND isMeta=True AND content含'Continue from where'")
meta_entries = []
for i, r in enumerate(records):
    if r.get('type') == 'user':
        is_meta = r.get('isMeta', False)
        msg = r.get('message', {})
        content = msg.get('content', '') if isinstance(msg, dict) else ''
        if isinstance(content, str) and 'Continue from where you left off' in content:
            meta_entries.append({'idx': i+1, 'ts': r.get('timestamp',''), 'isMeta': is_meta, 'content': content[:80]})
            print(f"  idx={i+1} ts={r.get('timestamp','')} isMeta={is_meta} content={content[:80]!r}")

# Also look for any Continue without isMeta
print("\n搜尋條件: type=user AND content含'Continue from where' (不限isMeta)")
for i, r in enumerate(records):
    if r.get('type') == 'user':
        msg = r.get('message', {})
        content = msg.get('content', '') if isinstance(msg, dict) else ''
        if isinstance(content, str) and 'Continue from where' in content:
            is_meta = r.get('isMeta', False)
            print(f"  idx={i+1} ts={r.get('timestamp','')} isMeta={is_meta} promptSource={r.get('promptSource','')!r}")

# Check assistant after each meta entry
print("\n每個 R_META user 後面緊接的 assistant:")
for e in meta_entries:
    idx = e['idx']
    # Look within next 3 records
    for j in range(idx, min(idx+3, len(records))):
        r2 = records[j]
        if r2.get('type') == 'assistant':
            msg2 = r2.get('message', {})
            model = msg2.get('model', '') if isinstance(msg2, dict) else ''
            stop = msg2.get('stop_reason', '') if isinstance(msg2, dict) else ''
            content2 = msg2.get('content', '') if isinstance(msg2, dict) else ''
            print(f"  R_META idx={e['idx']} -> assistant idx={j+1} model={model!r} stop={stop!r} content={str(content2)[:80]!r}")
            break

# ─── B. 四次 bridge-session 跳升分類 ────────────────────────────────────────

print("\n=== B. 四次 bridge-session 跳升分析 ===")
bridge_records = [(i+1, r) for i, r in enumerate(records) if r.get('type') == 'bridge-session']

jumps = []
prev_max = 0
for idx, r in bridge_records:
    seq = r.get('lastSequenceNum', 0)
    if seq > prev_max:
        jumps.append({'idx': idx, 'from': prev_max, 'to': seq})
        prev_max = seq

for j_num, jmp in enumerate(jumps):
    print(f"\n跳升 #{j_num+1}: idx={jmp['idx']} {jmp['from']} -> {jmp['to']} (delta={jmp['to']-jmp['from']})")

    # Context: what happened just before this jump?
    before_idx = jmp['idx'] - 1  # 0-based
    window_start = max(0, before_idx - 5)
    window_end = min(len(records), jmp['idx'] + 2)

    for k in range(window_start, window_end):
        r = records[k]
        typ = r.get('type', '')
        ts = r.get('timestamp', '(no-ts)')
        marker = " <-- JUMP" if (k+1 == jmp['idx']) else ""

        extra = ''
        if typ == 'user':
            ps = r.get('promptSource', '')
            is_meta = r.get('isMeta', False)
            msg = r.get('message', {})
            content = msg.get('content', '') if isinstance(msg, dict) else ''
            if isinstance(content, list):
                content_str = 'list:' + str(content)[:60]
            else:
                content_str = str(content)[:60]
            extra = f"ps={ps!r} isMeta={is_meta} content={content_str!r}"
        elif typ == 'assistant':
            msg = r.get('message', {})
            model = msg.get('model','') if isinstance(msg, dict) else ''
            stop = msg.get('stop_reason','') if isinstance(msg, dict) else ''
            content = msg.get('content','') if isinstance(msg, dict) else ''
            extra = f"model={model!r} stop={stop!r} content={str(content)[:60]!r}"
        elif typ == 'bridge-session':
            extra = f"lastSeq={r.get('lastSequenceNum')}"
        elif typ == 'queue-operation':
            extra = f"op={r.get('operation')!r}"

        print(f"  [{k+1:3d}] {typ:<22} {extra}{marker}")

# ─── C. Subagent last records detail ─────────────────────────────────────────

print("\n=== C. subagent 最後記錄原始內容 ===")
for fname in sorted(os.listdir(SUBAGENT_DIR)):
    if not fname.endswith('.jsonl'):
        continue
    agent_id = fname.replace('.jsonl','').replace('agent-','')
    path = os.path.join(SUBAGENT_DIR, fname)
    sa = load_jsonl(path)
    total = len(sa)
    print(f"\n--- Agent {agent_id} ({total} records) ---")

    # Last 3
    for i, r in enumerate(sa[max(0, total-3):]):
        abs_i = total - min(3, total) + i + 1
        typ = r.get('type','')
        ts = r.get('timestamp','')
        print(f"  [{abs_i}] type={typ} ts={ts}")

        # toolUseResult
        tur = r.get('toolUseResult')
        if tur:
            print(f"    toolUseResult (type={type(tur).__name__}): {str(tur)[:300]!r}")

        # message content
        msg = r.get('message', {})
        if isinstance(msg, dict):
            content = msg.get('content')
            if content is not None:
                if isinstance(content, str):
                    print(f"    message.content (str): {content[:200]!r}")
                elif isinstance(content, list):
                    for ci, c in enumerate(content):
                        if isinstance(c, dict):
                            ctype = c.get('type','')
                            if ctype == 'tool_result':
                                inner = c.get('content', '')
                                if isinstance(inner, str):
                                    print(f"    message.content[{ci}] tool_result: {inner[:200]!r}")
                                elif isinstance(inner, list):
                                    for part in inner:
                                        if isinstance(part, dict):
                                            print(f"    message.content[{ci}] tool_result.text: {part.get('text','')[:200]!r}")
                            elif ctype == 'text':
                                print(f"    message.content[{ci}] text: {c.get('text','')[:200]!r}")
                            else:
                                print(f"    message.content[{ci}] {ctype}: {str(c)[:100]!r}")

# ─── D. 關窗點時間軸精確對齊 ─────────────────────────────────────────────────

print("\n=== D. 三次關窗 + 請繼續 時間軸精確對齊 ===")

# Key events to track:
events = []

for i, r in enumerate(records):
    typ = r.get('type','')
    ts = r.get('timestamp','')
    idx = i + 1

    # bridge-session jump
    if typ == 'bridge-session':
        seq = r.get('lastSequenceNum', 0)
        events.append({'idx': idx, 'ts': ts, 'event': f'bridge-session seq={seq}', 'order': seq * 100000 + idx})

    # user isMeta Continue
    if typ == 'user' and r.get('isMeta'):
        msg = r.get('message', {})
        content = msg.get('content', '') if isinstance(msg, dict) else ''
        if 'Continue from where' in str(content):
            events.append({'idx': idx, 'ts': ts, 'event': 'R_META:user(isMeta)Continue', 'order': 0})

    # synthetic assistant
    if typ == 'assistant':
        msg = r.get('message', {})
        if isinstance(msg, dict) and msg.get('model') == '<synthetic>':
            events.append({'idx': idx, 'ts': ts, 'event': 'R_META:synthetic-No-response', 'order': 0})

    # typed 請繼續
    if typ == 'user' and r.get('promptSource') == 'typed':
        msg = r.get('message', {})
        content = msg.get('content', '') if isinstance(msg, dict) else ''
        if '請繼續' in str(content):
            events.append({'idx': idx, 'ts': ts, 'event': f'USER_TYPED:請繼續', 'order': 0})

    # queue operations
    if typ == 'queue-operation':
        op = r.get('operation','')
        events.append({'idx': idx, 'ts': ts, 'event': f'queue-{op}', 'order': 0})

# Sort by idx
events_sorted = sorted(events, key=lambda x: x['idx'])

# Only show key events
key_event_types = ['R_META', 'USER_TYPED', 'queue-enqueue', 'queue-dequeue']
for e in events_sorted:
    ev = e['event']
    is_key = any(k in ev for k in key_event_types)
    if is_key or 'bridge-session seq=37' in ev or 'bridge-session seq=46' in ev or 'bridge-session seq=75' in ev or 'bridge-session seq=78' in ev:
        print(f"  idx={e['idx']:4d} ts={e['ts'][:23]} | {e['event']}")

# ─── E. 確認第四個 bridge jump (75->78) 的性質 ──────────────────────────────

print("\n=== E. 第四個 bridge jump (75->78) 分析 ===")
print("idx=123 jump 75->78: delta=3, 這是正常 subagent 完成還是關窗?")
# Look at context: what's around idx 123?
window_start = max(0, 122 - 8)
window_end = min(len(records), 128)
for k in range(window_start, window_end):
    r = records[k]
    typ = r.get('type','')
    ts = r.get('timestamp','')
    extra = ''
    if typ == 'assistant':
        msg = r.get('message',{})
        model = msg.get('model','') if isinstance(msg,dict) else ''
        stop = msg.get('stop_reason','') if isinstance(msg,dict) else ''
        content = msg.get('content','') if isinstance(msg,dict) else ''
        extra = f"model={model!r} stop={stop!r}"
    elif typ == 'bridge-session':
        extra = f"seq={r.get('lastSequenceNum')}"
    elif typ == 'user':
        ps = r.get('promptSource','')
        is_meta = r.get('isMeta',False)
        msg = r.get('message',{})
        content = msg.get('content','') if isinstance(msg,dict) else ''
        extra = f"ps={ps!r} isMeta={is_meta} content={str(content)[:50]!r}"

    marker = " <-- JUMP 75->78" if k+1==123 else ""
    print(f"  [{k+1:3d}] {ts[:23]} | {typ:<22} | {extra}{marker}")

# ─── F. 確認 isMeta 欄位是否確實存在 ─────────────────────────────────────────

print("\n=== F. isMeta 欄位盤點 ===")
for i, r in enumerate(records):
    if 'isMeta' in r:
        msg = r.get('message',{})
        content = msg.get('content','') if isinstance(msg,dict) else ''
        print(f"  idx={i+1} type={r.get('type')} isMeta={r.get('isMeta')} promptSource={r.get('promptSource','')} ts={r.get('timestamp','')} content={str(content)[:60]!r}")

print("\n完成")
