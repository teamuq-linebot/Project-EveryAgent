/**
 * ptyPromptAlert.spec.ts — Backend.onPtyPromptState 單元測試
 *
 * 驗證：
 *  T1: 未知 ptyId → null、不 emit alert
 *  T2: waiting 轉換 → emit PROMPT_ALERT（正確 payload）、setRunState waiting、回 {sessionId,taskId}
 *  T3: 重複 waiting → null、PROMPT_ALERT 只發過一次（不重發）
 *  T4: waiting → active → setRunState running、旗標清除、無新 alert
 *  T5: error 轉換 → setRunState error、showStatus ⚠ 文案、emit alert state='error'
 *  T6: 無旗標時的 active → 不發任何 runState（不蓋 monitor 判定的 waiting）
 *  T7: closeSession 後再 waiting → session 已刪 → null
 *  T8: reason 省略 → payload.reason = 'unknown'
 *
 * 隔離手法：與 backend.spec.ts 相同（in-memory SQLite + mock milestones + mock taskSessions）。
 * 不起真 Electron / BrowserWindow。webContents.send 以 EmitFn mock 注入。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { Backend } from '../src/main/backend'
import type { BackendDeps, EmitFn } from '../src/main/backend'
import type { PunchLedger } from '../src/main/db/punchLedger'
import type { ClaudeWorktimeSource } from '../src/main/worktime/worktimeSource'
import type { PtyManager } from '../src/main/pty/ptyManager'
import { SqliteTaskRepository, ensureSchema } from '../src/main/repo/sqliteTaskRepository'
import { CARD_CHANNELS, ALERT_CHANNELS, MONITOR_CHANNELS } from '../src/shared/ipcContracts'
import type { PromptAlertPayload, CardRunStatePayload } from '../src/shared/ipcContracts'

// ---------------------------------------------------------------------------
// Mock config/milestones（隔離檔案系統）
// ---------------------------------------------------------------------------

vi.mock('../src/main/config/milestones', () => ({
  get: vi.fn().mockReturnValue(null),
  setEntry: vi.fn().mockImplementation(
    (_id: unknown, params: { project_path: string | null; tool: string; custom_command?: string | null }) => ({
      project_path: params.project_path,
      tool: params.tool,
      custom_command: params.custom_command ?? null,
    }),
  ),
}))

// ---------------------------------------------------------------------------
// Mock config/taskSessions（隔離 teamuq.db）
// ---------------------------------------------------------------------------

vi.mock('../src/main/config/taskSessions', () => ({
  getEntry: vi.fn().mockReturnValue(null),
  getActive: vi.fn().mockReturnValue(null),
  getActiveProjectPath: vi.fn().mockReturnValue(null),
  setActiveProjectPath: vi.fn(),
  setActive: vi.fn().mockReturnValue({ active: null, monitoring: false, history: [] }),
  clearActive: vi.fn().mockReturnValue({ active: null, monitoring: false, history: [] }),
  setMonitoring: vi.fn().mockReturnValue(false),
  isMonitoring: vi.fn().mockReturnValue(false),
  listMonitoringTasks: vi.fn().mockReturnValue([]),
}))

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeMockLedger(): PunchLedger {
  return {
    listPunchesForTask: vi.fn().mockReturnValue([]),
    punchIn: vi.fn(),
    punchOut: vi.fn(),
    recordOneshot: vi.fn(),
    preloadDoneKeys: vi.fn().mockReturnValue(new Set()),
    listOpen: vi.fn().mockReturnValue([]),
    close: vi.fn(),
  } as unknown as PunchLedger
}

function makeMockWorktimeSource(): ClaudeWorktimeSource {
  return {
    collectPunchEvents: vi.fn().mockResolvedValue({
      subagent_events: [],
      main: {},
      main_events: [],
    }),
  } as unknown as ClaudeWorktimeSource
}

function makeMockPtyManager(): PtyManager {
  return {
    spawn: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    killAll: vi.fn(),
  } as unknown as PtyManager
}

const _dbs: Database.Database[] = []

/**
 * makeBackend — thin wrapper identical to backend.spec.ts 的 makeBackend。
 * 回傳 { backend, emittedEvents, sessionId, taskId } 以便測試直接使用已開啟的 session。
 */
