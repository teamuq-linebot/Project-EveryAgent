# Shell Preference Rule — Bash-First Policy

<!-- metadata
last_updated: 2026-04-27
revision_reason: 補 v2.1.119 PowerShell(*) carve-out 對策
-->

**適用範圍**：所有 agent 的 Bash 指令執行與 shell 相關操作。

## 優先順序（嚴格遵守）

1. **首選**：`Bash` 工具 + **bash 指令** / Python 腳本
2. **次選**：`Bash` 工具 + `powershell.exe -Command "..."`（僅限需要 COM、WMI 等 Windows 原生 API 時）
3. **禁止**：直接呼叫 Claude Code 的 `PowerShell` 工具

## 禁用原因
- Claude Code 的 `PowerShell` 工具被列為獨立工具，每次呼叫**都觸發權限提示**
- 使用者已授權 `Bash`，但 `PowerShell` 預設需再次授權
- 相同功能可以透過 `Bash` + `powershell.exe` 完成，共用 Bash 權限

## 具體做法

### ❌ 錯誤（會觸發權限提示）
呼叫 Claude Code 的 `PowerShell` 工具，直接執行 PowerShell 指令。

### ✅ 正確（僅用 Bash 工具）
透過 Bash 執行 `powershell.exe -Command "..."`，例如：
```bash
powershell.exe -Command "New-Object -ComObject PowerPoint.Application"
```

### ✅ 最佳（純 Python / bash）
優先使用 python-pptx、LibreOffice CLI 等跨平台方案，能不用 COM 就不用。

## 例外
僅以下情境允許透過 `Bash` 呼叫 `powershell.exe`：
- PowerPoint COM 渲染（匯出 PPTX 為 JPG/PNG）
- WMI 查詢 Windows 系統資訊
- Windows Registry 操作
- 其他無跨平台 Python 替代方案的 Windows 原生 API

---

## v2.1.119 已知 bug — `PowerShell(*)` 不是真萬用

**結論**：在 `.claude/settings.json` 寫 `PowerShell(*)` **無法**讓所有 PowerShell 指令免授權通過。Claude Code v2.1.119 的權限引擎會掃描指令字串，只要偵測到任何「subexpression / 變數插值 / script block」結構，就強制標記為 `Command contains subexpressions` 並跳出 prompt，**忽略** allowlist 裡的萬用 pattern。

### 觸發 carve-out 的語法（會被攔截，即使 `PowerShell(*)` 存在）
| 語法 | 範例 | 為何被攔 |
|------|------|---------|
| Subexpression `$(...)` | `Write-Output "$(Get-Date)"` | 子表達式可內嵌任意指令，視為注入風險 |
| 變數插值 `${...}` | `"$($env:USERNAME)"` | 同上 |
| Script block `{...}` | `Get-Process \| Where-Object { $_.CPU -gt 100 }` | block 內容無法靜態分析 |
| Pipeline 多階段組合 | 多個 `\|` 串接含 cmdlet 的句子 | pipeline 內任一階段含 script block (`{...}`) 或無法靜態分析的 cmdlet（如 `Where-Object`、`ForEach-Object`），整段被視為動態語意 |

### 為什麼會這樣
Claude Code 的 permission engine 把 PowerShell 工具的 pattern 比對視為「整段字串前綴匹配」，但對於含 subexpression 的指令會**先觸發安全檢查**再做 pattern 比對。只要安全檢查命中 carve-out，就直接送 prompt，allowlist 形同虛設。

### 來源
- GitHub Issue: <https://github.com/anthropics/claude-code/issues/52926>
- 官方權限文件: <https://code.claude.com/docs/en/permissions>

---

## Allowlist 範式（settings.json）

**核心原則**：不要寫 `PowerShell(*)`（無效且誤導）。改用**窄 pattern 列舉 read-only 指令**，每個 pattern 對應一個明確的 cmdlet 前綴。

### ❌ 錯誤範式
```json
{
  "permissions": {
    "allow": [
      "PowerShell(*)"
    ]
  }
}
```
看似全開，但任何含 `$(...)` 的指令仍會 prompt。給人「已授權」的錯誤安全感。

### ✅ 正確範式（read-only narrow allowlist）
```json
{
  "permissions": {
    "allow": [
      "PowerShell(Get-Process*)",
      "PowerShell(Get-ChildItem*)",
      "PowerShell(Get-Content*)",
      "PowerShell(Test-Path*)",
      "PowerShell(Get-Item*)",
      "PowerShell(Get-Location*)",
      "PowerShell(Get-Date*)",
      "PowerShell(Get-Service*)",
      "PowerShell(Resolve-Path*)",
      "PowerShell(Select-String*)"
    ]
  }
}
```

