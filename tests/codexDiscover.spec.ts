/**
 * codexDiscover.spec.ts — listCodexRollouts / findCodexRollout 單元測試。
 *
 * 涵蓋（= 批次 2 驗收）：
 *  - 在 tmp 目錄造 <base>/2026/06/09/rollout-*.jsonl（第一行 session_meta）→
 *    listCodexRollouts 正確解析 meta（id/cwd/startedAtMs）並依 mtime 新→舊排序。
 *  - findCodexRollout：cwd 正規化相等（含 Windows `C:\X` vs `c:/x/` 大小寫 + 斜線）→ 命中；
 *    cwd 不符 → null；startedAt/mtime < sinceMs → 排除；同 cwd 多檔 → 取 startedAt 最大。
 *  - 容錯：第一行非 session_meta / 壞 JSON / 檔不存在 → 略過回 []/null（不丟例外）。
 *
 * 隔離：每 test 建獨立 tmp base，afterEach 清除；CODEX_SESSIONS_ROOT 不被觸碰（全用 baseDir 注入）。
 */

import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  CODEX_SESSIONS_ROOT,
  listCodexRollouts,
  findCodexRollout,
  findCodexRolloutInWindow,
} from '../src/main/worktime/codex/discover'

const tmpDirs: string[] = []

function mkBase(): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-discover-'))
  tmpDirs.push(base)
  return base
}

/** 在 <base>/<Y>/<M>/<D>/ 造一個 rollout 檔，第一行為 session_meta（除非 firstLineRaw 覆蓋）。 */
function writeRollout(
  base: string,
  opts: {
    y?: string
    m?: string
    d?: string
    name?: string
    id?: string
    cwd?: string
    innerTs?: string | null // session_meta.payload.timestamp
    extraLines?: string[]
    firstLineRaw?: string // 直接覆蓋第一行內容（測壞檔 / 非 session_meta）
    mtimeMs?: number // 顯式設 mtime（測排序 / sinceMs）
  } = {},
): string {
  const y = opts.y ?? '2026'
  const m = opts.m ?? '06'
  const d = opts.d ?? '09'
  const dir = path.join(base, y, m, d)
  fs.mkdirSync(dir, { recursive: true })
  const name = opts.name ?? `rollout-${y}-${m}-${d}T10-00-00-${opts.id ?? 'id'}.jsonl`
  const file = path.join(dir, name)

  let firstLine: string
  if (opts.firstLineRaw !== undefined) {
    firstLine = opts.firstLineRaw
  } else {
    const payload: Record<string, unknown> = {
      id: opts.id ?? 'sess-1',
      cwd: opts.cwd ?? 'C:\\proj',
    }
    if (opts.innerTs !== null) payload['timestamp'] = opts.innerTs ?? '2026-06-09T10:00:00.000Z'
    firstLine = JSON.stringify({ timestamp: '2026-06-09T10:00:01.000Z', type: 'session_meta', payload })
  }
  const lines = [firstLine, ...(opts.extraLines ?? [])]
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf-8')

  if (opts.mtimeMs !== undefined) {
    const t = opts.mtimeMs / 1000
    fs.utimesSync(file, t, t)
  }
  return file
}

afterEach(() => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop()!
    try {
      fs.rmSync(d, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
})

describe('CODEX_SESSIONS_ROOT', () => {
  it('指向 ~/.codex/sessions', () => {
    expect(CODEX_SESSIONS_ROOT).toBe(path.join(os.homedir(), '.codex', 'sessions'))
  })
})

describe('listCodexRollouts', () => {
  it('解析 session_meta 的 id/cwd/startedAtMs；依 mtime 新→舊排序', () => {
    const base = mkBase()
    writeRollout(base, {
      id: 'old',
      cwd: 'C:\\a',
      innerTs: '2026-06-09T08:00:00.000Z',
      mtimeMs: 1000,
    })
    writeRollout(base, {
      id: 'new',
      cwd: 'C:\\b',
      innerTs: '2026-06-09T09:00:00.000Z',
      mtimeMs: 5000,
    })
    const list = listCodexRollouts(base)
    expect(list).toHaveLength(2)
    // 新→舊：mtime 5000 在前
    expect(list[0].id).toBe('new')
    expect(list[1].id).toBe('old')
    expect(list[0].cwd).toBe('C:\\b')
    expect(list[0].mtimeMs).toBe(5000)
    expect(list[0].startedAtMs).toBe(Date.parse('2026-06-09T09:00:00.000Z'))
    expect(list[1].startedAtMs).toBe(Date.parse('2026-06-09T08:00:00.000Z'))
  })

  it('session_meta 缺內層 timestamp → startedAtMs fallback 用檔 mtimeMs', () => {
    const base = mkBase()
    writeRollout(base, { id: 'noinner', cwd: 'C:\\a', innerTs: null, mtimeMs: 7777 })
    const list = listCodexRollouts(base)
    expect(list).toHaveLength(1)
    expect(list[0].startedAtMs).toBe(7777)
  })

  it('容錯：第一行非 session_meta / 壞 JSON / 非 rollout 前綴 → 略過', () => {
    const base = mkBase()
    writeRollout(base, { id: 'good', cwd: 'C:\\a' })
    // 第一行是別的 type
    writeRollout(base, {
      name: 'rollout-bad-type.jsonl',
      firstLineRaw: JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } }),
    })
    // 壞 JSON
    writeRollout(base, { name: 'rollout-bad-json.jsonl', firstLineRaw: '{not valid json' })
    // 非 rollout- 前綴（不該被掃到）
    const dir = path.join(base, '2026', '06', '09')
    fs.writeFileSync(path.join(dir, 'other.jsonl'), JSON.stringify({ type: 'session_meta', payload: { id: 'x', cwd: 'C:\\z' } }) + '\n')
    const list = listCodexRollouts(base)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('good')
  })

  it('base 不存在 → []（不丟）', () => {
    expect(listCodexRollouts(path.join(os.tmpdir(), 'codex-nonexistent-xyz-123'))).toEqual([])
  })

  it('第一行 base_instructions 超過初始視窗仍能讀到換行（擴讀）', () => {
    const base = mkBase()
    // 造一個 > 64KB 的第一行（base_instructions 灌大）
    const big = 'x'.repeat(80 * 1024)
    const firstLine = JSON.stringify({
      timestamp: '2026-06-09T10:00:01.000Z',
      type: 'session_meta',
      payload: { id: 'bigmeta', cwd: 'C:\\big', timestamp: '2026-06-09T10:00:00.000Z', base_instructions: big },
    })
    writeRollout(base, { name: 'rollout-big.jsonl', firstLineRaw: firstLine, extraLines: ['{"type":"event_msg"}'] })
    const list = listCodexRollouts(base)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('bigmeta')
    expect(list[0].cwd).toBe('C:\\big')
  })
})

