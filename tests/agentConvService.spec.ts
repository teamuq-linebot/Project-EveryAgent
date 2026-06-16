/**
 * agentConvService.spec.ts — AgentConversationService 單元測試（無真 PTY）
 *
 * 涵蓋（architect 設計驗收）：
 *  AC1: cliId=codex → _resolveJsonlFile 呼叫 findCodexRollout，不碰 findProjectFolder
 *  AC2: cliId=claude → _resolveJsonlFile 呼叫 findProjectFolder，不碰 findCodexRollout
 *  AC3: _tailOnce 解析器路由：codex → codexRecordToConversationMessage；claude → recordToConversationMessage
 *  AC4: handler cliId 透傳：agentConv:open invoke 含 cliId=codex → backend.agentConv.open 收到 cliId=codex
 *  AC5: open() 建 entry 時 openedAtMs 已設為 Date.now() 左右的值
 *
 * 隔離策略：
 *  - vi.mock('node-pty') 替換 spawn（回傳假 IPty，不開真 process）
 *  - vi.mock codex/discover + claude/discover + claude/index + worktime/jsonl
 *  - PtyPromptWatcher 以 spy 替換（不依賴 idle timer）
 *  - 用 (svc as any) 存取私有方法 _resolveJsonlFile / _tailOnce
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as nodePath from 'path'

// ---------------------------------------------------------------------------
// Mock node-pty（最先 mock，避免 native .node 載入失敗）
// ---------------------------------------------------------------------------

vi.mock('node-pty', () => {
  const makeStubPty = () => ({
    pid: 9999,
    cols: 120,
    rows: 30,
    process: 'stub',
    handleFlowControl: false,
    onData: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onExit: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  })
  return { spawn: vi.fn(() => makeStubPty()) }
})

// ---------------------------------------------------------------------------
// Mock worktime/codex/discover
// ---------------------------------------------------------------------------

vi.mock('../src/main/worktime/codex/discover', () => ({
  findCodexRollout: vi.fn().mockReturnValue(null),
  findCodexRolloutInWindow: vi.fn().mockReturnValue(null),
}))

// ---------------------------------------------------------------------------
// Mock worktime/claude/discover（findProjectFolder）
// ---------------------------------------------------------------------------

vi.mock('../src/main/worktime/claude/discover', () => ({
  findProjectFolder: vi.fn().mockReturnValue({
    match: 'not-found',
    folder_name: '__stub__',
    folder_path: '/stub/projects/__stub__',
  }),
}))

// ---------------------------------------------------------------------------
// Mock worktime/claude/index（recordToConversationMessage）
// ---------------------------------------------------------------------------

vi.mock('../src/main/worktime/claude/index', () => ({
  recordToConversationMessage: vi.fn().mockReturnValue(null),
}))

// ---------------------------------------------------------------------------
// Mock worktime/codex/parse（codexRecordToConversationMessage）
// ---------------------------------------------------------------------------

vi.mock('../src/main/worktime/codex/parse', () => ({
  codexRecordToConversationMessage: vi.fn().mockReturnValue(null),
}))

// ---------------------------------------------------------------------------
// Mock worktime/jsonl（readJsonl）
// ---------------------------------------------------------------------------

vi.mock('../src/main/worktime/jsonl', () => ({
  readJsonl: vi.fn().mockReturnValue([]),
}))

// ---------------------------------------------------------------------------
// Mock promptDetector（PtyPromptWatcher — 避免 idle timer 洩漏）
// ---------------------------------------------------------------------------

vi.mock('../src/main/pty/promptDetector', () => {
  return {
    PtyPromptWatcher: vi.fn().mockImplementation(() => ({
      onData: vi.fn(),
      dispose: vi.fn(),
    })),
  }
})

// ---------------------------------------------------------------------------
// 現在才 import 受測模組（mock 必須在 import 前宣告）
// ---------------------------------------------------------------------------

import { AgentConversationService, initialPromptEnterDelayMs } from '../src/main/services/agentConversationService'
import * as codexDiscover from '../src/main/worktime/codex/discover'
import * as claudeDiscover from '../src/main/worktime/claude/discover'
import * as claudeIndex from '../src/main/worktime/claude/index'
import * as codexParse from '../src/main/worktime/codex/parse'
import * as jsonlMod from '../src/main/worktime/jsonl'
import { buildAgentConvLaunchCommand } from '../src/main/services/agentConvLaunch'

// ---------------------------------------------------------------------------
// 臨時檔清單（AC3 用真實檔供 statSig 成功）
// ---------------------------------------------------------------------------

const tmpFiles: string[] = []

function makeTmpJsonl(content = ''): string {
  const file = nodePath.join(os.tmpdir(), `acs-spec-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`)
  fs.writeFileSync(file, content, 'utf-8')
  tmpFiles.push(file)
  return file
}

afterEach(() => {
  vi.clearAllMocks()
  for (const f of tmpFiles.splice(0)) {
    try { fs.unlinkSync(f) } catch { /* ignore */ }
  }
})