### 設計準則
1. **只列 read-only cmdlet** — `Set-*`、`Remove-*`、`New-*`、`Stop-*` 必須逐一審視，不要批次列入
2. **pattern 末尾用 `*`** — 涵蓋常見參數（`-Path`、`-Filter` 等），但仍受 carve-out 限制
3. **不要組合多 cmdlet 為一 pattern** — `PowerShell(Get-Process | Where-Object*)` 因含 pipeline + script block 必中 carve-out
4. **每加一個 pattern 都要實測** — 新增後跑一次該指令，確認沒跳 prompt

---

## 複雜 PS 邏輯 → 包成 `.claude/scripts/*.ps1`

**對齊規則**：使用者全域 `~/.claude/CLAUDE.md` 已定義「不要在 Bash 跑 `for` / `while` 迴圈、`find`、多行串接」，必須包成 `.claude/scripts/*.sh`。**同樣原則套用到 PowerShell**。

### 必須包成 `.ps1` 檔的情境
- 含 `$(...)` 或 `${...}` subexpression / 變數插值
- 含 `{...}` script block（`Where-Object`、`ForEach-Object` 等）
- 含 `for` / `while` / `foreach` 迴圈
- 多行（>= 2 行）的指令串接
- 任何會觸發 v2.1.119 carve-out 的語法

### ❌ 錯誤的 inline 用法
```bash
# 會跳 prompt（含 subexpression）
powershell.exe -Command "Get-ChildItem | Where-Object { $_.Length -gt 1MB } | ForEach-Object { Write-Output \"$($_.Name): $($_.Length)\" }"
```
即使 settings.json 有 `Bash(powershell.exe*)`，這段含 `$(...)` + script block，會被 carve-out 攔下。

### ✅ 正確：包成 `.ps1` + 用 bash 呼叫

**Step 1** — 把邏輯寫到 `.claude/scripts/list-large-files.ps1`：
```powershell
# .claude/scripts/list-large-files.ps1
param(
  [string]$Path = ".",
  [int]$MinMB = 1
)
Get-ChildItem -Path $Path |
  Where-Object { $_.Length -gt ($MinMB * 1MB) } |
  ForEach-Object { Write-Output "$($_.Name): $($_.Length)" }
```

**Step 2** — Bash 呼叫：
```bash
powershell.exe -File .claude/scripts/list-large-files.ps1 -Path . -MinMB 1
```

### 為什麼這樣可以
- `powershell.exe -File <path> <args>` 整段不含 PS subexpression 字符（`$(...)`、`${...}` 都在 `.ps1` 檔內，指令本身只是 exe + 參數）
- Claude Code 看到的是純 Bash 指令調用 `powershell.exe`，由 `Bash(powershell.exe*)` allowlist 直接通過（不需多包一層 `bash -c`，否則 allowlist 會從 `Bash(powershell.exe*)` 退化為 `Bash(bash*)`，授權精度反而下降）
- 邏輯複雜度全部封裝在版本控管的 `.ps1` 檔內，可被審查、被 reuse、被測試

### 命名與目錄
- 路徑固定：`<repo-root>/.claude/scripts/`
- 命名：`<verb>-<noun>.ps1`（與 PowerShell cmdlet 命名慣例一致）
- 同一邏輯若已有 `.sh` 版本，優先用 `.sh`（跨平台），只在必須用 Windows API 時才寫 `.ps1`

---

## 驗證清單（撰寫 agent 時）
- [ ] `tools.md` 未列入 `PowerShell`（只列 `Bash`）
- [ ] soul.md 或工作流文件中無「使用 PowerShell 工具」字樣
- [ ] 需要 Windows COM 時，範例程式碼皆用 `powershell.exe -Command` 形式
- [ ] 含 subexpression (`$(...)` / `${...}`) / script block (`{...}`) / 迴圈 / 多行的 PS 邏輯，已包成 `.claude/scripts/*.ps1` 並用 `powershell.exe -File ...` 直接呼叫（不要多包 `bash -c`）
- [ ] settings.json 未出現 `PowerShell(*)` 萬用 pattern；只列窄 read-only cmdlet（`PowerShell(Get-*)` 等）
