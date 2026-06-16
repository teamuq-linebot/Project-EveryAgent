/**
 * sessionPathAutofix.spec.ts — findSessionHome 單元 + Backend openSession path-autofix 整合
 *
 * 驗證：
 *  U1: findSessionHome 命中 — 子目錄存在 uuid.jsonl、首筆有 cwd → 回傳該 cwd
 *  U2: findSessionHome 前幾行壞 JSON / 空 cwd 跳過 → 取第一個 truthy cwd
 *  U3: 無任何子目錄含目標 uuid.jsonl → null
 *  U4: baseDir 不存在 → null（不拋）
 *
 *  I1: binding uuid + projectPath 空 + findSessionHome 回 projectCwd
 *      → SessionInfo.projectPath=projectCwd、launchCommand 含 --resume <uuid>、
 *         MONITOR_CHANNELS.STATUS 出現「已自動修正專案路徑」、taskSessions.setActiveProjectPath 回寫
 *  I2: binding uuid + projectPath 空 + findSessionHome 回 null → launchCommand 含 --session-id（不含 --resume）、不發修正提示
 *  I3: projectPath 有效且 JSONL 在其 slug 下 → 原行為（--resume、projectPath 不變、無提示、無回寫）
 *
 * 隔離手法：
 *  - Unit tests: findSessionHome 直接 import（真實實作），以 baseDir 參數注入 tmp fixture
 *  - Integration tests: vi.mock lightList，以 vi.mocked(findSessionHome) 控制 Backend 內部的回傳值
 *    （Backend 呼叫 findSessionHome 不帶 baseDir，所以從外部注入 mock 最乾淨）
 *
 * slug 規則：projectPathToFolderName(path) = path.trim().replace(/[^A-Za-z0-9-]/g, '-')
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import * as fs from 'fs'
import * as nodePath from 'path'
import * as os from 'os'
import Database from 'better-sqlite3'

// ---------------------------------------------------------------------------
// Mock lightList（整個模組）— 讓整合測試可以控制 findSessionHome 的回傳值
// 單元測試改用 __realFindSessionHome（從真實模組直接取）
// ---------------------------------------------------------------------------

// 先保存真實實作，再 mock（vi.mock hoisting 前需要在模組頂層取）。
// 注意：vi.mock 會 hoist 到此之前，所以用 importActual 取真實。
vi.mock('../src/main/worktime/claude/lightList', async (importActual) => {
  const actual = await importActual<typeof import('../src/main/worktime/claude/lightList')>()
  return {
    ...actual,
    findSessionHome: vi.fn(),
  }
})

// 真實 findSessionHome（透過 importActual 取出，用於 Unit tests）
import * as lightListMocked from '../src/main/worktime/claude/lightList'

// ---------------------------------------------------------------------------
// 真實 findSessionHome 取得（繞過 vi.mock）
// ---------------------------------------------------------------------------

// 我們需要真實的 findSessionHome 跑 Unit tests；
// 直接從原始檔動態 import 不易做到，改採：在 Unit tests 裡直接 import 原始邏輯的副本。
// 方法：vi.mock 只 mock 了 src/main 路徑；Unit tests 可以直接呼叫 lightListMocked 裡被保留的 actual：
// 由於 actual 的 findSessionHome 已被 spread 並被 vi.fn() 覆蓋，
// 改以 importActual 在測試邏輯裡直接使用。

let _realFindSessionHome: (sessionId: string, baseDir?: string) => string | null

beforeAll(async () => {
  const actual = await vi.importActual<typeof import('../src/main/worktime/claude/lightList')>(
    '../src/main/worktime/claude/lightList',
  )
  _realFindSessionHome = actual.findSessionHome
})

import { beforeAll } from 'vitest'

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

import * as taskSessionsConfig from '../src/main/config/taskSessions'
import { Backend } from '../src/main/backend'
import type { BackendDeps, EmitFn } from '../src/main/backend'
import type { PunchLedger } from '../src/main/db/punchLedger'
import type { ClaudeWorktimeSource } from '../src/main/worktime/worktimeSource'
import type { PtyManager } from '../src/main/pty/ptyManager'
import { SqliteTaskRepository, ensureSchema } from '../src/main/repo/sqliteTaskRepository'
import { MONITOR_CHANNELS } from '../src/shared/ipcContracts'
import type { MonitorStatusPayload } from '../src/shared/ipcContracts'

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const _tmpDirs: string[] = []

function makeTmpDir(suffix = ''): string {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), `autofix-test-${suffix}-`))
  _tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  vi.resetAllMocks()
  for (const dir of _tmpDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
})

/**
 * 在 baseDir 的 slug 子目錄建立 uuid.jsonl，寫入指定行。
 */
