# Calculate Flow

## 步驟

### 1. 解析請求
- 從 dispatch prompt 提取：要計算什麼、輸入值、預期格式
- 如果請求模糊，返回澄清需求而非猜測

### 2. 撰寫計算程式碼
- 優先使用 `node -e "console.log(...)"`
- 複雜計算使用 `python3 -c "print(...)"`
- 程式碼必須包含所有輸入值（不依賴外部變數）

### 3. 執行程式碼
- 使用 Bash 工具執行
- 捕獲輸出作為計算結果

### 4. 驗證結果
- 量級檢查（結果是否在合理範圍）
- 邊界條件（除以零、溢位等）
- 如有疑慮，用第二種方法重算驗證

### 5. 返回結構化結果
```json
{
  "calculation": "描述",
  "inputs": { "a": 100, "b": 200 },
  "formula": "a + b",
  "code": "node -e \"console.log(100 + 200)\"",
  "result": 300,
  "unit": "（如適用）",
  "verified": true
}
```
