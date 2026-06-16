/**
 * tuqStub — E2E 固定 fixture 資料（golden-path 回歸網用）。
 *
 * 存在理由：
 *   golden-path.e2e.ts 的後端（auth / AppSync / claude CLI / monitor engine）全由
 *   e2eMain.cjs 的 ipcMain handler 以此固定資料取代，切斷外部相依，讓測試確定性可重跑。
 *
 * 本檔的職責：
 *   1. 以 TypeScript 型別對齊 src/shared/ipcContracts.ts，讓 fixture 形狀有靜態保證。
 *   2. 把 e2eMain.cjs 中散落的 fixture 常數集中為具名匯出，方便多測試檔共用。
 *   3. 記錄 golden-path 期望的「stub 介面清單」（各 IPC channel 對應的回傳 fixture）。
 *
 * 注意：
 *   - 本檔**不**在 tsconfig.node.json / tsconfig.web.json 的 include 範圍，
 *     僅供 Playwright/E2E 環境使用，不參與生產 build。
 *   - 若需要語法檢查，可單獨執行：
 *       npx tsc --noEmit --strict --module esnext --moduleResolution bundler \
 *         --target ES2022 --skipLibCheck tests/e2e/fixtures/tuqStub.ts
 */

import type {
  SessionInfo,
  PunchRow,
  ConversationMessage,
  SegmentInfo,
  BindSessionItem,
  SkillItem,
  MonitorRenderPayload,
  MonitorStatusPayload,
  CardRunStatePayload,
} from '../../../src/shared/ipcContracts'

// ---------------------------------------------------------------------------
// 固定 task fixture（tasks:findAll 回傳；loggedIn=true 時有效）
// ---------------------------------------------------------------------------

/**
 * E2E 黃金路徑任務（stub 唯一任務卡）。
 *
 * golden-path 驗證：
 *   - `.task-card` 出現 1 張
 *   - `.task-card__name` = '`E2E 黃金路徑任務`'
 *   - 卡片在「進行中」欄（status = 'IN_PROGRESS'，看板第 3 欄）
 */
export const STUB_TASK = {
  id: 'task-1',
  name: 'E2E 黃金路徑任務',
  status: 'IN_PROGRESS',
  milestoneId: 'ms-1',
  milestone: { id: 'ms-1', name: '里程碑甲', project: { name: '專案 Alpha' } },
  assignee: { name: '王小明' },
  typeCategory: { name: '開發' },
} as const

// ---------------------------------------------------------------------------
// 固定 session fixture（session:open 回傳）
// ---------------------------------------------------------------------------

/**
 * session:open 的回傳 fixture（`IpcResult<SessionInfo>` 的 data 欄）。
 * golden-path 驗證：session tab 顯示 `E2E 黃金路徑任務` 任務名。
 */
export const STUB_SESSION_INFO: SessionInfo = {
  sessionId: 'sess-1',
  taskId: 'task-1',
  projectPath: 'C:/work/alpha',
  milestoneId: 'ms-1',
  tool: 'claude',
  launchCommand: null,
  claudeSessionId: 'claude-uuid-1',
}

// ---------------------------------------------------------------------------
// 固定 punch rows fixture（monitor:render 推播 + punches:listForTask 回傳）
// ---------------------------------------------------------------------------

/**
 * 監測面板推播 / PunchTable 的 2 列固定 fixture。
 *
 * golden-path 驗證：
 *   - `.punch-table__row` 共 2 列
 *   - 第 0 列：name='`上工：E2E 黃金路徑任務`', status='`執行中`'（無結束時間）
 *   - 第 1 列：name='`實作登入流程`', status='`已打卡`', hours=0.75（45.0 分）
 *   - 點「詳情」可見 description='`完成登入 UI 與 OAuth 串接`'
 */
