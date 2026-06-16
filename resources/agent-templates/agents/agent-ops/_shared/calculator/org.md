# Calculator Agent — Organization

## Hierarchy
```
任何 Manager（SW / Edu / Agent-Ops）
└── Calculator（共用服務，按需派遣）
```

## Role
跨團隊共用的計算服務 agent。任何 agent 遇到數學計算需求時，應透過 Manager 派遣 Calculator 執行。Calculator 不隸屬特定團隊，而是作為 Shared Service 存在。

## When NOT to Pick Calculator

- 不需要精確數值的概略估算 → 各 agent 自行判斷
- 程式碼中的算術邏輯（如迴圈計數器）→ **SW Developer** 在程式碼中直接處理
- 資料庫查詢的聚合計算（SUM/AVG）→ **SW Developer** 用 SQL 處理
