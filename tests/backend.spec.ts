/**
 * backend.spec.ts — Backend 應用服務層單元測試
 *
 * 驗證：
 *  B1: openSession → 建 SessionEntry（sessionId 非空、task 可查）
 *  B2: openSession 同 taskId 冪等 → 回同一 sessionId
 *  B3: openSession → claim 鎖 + 建 MonitorController
 *  B4: closeSession → monitor.stopMonitor + ptyManager.killAll + sessions 清除
 *  B5: closeSession → 推送 card:runState none
 *  B6: startMonitor → 正確呼叫 MonitorController.startMonitor（含 assigneeId=null）
 *  B7: startMonitor → claim 鎖：不同 taskId 搶同一 sessionId → 第二次 false
 *  B8: stopMonitor → 呼叫 monitor.stopMonitor + release claim
 *  B9: login → 轉發 client.loginAsync
 *  B10: findAllTasks → 轉發 client.findAllTasks
 *  B11: listPunchesForTask → 轉發 ledger.listPunchesForTask
 *  B12: destroyAll → 停所有 session
 *  B13: getMilestone → 轉發 milestonesConfig.get
 *  B14: setMilestone → 轉發 milestonesConfig.setEntry
 *  B15: openSession 帶 milestoneId → 從 config 解析 projectPath，SessionInfo 含 projectPath
 *  B16: startMonitor 收到由 openSession 解析的 projectPath
 *
 * 不起真 Electron / BrowserWindow / 真 SQLite。
 * webContents.send 以 EmitFn mock 注入，驗 channel + payload。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { Backend } from '../src/main/backend'
import type { BackendDeps, EmitFn } from '../src/main/backend'
import type { PunchLedger } from '../src/main/db/punchLedger'
import type { ClaudeWorktimeSource } from '../src/main/worktime/worktimeSource'
import type { PtyManager } from '../src/main/pty/ptyManager'
import { SqliteTaskRepository, ensureSchema } from '../src/main/repo/sqliteTaskRepository'
import { CARD_CHANNELS, MONITOR_CHANNELS } from '../src/shared/ipcContracts'

// ---------------------------------------------------------------------------
// Mock config/milestones（隔離檔案系統）
// ---------------------------------------------------------------------------

vi.mock('../src/main/config/milestones', () => ({
  get: vi.fn().mockReturnValue(null),
  setEntry: vi.fn().mockImplementation((_id: unknown, params: { project_path: string | null; tool: string; custom_command?: string | null }) => ({
    project_path: params.project_path,
    tool: params.tool,
    custom_command: params.custom_command ?? null,
  })),
}))

// 取得可重設的 mock 函式
import * as milestonesConfig from '../src/main/config/milestones'
import * as taskSessionsConfig from '../src/main/config/taskSessions'

// ---------------------------------------------------------------------------
// Mock config/taskSessions（隔離 teamuq.db；G6 換源後 taskSessions 改打 openTeamuqDb，
// 不 mock 會在測試中讀寫使用者真實 ~/.teamuq/teamuq.db。backend.spec 不斷言 taskSessions
// 行為，僅需 no-op 隔離。）
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
    listPunchesForTask: vi.fn().mockReturnValue([{ punch_uid: 'u1', task_id: 'task-1' }]),
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

/** 開過的 in-memory DB（makeBackend 用；afterEach 關閉避免 :memory: WAL teardown segfault）。 */
const _backendDbs: Database.Database[] = []


/**
 * makeBackend — 純本地版（B9：移除 SecretStore / authSecretStore，純本地無雲端 auth）。
 */
function makeBackend(emitFn?: EmitFn): {
  backend: Backend
  ledger: PunchLedger
  worktimeSource: ClaudeWorktimeSource
  ptyManager: PtyManager
  emittedEvents: Array<{ channel: string; payload: unknown }>
} {
  const ledger = makeMockLedger()
  const worktimeSource = makeMockWorktimeSource()
  const ptyManager = makeMockPtyManager()
  const emittedEvents: Array<{ channel: string; payload: unknown }> = []

  const emit: EmitFn = emitFn ?? ((channel, payload) => {
    emittedEvents.push({ channel, payload })
  })

  const db = new Database(':memory:')
  _backendDbs.push(db)
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

  return { backend, ledger, worktimeSource, ptyManager, emittedEvents }
}