export const STUB_PUNCH_ROWS: PunchRow[] = [
  {
    name: '上工：E2E 黃金路徑任務',
    started_at: '2026-06-04T09:00:00.000Z',
    ended_at: '',
    hours: 0,
    status: '執行中',
    show_end: false,
    type: 'session',
    description: '開始監測',
    subtask_id: 'loc:sub-1',
    error: '',
  },
  {
    name: '實作登入流程',
    started_at: '2026-06-04T09:00:00.000Z',
    ended_at: '2026-06-04T09:45:00.000Z',
    hours: 0.75,
    status: '已打卡',
    show_end: true,
    type: 'subtask',
    description: '完成登入 UI 與 OAuth 串接',
    subtask_id: 'loc:sub-2',
    error: '',
  },
]

// ---------------------------------------------------------------------------
// 固定 monitor push events（monitor:render + monitor:status + card:runState）
// ---------------------------------------------------------------------------

/**
 * monitor:render 推播 payload（`IpcRenderer.on('monitor:render', ...)` 接收）。
 * e2eMain.cjs 在 session:open / monitor:start 後 50ms 推播。
 */
export const STUB_MONITOR_RENDER: MonitorRenderPayload = {
  sessionId: STUB_SESSION_INFO.sessionId,
  rows: STUB_PUNCH_ROWS,
  canPunch: true,
}

/**
 * monitor:status 推播 payload（`.monitor-panel__status` 顯示「監測中」）。
 */
export const STUB_MONITOR_STATUS: MonitorStatusPayload = {
  sessionId: STUB_SESSION_INFO.sessionId,
  text: '監測中（claude-uuid-1）',
}

/**
 * card:runState 推播 payload（看板卡片執行中狀態）。
 */
export const STUB_CARD_RUN_STATE: CardRunStatePayload = {
  taskId: STUB_TASK.id,
  state: 'running',
}

// ---------------------------------------------------------------------------
// 固定 conversation fixture（session:getConversation 回傳）
// ---------------------------------------------------------------------------

/**
 * session:getConversation / session:getConversationWindow / session:getSegmentMessages 回傳。
 *
 * golden-path 驗證：
 *   - `.conversation-panel` 可見且含文字 '`幫我實作登入流程`'
 *   - 段落不停在空狀態（`.conversation-panel__empty` 計數為 0）
 */
export const STUB_CONV_MESSAGES: ConversationMessage[] = [
  {
    role: 'user',
    source: 'typed',
    timestamp: '2026-06-04T09:00:01.000Z',
    blocks: [{ kind: 'text', text: '幫我實作登入流程' }],
  },
  {
    role: 'assistant',
    timestamp: '2026-06-04T09:00:05.000Z',
    blocks: [{ kind: 'text', text: '好的，我先讀取現有的 useAuth hook。' }],
    stopReason: 'end_turn',
  },
]

// ---------------------------------------------------------------------------
// 固定 segments fixture（session:getSegments 回傳）
// ---------------------------------------------------------------------------

/**
 * session:getSegments 回傳的段落索引（SegmentInfo[]）。
 * golden-path 驗證：段落 viewer 不停在空狀態；最後一段展開後可見 '`幫我實作登入流程`'。
 */
export const STUB_SEGMENTS: SegmentInfo[] = [
  {
    seg_no: 0,
    start_seq: 0,
    end_seq: 1,
    start_ts: '2026-06-04T09:00:01.000Z',
    end_ts: '2026-06-04T09:00:05.000Z',
    label: '幫我實作登入流程',
    is_command: 0,
    msg_count: 2,
    head_kind: 'typed',
  },
]

// ---------------------------------------------------------------------------
// 固定 listSessions fixture（session:listSessions 回傳）
// ---------------------------------------------------------------------------

/**
 * session:listSessions 回傳的綁定下拉項目。
 * golden-path 驗證：`.sidebar__session` 數量為 1。
 */
