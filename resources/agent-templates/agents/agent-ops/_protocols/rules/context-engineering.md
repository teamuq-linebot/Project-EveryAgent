# Context Engineering Rules

## 目的

登錄 Anthropic 三個第一方 context / 記憶 primitive，供長任務或多輪 dispatch 時選用。
三個 primitive 均為**可選採用工具**，非強制；不改動現有 `memory/MEMORY.md` 格式。

> 識別碼格式：`snake_case_YYYYMMDD`（來自 Anthropic changelog），primitive 演進時以官方 docs 為準。

---

## §1 Compaction（`compact_20260112`）

**機制**：context window 接近上限時，server-side 自動將已有內容蒸餾成高保真摘要後繼續，
使 agent 無需截斷即可續跑長 pipeline。

| 參數 | 值 |
|------|----|
| token 門檻（min） | 50,000 |
| token 門檻（default） | 150,000 |
| 觸發方式 | 自動（server-side） |

**適用場景**：長 pipeline（多步驟研究、跨多 agent dispatch 的主 session）避免 context 溢出。

---

## §2 Tool-result Clearing / Context Editing（`clear_tool_uses_20250919`）

**機制**：把可重新抓取的舊 `tool_result` block 替換為 placeholder，保留對應的 `tool_use` 紀錄。
不影響推論結果，實測節省約 67% token（128,740 → 43,060）。

| 面向 | 說明 |
|------|------|
| token 節省 | −67%（實測）|
| 推論成本 | 不增加（無需重跑推論）|
| 保留資訊 | tool_use 紀錄完整保留 |

**適用場景**：tool 密集任務（大量讀檔、搜尋、API 呼叫後 context 膨脹）。

---

## §3 Memory Tool（`memory_20250818`）

**機制**：client-side 檔案式跨 session 記憶，預設存於 `/memories` 目錄，
支援六個操作：`view` / `create` / `str_replace` / `insert` / `delete` / `rename`。

**適用場景**：需要跨 session 持續追蹤的短小知識（不適合替代 AgentOrg 的 `memory/MEMORY.md` 長結構）。

---

## §4 採用邊界（2026-06-08 決策）

- 本 rollout **不改** AgentOrg 現有 `memory/MEMORY.md` 格式（PARA 四分類）。
- 三個 primitive 列為「可選採用工具」，agent 可視任務需求自行使用，**不強制**對齊 `/memories` 格式。
- Memory Tool（§3）與 `memory/MEMORY.md` 為並存關係，非替代。

---

## §5 與既有規則關係

- **記憶衛生**：本規則為 in-context 層工具；記憶生命週期管理（PARA 分類、老化、整合）
  仍遵循 `memory-hygiene.md`。
- **外部 Session 持久化差距**：差距研究
  `agents/agent-ops/evolution/memory/resource_external_research_multiagent_2026-04-14.md`
  §2.2 差距 3 將「無外部 Session 持久化」列為 P1。本規則落地的是 **in-context 層**的緩解手段
  （Compaction、Tool-result Clearing），與外部持久化層（Managed Agents Session / LangGraph Durable Execution）不同層，不互斥，亦不取代 P1 差距的長期解法。

---

## §6 成熟度聲明

三個 primitive 均為 2025–2026 public beta 功能，識別碼可能隨官方版本演進。
採用時以 Anthropic 官方文件為準，不以本檔識別碼為唯一依據。

---

## 來源

- Anthropic Engineering：[Effective context engineering for AI agents](https://www.anthropic.com/engineering/context-engineering-for-agents)
- Anthropic Cookbook：[Context Engineering Cookbook](https://github.com/anthropics/anthropic-cookbook/tree/main/context_engineering)
- Compaction docs：[Long context management — Compaction](https://docs.anthropic.com/en/docs/claude-code/memory#compaction)
- Memory Tool docs：[Memory Tool](https://docs.anthropic.com/en/docs/claude-code/memory#memory-tool)