afterEach(() => {
  for (const db of _backendDbs.splice(0)) {
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

describe('Backend', () => {
  beforeEach(() => {
    // 重設 mock 狀態（每個 test 獨立）
    vi.mocked(milestonesConfig.get).mockReturnValue(null)
    vi.mocked(milestonesConfig.setEntry).mockImplementation((_id: unknown, params: { project_path: string | null; tool: string; custom_command?: string | null }) => ({
      project_path: params.project_path,
      tool: params.tool,
      custom_command: params.custom_command ?? null,
    }))
  })

  // B1: openSession 建 SessionEntry
  it('B1: openSession 建立 SessionEntry，sessionId 非空', () => {
    const { backend } = makeBackend()
    const info = backend.sessions.openSession({ taskId: 'task-1', projectPath: '/p' })
    expect(info.sessionId).toBeTruthy()
    expect(info.taskId).toBe('task-1')
    expect(backend.sessionCount).toBe(1)
  })

  // B2: openSession 同 taskId 冪等
  it('B2: openSession 同 taskId 冪等 → 回同一 sessionId', () => {
    const { backend } = makeBackend()
    const a = backend.sessions.openSession({ taskId: 'task-1' })
    const b = backend.sessions.openSession({ taskId: 'task-1' })
    expect(a.sessionId).toBe(b.sessionId)
    expect(backend.sessionCount).toBe(1)
  })

  // B3: openSession 不同 taskId → 不同 sessionId
  it('B3: openSession 不同 taskId → 不同 sessionId + 各自有 MonitorController', () => {
    const { backend } = makeBackend()
    const a = backend.sessions.openSession({ taskId: 'task-1' })
    const b = backend.sessions.openSession({ taskId: 'task-2' })
    expect(a.sessionId).not.toBe(b.sessionId)
    expect(backend.sessionCount).toBe(2)
    expect(backend.getSessionEntry(a.sessionId)).toBeTruthy()
    expect(backend.getSessionEntry(b.sessionId)).toBeTruthy()
  })

  // B4: closeSession → killAll + 清 sessions
  it('B4: closeSession → ptyManager.killAll + sessions 清除', () => {
    const { backend, ptyManager } = makeBackend()
    const { sessionId } = backend.sessions.openSession({ taskId: 'task-1' })
    backend.sessions.closeSession(sessionId)
    expect(ptyManager.killAll).toHaveBeenCalled()
    expect(backend.sessionCount).toBe(0)
  })

  // B5: closeSession → 推送 card:runState none
  it('B5: closeSession → 推送 card:runState none', () => {
    const { backend, emittedEvents } = makeBackend()
    const { sessionId } = backend.sessions.openSession({ taskId: 'task-1' })
    emittedEvents.length = 0 // 清掉 openSession 期間的推送
    backend.sessions.closeSession(sessionId)
    const cardEvt = emittedEvents.find(e => e.channel === CARD_CHANNELS.RUN_STATE)
    expect(cardEvt).toBeTruthy()
    expect((cardEvt!.payload as { taskId: string; state: string }).taskId).toBe('task-1')
    expect((cardEvt!.payload as { taskId: string; state: string }).state).toBe('none')
  })

  // B6: startMonitor → MonitorController.startMonitor 被呼叫
  it('B6: startMonitor → MonitorController.startMonitor 呼叫且回 true', async () => {
    const { backend } = makeBackend()
    const { sessionId } = backend.sessions.openSession({ taskId: 'task-1', projectPath: '/p' })
    const entry = backend.getSessionEntry(sessionId)!
    // spy monitor.startMonitor
    const startSpy = vi.spyOn(entry.monitor, 'startMonitor').mockReturnValue(true)

    const started = await backend.monitor.startMonitor({
      sessionId,
      taskId: 'task-1',
      projectPath: '/p',
    })
    expect(started).toBe(true)
    expect(startSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        taskId: 'task-1',
        projectPath: '/p',
        assigneeId: null,
      })
    )
  })

  // B7: claim 鎖 — 不同 taskId 搶同一 session → 第二次 false
  it('B7: claim 鎖 — 不同 taskId 搶同 session → 第二次 false', async () => {
    const { backend } = makeBackend()
    const { sessionId } = backend.sessions.openSession({ taskId: 'task-1' })
    const entry = backend.getSessionEntry(sessionId)!
    vi.spyOn(entry.monitor, 'startMonitor').mockReturnValue(true)

    const first = await backend.monitor.startMonitor({ sessionId, taskId: 'task-1', projectPath: '/p' })
    expect(first).toBe(true)

    // 不同 task 搶同一 sessionId — 用 session:open 建新 entry 但相同 sessionId 已 claim
    // 直接呼叫 startMonitor 模擬衝突
    const second = await backend.monitor.startMonitor({ sessionId, taskId: 'task-other', projectPath: '/p' })
    expect(second).toBe(false)
  })

  // B8: stopMonitor → monitor.stopMonitor + release claim
  it('B8: stopMonitor → monitor.stopMonitor + claim 釋放', async () => {
    const { backend } = makeBackend()
    const { sessionId } = backend.sessions.openSession({ taskId: 'task-1' })
    const entry = backend.getSessionEntry(sessionId)!
    vi.spyOn(entry.monitor, 'startMonitor').mockReturnValue(true)
    const stopSpy = vi.spyOn(entry.monitor, 'stopMonitor')

    await backend.monitor.startMonitor({ sessionId, taskId: 'task-1', projectPath: '/p' })
    backend.monitor.stopMonitor(sessionId)

    expect(stopSpy).toHaveBeenCalled()
    // claim 釋放後，可被相同 task 重新 claim
    expect(backend.activeSessions.has(sessionId)).toBe(false)
  })

  // B10: findAllTasks → 走 TaskService（本地 repo 讀），回 TaskDto[]
  it('B10: findAllTasks → 走 TaskService 本地 repo，回 TaskDto[]', async () => {
    // B9（純本地）：TaskDto 不含 origin / platform_local_id / sync_enabled（雲端欄已移除）。
    const fakeDto = { id: 'task-1', name: 'T', status: 'TODO', start_date: null, end_date: null, milestone_id: null, milestone_public_id: null, milestone_name: null, project_local_id: null, raw: {} }
    const mockTaskService = { findAllTasks: vi.fn().mockResolvedValue([fakeDto]) } as unknown as import('../src/main/services/taskService').TaskService
    const { backend } = makeBackend()
    // 注入 mock taskService（bypass 真實 repo）
    ;(backend as unknown as Record<string, unknown>)['_taskService'] = mockTaskService
    const result = await backend.projects.findAllTasks({})
    expect(mockTaskService.findAllTasks).toHaveBeenCalledWith({})
    expect(result).toEqual([fakeDto])
  })

  // B11: listPunchesForTask → 轉發 ledger.listPunchesForTask
  it('B11: listPunchesForTask → 轉發 ledger.listPunchesForTask', () => {
    const { backend, ledger } = makeBackend()
    const rows = backend.monitor.listPunchesForTask('task-1')
    expect(ledger.listPunchesForTask).toHaveBeenCalledWith('task-1')
    expect(Array.isArray(rows)).toBe(true)
  })

  // B12: destroyAll → 停所有 session
  it('B12: destroyAll → 停所有 session', () => {
    const { backend, ptyManager } = makeBackend()
    backend.sessions.openSession({ taskId: 'task-1' })
    backend.sessions.openSession({ taskId: 'task-2' })
    expect(backend.sessionCount).toBe(2)
    backend.destroyAll()
    expect(backend.sessionCount).toBe(0)
    // killAll 每個 session 各一次 → 共 2 次
    expect((ptyManager.killAll as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2)
  })

  // B-extra: getRunState session 不存在 → 'none'
  it('getRunState：session 不存在 → none', () => {
    const { backend } = makeBackend()
    expect(backend.sessions.getRunState('non-exist')).toBe('none')
  })

  // B-emit: setEmit 注入後，view 的 emit 同步更新
  it('setEmit → 現有 session view 的 emit 跟著更新', () => {
    const { backend } = makeBackend()
    const { sessionId } = backend.sessions.openSession({ taskId: 'task-1' })
    const newEvents: Array<{ channel: string; payload: unknown }> = []
    backend.setEmit((ch, pl) => newEvents.push({ channel: ch, payload: pl }))
    backend.sessions.closeSession(sessionId) // triggers card:runState push via new emit
    expect(newEvents.some(e => e.channel === CARD_CHANNELS.RUN_STATE)).toBe(true)
  })

  // B-monitor-render: monitor view showStatus → MONITOR_CHANNELS.STATUS push
  it('MainProcessMonitorView.showStatus → MONITOR_CHANNELS.STATUS push', () => {
    const { backend, emittedEvents } = makeBackend()
    const { sessionId } = backend.sessions.openSession({ taskId: 'task-1' })
    const entry = backend.getSessionEntry(sessionId)!
    emittedEvents.length = 0
    entry.view.showStatus('掃描中')
    const evt = emittedEvents.find(e => e.channel === MONITOR_CHANNELS.STATUS)
    expect(evt).toBeTruthy()
    expect((evt!.payload as { text: string }).text).toBe('掃描中')
  })

  // B13: getMilestone → 轉發 milestonesConfig.get
  it('B13: getMilestone → 轉發 milestonesConfig.get', () => {
    const mockEntry = { project_path: '/my/project', tool: 'claude', custom_command: null }
    vi.mocked(milestonesConfig.get).mockReturnValueOnce(mockEntry)
    const { backend } = makeBackend()
    const result = backend.projects.getMilestone('ms-1')
    expect(milestonesConfig.get).toHaveBeenCalledWith('ms-1')
    expect(result).toEqual(mockEntry)
  })

  // B14: setMilestone → 轉發 milestonesConfig.setEntry
  it('B14: setMilestone → 轉發 milestonesConfig.setEntry', () => {
    const { backend } = makeBackend()
    const result = backend.projects.setMilestone('ms-2', {
      project_path: '/p/q',
      tool: 'vscode',
      custom_command: null,
    })
    expect(milestonesConfig.setEntry).toHaveBeenCalledWith('ms-2', {
      project_path: '/p/q',
      tool: 'vscode',
      custom_command: null,
    })
    expect(result.project_path).toBe('/p/q')
    expect(result.tool).toBe('vscode')
  })

  // B15: openSession 帶 milestoneId → config 解析 projectPath → SessionInfo 含 projectPath
  it('B15: openSession 帶 milestoneId → 從 config 解析 projectPath', () => {
    vi.mocked(milestonesConfig.get).mockReturnValueOnce({
      project_path: '/resolved/path',
      tool: 'claude',
      custom_command: null,
    })
    const { backend } = makeBackend()
    const info = backend.sessions.openSession({ taskId: 'task-ms', milestoneId: 'ms-abc' })
    expect(milestonesConfig.get).toHaveBeenCalledWith('ms-abc')
    expect(info.projectPath).toBe('/resolved/path')
    expect(info.milestoneId).toBe('ms-abc')
    // SessionEntry 也應含 projectPath
    const entry = backend.getSessionEntry(info.sessionId)!
    expect(entry.projectPath).toBe('/resolved/path')
    expect(entry.milestoneId).toBe('ms-abc')
  })

  // B16: openSession 解析的 projectPath 傳給 startMonitor → MonitorController.startMonitor 收到
  it('B16: startMonitor 收到由 openSession 解析的 projectPath', async () => {
    vi.mocked(milestonesConfig.get).mockReturnValueOnce({
      project_path: '/project/from/config',
      tool: 'claude',
      custom_command: null,
    })
    const { backend } = makeBackend()
    const { sessionId, projectPath } = backend.sessions.openSession({ taskId: 'task-16', milestoneId: 'ms-16' })
    expect(projectPath).toBe('/project/from/config')

    const entry = backend.getSessionEntry(sessionId)!
    const startSpy = vi.spyOn(entry.monitor, 'startMonitor').mockReturnValue(true)

    await backend.monitor.startMonitor({
      sessionId,
      taskId: 'task-16',
      projectPath,
    })
    expect(startSpy).toHaveBeenCalledWith(
      expect.objectContaining({ projectPath: '/project/from/config' })
    )
  })

  // ---- B17–B20：監測集合單一來源 + recoverMonitoring 不重複 start（fix: card 閃數 ≠ 監測列表數）----

  // B17: listActiveSessions 反映 main 端「實際存在」的所有 session（renderer hydrate tab 的單一來源）。
  it('B17: listActiveSessions 列出所有開啟的 session（單一真相來源）', () => {
    const { backend } = makeBackend()
    expect(backend.sessions.listActiveSessions()).toEqual([])
    const a = backend.sessions.openSession({ taskId: 'task-A', projectPath: '/a' })
    const b = backend.sessions.openSession({ taskId: 'task-B', projectPath: '/b' })
    const list = backend.sessions.listActiveSessions()
    expect(list).toHaveLength(2)
    const byTask = new Map(list.map((s) => [s.taskId, s]))
    expect(byTask.get('task-A')!.sessionId).toBe(a.sessionId)
    expect(byTask.get('task-B')!.sessionId).toBe(b.sessionId)
    // 列出集合 === sessionCount（無重複、無遺漏）。
    expect(list.length).toBe(backend.sessionCount)

  })

  // B18: recoverMonitoring → 對每個 monitoring 綁定 headless openSession + startMonitor，
  //   且 listActiveSessions === 恢復集合（card 閃 / 監測列表 / backend 集合 三者同源）。
  it('B18: recoverMonitoring → listActiveSessions 等於恢復集合，每綁定恰啟動一次', async () => {
    vi.mocked(taskSessionsConfig.listMonitoringTasks).mockReturnValueOnce([
      { task_id: 'task-r1', session_id: 's-r1', project_path: '/r1' },
      { task_id: 'task-r2', session_id: 's-r2', project_path: '/r2' },
    ])
    const { backend } = makeBackend()
    // 讓 MonitorController.startMonitor 一律回 true（避免依賴真實掃描），用 prototype spy 計次。
    const startSpy = vi
      .spyOn(
        (await import('../src/main/monitor/MonitorController')).MonitorController.prototype,
        'startMonitor',
      )
      .mockReturnValue(true)

    const recovered = await backend.monitor.recoverMonitoring()
    expect(recovered.sort()).toEqual(['task-r1', 'task-r2'])

    // 恢復集合 === listActiveSessions（每個監測中 task 都有對應 session entry）。
    const activeTaskIds = backend.sessions.listActiveSessions().map((s) => s.taskId).sort()
    expect(activeTaskIds).toEqual(['task-r1', 'task-r2'])
    expect(backend.sessionCount).toBe(2)
    // 每個綁定 startMonitor 恰一次（不重複 start / 不重複掃）。
    expect(startSpy).toHaveBeenCalledTimes(2)
    startSpy.mockRestore()
  })

  // B19: recoverMonitoring 後對「已恢復且在監測」的 session 再 startMonitor（= renderer hydrate
  //   出 tab → SessionTab mount 再 start）→ MonitorController.startMonitor 因 _monitorActive 守門
  //   不重複掃；不會新增 session、集合維持不變（冪等）。
  it('B19: 對已在監測的 session 再 startMonitor → 冪等不重複掃，集合不變', async () => {
    const { backend } = makeBackend()
    const info = backend.sessions.openSession({ taskId: 'task-idem', projectPath: '/p' })
    const entry = backend.getSessionEntry(info.sessionId)!
    // 用真實 MonitorController 行為：第一次 true、之後（_monitorActive）false。
    let active = false
    const ctrlSpy = vi.spyOn(entry.monitor, 'startMonitor').mockImplementation(() => {
      if (active) return false // 已在監測 → 不重掃
      active = true
      return true
    })

    const first = await backend.monitor.startMonitor({ sessionId: info.sessionId, taskId: 'task-idem', projectPath: '/p' })
    const second = await backend.monitor.startMonitor({ sessionId: info.sessionId, taskId: 'task-idem', projectPath: '/p' })

    expect(first).toBe(true)
    expect(second).toBe(false) // 第二次不重複啟動
    expect(ctrlSpy).toHaveBeenCalledTimes(2) // 有呼叫，但第二次被守門
    // 集合不變：仍只有一個 session，沒因重複 start 而長出第二個。
    expect(backend.sessionCount).toBe(1)
    expect(backend.sessions.listActiveSessions().filter((s) => s.taskId === 'task-idem')).toHaveLength(1)
  })

  // B20: recoverMonitoring 無 monitoring 綁定 → 不開任何 session（空集合，三者一致為空）。
  it('B20: 無 monitoring 綁定 → recoverMonitoring 不開 session', async () => {
    vi.mocked(taskSessionsConfig.listMonitoringTasks).mockReturnValueOnce([])
    const { backend } = makeBackend()
    const recovered = await backend.monitor.recoverMonitoring()
    expect(recovered).toEqual([])
    expect(backend.sessionCount).toBe(0)
    expect(backend.sessions.listActiveSessions()).toEqual([])
  })

  // B21: listActiveSessions 帶 taskName（fix: 重開後恢復 tab 名稱顯示數字 ID 問題）。
  //   repo 有 task 列 → taskName = task.name；repo 無 task 列 → taskName fallback = taskId。
  it('B21: listActiveSessions 帶 taskName — repo 有 task 時回任務名，無則 fallback taskId', () => {
    const { backend } = makeBackend()
    // 取出 repo，建一筆有名稱的 task，取得其自動產生的 local_id。
    const repo: SqliteTaskRepository = (backend as unknown as { _repo: SqliteTaskRepository })._repo
    const taskRow = repo.createTask({ name: '我的任務' })
    const namedTaskId = taskRow.local_id

    // 開兩個 session：一個 task 在 repo（有名）、一個不在（無名 fallback）。
    backend.sessions.openSession({ taskId: namedTaskId, projectPath: '/p1' })
    backend.sessions.openSession({ taskId: 'task-unknown-xyz', projectPath: '/p2' })

    const list = backend.sessions.listActiveSessions()
    const byTask = new Map(list.map((s) => [s.taskId, s]))

    // task 在 repo → taskName 為任務名
    expect(byTask.get(namedTaskId)!.taskName).toBe('我的任務')
    // task 不在 repo → taskName fallback 為 taskId（非空、不是 undefined）
    expect(byTask.get('task-unknown-xyz')!.taskName).toBe('task-unknown-xyz')
  })

  // B22（回歸）：團隊對話 session — 無 milestone 建 task。
  //   milestoneLocalId 改選填後，不傳 milestone 仍能建 task；不應拋「里程碑不存在」。
  //   B9（純本地）：TaskDto 不含 platform_local_id / sync_enabled（雲端欄已移除）。
  it('B22: 無 milestoneLocalId 建 task → 成功、milestone_id=null（不拋里程碑不存在）', async () => {
    const { backend } = makeBackend()
    const dto = await backend.projects.createTask({ name: '團隊對話任務' } as Parameters<
      typeof backend.projects.createTask
    >[0])
    expect(dto.id).toBeTruthy()
    expect(dto.name).toBe('團隊對話任務')
    expect(dto.milestone_id).toBeNull()
  })

  // B23（純本地）：純本地版移除了里程碑存在性守門（FK 不強制）。
  //   傳不存在的 milestoneLocalId → task 照建，milestone_id 儲存傳入值（無拋錯）。
  it('B23: 傳不存在的 milestoneLocalId → 純本地版照建，milestone_id=傳入值（不拋）', async () => {
    const { backend } = makeBackend()
    const dto = await backend.projects.createTask({
      name: 'X',
      milestoneLocalId: 'ms-不存在',
    } as Parameters<typeof backend.projects.createTask>[0])
    expect(dto.id).toBeTruthy()
    expect(dto.name).toBe('X')
    expect(dto.milestone_id).toBe('ms-不存在')
  })

  // B24：團隊對話 session — 建 task 帶 projectLocalId + folderPath → 順帶 linkProjectFolder。
  it('B24: createTask 帶 projectLocalId + folderPath → 建 task 並順帶 link folder↔project', async () => {
    const { backend } = makeBackend()
    const repo: SqliteTaskRepository = (backend as unknown as { _repo: SqliteTaskRepository })._repo
    const proj = repo.createProject({ name: '對話專案' })
    const dto = await backend.projects.createTask({
      name: '帶 project 的任務',
      projectLocalId: proj.local_id,
      folderPath: 'C:\\work\\team',
    } as Parameters<typeof backend.projects.createTask>[0])
    expect(dto.project_local_id).toBe(proj.local_id)
    // 關聯已建（backend 順帶 linkProjectFolder，省 IPC）。
    expect(repo.findFoldersByProject(proj.local_id)).toEqual(['C:\\work\\team'])
    expect(repo.findProjectsByFolder('C:\\work\\team').map((p) => p.local_id)).toEqual([
      proj.local_id,
    ])
  })
})

// ===========================================================================
// 批次 4：backend 對話定檔依 tool 分流（_resolveConvFile）+ openedAtMs
//   - tool='codex'：造 codex rollout（cwd=projectPath）→ getConversationWindow ok 且非空。
//   - tool='agy'：未支援 → FAIL（不誤傷、不崩）。
// 真檔依賴：findCodexRollout 走 import-time CODEX_SESSIONS_ROOT（~/.codex/sessions），
// 無 baseDir 注入點 → 在真 root 下用「唯一 tmp cwd」造檔（不與真 codex session 衝突），
// afterEach 精準清除本 test 建立的檔/日目錄。conv cache DB 走 TEAMUQ_HOME 隔離。
// ===========================================================================

import * as bfs from 'fs'
import * as bos from 'os'
import * as bpath from 'path'
import { CODEX_SESSIONS_ROOT } from '../src/main/worktime/codex/discover'

describe('Backend — 批次4 對話定檔 tool 分流', () => {
  let teamuqHome: string
  const createdFiles: string[] = []

  beforeEach(() => {
    teamuqHome = bfs.mkdtempSync(bpath.join(bos.tmpdir(), 'backend-conv-'))
    process.env['TEAMUQ_HOME'] = teamuqHome
  })

  afterEach(() => {
    delete process.env['TEAMUQ_HOME']
    for (const f of createdFiles.splice(0)) {
      try { bfs.rmSync(f, { force: true }) } catch { /* ignore */ }
    }
    try { bfs.rmSync(teamuqHome, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  /** 在真 CODEX_SESSIONS_ROOT 下造一個 rollout（cwd=projectPath）；回檔路徑（記錄供清除）。 */
  function writeCodexRollout(projectPath: string, lines: string[]): string {
    const now = new Date()
    const y = String(now.getFullYear())
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    const dir = bpath.join(CODEX_SESSIONS_ROOT, y, m, d)
    bfs.mkdirSync(dir, { recursive: true })
    const ts = now.toISOString()
    const meta = JSON.stringify({ timestamp: ts, type: 'session_meta', payload: { id: `bktest-${Date.now()}`, cwd: projectPath, timestamp: ts } })
    const file = bpath.join(dir, `rollout-bktest-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`)
    bfs.writeFileSync(file, [meta, ...lines].join('\n') + '\n', 'utf-8')
    createdFiles.push(file)
    return file
  }

  function cxEvent(payloadType: string, extra: Record<string, unknown> = {}): string {
    return JSON.stringify({ timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: payloadType, ...extra } })
  }

  /** 取 backend 私有 _sessions，把指定 session 改成目標 tool/projectPath（並回 entry）。 */
  function patchSession(backend: Backend, sessionId: string, tool: string, projectPath: string): void {
    const sessions = (backend as unknown as { _sessions: Map<string, { tool: string; projectPath: string; claudeSessionId: string | null; openedAtMs: number }> })._sessions
    const entry = sessions.get(sessionId)!
    entry.tool = tool
    entry.projectPath = projectPath
    entry.claudeSessionId = null
  }

  it('tool=codex：造 rollout(cwd=projectPath) → getConversationWindow ok 且 messages 非空', () => {
    const { backend } = makeBackend()
    // 唯一 projectPath（mkdtemp）→ 不與真 codex session cwd 衝突。
    const projectPath = bfs.mkdtempSync(bpath.join(bos.tmpdir(), 'codex-proj-'))
    createdFiles.push(projectPath)

    const { sessionId } = backend.sessions.openSession({ taskId: 'task-codex', projectPath })
    // openSession 已填 openedAtMs=Date.now()；rollout 在其後寫入 → discover 命中（sinceMs 下界）。
    patchSession(backend, sessionId, 'codex', projectPath)
    writeCodexRollout(projectPath, [
      cxEvent('user_message', { message: '你好 codex' }),
      cxEvent('agent_message', { message: '收到。', phase: 'final_answer' }),
      cxEvent('task_complete', { turn_id: 't1', duration_ms: 3000 }),
    ])

    const win = backend.conversations.getConversationWindow(sessionId)
    expect(win.ok).toBe(true)
    expect(win.messages.length).toBeGreaterThan(0)
    const userText = win.messages
      .filter((m) => m.role === 'user')
      .flatMap((m) => m.blocks)
      .filter((b) => b.kind === 'text')
      .map((b) => b.text)
    expect(userText).toEqual(['你好 codex'])

    // getSegments 也回非空段（user_message 開段）。
    const seg = backend.conversations.getSegments(sessionId)
    expect(seg.ok).toBe(true)
    expect(seg.segments.length).toBeGreaterThan(0)
  })

  it('tool=agy（未支援）→ getConversationWindow FAIL（不崩）', () => {
    const { backend } = makeBackend()
    const projectPath = bfs.mkdtempSync(bpath.join(bos.tmpdir(), 'agy-proj-'))
    createdFiles.push(projectPath)
    const { sessionId } = backend.sessions.openSession({ taskId: 'task-agy', projectPath })
    patchSession(backend, sessionId, 'agy', projectPath)

    const win = backend.conversations.getConversationWindow(sessionId)
    expect(win.ok).toBe(false)
    expect(win.messages).toEqual([])
    // 其他四方法同樣 FAIL（不崩）。
    expect(backend.conversations.getSegments(sessionId).ok).toBe(false)
    expect(backend.conversations.getSegmentMessages(sessionId, 0, 5).ok).toBe(false)
    expect(backend.conversations.getRawLines(sessionId, 0, 5).ok).toBe(false)
    expect(backend.conversations.getSessionConversation(sessionId)).toEqual([])
  })

  it('codex 無 projectPath → FAIL（不崩）', () => {
    const { backend } = makeBackend()
    const { sessionId } = backend.sessions.openSession({ taskId: 'task-codex-nopath' })
    patchSession(backend, sessionId, 'codex', '')
    expect(backend.conversations.getConversationWindow(sessionId).ok).toBe(false)
  })
})
