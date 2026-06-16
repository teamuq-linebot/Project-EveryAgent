/**
 * Golden-path smoke E2E（回歸網）— 釘住「現狀」黃金路徑，改造期間既有 UI 不退化。
 *
 * 路徑：登入 → 看板載入 → 開 session → 打卡顯示 → 對話 viewer。
 *
 * 範圍與邊界（重要）：
 *   - 這是 **回歸網**，不是新功能驗收。只驗「現狀 renderer UI 行為」。
 *   - 後端（auth/AppSync/claude CLI）由 tuqStub 以固定 fixture 取代 —— 切斷外部
 *     相依，讓測試確定性可重跑（見 fixtures/tuqStub.ts 的理由說明）。
 *   - 因此本測試**不**驗真實 OAuth / 真實 GraphQL / 真實打卡引擎；那些屬整合層，
 *     由 vitest（backend.spec / punch*.spec / appsync.spec 等）守。
 *   - 本網守的是：**renderer 元件鏈在既有 IPC 合約下渲染與互動不退化**。
 *     Phase 5 起讀路徑換軌（本地 SQLite）時，只要 window.tuq 合約不變，此網應持續綠。
 *
 * 啟動前提：先 `npm run build`（產 out/），native 模組需可被 Electron 載入
 *   （better-sqlite3 ABI；見回報 blocker 段）。
 */
import { test, expect } from './fixtures/electronApp'

test.describe('golden path（現狀回歸）', () => {
  test('登入 → 看板 → session → 打卡 → 對話 viewer 全鏈不退化', async ({ win }) => {
    // ── 0. 起手：app shell 掛載、預設在看板 tab、未登入 ──────────────
    await expect(win.locator('.app-shell')).toBeVisible()
    // 側欄登入鈕（未登入顯示「登入」）。
    const loginBtn = win.locator('.sidebar__login-btn')
    await expect(loginBtn).toHaveText('登入')
    // 看板五欄常駐（即使未登入也渲染欄位骨架）。
    await expect(win.locator('.kanban-col')).toHaveCount(5)
    await expect(win.locator('.kanban-col__name').first()).toHaveText('準備中')

    // ── 1. 登入 → 看板載入任務卡 ──────────────────────────────────
    await loginBtn.click()
    // 登入後側欄狀態與鈕切換（stub 回 loggedIn=true）。
    await expect(loginBtn).toHaveText('登出')
    await expect(win.locator('.sidebar__status')).toContainText('e2e@teamuq.test')
    // 看板載入 stub 的單一任務卡。
    const card = win.locator('.task-card')
    await expect(card).toHaveCount(1)
    await expect(card.locator('.task-card__name')).toHaveText('E2E 黃金路徑任務')
    // 卡片在「進行中」欄（IN_PROGRESS = 第 3 欄）。
    const inProgressCol = win.locator('.kanban-col').nth(2)
    await expect(inProgressCol.locator('.kanban-col__name')).toHaveText('進行中')
    await expect(inProgressCol.locator('.task-card')).toHaveCount(1)

    // ── 2. 雙擊任務卡 → 開 session tab ───────────────────────────
    await card.dblclick()
    // session tab 容器掛載（身分列 + 任務名）。
    const sessionTab = win.locator('.session-tab')
    await expect(sessionTab).toBeVisible()
    await expect(sessionTab.locator('.session-tab__task-name')).toHaveText('E2E 黃金路徑任務')
    // 側欄「監測 session」group 出現該 session 項。
    await expect(win.locator('.sidebar__session')).toHaveCount(1)

    // ── 3. 打卡顯示：監測面板 + PunchTable 填入 stub 推播的列 ───────
    // monitor.start 後 stub 推 monitorRender（含 2 列）。等表格列出現。
    const punchRows = win.locator('.punch-table__row')
    await expect(punchRows).toHaveCount(2)
    // 第一列 = 上工（執行中、結束欄為 —）。
    await expect(punchRows.nth(0).locator('.punch-table__td--name')).toHaveText(
      '上工：E2E 黃金路徑任務',
    )
    await expect(punchRows.nth(0).locator('.punch-table__status')).toContainText('執行中')
    // 第二列 = 已完成 subtask（已打卡、工時 45 分）。
    await expect(punchRows.nth(1).locator('.punch-table__td--name')).toHaveText('實作登入流程')
    await expect(punchRows.nth(1).locator('.punch-table__status')).toContainText('已打卡')
    // 工時欄 = hours(0.75)*60 = 45.0 分。
    await expect(punchRows.nth(1).locator('.punch-table__td--num')).toHaveText('45.0')
    // 監測狀態小字（onMonitorStatus 推播）。
    await expect(win.locator('.monitor-panel__status')).toContainText('監測中')

    // ── 4. 對話 viewer：段落群組渲染 stub 的對話訊息 ───────────────
    const convPanel = win.locator('.conversation-panel')
    await expect(convPanel).toBeVisible()
    await expect(convPanel.locator('.conversation-panel__title')).toHaveText('對話')
    // 段落群組出現（新資料層：getSegments 回 1 段）。viewer 不應停在「重新整理中…」或空狀態。
    await expect(convPanel.locator('.conversation-panel__empty')).toHaveCount(0)
    // 對話內容含 stub 的使用者訊息文字（段落展開後可見；最後一段預設展開）。
    await expect(convPanel).toContainText('幫我實作登入流程')

    // ── 5. 打卡詳情對話框：點「詳情」可開（互動不退化）─────────────
    await punchRows.nth(1).locator('.punch-table__detail-btn').click()
    // PunchDetailDialog 開啟（含該 subtask 描述）。
    await expect(win.locator('text=完成登入 UI 與 OAuth 串接')).toBeVisible()
  })
})