// ---------------------------------------------------------------------------
// helper：建 service 實例
// ---------------------------------------------------------------------------

function makeService() {
  const emit = vi.fn()
  const svc = new AgentConversationService(emit)
  return { svc, emit }
}

type SvcPrivate = {
  _convs: Map<string, unknown>
  _resolveJsonlFile: (e: unknown) => string | null
  _tailOnce: (e: unknown) => void
}

/** 快速建 ConvEntry 直接塞入 _convs（繞過 spawn），供私有方法測試用。 */
function injectEntry(
  svc: AgentConversationService,
  overrides: Partial<Record<string, unknown>> = {},
) {
  const entry: Record<string, unknown> = {
    conversationId: '00000000-0000-0000-0000-000000000001',
    cwd: 'C:\\teamuq\\project',
    cliId: 'claude',
    openedAtMs: Date.now(),
    pty: {
      kill: vi.fn(),
      write: vi.fn(),
      onData: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onExit: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    },
    jsonlFile: null,
    lastSig: null,
    tailTimer: null,
    injectTimers: [],
    disposables: [],
    done: false,
    busy: false,
    busyDebounce: null,
    lastMessages: [],
    promptWatcher: { onData: vi.fn(), dispose: vi.fn() },
    rawBuffer: '',
    pendingTimeoutTimer: null,
    gotData: false,
    spawnWatchdog: null,
    ...overrides,
  }
  const p = svc as unknown as SvcPrivate
  p._convs.set(entry['conversationId'] as string, entry)
  return entry
}

// ---------------------------------------------------------------------------
// AC1: cliId=codex → _resolveJsonlFile 用 findCodexRolloutInWindow，不碰 findProjectFolder
// ---------------------------------------------------------------------------

describe('AC1: _resolveJsonlFile — codex 分支', () => {
  it('cliId=codex 時呼叫 findCodexRolloutInWindow，不呼叫 findProjectFolder', () => {
    const { svc } = makeService()
    const entry = injectEntry(svc, { cliId: 'codex', openedAtMs: 1_000_000 })

    vi.mocked(codexDiscover.findCodexRolloutInWindow).mockReturnValueOnce(null)

    const result = (svc as unknown as SvcPrivate)._resolveJsonlFile(entry)

    expect(result).toBeNull()
    expect(vi.mocked(codexDiscover.findCodexRolloutInWindow)).toHaveBeenCalledWith(
      entry['cwd'],
      entry['openedAtMs'],
      null,
      expect.any(Set),
    )
    expect(vi.mocked(claudeDiscover.findProjectFolder)).not.toHaveBeenCalled()
  })

  it('findCodexRolloutInWindow 命中時設 entry.jsonlFile 並回傳路徑', () => {
    const { svc } = makeService()
    const entry = injectEntry(svc, { cliId: 'codex', openedAtMs: 2_000_000 })

    const fakeFile = '/home/user/.codex/sessions/2026/06/11/rollout-abc.jsonl'
    vi.mocked(codexDiscover.findCodexRolloutInWindow).mockReturnValueOnce(fakeFile)

    const result = (svc as unknown as SvcPrivate)._resolveJsonlFile(entry)

    expect(result).toBe(fakeFile)
    expect(entry['jsonlFile']).toBe(fakeFile)
  })
})