export const STUB_SESSION_LIST: BindSessionItem[] = [
  {
    id: 'claude-uuid-1',
    label: '09:00 幫我實作登入流程',
    tooltip: '目前監測對象',
    busy: false,
    current: true,
  },
]

// ---------------------------------------------------------------------------
// 固定 skills fixture（session:listSkills 回傳）
// ---------------------------------------------------------------------------

/**
 * session:listSkills 回傳（對話框技能下拉；golden-path 不直接驗但需 handler 不報錯）。
 */
export const STUB_SKILLS: SkillItem[] = [
  { name: 'tuq-dev', description: 'SW Manager 流程入口' },
]

// ---------------------------------------------------------------------------
// IPC stub 介面清單摘要（文件性；供 reviewer 快速對照 e2eMain.cjs 的 handler 清單）
// ---------------------------------------------------------------------------

/**
 * golden-path E2E 依賴的全部 IPC channel stub 對照表。
 *
 * | Channel                          | 回傳 fixture                   | 推播事件                      |
 * |----------------------------------|-------------------------------|-------------------------------|
 * | auth:login                       | { ok: true }                  | —                             |
 * | auth:status                      | { loggedIn, account }         | —                             |
 * | auth:logout                      | {}                            | —                             |
 * | tasks:findAll                    | [STUB_TASK]（loggedIn=true）  | —                             |
 * | tasks:update                     | {}                            | —                             |
 * | session:open                     | STUB_SESSION_INFO             | monitor:render, monitor:status, card:runState |
 * | session:close                    | {}                            | —                             |
 * | session:listSessions             | STUB_SESSION_LIST             | —                             |
 * | session:rename                   | { ok: true }                  | —                             |
 * | session:getConversation          | STUB_CONV_MESSAGES            | —                             |
 * | session:setProject               | { ok, launchCommand, … }      | —                             |
 * | session:listSkills               | STUB_SKILLS                   | —                             |
 * | session:getSubagentConversation  | { ok: true, messages: [] }    | —                             |
 * | session:getConversationWindow    | STUB_CONV_MESSAGES + meta     | —                             |
 * | session:getSegments              | STUB_SEGMENTS + meta          | —                             |
 * | session:getSegmentMessages       | STUB_CONV_MESSAGES            | —                             |
 * | monitor:start                    | { started: true }             | monitor:render, monitor:status, card:runState |
 * | monitor:stop                     | {}                            | —                             |
 * | monitor:rebind                   | { ok, claudeSessionId, … }    | —                             |
 * | punches:listForTask              | STUB_PUNCH_ROWS               | —                             |
 * | pty:spawn / write / resize / kill| {}                            | —                             |
 * | config:getMilestone              | { project_path, tool, … }     | —                             |
 * | config:setMilestone              | { project_path, tool, … }     | —                             |
 * | dialog:openDirectory             | 'C:/work/alpha'               | —                             |
 *
 * 以上 stub handler 全在 e2eMain.cjs `registerHandlers()` 中實作。
 * tuqStub.ts 提供型別化常數供共用；e2eMain.cjs 仍是 Electron main 實際跑的入口點。
 */
export const STUB_IPC_CHANNELS = [
  'auth:login',
  'auth:status',
  'auth:logout',
  'tasks:findAll',
  'tasks:update',
  'session:open',
  'session:close',
  'session:listSessions',
  'session:rename',
  'session:getConversation',
  'session:setProject',
  'session:listSkills',
  'session:getSubagentConversation',
  'session:getConversationWindow',
  'session:getSegments',
  'session:getSegmentMessages',
  'monitor:start',
  'monitor:stop',
  'monitor:rebind',
  'punches:listForTask',
  'pty:spawn',
  'pty:write',
  'pty:resize',
  'pty:kill',
  'config:getMilestone',
  'config:setMilestone',
  'dialog:openDirectory',
] as const

export type StubIpcChannel = (typeof STUB_IPC_CHANNELS)[number]
