/**
 * e2eMain — E2E 專用 Electron 主程序（回歸網用）。
 *
 * 為什麼不直接跑 out/main/index.js：
 *   真實 main 在 boot 即連 OAuth / AppSync / claude CLI / better-sqlite3，
 *   全是不可控外部相依（且 better-sqlite3 在本機有 ABI blocker，無編譯器可重建）。
 *   contextBridge 把 window.tuq 凍結，preload 跑完後 renderer 端無法覆蓋（實測
 *   non-configurable/non-writable）。
 *
 * 本檔的策略（正確切面）：
 *   - 仍載入 **真實 preload**（out/preload/index.js）→ renderer 拿到的是貨真價實的
 *     contextBridge window.tuq（走 ipcRenderer.invoke / on）。
 *   - 仍載入 **真實 renderer bundle**（out/renderer/index.html）→ 驗真實 UI 元件鏈。
 *   - 只把 **main 端的 ipcMain handler 換成固定 fixture** → 切斷外部相依，
 *     確定性可重跑。等於「真前端 + 真 IPC 橋 + 假後端」。
 *
 * 結果：此 E2E 不依賴 better-sqlite3 / node-pty（不載入真實 backend），
 *   可在無編譯器環境穩定跑，純守「renderer 在既有 IPC 合約下不退化」。
 */
const { app, BrowserWindow, ipcMain, session } = require('electron')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const PRELOAD = path.join(REPO_ROOT, 'out', 'preload', 'index.js')
const RENDERER_HTML = path.join(REPO_ROOT, 'out', 'renderer', 'index.html')

// ───────────────────────────── 固定 fixtures ─────────────────────────────
const TASK = {
  id: 'task-1',
  name: 'E2E 黃金路徑任務',
  status: 'IN_PROGRESS',
  milestoneId: 'ms-1',
  milestone: { id: 'ms-1', name: '里程碑甲', project: { name: '專案 Alpha' } },
  assignee: { name: '王小明' },
  typeCategory: { name: '開發' },
}

const SESSION_INFO = {
  sessionId: 'sess-1',
  taskId: 'task-1',
  projectPath: 'C:/work/alpha',
  milestoneId: 'ms-1',
  tool: 'claude',
  launchCommand: null,
  claudeSessionId: 'claude-uuid-1',
}

const PUNCH_ROWS = [
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

const CONV_MESSAGES = [
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
    stop_reason: 'end_turn',
  },
]

const SEGMENTS = [
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

let loggedIn = false
const ok = (data) => ({ ok: true, data })

/** 推播：監測列 + 狀態 + run-state（模擬真實 backend.setEmit）。 */
function pushMonitor(win) {
  if (win.isDestroyed()) return
  win.webContents.send('monitor:status', { sessionId: SESSION_INFO.sessionId, text: '監測中（claude-uuid-1）' })
  win.webContents.send('monitor:render', { sessionId: SESSION_INFO.sessionId, rows: PUNCH_ROWS, canPunch: true })
  win.webContents.send('card:runState', { taskId: TASK.id, state: 'running' })
}

function registerHandlers(getWin) {
  // ── auth ──
  ipcMain.handle('auth:login', () => {
    loggedIn = true
    return ok({ ok: true })
  })
  ipcMain.handle('auth:status', () =>
    ok({ loggedIn, account: loggedIn ? { email: 'e2e@teamuq.test', name: 'E2E 使用者' } : null }),
  )
  ipcMain.handle('auth:logout', () => {
    loggedIn = false
    return ok({})
  })

  // ── tasks ──
  ipcMain.handle('tasks:findAll', () => ok(loggedIn ? [TASK] : []))
  ipcMain.handle('tasks:update', () => ok({}))

  // ── session ──
  ipcMain.handle('session:open', () => {
    setTimeout(() => pushMonitor(getWin()), 50)
    return ok({ ...SESSION_INFO })
  })
  ipcMain.handle('session:close', () => ok({}))
  ipcMain.handle('session:listSessions', () =>
    ok([{ id: 'claude-uuid-1', label: '09:00 幫我實作登入流程', tooltip: '目前監測對象', busy: false, current: true }]),
  )
  ipcMain.handle('session:rename', () => ok({ ok: true }))
  ipcMain.handle('session:getConversation', () => ok(CONV_MESSAGES))
  ipcMain.handle('session:setProject', () => ok({ ok: true, launchCommand: null, claudeSessionId: 'claude-uuid-1' }))
  ipcMain.handle('session:listSkills', () => ok([{ name: 'tuq-dev', description: 'SW Manager 流程入口' }]))
  ipcMain.handle('session:getSubagentConversation', () => ok({ ok: true, messages: [] }))
  ipcMain.handle('session:getConversationWindow', () =>
    ok({ ok: true, messages: CONV_MESSAGES, startSeq: 0, totalCount: CONV_MESSAGES.length }),
  )
  ipcMain.handle('session:getSegments', () => ok({ ok: true, segments: SEGMENTS, totalCount: CONV_MESSAGES.length }))
  ipcMain.handle('session:getSegmentMessages', () => ok({ ok: true, messages: CONV_MESSAGES }))

  // ── monitor ──
  ipcMain.handle('monitor:start', () => {
    setTimeout(() => pushMonitor(getWin()), 50)
    return ok({ started: true })
  })
  ipcMain.handle('monitor:stop', () => ok({}))
  ipcMain.handle('monitor:rebind', () => ok({ ok: true, claudeSessionId: 'claude-uuid-1', launchCommand: null }))

  // ── punches ──
  ipcMain.handle('punches:listForTask', () => ok(PUNCH_ROWS))

  // ── pty（對話框送出 / 終端；回 ok 即可，無真 PTY）──
  ipcMain.handle('pty:spawn', () => ok({}))
  ipcMain.handle('pty:write', () => ok({}))
  ipcMain.handle('pty:resize', () => ok({}))
  ipcMain.handle('pty:kill', () => ok({}))

  // ── config ──
  ipcMain.handle('config:getMilestone', () => ok({ project_path: 'C:/work/alpha', tool: 'claude', custom_command: null }))
  ipcMain.handle('config:setMilestone', () => ok({ project_path: 'C:/work/alpha', tool: 'claude', custom_command: null }))

  // ── dialog ──
  ipcMain.handle('dialog:openDirectory', () => ok('C:/work/alpha'))
}

function installCsp() {
  // 與真實 prod 一致的嚴格 CSP（renderer 只走 IPC，不對外連線）。
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
  ].join('; ')
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } })
  })
}

let theWin = null

app.whenReady().then(() => {
  installCsp()
  registerHandlers(() => theWin)
  theWin = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'TeamUQ (E2E)',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  theWin.loadFile(RENDERER_HTML)
})

app.on('window-all-closed', () => {
  app.quit()
})