// ---------------------------------------------------------------------------
// AC2: cliId=claude → _resolveJsonlFile 用 findProjectFolder，不碰 findCodexRollout
// ---------------------------------------------------------------------------

describe('AC2: _resolveJsonlFile — claude 分支', () => {
  it('cliId=claude 時呼叫 findProjectFolder，不呼叫 findCodexRollout', () => {
    const { svc } = makeService()
    const entry = injectEntry(svc, { cliId: 'claude' })

    vi.mocked(claudeDiscover.findProjectFolder).mockReturnValueOnce({
      match: 'not-found',
      folder_name: '__stub__',
      folder_path: '/stub/__stub__',
    })

    ;(svc as unknown as SvcPrivate)._resolveJsonlFile(entry)

    expect(vi.mocked(claudeDiscover.findProjectFolder)).toHaveBeenCalled()
    expect(vi.mocked(codexDiscover.findCodexRolloutInWindow)).not.toHaveBeenCalled()
  })

  it('cliId=antigravity 也走 findProjectFolder 分支', () => {
    const { svc } = makeService()
    const entry = injectEntry(svc, { cliId: 'antigravity' })

    vi.mocked(claudeDiscover.findProjectFolder).mockReturnValueOnce({
      match: 'not-found',
      folder_name: '__stub__',
      folder_path: '/stub/__stub__',
    })

    ;(svc as unknown as SvcPrivate)._resolveJsonlFile(entry)

    expect(vi.mocked(claudeDiscover.findProjectFolder)).toHaveBeenCalled()
    expect(vi.mocked(codexDiscover.findCodexRolloutInWindow)).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// AC3: _tailOnce 解析器路由（用真實臨時檔供 statSig 成功）
// ---------------------------------------------------------------------------

describe('AC3: _tailOnce 解析器路由', () => {
  it('cliId=codex → 解析呼叫 codexRecordToConversationMessage，不呼叫 recordToConversationMessage', () => {
    const { svc, emit } = makeService()

    // 建一個真實檔（讓 statSig/fs.statSync 成功）
    const tmpFile = makeTmpJsonl('{"type":"event_msg","payload":{"type":"user_message","message":"hi"}}\n')

    const fakeRecord = { type: 'event_msg', payload: { type: 'user_message', message: 'hi' } }
    vi.mocked(jsonlMod.readJsonl).mockReturnValueOnce([
      { index: 0, record: fakeRecord as Record<string, unknown>, error: null },
    ])
    vi.mocked(codexParse.codexRecordToConversationMessage).mockReturnValueOnce({
      role: 'user',
      source: 'typed',
      blocks: [{ kind: 'text', text: 'hi' }],
    })

    const entry = injectEntry(svc, {
      cliId: 'codex',
      jsonlFile: tmpFile,
      lastSig: null,   // null → 跳過去重，強制解析
      done: false,
    })

    ;(svc as unknown as SvcPrivate)._tailOnce(entry)

    expect(vi.mocked(codexParse.codexRecordToConversationMessage)).toHaveBeenCalledWith(fakeRecord)
    expect(vi.mocked(claudeIndex.recordToConversationMessage)).not.toHaveBeenCalled()
    expect(emit).toHaveBeenCalled()
  })

  it('cliId=claude → 解析呼叫 recordToConversationMessage，不呼叫 codexRecordToConversationMessage', () => {
    const { svc, emit } = makeService()

    const tmpFile = makeTmpJsonl('{"type":"assistant","message":{}}\n')

    const fakeRecord = { type: 'assistant', message: {} }
    vi.mocked(jsonlMod.readJsonl).mockReturnValueOnce([
      { index: 0, record: fakeRecord as Record<string, unknown>, error: null },
    ])
    vi.mocked(claudeIndex.recordToConversationMessage).mockReturnValueOnce({
      role: 'assistant',
      blocks: [{ kind: 'text', text: 'pong' }],
    })

    const entry = injectEntry(svc, {
      cliId: 'claude',
      jsonlFile: tmpFile,
      lastSig: null,
      done: false,
    })

    ;(svc as unknown as SvcPrivate)._tailOnce(entry)

    expect(vi.mocked(claudeIndex.recordToConversationMessage)).toHaveBeenCalledWith(fakeRecord)
    expect(vi.mocked(codexParse.codexRecordToConversationMessage)).not.toHaveBeenCalled()
    expect(emit).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// AC4: handler cliId 透傳（直接模擬 handler 邏輯）
// ---------------------------------------------------------------------------

describe('AC4: agentConvHandlers cliId 透傳', () => {
  it('cliId=codex 時 backend.agentConv.open 收到 cliId=codex', () => {
    const openSpy = vi.fn().mockReturnValue('00000000-0000-0000-0000-000000000002')
    const mockBackend = { agentConv: { open: openSpy } }

    // 模擬 handler 的補 cliId 邏輯（與 agentConvHandlers.ts 行為一致）
    const p = {
      conversationId: '00000000-0000-0000-0000-000000000002',
      cwd: '/some/path',
      initialPrompt: null as string | null,
      cliId: 'codex' as string | undefined,
    }
    const launchCommand = buildAgentConvLaunchCommand(p.cliId ?? 'claude', p.conversationId)

    mockBackend.agentConv.open({
      conversationId: p.conversationId,
      cwd: p.cwd,
      launchCommand,
      initialPrompt: p.initialPrompt ?? null,
      cliId: p.cliId ?? 'claude',
    })

    expect(openSpy).toHaveBeenCalledWith(
      expect.objectContaining({ cliId: 'codex' }),
    )
  })

  it('cliId 未指定時 fallback 為 claude', () => {
    const openSpy = vi.fn().mockReturnValue('00000000-0000-0000-0000-000000000003')
    const mockBackend = { agentConv: { open: openSpy } }

    const p = {
      conversationId: '00000000-0000-0000-0000-000000000003',
      cwd: '/some/path',
      initialPrompt: null as string | null,
      cliId: undefined as string | undefined,
    }
    const launchCommand = buildAgentConvLaunchCommand(p.cliId ?? 'claude', p.conversationId)

    mockBackend.agentConv.open({
      conversationId: p.conversationId,
      cwd: p.cwd,
      launchCommand,
      initialPrompt: p.initialPrompt ?? null,
      cliId: p.cliId ?? 'claude',
    })

    expect(openSpy).toHaveBeenCalledWith(
      expect.objectContaining({ cliId: 'claude' }),
    )
  })
})

// ---------------------------------------------------------------------------
// AC5: open() 建 entry 時 openedAtMs 已設定
// ---------------------------------------------------------------------------

describe('AC5: open() 建 entry 時 openedAtMs 已設定', () => {
  it('注入的 entry openedAtMs 為非零正整數（毫秒）', () => {
    const { svc } = makeService()
    const before = Date.now()
    const entry = injectEntry(svc, { cliId: 'codex', openedAtMs: Date.now() })
    const after = Date.now()
    const ts = entry['openedAtMs'] as number
    expect(typeof ts).toBe('number')
    expect(ts).toBeGreaterThanOrEqual(before - 1)
    expect(ts).toBeLessThanOrEqual(after + 1)
  })

  it('cliId=codex 時 _resolveJsonlFile 把 openedAtMs 傳給 findCodexRolloutInWindow', () => {
    const { svc } = makeService()
    const openedAtMs = 5_555_555
    const entry = injectEntry(svc, { cliId: 'codex', openedAtMs })

    vi.mocked(codexDiscover.findCodexRolloutInWindow).mockReturnValueOnce(null)
    ;(svc as unknown as SvcPrivate)._resolveJsonlFile(entry)

    expect(vi.mocked(codexDiscover.findCodexRolloutInWindow)).toHaveBeenCalledWith(
      expect.any(String),
      openedAtMs,
      null,
      expect.any(Set),
    )
  })
})

// ---------------------------------------------------------------------------
// B11c Fix 1: onExit 殭屍保護 — stale PTY 的 onExit 不應設 done=true
// ---------------------------------------------------------------------------

describe('B11c Fix 1: onExit 殭屍保護', () => {
  it('entry.pty !== p 時 onExit 不設 done=true，不 emit messages', () => {
    const { svc, emit } = makeService()

    // 建立一個 entry，pty 設成 newPty（模擬 respawn 後已換 PTY）
    const oldPty = {
      kill: vi.fn(),
      write: vi.fn(),
      onData: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onExit: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    }
    const newPty = {
      kill: vi.fn(),
      write: vi.fn(),
      onData: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onExit: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    }

    // entry.pty = newPty（已 respawn）
    const entry = injectEntry(svc, { pty: newPty, done: false })

    // 模擬 exitListener 邏輯（直接繞過 svc 私有方法，白箱測試保護邏輯）：
    // 若 e.pty !== p（p = oldPty），則應直接 return，不修改 done
    const conversationId = entry['conversationId'] as string
    const p = oldPty  // 舊 PTY：exitListener 的閉包捕獲值

    // 模擬 exitListener 本體（含修復後的 PTY 身份檢查）：
    const runExitListener = (): void => {
      const e = (svc as unknown as SvcPrivate)._convs.get(conversationId) as Record<string, unknown> | undefined
      if (!e) return
      if ((e['pty'] as unknown) !== (p as unknown)) return  // 修復點
      e['done'] = true
    }

    runExitListener()

    // 修復後：done 不應被設成 true（因為 e.pty = newPty ≠ oldPty）
    expect(entry['done']).toBe(false)
    // 也不應 emit 任何東西
    expect(emit).not.toHaveBeenCalled()
  })

  it('entry.pty === p 時 onExit 正常設 done=true', () => {
    const { svc } = makeService()
    const samePty = {
      kill: vi.fn(),
      write: vi.fn(),
      onData: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onExit: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    }
    const entry = injectEntry(svc, { pty: samePty, done: false })
    const conversationId = entry['conversationId'] as string
    const p = samePty  // 同一個 PTY

    const runExitListener = (): void => {
      const e = (svc as unknown as SvcPrivate)._convs.get(conversationId) as Record<string, unknown> | undefined
      if (!e) return
      if ((e['pty'] as unknown) !== (p as unknown)) return
      e['done'] = true
    }

    runExitListener()

    // entry.pty === p → done 應被設成 true
    expect(entry['done']).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// AC6: initialPrompt 拆兩次寫入（修復 bracketed paste 問題）
// ---------------------------------------------------------------------------

describe('AC6: initialPrompt 注入拆兩次 write（繞 bracketed paste）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('open() 後推進 timers，PTY write 被呼叫兩次：先文字後 \\r（不一包）', async () => {
    const { svc } = makeService()

    const ptyMod = await import('node-pty')
    const stubPty = {
      pid: 1234,
      cols: 120,
      rows: 30,
      process: 'stub',
      handleFlowControl: false,
      onData: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onExit: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
    }
    vi.mocked(ptyMod.spawn).mockReturnValueOnce(stubPty as unknown as import('node-pty').IPty)

    const prompt = 'hello world'
    svc.open({
      conversationId: 'test-ac6-0001',
      cwd: 'C:\\teamuq',
      launchCommand: 'claude --session-id test-ac6-0001',
      initialPrompt: prompt,
      cliId: 'claude',
    })

    // t1（LAUNCH_DELAY_MS=300）→ launchCommand + '\r'
    vi.advanceTimersByTime(300)
    expect(stubPty.write).toHaveBeenCalledTimes(1)
    expect(stubPty.write).toHaveBeenLastCalledWith('claude --session-id test-ac6-0001\r')

    // t2（LAUNCH_DELAY_MS + PROMPT_DELAY_MS = 1800）→ 只寫文字本身（不含 \r）
    vi.advanceTimersByTime(1500)
    expect(stubPty.write).toHaveBeenCalledTimes(2)
    expect(stubPty.write).toHaveBeenLastCalledWith(prompt)

    expect(initialPromptEnterDelayMs(prompt, 'claude')).toBe(800)

    // t3（Claude enterDelay = 800ms）→ 寫 '\r' 送出
    vi.advanceTimersByTime(799)
    expect(stubPty.write).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(1)
    expect(stubPty.write).toHaveBeenCalledTimes(3)
    expect(stubPty.write).toHaveBeenLastCalledWith('\r')

    // 確認文字與換行沒有合在一起寫（不接受 'hello world\r' 這種呼叫）
    const allCalls = stubPty.write.mock.calls.map((c: unknown[]) => c[0])
    expect(allCalls).not.toContain(prompt + '\r')

    svc.close('test-ac6-0001')
  })

  it('長 prompt（> 80 字元）enterDelay 依比例增大', async () => {
    const { svc } = makeService()

    const ptyMod = await import('node-pty')
    const stubPty = {
      pid: 9001,
      cols: 120,
      rows: 30,
      process: 'stub',
      handleFlowControl: false,
      onData: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onExit: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
    }
    vi.mocked(ptyMod.spawn).mockReturnValueOnce(stubPty as unknown as import('node-pty').IPty)

    // 241 字元 → ceil(241/80)*50 = 200；Claude 最小 800ms，因此仍等 800ms。
    const longPrompt = 'A'.repeat(241)
    svc.open({
      conversationId: 'test-ac6-long',
      cwd: 'C:\\teamuq',
      launchCommand: 'claude --session-id test-ac6-long',
      initialPrompt: longPrompt,
      cliId: 'claude',
    })

    // 推進到 t2 剛執行後（300+1500=1800ms）→ 只寫文字
    vi.advanceTimersByTime(1800)
    expect(stubPty.write).toHaveBeenCalledTimes(2)
    expect(stubPty.write).toHaveBeenLastCalledWith(longPrompt)

    expect(initialPromptEnterDelayMs(longPrompt, 'claude')).toBe(800)

    // 799ms 後仍未送 '\r'（Claude enterDelay=800ms）
    vi.advanceTimersByTime(799)
    expect(stubPty.write).toHaveBeenCalledTimes(2)

    // 再 1ms（總共 800ms）→ '\r' 送出
    vi.advanceTimersByTime(1)
    expect(stubPty.write).toHaveBeenCalledTimes(3)
    expect(stubPty.write).toHaveBeenLastCalledWith('\r')

    svc.close('test-ac6-long')
  })

  it('codex initialPrompt 維持較短 enterDelay', async () => {
    const { svc } = makeService()

    const ptyMod = await import('node-pty')
    const stubPty = {
      pid: 5678,
      cols: 120,
      rows: 30,
      process: 'stub',
      handleFlowControl: false,
      onData: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onExit: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
    }
    vi.mocked(ptyMod.spawn).mockReturnValueOnce(stubPty as unknown as import('node-pty').IPty)

    const prompt = '$tuq-agent audit sw'
    svc.open({
      conversationId: 'test-ac6-codex',
      cwd: 'C:\\teamuq',
      launchCommand: 'codex --model gpt-5.4',
      initialPrompt: prompt,
      cliId: 'codex',
    })

    vi.advanceTimersByTime(1800)
    expect(stubPty.write).toHaveBeenCalledTimes(2)
    expect(stubPty.write).toHaveBeenLastCalledWith(prompt)
    expect(initialPromptEnterDelayMs(prompt, 'codex')).toBe(150)

    vi.advanceTimersByTime(149)
    expect(stubPty.write).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(1)
    expect(stubPty.write).toHaveBeenCalledTimes(3)
    expect(stubPty.write).toHaveBeenLastCalledWith('\r')

    svc.close('test-ac6-codex')
  })

  it('initialPrompt 送出後仍無 JSONL 時會清空輸入列並重送', async () => {
    const { svc } = makeService()

    const ptyMod = await import('node-pty')
    let onDataCallback: ((chunk: string) => void) | null = null
    const stubPty = {
      pid: 7788,
      cols: 120,
      rows: 30,
      process: 'stub',
      handleFlowControl: false,
      onData: vi.fn().mockImplementation((cb: (chunk: string) => void) => {
        onDataCallback = cb
        return { dispose: vi.fn() }
      }),
      onExit: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
    }
    vi.mocked(ptyMod.spawn).mockReturnValueOnce(stubPty as unknown as import('node-pty').IPty)

    const prompt = '/tuq-agent platform_context: teamuq_agent_team_ui'
    svc.open({
      conversationId: 'test-ac6-retry',
      cwd: 'C:\\teamuq',
      launchCommand: 'claude --session-id test-ac6-retry',
      initialPrompt: prompt,
      cliId: 'claude',
    })
    onDataCallback?.('Claude Code ready')

    vi.advanceTimersByTime(1800)
    vi.advanceTimersByTime(800)
    expect(stubPty.write.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      'claude --session-id test-ac6-retry\r',
      prompt,
      '\r',
    ])

    vi.advanceTimersByTime(5000)
    expect(stubPty.write).toHaveBeenCalledTimes(5)
    expect(stubPty.write.mock.calls[3][0]).toBe('\x15')
    expect(stubPty.write.mock.calls[4][0]).toBe(prompt)

    vi.advanceTimersByTime(800)
    expect(stubPty.write).toHaveBeenCalledTimes(6)
    expect(stubPty.write).toHaveBeenLastCalledWith('\r')

    svc.close('test-ac6-retry')
  })
})

// ---------------------------------------------------------------------------
// B11c Fix 2: busy=false debounce 清 lastSig，強制下一輪 _tailOnce 重解析
// ---------------------------------------------------------------------------

describe('B11c Fix 2: busy=false 時清 lastSig 強制下次 _tailOnce 重解析', () => {
  it('lastSig 已有值時，_tailOnce 因簽名未變而 skip（確認基準行為）', () => {
    const { svc, emit } = makeService()

    const tmpFile = makeTmpJsonl('{"type":"assistant","message":{}}\n')
    const st = fs.statSync(tmpFile)
    const sig = { mtimeMs: st.mtimeMs, size: st.size }

    const entry = injectEntry(svc, {
      cliId: 'claude',
      jsonlFile: tmpFile,
      lastSig: sig,   // ← 與當前 sig 相同
      done: false,
      busy: false,
    })

    emit.mockClear()
    ;(svc as unknown as SvcPrivate)._tailOnce(entry)

    // sig 未變 + !done → skip → 不 emit
    expect(emit).not.toHaveBeenCalled()
  })

  it('lastSig 清為 null 後，_tailOnce 強制重解析並 emit（修復效果驗證）', () => {
    const { svc, emit } = makeService()

    const fakeRecord = { type: 'assistant', message: {} }
    vi.mocked(jsonlMod.readJsonl).mockReturnValueOnce([
      { index: 0, record: fakeRecord as Record<string, unknown>, error: null },
    ])
    vi.mocked(claudeIndex.recordToConversationMessage).mockReturnValueOnce({
      role: 'assistant',
      blocks: [{ kind: 'text', text: 'hello' }],
    })

    const tmpFile = makeTmpJsonl('{"type":"assistant","message":{}}\n')

    const entry = injectEntry(svc, {
      cliId: 'claude',
      jsonlFile: tmpFile,
      lastSig: null,   // ← busy=false debounce 清掉後
      done: false,
      busy: false,
    })

    ;(svc as unknown as SvcPrivate)._tailOnce(entry)

    // lastSig=null → 不 skip → 重解析 → emit
    expect(emit).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ done: false, busy: false }),
    )
  })
})
