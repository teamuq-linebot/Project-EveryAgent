# 命名規則 — User-Facing vs 系統內部

**版本**：1.0
**生效日期**：2026-04-16
**適用範圍**：所有 team（edu、sw、agent-ops、bni）的所有 agent

---

## 核心原則

- **User-facing 產出**（交付給用戶看的資料夾和檔案）→ **必須使用繁體中文命名**
- **系統工作區**（agent 內部使用的中間產物、暫存、腳本）→ **維持英文命名**

---

## 分類表格

| 類型 | 命名語言 | 範例 | 說明 |
|------|---------|------|------|
| 產出資料夾（deliverables） | 繁體中文 | `教材成品/` | 用戶需要直接瀏覽 |
| 產出檔名 | 繁體中文 | `工作坊簡報.pptx`、`學員手冊.docx` | 用戶需要一眼辨識用途 |
| session 目錄 | 英文 | `sessions/2026-04-15_agentorg_training` | 系統自動生成 |
| 中間產物資料夾 | 英文 | `research/`、`design/`、`tmp/` | 用戶不需要看 |
| 中間產物檔名 | 英文 | `workshop_design_draft.md`、`style_guide.json` | 系統內部使用 |
| Agent 系統檔案 | 英文 | `soul.md`、`workflow.yaml` | Agent 系統規範 |
| 腳本 | 英文 | `scripts/gen-pptx.py` | 程式碼慣例 |

---

## 判斷準則

> 如果用戶會在檔案總管或 Google Drive 中看到並需要辨識此檔案 → **中文**。否則 → **英文**。

---

## 技術注意事項

- Windows + Google Drive 共用雲端硬碟完整支援 UTF-8 中文檔名，無需特殊處理
- `python-pptx`、`python-docx`、`openpyxl` 均支援中文路徑與中文檔名
- 避免使用特殊字元（`\ / : * ? " < > |`），無論中英文命名皆適用

---

## 違規行為（禁止）

- ❌ 用英文命名用戶交付的簡報或手冊（如 `workshop_slides.pptx` 交付給用戶）
- ❌ 用中文命名 session 目錄或中間產物（如 `sessions/工作坊研究/`）
- ❌ 用中文命名腳本或 agent 系統檔案