function writeFixtureJsonl(baseDir: string, slug: string, uuid: string, lines: string[]): string {
  const slugDir = nodePath.join(baseDir, slug)
  fs.mkdirSync(slugDir, { recursive: true })
  const file = nodePath.join(slugDir, uuid + '.jsonl')
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf-8')
  return file
}

// ---------------------------------------------------------------------------
// Backend mock factories
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

function makeBackend(): {
  backend: Backend
  emittedEvents: Array<{ channel: string; payload: unknown }>
  repo: SqliteTaskRepository
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

  return { backend, emittedEvents, repo }
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
// Unit tests: findSessionHome（真實實作，baseDir 注入）
// ---------------------------------------------------------------------------

describe('findSessionHome — 單元（真實實作）', () => {
  // U1: 命中且首筆有 cwd（且該 cwd 仍存在）→ 回傳該 cwd
  it('U1: 子目錄含 uuid.jsonl 且首筆 record 有 cwd（存在）→ 回傳 cwd', () => {
    const baseDir = makeTmpDir('u1')
    const uuid = 'aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb'
    // cwd 須為「仍存在」的目錄才會被回傳（findSessionHome 會驗存在）。
    const projectCwd = makeTmpDir('u1-cwd')
    writeFixtureJsonl(baseDir, 'some-slug', uuid, [
      JSON.stringify({ type: 'user', cwd: projectCwd }),
    ])

    const result = _realFindSessionHome(uuid, baseDir)
    expect(result).toBe(projectCwd)
  })

  // U2: 前幾行壞 JSON / 空 cwd → 跳過，取第一個 truthy 且存在的 cwd
  it('U2: 前幾行壞 JSON / 空 cwd → 跳過，取第一個 truthy 且存在的 cwd', () => {
    const baseDir = makeTmpDir('u2')
    const uuid = 'bbbbbbbb-1111-2222-3333-cccccccccccc'
    const projectCwd = makeTmpDir('u2-cwd')
    writeFixtureJsonl(baseDir, 'some-slug', uuid, [
      'this is not json',
      JSON.stringify({ type: 'system', cwd: '' }),
      JSON.stringify({ type: 'user', cwd: '   ' }),
      JSON.stringify({ type: 'user', cwd: projectCwd }),
      JSON.stringify({ type: 'assistant', cwd: '/should-not-be-returned' }),
    ])

    const result = _realFindSessionHome(uuid, baseDir)
    expect(result).toBe(projectCwd)
  })

  // U5: cwd 指向「已刪除的資料夾」→ 不回傳（視同未命中 → null）。
  // 這是「claude --resume <uuid> → No conversation found」的根因修正：
  // 記錄的 cwd 若已被刪除（如暫存夾），resume 必失敗，故 findSessionHome 不該回傳它。
  it('U5: 命中但 cwd 指向已刪除的資料夾 → 回 null（防 resume 不存在的 session）', () => {
    const baseDir = makeTmpDir('u5')
    const uuid = 'eeeeeeee-1111-2222-3333-ffffffffffff'
    const deletedCwd = makeTmpDir('u5-deleted-cwd')
    writeFixtureJsonl(baseDir, 'some-slug', uuid, [
      JSON.stringify({ type: 'user', cwd: deletedCwd }),
    ])
    // 刪掉 cwd 資料夾（模擬暫存夾被清除）
    fs.rmSync(deletedCwd, { recursive: true, force: true })

    const result = _realFindSessionHome(uuid, baseDir)
    expect(result).toBeNull()
  })

  // U3: 任何目錄都沒有該 uuid → null
  it('U3: baseDir 下無任何子目錄含目標 uuid.jsonl → null', () => {
    const baseDir = makeTmpDir('u3')
    const targetUuid = 'cccccccc-0000-0000-0000-000000000000'
    const otherUuid = 'dddddddd-9999-9999-9999-999999999999'
    writeFixtureJsonl(baseDir, 'some-slug', otherUuid, [
      JSON.stringify({ type: 'user', cwd: '/other/project' }),
    ])

    const result = _realFindSessionHome(targetUuid, baseDir)
    expect(result).toBeNull()
  })

  // U4: baseDir 不存在 → null（不拋）
  it('U4: baseDir 不存在 → null（不拋）', () => {
    const nonExistentDir = nodePath.join(os.tmpdir(), 'autofix-nonexistent-dir-xyz-99999')
    expect(fs.existsSync(nonExistentDir)).toBe(false)

    let result: string | null = 'SENTINEL' as unknown as null
    expect(() => {
      result = _realFindSessionHome('some-uuid', nonExistentDir)
    }).not.toThrow()
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Integration tests: Backend.openSession — path-autofix via mocked findSessionHome
// ---------------------------------------------------------------------------

describe('Backend.openSession — session 專案路徑自動修復', () => {
  // I1: binding uuid + projectPath 空 + findSessionHome 回 projectCwd
  //     → SessionInfo.projectPath=projectCwd, launchCommand 含 --resume, STATUS 提示, setActiveProjectPath 回寫
  it('I1: uuid 有綁定, projectPath 空, findSessionHome 命中 → autofix: projectPath=cwd, --resume, STATUS 提示, 回寫', () => {
    const uuid = 'i1111111-aaaa-bbbb-cccc-dddddddddddd'
    // 須為「真實存在」的目錄：_resolveSessionPlan 會驗 effectivePath 存在，不存在會回退 home。
    const projectCwd = makeTmpDir('i1-cwd')

    // 控制 findSessionHome 回傳命中的 cwd
    vi.mocked(lightListMocked.findSessionHome).mockReturnValue(projectCwd)

    // taskSessions.getActive 回傳 uuid（模擬已綁定）、projectPath 空
    vi.mocked(taskSessionsConfig.getActive).mockReturnValue(uuid)
    vi.mocked(taskSessionsConfig.getActiveProjectPath).mockReturnValue(null)

    const { backend, emittedEvents } = makeBackend()
    emittedEvents.length = 0

    const info = backend.sessions.openSession({ taskId: 'task-i1', projectPath: '', tool: 'claude' })

    // 1. projectPath 改為 findSessionHome 回傳的 cwd
    expect(info.projectPath).toBe(projectCwd)

    // 2. launchCommand 含 --resume 和正確 uuid
    expect(info.launchCommand).toContain('--resume')
    expect(info.launchCommand).toContain(uuid)
    expect(info.launchCommand).not.toContain('--session-id')

    // 3. MONITOR_CHANNELS.STATUS 含「已自動修正專案路徑」
    const autofixStatus = emittedEvents.find(e =>
      e.channel === MONITOR_CHANNELS.STATUS &&
      typeof (e.payload as MonitorStatusPayload).text === 'string' &&
      (e.payload as MonitorStatusPayload).text.includes('已自動修正專案路徑'),
    )
    expect(autofixStatus).toBeTruthy()
    expect((autofixStatus!.payload as MonitorStatusPayload).text).toContain(projectCwd)

    // 4. taskSessions.setActiveProjectPath 以正確路徑回寫
    expect(taskSessionsConfig.setActiveProjectPath).toHaveBeenCalledWith('task-i1', projectCwd)
  })

  // I2: binding uuid + projectPath 空 + findSessionHome 回 null → --session-id, 不發修正提示, 不回寫
  it('I2: uuid 有綁定, projectPath 空, findSessionHome 回 null → --session-id, 不發修正提示, 不回寫', () => {
    const uuid = 'i2222222-aaaa-bbbb-cccc-dddddddddddd'

    // findSessionHome 找不到（全域反查未命中）
    vi.mocked(lightListMocked.findSessionHome).mockReturnValue(null)

    vi.mocked(taskSessionsConfig.getActive).mockReturnValue(uuid)
    vi.mocked(taskSessionsConfig.getActiveProjectPath).mockReturnValue(null)

    const { backend, emittedEvents } = makeBackend()
    emittedEvents.length = 0

    const info = backend.sessions.openSession({ taskId: 'task-i2', projectPath: '', tool: 'claude' })

    // 1. launchCommand 含 --session-id（新對話模式），不含 --resume
    expect(info.launchCommand).toContain('--session-id')
    expect(info.launchCommand).not.toContain('--resume')

    // 2. 不發「已自動修正專案路徑」提示
    const autofixStatus = emittedEvents.find(e =>
      e.channel === MONITOR_CHANNELS.STATUS &&
      typeof (e.payload as MonitorStatusPayload).text === 'string' &&
      (e.payload as MonitorStatusPayload).text.includes('已自動修正專案路徑'),
    )
    expect(autofixStatus).toBeUndefined()

    // 3. setActiveProjectPath 不被呼叫
    expect(taskSessionsConfig.setActiveProjectPath).not.toHaveBeenCalled()
  })

  // I3: projectPath 有效且 JSONL 在其 slug 下 → 原行為（--resume, projectPath 不變, 無提示, 無回寫）
  //
  // 注意：Backend 只在 foundLocally=false 時才呼叫 findSessionHome。
  // projectPath 有效且 listSessionFilesLight 找得到 uuid → foundLocally=true → findSessionHome 不被呼叫。
  // 但 listSessionFilesLight 也是被 mock 的 lightList 模組的一部分（實際模組用真實實作展開）。
  // 此測試把 findSessionHome mock 為不應被呼叫（即使呼叫了也回 null），
  // 並依賴 taskSessions.getActive 回傳 uuid + listSessionFilesLight 從真實 tmp fixture 讀到 uuid.jsonl
  // → foundLocally=true → autofix 路徑不觸發。
  it('I3: projectPath 有效且 JSONL 在 slug 下 → 原行為: --resume, projectPath 不變, 無修正提示', () => {
    const uuid = 'i3333333-aaaa-bbbb-cccc-dddddddddddd'

    // 建立真實 fixture：在 tmp 目錄下按 slug 規則放 JSONL
    const baseDir = makeTmpDir('i3-projects')
    // projectPath = baseDir/my-project（非空有效路徑）；須真實存在，否則
    // _resolveSessionPlan 會把不存在的 effectivePath 回退到 home。
    const projectPath = nodePath.join(baseDir, 'my-project')
    fs.mkdirSync(projectPath, { recursive: true })
    // slug 規則：非 A-Za-z0-9- 全轉 -
    const slug = projectPath.trim().replace(/[^A-Za-z0-9-]/g, '-')
    // 用預設 ~/.claude/projects 路徑結構模擬：直接在 baseDir 下建 slug 子目錄
    // listSessionFilesLight 走 findProjectFolder → 找 ~/.claude/projects/<slug>
    // 這裡需要真正的 claude projects 結構，但隔離困難。
    // 改策略：用 vi.mocked(lightListMocked.listSessionFilesLight) mock 為找得到 uuid
    // 這樣 foundLocally=true，不進 autofix 分支。
    // listSessionFilesLight 在 lightList mock 中已是真實實作（spread actual），
    // 需要 spyOn 覆蓋。

    // listSessionFilesLight 回傳含 uuid 的列表 → foundLocally=true
    vi.spyOn(lightListMocked, 'listSessionFilesLight').mockReturnValue([
      { session_id: uuid, file: nodePath.join(projectPath, uuid + '.jsonl'), mtimeMs: Date.now() },
    ])
    // findSessionHome 不應被呼叫（foundLocally=true 不進此分支）
    vi.mocked(lightListMocked.findSessionHome).mockReturnValue(null)

    vi.mocked(taskSessionsConfig.getActive).mockReturnValue(uuid)
    vi.mocked(taskSessionsConfig.getActiveProjectPath).mockReturnValue(null)

    const { backend, emittedEvents } = makeBackend()
    emittedEvents.length = 0

    const info = backend.sessions.openSession({ taskId: 'task-i3', projectPath, tool: 'claude' })

    // 1. projectPath 維持傳入值（無 autofix）
    expect(info.projectPath).toBe(projectPath)

    // 2. launchCommand 含 --resume（正常 resume 路徑）
    expect(info.launchCommand).toContain('--resume')
    expect(info.launchCommand).toContain(uuid)

    // 3. 不發「已自動修正專案路徑」提示
    const autofixStatus = emittedEvents.find(e =>
      e.channel === MONITOR_CHANNELS.STATUS &&
      typeof (e.payload as MonitorStatusPayload).text === 'string' &&
      (e.payload as MonitorStatusPayload).text.includes('已自動修正專案路徑'),
    )
    expect(autofixStatus).toBeUndefined()

    // 4. setActiveProjectPath 不被呼叫（非 autofix 路徑）
    expect(taskSessionsConfig.setActiveProjectPath).not.toHaveBeenCalled()

    // 5. findSessionHome 確實未被呼叫（foundLocally=true 不進 autofix 分支）
    expect(lightListMocked.findSessionHome).not.toHaveBeenCalled()
  })

  // §dup-fix（根因）：同資料夾兩任務不得解析到同一 claude session。
  // 無 active 綁定的新任務在「取最新 session」時，須跳過已被『其他任務』綁定/監測的 session，
  // 否則兩任務各自物化同一筆 worktime 打卡 → 雲端重複上傳。
  it('I4（dup-fix）：latest session 已被其他任務監測 → 解析跳過它，改取次新未被佔用的 session', () => {
    const ownedByOther = 'i4owned0-aaaa-bbbb-cccc-000000000001' // 最新，但別任務已佔
    const freeOlder = 'i4free00-aaaa-bbbb-cccc-000000000002' // 次新，未被佔
    const projectPath = nodePath.join(makeTmpDir('i4-projects'), 'shared-folder')
    fs.mkdirSync(projectPath, { recursive: true })

    // listSessionFilesLight：最新在前（owned），次新在後（free）
    vi.spyOn(lightListMocked, 'listSessionFilesLight').mockReturnValue([
      { session_id: ownedByOther, file: nodePath.join(projectPath, ownedByOther + '.jsonl'), mtimeMs: Date.now() },
      { session_id: freeOlder, file: nodePath.join(projectPath, freeOlder + '.jsonl'), mtimeMs: Date.now() - 1000 },
    ])
    vi.mocked(lightListMocked.findSessionHome).mockReturnValue(null)

    // 本任務無 active 綁定 → 走「取最新」分支
    vi.mocked(taskSessionsConfig.getActive).mockReturnValue(null)
    vi.mocked(taskSessionsConfig.getActiveProjectPath).mockReturnValue(null)
    // 最新 session 由「另一個任務」監測中 → 應被排除
    vi.mocked(taskSessionsConfig.listMonitoringTasks).mockReturnValue([
      { task_id: 'other-task', session_id: ownedByOther, project_path: projectPath },
    ])

    const { backend } = makeBackend()
    const info = backend.sessions.openSession({ taskId: 'task-i4', projectPath, tool: 'claude' })

    // 解析到次新（free），而非被別任務佔用的最新
    expect(info.claudeSessionId).toBe(freeOlder)
    expect(info.claudeSessionId).not.toBe(ownedByOther)
    expect(info.launchCommand).toContain(freeOlder)
    expect(info.launchCommand).not.toContain(ownedByOther)
  })

  // §dup-fix（根因，邊界）：資料夾僅有的 session 已被別任務佔用 → 解析不到可用 latest →
  // 退回「開新對話」（產生全新 uuid，非沿用別任務的 session）。
  it('I5（dup-fix）：唯一 session 已被別任務佔用 → 不沿用，改開新 session（新 uuid）', () => {
    const ownedByOther = 'i5owned0-aaaa-bbbb-cccc-000000000001'
    const projectPath = nodePath.join(makeTmpDir('i5-projects'), 'shared-folder')
    fs.mkdirSync(projectPath, { recursive: true })

    vi.spyOn(lightListMocked, 'listSessionFilesLight').mockReturnValue([
      { session_id: ownedByOther, file: nodePath.join(projectPath, ownedByOther + '.jsonl'), mtimeMs: Date.now() },
    ])
    vi.mocked(lightListMocked.findSessionHome).mockReturnValue(null)
    vi.mocked(taskSessionsConfig.getActive).mockReturnValue(null)
    vi.mocked(taskSessionsConfig.getActiveProjectPath).mockReturnValue(null)
    vi.mocked(taskSessionsConfig.listMonitoringTasks).mockReturnValue([
      { task_id: 'other-task', session_id: ownedByOther, project_path: projectPath },
    ])

    const { backend } = makeBackend()
    const info = backend.sessions.openSession({ taskId: 'task-i5', projectPath, tool: 'claude' })

    // 沒沿用別任務的 session；改開新 session（新 uuid）
    expect(info.claudeSessionId).not.toBe(ownedByOther)
    expect(info.claudeSessionId).toBeTruthy()
    expect(info.launchCommand).not.toContain(ownedByOther)
  })

  // §local-project fix（根因）：本地專案任務的資料夾綁在 project_folders（task.project_local_id），
  // milestone / task_sessions 都查不到。openSession 須由此反查補上 projectPath，
  // 否則從看板開啟時 projectPath="" → 對話檔解析失敗 → 對話欄全空、監測不啟動。
  it('I6（local-project fix）：projectPath 空 + 任務綁定本地專案資料夾 → 由 project_folders 反查補上 projectPath', () => {
    const folder = nodePath.join(makeTmpDir('i6-local'), 'my-local-project')
    fs.mkdirSync(folder, { recursive: true })
    const projectLocalId = 'proj-local-i6'

    // 真實 repo：建 project↔folder 關聯 + 建帶 project_local_id 的本地任務
    const { backend, repo } = makeBackend()
    repo.linkProjectFolder(projectLocalId, folder)
    const task = repo.createTask({ name: '本地專案任務 I6', projectLocalId })

    // 無任何 session 既存於該資料夾 → 走「開新對話」分支（claudeSessionId 為新 uuid）
    vi.spyOn(lightListMocked, 'listSessionFilesLight').mockReturnValue([])
    vi.mocked(lightListMocked.findSessionHome).mockReturnValue(null)
    // milestone / task_sessions 都無路徑（模擬看板雙擊本地專案任務）
    vi.mocked(taskSessionsConfig.getActive).mockReturnValue(null)
    vi.mocked(taskSessionsConfig.getActiveProjectPath).mockReturnValue(null)

    // 完全不傳 projectPath（對齊 handleCardDoubleClick：openSession(taskId, name, milestoneId)）
    const info = backend.sessions.openSession({ taskId: task.local_id, tool: 'claude' })

    // 關鍵：projectPath 由 project_folders 反查補上（不再是空字串）
    expect(info.projectPath).toBe(folder)
  })

  // §local-project fix（邊界）：任務無 project_local_id（純獨立任務）→ 反查回 null，
  // projectPath 維持空 → 退回原本行為（不誤抓任何資料夾）。
  it('I7（local-project fix 邊界）：任務無 project_local_id → 反查不命中, projectPath 維持空', () => {
    const { backend, repo } = makeBackend()
    const task = repo.createTask({ name: '無專案綁定任務 I7' }) // 不帶 projectLocalId

    vi.spyOn(lightListMocked, 'listSessionFilesLight').mockReturnValue([])
    vi.mocked(lightListMocked.findSessionHome).mockReturnValue(null)
    vi.mocked(taskSessionsConfig.getActive).mockReturnValue(null)
    vi.mocked(taskSessionsConfig.getActiveProjectPath).mockReturnValue(null)

    const info = backend.sessions.openSession({ taskId: task.local_id, tool: 'claude' })

    // 無綁定資料夾可反查 → projectPath 維持空（不誤抓）
    expect(info.projectPath).toBe('')
  })

  // §deleted-folder fix（根因）：綁定的工作資料夾被刪除（如暫存夾）→ effectivePath 指向不存在
  // 路徑會讓 PTY cwd 回退 home、但對話讀取/監測仍看舊路徑 → 對話框空白、監測掃不到。
  // 修法：effectivePath 不存在時統一回退 home，三者對齊；pathAutofixed 觸發回寫 + 提示。
  it('I8（deleted-folder fix）：綁定資料夾已刪除 → effectivePath 回退 home, --session-id, 回寫, 提示', () => {
    const uuid = 'i8888888-aaaa-bbbb-cccc-dddddddddddd'
    const deletedFolder = nodePath.join(os.tmpdir(), 'autofix-i8-deleted-does-not-exist-xyz')
    expect(fs.existsSync(deletedFolder)).toBe(false)

    // 任務綁定該（已刪除）資料夾 + active uuid；磁碟找不到、findSessionHome 也找不到。
    vi.mocked(taskSessionsConfig.getActive).mockReturnValue(uuid)
    vi.mocked(taskSessionsConfig.getActiveProjectPath).mockReturnValue(deletedFolder)
    vi.spyOn(lightListMocked, 'listSessionFilesLight').mockReturnValue([])
    vi.mocked(lightListMocked.findSessionHome).mockReturnValue(null)

    const { backend, emittedEvents } = makeBackend()
    emittedEvents.length = 0

    const info = backend.sessions.openSession({ taskId: 'task-i8', projectPath: deletedFolder, tool: 'claude' })

    // 1. effectivePath 回退到 home（三子系統對齊）
    expect(info.projectPath).toBe(os.homedir())
    // 2. 新對話模式（不 resume 已不存在處的 session）
    expect(info.launchCommand).toContain('--session-id')
    expect(info.launchCommand).not.toContain('--resume')
    // 3. 回寫 task_sessions 為 home
    expect(taskSessionsConfig.setActiveProjectPath).toHaveBeenCalledWith('task-i8', os.homedir())
    // 4. 發「已自動修正專案路徑」提示
    const autofixStatus = emittedEvents.find(e =>
      e.channel === MONITOR_CHANNELS.STATUS &&
      typeof (e.payload as MonitorStatusPayload).text === 'string' &&
      (e.payload as MonitorStatusPayload).text.includes('已自動修正專案路徑'),
    )
    expect(autofixStatus).toBeTruthy()
  })

  // §forceNew（開始團隊對話）：即使有 active 綁定 + 資料夾有舊 session（正常會 resume），
  // forceNewSession=true 也一律略過、開一條全新 session，讓 /tuq-agent <任務> 注入乾淨對話。
  it('I9（forceNew）：forceNewSession=true → 不沿用 active/資料夾舊 session, 開全新 --session-id', () => {
    const activeUuid = 'i9active0-aaaa-bbbb-cccc-000000000001'
    const folderUuid = 'i9folder0-aaaa-bbbb-cccc-000000000002'
    const projectPath = makeTmpDir('i9-folder') // 真實存在，避免 effectivePath 回退干擾

    // 有 active 綁定 + 資料夾有舊 session（非 forceNew 時會 resume）→ forceNew 應全部略過。
    vi.mocked(taskSessionsConfig.getActive).mockReturnValue(activeUuid)
    vi.mocked(taskSessionsConfig.getActiveProjectPath).mockReturnValue(projectPath)
    vi.spyOn(lightListMocked, 'listSessionFilesLight').mockReturnValue([
      { session_id: folderUuid, file: nodePath.join(projectPath, folderUuid + '.jsonl'), mtimeMs: Date.now() },
    ])
    vi.mocked(lightListMocked.findSessionHome).mockReturnValue(null)

    const { backend } = makeBackend()
    const info = backend.sessions.openSession({
      taskId: 'task-i9',
      projectPath,
      tool: 'claude',
      forceNewSession: true,
    })

    // 全新 uuid（非 active、非資料夾舊 session）
    expect(info.claudeSessionId).not.toBe(activeUuid)
    expect(info.claudeSessionId).not.toBe(folderUuid)
    expect(info.claudeSessionId).toBeTruthy()
    // 新對話模式（--session-id <新 uuid>，非 --resume）
    expect(info.launchCommand).toContain('--session-id')
    expect(info.launchCommand).not.toContain('--resume')
    expect(info.launchCommand).toContain(info.claudeSessionId as string)
    // projectPath 維持選定的有效資料夾（未被 effectivePath 回退）
    expect(info.projectPath).toBe(projectPath)
  })
})