describe('findCodexRollout', () => {
  it('cwd 正規化相等（C:\\X vs c:/x/ 大小寫 + 斜線 + 尾斜線）→ 命中', () => {
    const base = mkBase()
    const file = writeRollout(base, { id: 's1', cwd: 'C:\\Users\\david\\Proj', mtimeMs: 5000 })
    // projectPath 用不同大小寫 + 正斜線 + 尾斜線
    const hit = findCodexRollout('c:/users/david/proj/', 0, base)
    expect(hit).toBe(file)
  })

  it('cwd 不符 → null', () => {
    const base = mkBase()
    writeRollout(base, { id: 's1', cwd: 'C:\\proj-a', mtimeMs: 5000 })
    expect(findCodexRollout('C:\\proj-b', 0, base)).toBeNull()
  })

  it('startedAt 與 mtime 皆 < sinceMs → 排除', () => {
    const base = mkBase()
    writeRollout(base, {
      id: 'old',
      cwd: 'C:\\proj',
      innerTs: '2026-06-09T08:00:00.000Z', // startedAt 早
      mtimeMs: 1000, // mtime 早
    })
    // sinceMs 設在兩者之後 → 排除
    expect(findCodexRollout('C:\\proj', 9_999_999_999_999, base)).toBeNull()
  })

  it('mtime ≥ sinceMs（即使 startedAt < sinceMs）→ 仍命中', () => {
    const base = mkBase()
    const startedMs = Date.parse('2026-06-09T08:00:00.000Z')
    const file = writeRollout(base, {
      id: 's1',
      cwd: 'C:\\proj',
      innerTs: '2026-06-09T08:00:00.000Z',
      mtimeMs: startedMs + 100_000, // mtime 比 startedAt 晚
    })
    // sinceMs 介於 startedAt 與 mtime 之間 → mtime 下界命中
    const hit = findCodexRollout('C:\\proj', startedMs + 50_000, base)
    expect(hit).toBe(file)
  })

  it('同 cwd 多檔 → 取 startedAtMs 最大者', () => {
    const base = mkBase()
    writeRollout(base, {
      id: 'earlier',
      cwd: 'C:\\proj',
      innerTs: '2026-06-09T08:00:00.000Z',
      mtimeMs: 9000, // mtime 較新，但 startedAt 較早
    })
    const later = writeRollout(base, {
      id: 'later',
      cwd: 'C:\\proj',
      innerTs: '2026-06-09T10:00:00.000Z',
      mtimeMs: 1000, // mtime 較舊，但 startedAt 最新
    })
    const hit = findCodexRollout('C:\\proj', 0, base)
    // 取 startedAtMs 最大（later），與 mtime 排序無關
    expect(hit).toBe(later)
  })

  it('同 cwd 並行 session 可用 beforeMs 上界隔離，不抓到較晚 rollout', () => {
    const base = mkBase()
    const first = writeRollout(base, {
      id: 'first',
      cwd: 'C:\\proj',
      innerTs: '2026-06-09T08:00:00.000Z',
      mtimeMs: Date.parse('2026-06-09T08:00:10.000Z'),
    })
    writeRollout(base, {
      id: 'second',
      cwd: 'C:\\proj',
      innerTs: '2026-06-09T08:05:00.000Z',
      mtimeMs: Date.parse('2026-06-09T08:05:10.000Z'),
    })

    const hit = findCodexRolloutInWindow(
      'C:\\proj',
      Date.parse('2026-06-09T07:59:59.000Z'),
      Date.parse('2026-06-09T08:05:00.000Z'),
      undefined,
      base,
    )

    expect(hit).toBe(first)
  })

  it('projectPath 空 → null', () => {
    const base = mkBase()
    writeRollout(base, { id: 's1', cwd: 'C:\\proj' })
    expect(findCodexRollout('', 0, base)).toBeNull()
  })

  it('base 無任何 rollout → null（不丟）', () => {
    const base = mkBase()
    expect(findCodexRollout('C:\\proj', 0, base)).toBeNull()
  })
})
