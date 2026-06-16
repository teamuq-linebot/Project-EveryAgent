#!/usr/bin/env python3
"""
closewindow_clarify.py
釐清：
1. 四個 R_META 事件與三次橋接跳升的關係
2. 第四個 bridge jump (75->78) 是否也伴隨 R_META
3. 誤報分析：R_META 出現時是否一定有 bridge jump
4. 時間軸完整對照
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

# ─── All R_META events (isMeta=True) ────────────────────────────────────────
r_meta_events = []
for i, r in enumerate(records):
    if r.get('isMeta', False) and r.get('type') == 'user':
        r_meta_events.append(i+1)  # 1-based idx

print("=== R_META events (isMeta=True, type=user) ===")
for idx in r_meta_events:
    r = records[idx-1]
    ts = r.get('timestamp','')
    msg = r.get('message',{})
    content = msg.get('content','') if isinstance(msg,dict) else ''
    print(f"  idx={idx} ts={ts} content={str(content)[:80]!r}")

# ─── R_SYNTHETIC (model=<synthetic>) ────────────────────────────────────────
r_synthetic = []
for i, r in enumerate(records):
    if r.get('type') == 'assistant':
        msg = r.get('message',{})
        if isinstance(msg,dict) and msg.get('model') == '<synthetic>':
            r_synthetic.append(i+1)

print("\n=== R_SYNTHETIC events (model=<synthetic>) ===")
for idx in r_synthetic:
    r = records[idx-1]
    ts = r.get('timestamp','')
    msg = r.get('message',{})
    stop = msg.get('stop_reason','') if isinstance(msg,dict) else ''
    content = msg.get('content','') if isinstance(msg,dict) else ''
    print(f"  idx={idx} ts={ts} stop={stop!r} content={str(content)[:80]!r}")

# ─── Bridge jumps ────────────────────────────────────────────────────────────
bridge_seqs = [(i+1, r.get('lastSequenceNum',0)) for i, r in enumerate(records) if r.get('type') == 'bridge-session']
jumps = []
prev_max = 0
for idx, seq in bridge_seqs:
    if seq > prev_max:
        jumps.append({'idx': idx, 'from': prev_max, 'to': seq})
        prev_max = seq

print("\n=== bridge-session jumps ===")
for j in jumps:
    print(f"  idx={j['idx']} {j['from']} -> {j['to']} (delta={j['to']-j['from']})")

# ─── Pairing analysis ────────────────────────────────────────────────────────
# For each R_META pair, find nearest bridge jump AFTER it (within 15 records)
print("\n=== R_META 與 bridge jump 配對分析 ===")

for meta_idx in r_meta_events:
    # Find synthetic assistant immediately after
    synth_idx = None
    for j in range(meta_idx, min(meta_idx+5, len(records))):
        r2 = records[j]
        if r2.get('type') == 'assistant':
            msg2 = r2.get('message',{})
            if isinstance(msg2,dict) and msg2.get('model') == '<synthetic>':
                synth_idx = j+1
                break

    # Find nearest bridge jump after meta_idx
    nearby_jump = None
    for jmp in jumps:
        if jmp['idx'] > meta_idx and jmp['idx'] < meta_idx + 60:
            nearby_jump = jmp
            break

    print(f"  R_META idx={meta_idx} -> synthetic at idx={synth_idx} -> bridge jump: {nearby_jump}")

# ─── Special case: R_META at idx=54 and idx=104 ─────────────────────────────
# These happen AFTER a bridge jump; are they also "close window" or something else?
print("\n=== idx=54 R_META 詳細分析 ===")
# What's before and after idx=54?
for k in range(48, 62):
    r = records[k]
    typ = r.get('type','')
    ts = r.get('timestamp','')
    is_meta = r.get('isMeta',False)
    extra = ''
    if typ == 'user':
        msg = r.get('message',{})
        content = msg.get('content','') if isinstance(msg,dict) else ''
        ps = r.get('promptSource','')
        extra = f"ps={ps!r} isMeta={is_meta} content={str(content)[:80]!r}"
    elif typ == 'assistant':
        msg = r.get('message',{})
        model = msg.get('model','') if isinstance(msg,dict) else ''
        stop = msg.get('stop_reason','') if isinstance(msg,dict) else ''
        extra = f"model={model!r} stop={stop!r}"
    elif typ == 'bridge-session':
        extra = f"lastSeq={r.get('lastSequenceNum')}"
    elif typ == 'queue-operation':
        extra = f"op={r.get('operation')}"
    print(f"  [{k+1:3d}] {ts[:23] if ts else '(no-ts)'} | {typ:<22} | {extra}")

print("\n=== idx=104 R_META 詳細分析 ===")
for k in range(98, 114):
    r = records[k]
    typ = r.get('type','')
    ts = r.get('timestamp','')
    is_meta = r.get('isMeta',False)
    extra = ''
    if typ == 'user':
        msg = r.get('message',{})
        content = msg.get('content','') if isinstance(msg,dict) else ''
        ps = r.get('promptSource','')
        extra = f"ps={ps!r} isMeta={is_meta} content={str(content)[:80]!r}"
    elif typ == 'assistant':
        msg = r.get('message',{})
        model = msg.get('model','') if isinstance(msg,dict) else ''
        stop = msg.get('stop_reason','') if isinstance(msg,dict) else ''
        extra = f"model={model!r} stop={stop!r}"
    elif typ == 'bridge-session':
        extra = f"lastSeq={r.get('lastSequenceNum')}"
    elif typ == 'queue-operation':
        extra = f"op={r.get('operation')}"
    print(f"  [{k+1:3d}] {ts[:23] if ts else '(no-ts)'} | {typ:<22} | {extra}")

# ─── Check promptSource of each R_META ───────────────────────────────────────
print("\n=== R_META 的 promptSource 欄位 ===")
for idx in r_meta_events:
    r = records[idx-1]
    print(f"  idx={idx} promptSource={r.get('promptSource','(missing)')!r} entrypoint={r.get('entrypoint','')!r}")

# ─── Check 4th jump context more carefully ───────────────────────────────────
print("\n=== 第四次 jump (75->78) 是否有 R_META? ===")
# Jump at idx=123, look for R_META between last bridge-75 (idx=119) and jump (idx=123)
for k in range(97, 128):
    r = records[k]
    typ = r.get('type','')
    is_meta = r.get('isMeta',False)
    ts = r.get('timestamp','')
    if is_meta:
        print(f"  FOUND isMeta at idx={k+1} ts={ts}")
    if typ == 'bridge-session':
        print(f"  bridge-session idx={k+1} seq={r.get('lastSequenceNum')}")

# ─── Summary: Complete event timeline ────────────────────────────────────────
print("\n=== 完整時間軸：所有關鍵事件 ===")
timeline = []
for i, r in enumerate(records):
    idx = i + 1
    typ = r.get('type','')
    ts = r.get('timestamp','(no-ts)')

    if typ == 'user' and r.get('isMeta'):
        msg = r.get('message',{})
        content = msg.get('content','') if isinstance(msg,dict) else ''
        timeline.append((idx, ts, f"[R_META] user isMeta content={str(content)[:50]!r}"))

    if typ == 'assistant':
        msg = r.get('message',{})
        if isinstance(msg,dict) and msg.get('model') == '<synthetic>':
            timeline.append((idx, ts, "[R_SYNTHETIC] assistant model=<synthetic> No response requested"))

    if typ == 'bridge-session':
        seq = r.get('lastSequenceNum',0)
        timeline.append((idx, ts, f"[BRIDGE] lastSeq={seq}"))

    if typ == 'user' and r.get('promptSource') == 'typed':
        msg = r.get('message',{})
        content = msg.get('content','') if isinstance(msg,dict) else ''
        timeline.append((idx, ts, f"[USER_TYPED] {str(content)[:50]!r}"))

    if typ == 'queue-operation':
        timeline.append((idx, ts, f"[QUEUE] op={r.get('operation')}"))

for idx, ts, ev in timeline:
    print(f"  {idx:4d} | {ts[:23]} | {ev}")

print("\n=== 完成 ===")