function makeBackend(taskId = 'task-pty-1'): {
  backend: Backend
  emittedEvents: Array<{ channel: string; payload: unknown }>
  sessionId: string
  taskId: string
} {
  const ledger = makeMockLedger()
  const worktimeSource = makeMockWorktimeSource()
  const ptyManager = makeMockPtyManager()
  const emittedEvents: Array<{ channel: string; payload: unknown }> = []

  const emit: EmitFn = (channel, payload) => {
    emittedEvents.push({ channel, payload })
  }

  const db = new Database(':memory:')
  _dbs.push(db)
  db.pragma('journal_mode = WAL')
  ensureSchema(db)
  const repo = new SqliteTaskRepository(db)

  const deps: BackendDeps = {
    ledger,
    worktimeSource,
    ptyManagerFactory: () => ptyManager,
    repo,
    watermarkStore: null,
  }
  const backend = new Backend(deps)
  backend.setEmit(emit)

  const { sessionId } = backend.sessions.openSession({ taskId, projectPath: '/test' })
  // 清掉 openSession 過程中產生的事件，讓測試從乾淨狀態開始
  emittedEvents.length = 0

  return { backend, emittedEvents, sessionId, taskId }
}

afterEach(() => {
  for (const db of _dbs.splice(0)) {
    try {
      db.close()
    } catch {
      // ignore
    }
  }
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Backend.onPtyPromptState', () => {
  // T1: 未知 ptyId → null、不 emit alert
  it('T1: 未知 ptyId → 回 null、不 emit PROMPT_ALERT', () => {
    const { backend, emittedEvents } = makeBackend()

    const result = backend.monitor.onPtyPromptState('non-existent-pty-id', 'waiting', 'some reason')

    expect(result).toBeNull()
    const alertEvts = emittedEvents.filter(e => e.channel === ALERT_CHANNELS.PROMPT_ALERT)
    expect(alertEvts).toHaveLength(0)
  })

  // T2: waiting 轉換 → 正確 emit + 正確 payload + 回 {sessionId, taskId}
  it('T2: waiting 轉換 → emit PROMPT_ALERT(payload 正確) + setRunState waiting + 回 {sessionId,taskId}', () => {
    const { backend, emittedEvents, sessionId, taskId } = makeBackend()

    const result = backend.monitor.onPtyPromptState(sessionId, 'waiting', 'my-reason')

    // 回傳值
    expect(result).toEqual({ sessionId, taskId })

    // PROMPT_ALERT 發出且 payload 正確
    const alertEvt = emittedEvents.find(e => e.channel === ALERT_CHANNELS.PROMPT_ALERT)
    expect(alertEvt).toBeTruthy()
    const alertPayload = alertEvt!.payload as PromptAlertPayload
    expect(alertPayload.sessionId).toBe(sessionId)
    expect(alertPayload.taskId).toBe(taskId)
    expect(alertPayload.state).toBe('waiting')
    expect(alertPayload.reason).toBe('my-reason')

    // card:runState waiting 發出
    const runStateEvt = emittedEvents.find(
      e => e.channel === CARD_CHANNELS.RUN_STATE &&
        (e.payload as CardRunStatePayload).state === 'waiting',
    )
    expect(runStateEvt).toBeTruthy()
    expect((runStateEvt!.payload as CardRunStatePayload).taskId).toBe(taskId)
  })

  // T3: 重複 waiting → null、PROMPT_ALERT 只發過一次（不重發）
  it('T3: 重複 waiting → 回 null、PROMPT_ALERT 只發一次（去重）', () => {
    const { backend, emittedEvents, sessionId } = makeBackend()

    const first = backend.monitor.onPtyPromptState(sessionId, 'waiting', 'reason-1')
    const alertCountAfterFirst = emittedEvents.filter(e => e.channel === ALERT_CHANNELS.PROMPT_ALERT).length

    const second = backend.monitor.onPtyPromptState(sessionId, 'waiting', 'reason-2')

    expect(first).not.toBeNull() // 第一次成功
    expect(second).toBeNull()   // 第二次重複 → null

    // 整個 test 裡 PROMPT_ALERT 只發過 1 次
    const totalAlerts = emittedEvents.filter(e => e.channel === ALERT_CHANNELS.PROMPT_ALERT)
    expect(totalAlerts).toHaveLength(alertCountAfterFirst)
    expect(totalAlerts).toHaveLength(1)
  })

  // T4: waiting → active → setRunState running、旗標清除、emit state='resolved'（sticky toast 撤銷）
  it('T4: waiting 後 active → setRunState running、旗標清除、emit state=resolved', () => {
    const { backend, emittedEvents, sessionId, taskId } = makeBackend()

    backend.monitor.onPtyPromptState(sessionId, 'waiting', 'wait-trigger')
    emittedEvents.length = 0 // 清掉 waiting 產生的事件，重新計數

    const result = backend.monitor.onPtyPromptState(sessionId, 'active')

    // active 回傳 null（不發系統通知）
    expect(result).toBeNull()

    // emit 一次 state='resolved'（renderer 撤銷 sticky toast）
    const alertEvts = emittedEvents.filter(e => e.channel === ALERT_CHANNELS.PROMPT_ALERT)
    expect(alertEvts).toHaveLength(1)
    const resolvedPayload = alertEvts[0].payload as PromptAlertPayload
    expect(resolvedPayload.state).toBe('resolved')
    expect(resolvedPayload.sessionId).toBe(sessionId)
    expect(resolvedPayload.taskId).toBe(taskId)

    // setRunState running 發出
    const runStateEvt = emittedEvents.find(
      e => e.channel === CARD_CHANNELS.RUN_STATE &&
        (e.payload as CardRunStatePayload).state === 'running',
    )
    expect(runStateEvt).toBeTruthy()
    expect((runStateEvt!.payload as CardRunStatePayload).taskId).toBe(taskId)

    // 旗標已清：再 waiting 可再次觸發（非重複）
    emittedEvents.length = 0
    const againResult = backend.monitor.onPtyPromptState(sessionId, 'waiting', 'trigger-again')
    expect(againResult).not.toBeNull()
    const newAlerts = emittedEvents.filter(e => e.channel === ALERT_CHANNELS.PROMPT_ALERT)
    expect(newAlerts).toHaveLength(1)
    expect((newAlerts[0].payload as PromptAlertPayload).state).toBe('waiting')
  })

  // T5: error 轉換 → setRunState error + showStatus ⚠ 文案 + alert state='error'
  it('T5: error 轉換 → setRunState error + showStatus ⚠ 文案 + PROMPT_ALERT state=error', () => {
    const { backend, emittedEvents, sessionId, taskId } = makeBackend()

    const result = backend.monitor.onPtyPromptState(sessionId, 'error', 'crash')

    // 回傳非 null
    expect(result).toEqual({ sessionId, taskId })

    // PROMPT_ALERT 發出且 state='error'
    const alertEvt = emittedEvents.find(e => e.channel === ALERT_CHANNELS.PROMPT_ALERT)
    expect(alertEvt).toBeTruthy()
    const alertPayload = alertEvt!.payload as PromptAlertPayload
    expect(alertPayload.state).toBe('error')
    expect(alertPayload.sessionId).toBe(sessionId)
    expect(alertPayload.taskId).toBe(taskId)
    expect(alertPayload.reason).toBe('crash')

    // card:runState error 發出
    const runStateEvt = emittedEvents.find(
      e => e.channel === CARD_CHANNELS.RUN_STATE &&
        (e.payload as CardRunStatePayload).state === 'error',
    )
    expect(runStateEvt).toBeTruthy()

    // monitor:status ⚠ 文案發出
    const statusEvt = emittedEvents.find(e => e.channel === MONITOR_CHANNELS.STATUS)
    expect(statusEvt).toBeTruthy()
    const statusText = (statusEvt!.payload as { text: string }).text
    expect(statusText).toMatch(/⚠/)
    expect(statusText).toContain('crash')
  })

  // T6: 無旗標時的 active → 不發任何 runState（不蓋 monitor 判定的 waiting）
  it('T6: 無旗標時 active → 不 emit card:runState（不蓋 monitor 判定的 waiting）', () => {
    const { backend, emittedEvents, sessionId } = makeBackend()
    // 從未 waiting → 無旗標

    const result = backend.monitor.onPtyPromptState(sessionId, 'active')

    expect(result).toBeNull()

    // 不 emit 任何 card:runState（running 不蓋 monitor 的 waiting）
    const runStateEvts = emittedEvents.filter(e => e.channel === CARD_CHANNELS.RUN_STATE)
    expect(runStateEvts).toHaveLength(0)

    // 也不 emit PROMPT_ALERT
    const alertEvts = emittedEvents.filter(e => e.channel === ALERT_CHANNELS.PROMPT_ALERT)
    expect(alertEvts).toHaveLength(0)
  })

  // T7: closeSession 後再 waiting → session 已刪 → null
  it('T7: closeSession 後再 waiting → _sessions 無此 sessionId → 回 null', () => {
    const { backend, emittedEvents, sessionId } = makeBackend()

    backend.sessions.closeSession(sessionId)
    emittedEvents.length = 0 // 清掉 closeSession 產生的事件

    const result = backend.monitor.onPtyPromptState(sessionId, 'waiting', 'late-trigger')

    expect(result).toBeNull()
    const alertEvts = emittedEvents.filter(e => e.channel === ALERT_CHANNELS.PROMPT_ALERT)
    expect(alertEvts).toHaveLength(0)
  })

  // T8: reason 省略 → payload.reason = 'unknown'
  it('T8: reason 省略 → PROMPT_ALERT payload.reason = "unknown"', () => {
    const { backend, emittedEvents, sessionId } = makeBackend()

    // 不傳 reason
    backend.monitor.onPtyPromptState(sessionId, 'waiting')

    const alertEvt = emittedEvents.find(e => e.channel === ALERT_CHANNELS.PROMPT_ALERT)
    expect(alertEvt).toBeTruthy()
    expect((alertEvt!.payload as PromptAlertPayload).reason).toBe('unknown')
  })

  // T-options: onPtyPromptState 帶 options 第 4 參數 → PROMPT_ALERT payload.options 原樣到達
  it('T-options: waiting 帶 options 第 4 參數 → PROMPT_ALERT payload.options 原樣到達', () => {
    const { backend, emittedEvents, sessionId } = makeBackend()

    const options = [
      { value: '1', label: 'Resume from summary (recommended)' },
      { value: '2', label: 'Resume full session as-is' },
    ]
    backend.monitor.onPtyPromptState(sessionId, 'waiting', 'menu_digit', options)

    const alertEvt = emittedEvents.find(e => e.channel === ALERT_CHANNELS.PROMPT_ALERT)
    expect(alertEvt).toBeTruthy()
    const alertPayload = alertEvt!.payload as PromptAlertPayload
    expect(alertPayload.state).toBe('waiting')
    expect(alertPayload.options).toEqual(options)
  })

  // Bonus: error 重複 → null（同 waiting 去重邏輯）
  it('T9 (bonus): 重複 error → 回 null、PROMPT_ALERT 只發一次', () => {
    const { backend, emittedEvents, sessionId } = makeBackend()

    const first = backend.monitor.onPtyPromptState(sessionId, 'error', 'err-1')
    const alertsAfterFirst = emittedEvents.filter(e => e.channel === ALERT_CHANNELS.PROMPT_ALERT).length

    const second = backend.monitor.onPtyPromptState(sessionId, 'error', 'err-2')

    expect(first).not.toBeNull()
    expect(second).toBeNull()
    expect(emittedEvents.filter(e => e.channel === ALERT_CHANNELS.PROMPT_ALERT)).toHaveLength(alertsAfterFirst)
  })

  // Bonus: error → active → 旗標清除（可再觸發）
  it('T10 (bonus): error 後 active → 旗標清除 + setRunState running', () => {
    const { backend, emittedEvents, sessionId, taskId } = makeBackend()

    backend.monitor.onPtyPromptState(sessionId, 'error', 'err')
    emittedEvents.length = 0

    const result = backend.monitor.onPtyPromptState(sessionId, 'active')
    expect(result).toBeNull()

    const runEvt = emittedEvents.find(
      e => e.channel === CARD_CHANNELS.RUN_STATE &&
        (e.payload as CardRunStatePayload).state === 'running',
    )
    expect(runEvt).toBeTruthy()
    expect((runEvt!.payload as CardRunStatePayload).taskId).toBe(taskId)

    // 旗標已清：再 error 可再次觸發
    emittedEvents.length = 0
    const againResult = backend.monitor.onPtyPromptState(sessionId, 'error', 'err-again')
    expect(againResult).not.toBeNull()
  })
})
