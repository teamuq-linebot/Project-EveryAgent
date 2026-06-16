/**
 * config.spec.ts — milestones.ts / taskSessions.ts 行為測試（DB-backed）。
 *
 * Phase 4.0 / G6 換源後：milestones / taskSessions 改讀寫 teamuq.db 的 milestone_bindings /
 * session_bindings 表（不再讀 ~/.teamuq/*.json）。本測試以臨時 TEAMUQ_HOME 隔離，驗證：
 *   - milestones: get/setEntry 基本讀寫、整筆覆寫語意（沒帶的欄位變預設）、空 DB → 預設
 *   - taskSessions: setActive/getActive、history upsert、active 旗標、monitoring、空 DB → {}
 *
 * 每個 test 使用獨立 tmp TEAMUQ_HOME 做隔離（openTeamuqDb 吃 TEAMUQ_HOME）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

// ---------------------------------------------------------------------------
// HOME 隔離工具
// ---------------------------------------------------------------------------

let tmpHome: string
let origHome: string
let origUserProfile: string
let origTeamuqHome: string | undefined

function setTmpHome(dir: string): void {
  process.env['HOME'] = dir
  process.env['USERPROFILE'] = dir
  // os.homedir() 在 Windows 不吃 USERPROFILE 覆寫（會回真實家目錄→誤寫使用者真實
  // ~/.teamuq）。故 teamuqDbPath() 認 TEAMUQ_HOME 環境變數，測試在此明確設定隔離。
  process.env['TEAMUQ_HOME'] = dir
}

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tuq-test-'))
  origHome = process.env['HOME'] ?? ''
  origUserProfile = process.env['USERPROFILE'] ?? ''
  origTeamuqHome = process.env['TEAMUQ_HOME']
  setTmpHome(tmpHome)
})

afterEach(() => {
  process.env['HOME'] = origHome
  process.env['USERPROFILE'] = origUserProfile
  if (origTeamuqHome === undefined) delete process.env['TEAMUQ_HOME']
  else process.env['TEAMUQ_HOME'] = origTeamuqHome
  fs.rmSync(tmpHome, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// milestones（DB-backed：milestone_bindings 表）
// ---------------------------------------------------------------------------

describe('milestones', async () => {
  async function importMilestones() {
    const mod = await import('../src/main/config/milestones')
    return mod
  }

  it('get() 回 null 當不存在（空 DB）', async () => {
    const { get } = await importMilestones()
    expect(get('nonexistent')).toBeNull()
  })

  it('load() 回空當無任何綁定（空 DB）', async () => {
    const { load } = await importMilestones()
    const data = load()
    expect(data.version).toBe(1)
    expect(data.milestones).toEqual({})
  })

  it('setEntry + get 基本讀寫', async () => {
    const { setEntry, get } = await importMilestones()
    const entry = setEntry('milestone-1', {
      project_path: '/some/path',
      tool: 'claude',
      custom_command: null,
    })
    expect(entry.project_path).toBe('/some/path')
    expect(entry.tool).toBe('claude')
    expect(entry.custom_command).toBeNull()

    const got = get('milestone-1')
    expect(got).not.toBeNull()
    expect(got!.project_path).toBe('/some/path')
    expect(got!.tool).toBe('claude')
  })

  it('setEntry 整筆覆寫語意：set 後沒帶的欄位變預設（null）', async () => {
    const { setEntry, get } = await importMilestones()

    // 先寫完整一筆
    setEntry('ms-2', {
      project_path: '/initial/path',
      tool: 'custom',
      custom_command: 'my-cmd',
    })

    // 用不帶 custom_command 的參數覆寫 → custom_command 應為 null（預設值）
    setEntry('ms-2', {
      project_path: '/new/path',
      tool: 'claude',
      // custom_command 未帶 → 預設 null
    })

    const got = get('ms-2')
    expect(got).not.toBeNull()
    expect(got!.project_path).toBe('/new/path')
    expect(got!.tool).toBe('claude')
    // 整筆覆寫：custom_command 應變預設 null，不保留舊值
    expect(got!.custom_command).toBeNull()
  })

  it('setEntry 覆寫不影響其他 milestone', async () => {
    const { setEntry, get } = await importMilestones()
    setEntry('ms-a', { project_path: '/path/a', tool: 'claude' })
    setEntry('ms-b', { project_path: '/path/b', tool: 'vscode' })
    setEntry('ms-a', { project_path: '/path/a-updated', tool: 'codex' })

    const a = get('ms-a')
    const b = get('ms-b')
    expect(a!.project_path).toBe('/path/a-updated')
    expect(a!.tool).toBe('codex')
    expect(b!.project_path).toBe('/path/b')
    expect(b!.tool).toBe('vscode')
  })

  it('load() 列出已寫入的全部綁定', async () => {
    const { setEntry, load } = await importMilestones()
    setEntry('ms-3', { project_path: '/test', tool: 'claude' })
    const data = load()
    expect(data.version).toBe(1)
    expect(data.milestones['ms-3'].project_path).toBe('/test')
  })
})

// ---------------------------------------------------------------------------
// taskSessions（DB-backed：session_bindings 表）
// ---------------------------------------------------------------------------

describe('taskSessions', async () => {
  async function importTaskSessions() {
    const mod = await import('../src/main/config/taskSessions')
    return mod
  }

  it('getActive() 回 null 當任務不存在（空 DB）', async () => {
    const { getActive } = await importTaskSessions()
    expect(getActive('task-nonexistent')).toBeNull()
  })

  it('load() 回 {} 當無任何綁定（空 DB）', async () => {
    const { load } = await importTaskSessions()
    expect(load()).toEqual({})
  })

  it('setActive + getActive 基本讀寫', async () => {
    const { setActive, getActive } = await importTaskSessions()
    setActive('task-1', 'session-abc', {
      source: 'claude',
      project_path: '/some/project',
    })
    const active = getActive('task-1')
    expect(active).toBe('session-abc')
  })

  it('setActive 寫入 project_path → getActiveProjectPath 帶回', async () => {
    const { setActive, getActiveProjectPath } = await importTaskSessions()
    setActive('task-pp', 'session-pp', {
      source: 'claude',
      project_path: '/proj/path',
    })
    expect(getActiveProjectPath('task-pp')).toBe('/proj/path')
  })

  it('setActive 把 session upsert 進 history', async () => {
    const { setActive, getEntry } = await importTaskSessions()
    setActive('task-2', 'session-xyz', {
      source: 'claude',
      project_path: '/proj',
      label: 'first binding',
    })
    const entry = getEntry('task-2')
    expect(entry).not.toBeNull()
    expect(entry!.history).toHaveLength(1)
    expect(entry!.history[0].session_id).toBe('session-xyz')
    expect(entry!.history[0].source).toBe('claude')
    expect(entry!.history[0].project_path).toBe('/proj')
    expect(entry!.history[0].label).toBe('first binding')
  })

  it('setActive 再次呼叫同 session_id → 更新 last_bound_at，不新增 history 項', async () => {
    const { setActive, getEntry } = await importTaskSessions()
    setActive('task-3', 'session-dup', { now_iso: '2026-01-01T00:00:00.000Z' })
    setActive('task-3', 'session-dup', { now_iso: '2026-01-02T00:00:00.000Z' })
    const entry = getEntry('task-3')
    expect(entry!.history).toHaveLength(1)
    expect(entry!.history[0].last_bound_at).toBe('2026-01-02T00:00:00.000Z')
    expect(entry!.history[0].first_bound_at).toBe('2026-01-01T00:00:00.000Z')
  })

  it('setActive 換綁不同 session → active 切換，舊列保留於 history', async () => {
    const { setActive, getActive, getEntry } = await importTaskSessions()
    setActive('task-rb', 'sess-A', { project_path: '/a' })
    setActive('task-rb', 'sess-B', { project_path: '/b' })
    expect(getActive('task-rb')).toBe('sess-B')
    const entry = getEntry('task-rb')
    expect(entry!.history).toHaveLength(2)
    expect(entry!.active).toBe('sess-B')
  })

  it('clearActive → active 變 null，history 保留', async () => {
    const { setActive, clearActive, getEntry } = await importTaskSessions()
    setActive('task-4', 'session-clr')
    clearActive('task-4')
    const entry = getEntry('task-4')
    expect(entry!.active).toBeNull()
    expect(entry!.history).toHaveLength(1)
  })

  it('setMonitoring / isMonitoring / listMonitoringTasks', async () => {
    const { setActive, setMonitoring, isMonitoring, listMonitoringTasks } =
      await importTaskSessions()
    setActive('task-mon', 'sess-mon', { project_path: '/mon' })
    expect(isMonitoring('task-mon')).toBe(false)

    const on = setMonitoring('task-mon', true)
    expect(on).toBe(true)
    expect(isMonitoring('task-mon')).toBe(true)

    const list = listMonitoringTasks()
    expect(list).toHaveLength(1)
    expect(list[0].task_id).toBe('task-mon')
    expect(list[0].session_id).toBe('sess-mon')
    expect(list[0].project_path).toBe('/mon')

    setMonitoring('task-mon', false)
    expect(isMonitoring('task-mon')).toBe(false)
    expect(listMonitoringTasks()).toHaveLength(0)
  })

  it('monitoring 旗標跨換綁保留（換綁不關監測）', async () => {
    const { setActive, setMonitoring, isMonitoring } = await importTaskSessions()
    setActive('task-mk', 'sess-1')
    setMonitoring('task-mk', true)
    expect(isMonitoring('task-mk')).toBe(true)
    // 換綁到新 session：監測旗標應搬到新 active 列
    setActive('task-mk', 'sess-2')
    expect(isMonitoring('task-mk')).toBe(true)
  })
})
