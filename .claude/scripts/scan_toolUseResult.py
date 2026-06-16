#!/usr/bin/env python3
"""
掃描 JSONL 找含 toolUseResult + agentId 的行，列出全部頂層 key 與 token 相關欄位實樣。
截短 content 以避免輸出爆炸。
"""
import json
import sys

JSONL_PATH = r"C:\Users\david\.claude\projects\C--teamuq-teamuq-electron\e88a4519-c477-4a05-8705-068ec8dc34cf.jsonl"
MAX_SAMPLES = 10  # 最多印幾筆完整樣本
CONTENT_TRUNC = 200  # content 截短長度

found = 0
all_top_keys = set()
token_samples = []

with open(JSONL_PATH, "r", encoding="utf-8") as f:
    for lineno, line in enumerate(f, 1):
        line = line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue

        # 頂層或 message 裡找 toolUseResult
        tool_use_result = record.get("toolUseResult")
        if tool_use_result is None:
            # 也可能包在 message 下
            msg = record.get("message", {})
            tool_use_result = msg.get("toolUseResult") if isinstance(msg, dict) else None

        if tool_use_result is None:
            continue

        if not isinstance(tool_use_result, dict):
            continue

        agent_id = tool_use_result.get("agentId")
        if agent_id is None:
            continue

        found += 1
        top_keys = list(tool_use_result.keys())
        all_top_keys.update(top_keys)

        # 找 token 相關欄位（key 含 token / usage / input / output / cost）
        token_fields = {
            k: v for k, v in tool_use_result.items()
            if any(kw in k.lower() for kw in ["token", "usage", "input", "output", "cost", "duration"])
        }

        sample = {
            "lineno": lineno,
            "agentId": agent_id,
            "status": tool_use_result.get("status"),
            "top_keys": top_keys,
            "token_fields": token_fields,
        }

        # content 截短
        content = tool_use_result.get("content")
        if content is not None:
            if isinstance(content, str):
                sample["content_preview"] = content[:CONTENT_TRUNC]
            elif isinstance(content, list):
                sample["content_preview"] = str(content)[:CONTENT_TRUNC]
            else:
                sample["content_preview"] = str(content)[:CONTENT_TRUNC]

        if found <= MAX_SAMPLES:
            token_samples.append(sample)

print(f"=== 掃描完畢 ===")
print(f"含 toolUseResult+agentId 的行數：{found}")
print(f"所有頂層 key 聯集：{sorted(all_top_keys)}")
print()
print(f"=== 前 {min(found, MAX_SAMPLES)} 筆樣本 ===")
for s in token_samples:
    print(json.dumps(s, ensure_ascii=False, indent=2))
    print("---")

if found == 0:
    print("WARNING: 找不到任何含 toolUseResult+agentId 的行，請確認 JSONL 路徑或欄位結構。")
    # 也印前 3 筆含 toolUseResult（不限 agentId）以供診斷
    print("\n=== fallback: 前 3 筆含 toolUseResult（不含 agentId 過濾）===")
    with open(JSONL_PATH, "r", encoding="utf-8") as f2:
        fallback_count = 0
        for lineno2, line2 in enumerate(f2, 1):
            line2 = line2.strip()
            if not line2:
                continue
            try:
                rec2 = json.loads(line2)
            except Exception:
                continue
            tur = rec2.get("toolUseResult")
            if tur is None:
                msg2 = rec2.get("message", {})
                tur = msg2.get("toolUseResult") if isinstance(msg2, dict) else None
            if tur is not None:
                print(f"Line {lineno2}: top-level record keys={list(rec2.keys())}, toolUseResult keys={list(tur.keys()) if isinstance(tur, dict) else type(tur)}")
                fallback_count += 1
                if fallback_count >= 3:
                    break
        if fallback_count == 0:
            print("(完全沒有 toolUseResult)")
