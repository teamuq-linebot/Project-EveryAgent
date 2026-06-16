# Google Drive 讀取限制

## 狀態
- 生效日期：2026-04-17
- 影響範圍：所有使用 `desktop-commander` 讀取 Google Drive (T:\) 檔案的 agent

## 問題
`desktop-commander` 的 `read_file` 工具在讀取 Google Drive 掛載路徑 (T:\) 時，
只回傳檔案 metadata（fileName, filePath, fileType），**不回傳實際內容**。
這是因為 Google Drive 的串流掛載機制與 `read_file` 的讀取方式不相容。

## 規則

### MUST
- 讀取 T:\ 路徑的檔案時，**必須使用 `read_multiple_files`**，即使只讀一個檔案
- 格式：`read_multiple_files({ paths: ["T:\\...\\file.md"] })`

### MUST NOT
- **不得使用 `read_file`** 讀取 T:\ 路徑 — 會拿到空內容
- 不得假設 `read_file` 回傳的 metadata 代表檔案為空

### 例外
- 本機路徑（C:\、D:\ 等非 Google Drive 掛載）不受此限制，`read_file` 正常運作
- `write_file` 不受影響，寫入 T:\ 正常運作

## 驗證方式
如果 `read_file` 回傳的結果只有 `fileName`、`filePath`、`fileType` 三個欄位且沒有文字內容，
代表觸發了此問題，應改用 `read_multiple_files` 重新讀取。
