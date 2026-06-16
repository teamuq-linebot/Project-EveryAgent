/**
 * promptDetector.spec.ts — PtyPromptWatcher / detectInteractivePrompt / stripAnsi 單元測試
 *
 * 待測：src/main/pty/promptDetector.ts
 * 測試框架：vitest（無 native 依賴，直接跑，不需 ABI 切換）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  stripAnsi,
  detectInteractivePrompt,
  detectCliError,
  extractMenuOptions,
  extractPromptText,
  isBenignStartupPrompt,
  PtyPromptWatcher,
} from '../src/main/pty/promptDetector'

// ============================================================================
// 1. stripAnsi
// ============================================================================

describe('stripAnsi', () => {
  it('剝除 CSI 顏色序列（SGR）', () => {
    expect(stripAnsi('\x1b[31mHello\x1b[0m')).toBe('Hello')
  })

  it('剝除 CSI 游標移動序列', () => {
    expect(stripAnsi('\x1b[2A\x1b[3C text')).toBe(' text')
  })

  it('剝除 CSI 問號序列（如 \\x1b[?25l hide cursor）', () => {
    expect(stripAnsi('\x1b[?25l\x1b[?25h')).toBe('')
  })

  it('剝除 OSC 標題序列（BEL 結尾）', () => {
    expect(stripAnsi('\x1b]0;My Terminal\x07text')).toBe('text')
  })

  it('剝除 OSC 標題序列（ESC \\ 結尾）', () => {
    expect(stripAnsi('\x1b]2;title\x1b\\text')).toBe('text')
  })

  it('保留正常 ASCII 文字', () => {
    expect(stripAnsi('Hello, World!')).toBe('Hello, World!')
  })

  it('保留中文字元', () => {
    expect(stripAnsi('你好世界')).toBe('你好世界')
  })

  it('保留 ❯ 符號', () => {
    expect(stripAnsi('❯ 1. Resume')).toBe('❯ 1. Resume')
  })

  it('空字串 → 空字串', () => {
    expect(stripAnsi('')).toBe('')
  })

  it('複合：CSI + OSC + 正文', () => {
    const raw = '\x1b]0;shell\x07\x1b[1;32m❯\x1b[0m 1. Resume from summary'
    const result = stripAnsi(raw)
    expect(result).toContain('❯')
    expect(result).toContain('1. Resume from summary')
    // 不應含 ESC
    expect(result).not.toContain('\x1b')
  })
})

// ============================================================================
// 2. detectInteractivePrompt — 每條 pattern 正例 + 關鍵負例
// ============================================================================

describe('detectInteractivePrompt', () => {
  // ——— 正例 ———

  it('menu_digit pattern：❯ 1. Resume from summary (recommended)', () => {
    const result = detectInteractivePrompt('❯ 1. Resume from summary (recommended)')
    expect(result.waiting).toBe(true)
    expect(result.reason).toBe('menu_digit')
  })

  it('yn_prompt pattern：(y/n)', () => {
    const result = detectInteractivePrompt('Are you sure? (y/n)')
    expect(result.waiting).toBe(true)
    expect(result.reason).toBe('yn_prompt')
  })

  it('do_you_trust pattern：Do you trust the files in this folder?', () => {
    const result = detectInteractivePrompt('Do you trust the files in this folder?')
    expect(result.waiting).toBe(true)
    expect(result.reason).toBe('do_you_trust')
  })

  it('dont_ask_again pattern：Don\'t ask me again', () => {
    const result = detectInteractivePrompt("Don't ask me again")
    expect(result.waiting).toBe(true)
    expect(result.reason).toBe('dont_ask_again')
  })

  it('press_enter pattern：Press Enter to continue', () => {
    const result = detectInteractivePrompt('Press Enter to continue')
    expect(result.waiting).toBe(true)
    expect(result.reason).toBe('press_enter')
  })

  it('continue_q pattern：continue?（大小寫混合）', () => {
    const result = detectInteractivePrompt('Do you want to Continue?')
    expect(result.waiting).toBe(true)
    expect(result.reason).toBe('continue_q')
  })

  it('resume_summary pattern：resume from summary', () => {
    const result = detectInteractivePrompt('You can resume from summary here')
    expect(result.waiting).toBe(true)
    expect(result.reason).toBe('resume_summary')
  })

  // ——— 負例 ———

  it('一般編譯輸出 → waiting: false', () => {
    const result = detectInteractivePrompt(
      'Building project... 100% done\nAll files compiled successfully.',
    )
    expect(result.waiting).toBe(false)
    expect(result.reason).toBeUndefined()
  })

  it('含 continue 但非問句（無 ?）→ waiting: false', () => {
    const result = detectInteractivePrompt(
      'The process will continue in background.',
    )
    expect(result.waiting).toBe(false)
  })

  it('空字串 → waiting: false', () => {
    const result = detectInteractivePrompt('')
    expect(result.waiting).toBe(false)
  })
})

// ============================================================================
// 3. 真實混合 ANSI 案例（模擬 claude resume 選單）
// ============================================================================

describe('stripAnsi + detectInteractivePrompt 整合（真實 ANSI 片段）', () => {
  it('帶 ANSI 的 claude resume 選單 → strip 後命中 menu_digit', () => {
    // 模擬 PTY 輸出：hide cursor + 顏色碼 + ❯ 箭頭選單
    const raw =
      '\x1b[?25l\x1b[2K\x1b[1;32m❯\x1b[0m 1. Resume from summary (recommended)\r\n' +
      '\x1b[2K  2. Start fresh\r\n'
    const stripped = stripAnsi(raw)
    expect(stripped).toContain('❯')
    expect(stripped).toContain('1. Resume from summary')
    const result = detectInteractivePrompt(stripped)
    expect(result.waiting).toBe(true)
    expect(result.reason).toBe('menu_digit')
  })

  it('帶 OSC title + yn prompt → strip 後命中 yn_prompt', () => {
    const raw = '\x1b]0;claude\x07\x1b[33mOverwrite file? \x1b[0m(y/n) '
    const stripped = stripAnsi(raw)
    expect(stripped).not.toContain('\x1b')
    const result = detectInteractivePrompt(stripped)
    expect(result.waiting).toBe(true)
    expect(result.reason).toBe('yn_prompt')
  })

  it('純 ANSI 無文字特徵 → strip 後 waiting: false', () => {
    const raw = '\x1b[2J\x1b[H\x1b[?25h'
    const stripped = stripAnsi(raw)
    const result = detectInteractivePrompt(stripped)
    expect(result.waiting).toBe(false)
  })
})

// ============================================================================
// 4. PtyPromptWatcher（注入 fake timer）
// ============================================================================

describe('PtyPromptWatcher', () => {
  const IDLE_MS = 200

  // fake timer 工廠——簡單手動實作，避免 vi.useFakeTimers 和 Electron 環境衝突
  function makeFakeTimers() {
    let nextId = 1
    const pending = new Map<number, { fn: () => void; at: number }>()
    let now = 0

    const fakeSetTimeout = (fn: () => void, ms: number): number => {
      const id = nextId++
      pending.set(id, { fn, at: now + ms })
      return id
    }

    const fakeClearTimeout = (id: number): void => {
      pending.delete(id)
    }

    /** 推進時間 ms，觸發到期的 timer */
    const tick = (ms: number) => {
      now += ms
      for (const [id, { fn, at }] of [...pending.entries()]) {
        if (at <= now) {
          pending.delete(id)
          fn()
        }
      }
    }

    return { fakeSetTimeout, fakeClearTimeout, tick, pending }
  }

  it('餵含選單的 chunk → idle 超時 → onWaiting 被呼叫一次（reason 正確）', () => {
    const { fakeSetTimeout, fakeClearTimeout, tick } = makeFakeTimers()
    const onWaiting = vi.fn()
    const onActive = vi.fn()

    const watcher = new PtyPromptWatcher(onWaiting, onActive, {
      idleMs: IDLE_MS,
      setTimeout: fakeSetTimeout as unknown as typeof globalThis.setTimeout,
      clearTimeout: fakeClearTimeout as unknown as typeof globalThis.clearTimeout,
    })

    watcher.onData('❯ 1. Resume from summary (recommended)\r\n  2. Start fresh')
    expect(onWaiting).not.toHaveBeenCalled()

    tick(IDLE_MS)
    expect(onWaiting).toHaveBeenCalledTimes(1)
    expect(onWaiting).toHaveBeenCalledWith('menu_digit', expect.any(Array), undefined)
    expect(onActive).not.toHaveBeenCalled()
  })

  it('waiting 中餵新 data → onActive 一次並重置（可再次進入 waiting）', () => {
    const { fakeSetTimeout, fakeClearTimeout, tick } = makeFakeTimers()
    const onWaiting = vi.fn()
    const onActive = vi.fn()

    const watcher = new PtyPromptWatcher(onWaiting, onActive, {
      idleMs: IDLE_MS,
      setTimeout: fakeSetTimeout as unknown as typeof globalThis.setTimeout,
      clearTimeout: fakeClearTimeout as unknown as typeof globalThis.clearTimeout,
    })

    // 進入 waiting
    watcher.onData('❯ 1. Resume from summary\n')
    tick(IDLE_MS)
    expect(onWaiting).toHaveBeenCalledTimes(1)

    // 餵新資料 → 應呼叫 onActive
    watcher.onData('some new output\n')
    expect(onActive).toHaveBeenCalledTimes(1)
    expect(onWaiting).toHaveBeenCalledTimes(1) // 仍只有 1 次

    // 再次 idle + 有選單 → 再次 onWaiting
    watcher.onData('❯ 2. Start fresh\n')
    tick(IDLE_MS)
    expect(onWaiting).toHaveBeenCalledTimes(2)
  })

  it('餵無特徵輸出 → idle 超時 → 不呼叫 onWaiting', () => {
    const { fakeSetTimeout, fakeClearTimeout, tick } = makeFakeTimers()
    const onWaiting = vi.fn()
    const onActive = vi.fn()

    const watcher = new PtyPromptWatcher(onWaiting, onActive, {
      idleMs: IDLE_MS,
      setTimeout: fakeSetTimeout as unknown as typeof globalThis.setTimeout,
      clearTimeout: fakeClearTimeout as unknown as typeof globalThis.clearTimeout,
    })

    watcher.onData('Compiling... done.\nAll tests passed.')
    tick(IDLE_MS)
    expect(onWaiting).not.toHaveBeenCalled()
    expect(onActive).not.toHaveBeenCalled()
  })

  it('持續餵 data（間隔 < IDLE_MS）→ timer 重置 → 不觸發 onWaiting', () => {
    const { fakeSetTimeout, fakeClearTimeout, tick } = makeFakeTimers()
    const onWaiting = vi.fn()
    const onActive = vi.fn()

    const watcher = new PtyPromptWatcher(onWaiting, onActive, {
      idleMs: IDLE_MS,
      setTimeout: fakeSetTimeout as unknown as typeof globalThis.setTimeout,
      clearTimeout: fakeClearTimeout as unknown as typeof globalThis.clearTimeout,
    })

    // 每 50ms 餵一次含選單的資料（共 3 次），間隔都 < IDLE_MS(200)
    watcher.onData('❯ 1. Resume from summary\n')
    tick(50) // 50ms 後餵下一筆，timer 應被重置
    watcher.onData('❯ 1. Resume from summary\n')
    tick(50) // 100ms 累計
    watcher.onData('❯ 1. Resume from summary\n')
    tick(50) // 150ms 累計（仍 < IDLE_MS）

    expect(onWaiting).not.toHaveBeenCalled()

    // 再過 IDLE_MS → 這次真的 idle → 觸發
    tick(IDLE_MS)
    expect(onWaiting).toHaveBeenCalledTimes(1)
  })

  describe('rolling buffer', () => {
    it('餵 >2000 chars 後特徵在尾段 → 仍命中', () => {
      const { fakeSetTimeout, fakeClearTimeout, tick } = makeFakeTimers()
      const onWaiting = vi.fn()

      const watcher = new PtyPromptWatcher(onWaiting, vi.fn(), {
        idleMs: IDLE_MS,
        bufferSize: 2000,
        setTimeout: fakeSetTimeout as unknown as typeof globalThis.setTimeout,
        clearTimeout: fakeClearTimeout as unknown as typeof globalThis.clearTimeout,
      })

      // 先餵超過 2000 字的雜訊
      const noise = 'x'.repeat(1800)
      watcher.onData(noise)
      // 再餵選單（會在尾段 buffer 中）
      watcher.onData('\n❯ 1. Resume from summary\n')

      tick(IDLE_MS)
      expect(onWaiting).toHaveBeenCalledTimes(1)
      expect(onWaiting).toHaveBeenCalledWith('menu_digit', undefined, expect.any(String))
    })

    it('TUI 重繪 10 次（含 1~3，總量 >2000 <8000）不應擠出最初完整選單的第 4 項', () => {
      // 重現真機缺漏根因：完整 4 項選單先進 buffer，後續 10 次只含 1~3 的重繪 chunk
      // 每次重繪約 220 字元，10 次 = ~2200 字元 > 舊 bufferSize(2000) < 新 bufferSize(8000)
      const { fakeSetTimeout, fakeClearTimeout, tick } = makeFakeTimers()
      const onWaiting = vi.fn()

      const watcher = new PtyPromptWatcher(onWaiting, vi.fn(), {
        idleMs: IDLE_MS,
        // 不指定 bufferSize，使用預設值 8000
        setTimeout: fakeSetTimeout as unknown as typeof globalThis.setTimeout,
        clearTimeout: fakeClearTimeout as unknown as typeof globalThis.clearTimeout,
      })

      // 1. 先餵含 1~4 完整選單的 chunk（初始渲染）
      const fullMenu = [
        '❯ 1. Resume from summary (recommended)',
        '  2. Resume full session as-is',
        "  3. Don't ask me again",
        '  4. Chat about this',
      ].join('\n') + '\n'
      watcher.onData(fullMenu)

      // 2. 連續餵 10 次只含 1~3 的重繪 chunk（每次 ~220 字元，模擬 TUI 游標重繪）
      //    10 次合計 ~2200 字元 > 舊 2000 bufferSize，但 < 新 8000 bufferSize
      const redrawChunk =
        '\x1b[3A' +                             // 游標上移 3 行（重繪動作）
        '\x1b[2K❯ 1. Resume from summary (recommended)\r\n' +
        '\x1b[2K  2. Resume full session as-is\r\n' +
        '\x1b[2K  3. Don\'t ask me again\r\n' +
        ' '.repeat(150)                          // 填充使每次約 220 字元
      for (let i = 0; i < 10; i++) {
        watcher.onData(redrawChunk)
      }

      // 3. idle 後 onWaiting 的 options 仍含 4 項（option 4 未被擠出）
      tick(IDLE_MS)
      expect(onWaiting).toHaveBeenCalledTimes(1)
      const [, options] = onWaiting.mock.calls[0]
      expect(Array.isArray(options)).toBe(true)
      expect(options).toHaveLength(4)
      expect(options[3]).toEqual({ value: '4', label: 'Chat about this' })
    })

    it('特徵被雜訊擠出尾段 buffer → 不命中', () => {
      const { fakeSetTimeout, fakeClearTimeout, tick } = makeFakeTimers()
      const onWaiting = vi.fn()

      const watcher = new PtyPromptWatcher(onWaiting, vi.fn(), {
        idleMs: IDLE_MS,
        bufferSize: 100, // 小 buffer，容易擠出
        setTimeout: fakeSetTimeout as unknown as typeof globalThis.setTimeout,
        clearTimeout: fakeClearTimeout as unknown as typeof globalThis.clearTimeout,
      })

      // 先餵選單（進 buffer）
      watcher.onData('❯ 1. Resume from summary\n')
      // 再餵超過 bufferSize 的雜訊 → 選單被擠出
      watcher.onData('z'.repeat(200))

      tick(IDLE_MS)
      expect(onWaiting).not.toHaveBeenCalled()
    })
  })

  it('dispose 後 timer 不再觸發（無洩漏）', () => {
    const { fakeSetTimeout, fakeClearTimeout, tick } = makeFakeTimers()
    const onWaiting = vi.fn()

    const watcher = new PtyPromptWatcher(onWaiting, vi.fn(), {
      idleMs: IDLE_MS,
      setTimeout: fakeSetTimeout as unknown as typeof globalThis.setTimeout,
      clearTimeout: fakeClearTimeout as unknown as typeof globalThis.clearTimeout,
    })

    watcher.onData('❯ 1. Resume from summary\n')
    // dispose 在 idle 到期前
    watcher.dispose()

    tick(IDLE_MS)
    expect(onWaiting).not.toHaveBeenCalled()
  })

  it('dispose 後再次 onData 不拋錯也不觸發任何 callback', () => {
    const { fakeSetTimeout, fakeClearTimeout, tick } = makeFakeTimers()
    const onWaiting = vi.fn()
    const onActive = vi.fn()

    const watcher = new PtyPromptWatcher(onWaiting, onActive, {
      idleMs: IDLE_MS,
      setTimeout: fakeSetTimeout as unknown as typeof globalThis.setTimeout,
      clearTimeout: fakeClearTimeout as unknown as typeof globalThis.clearTimeout,
    })

    watcher.dispose()
    // dispose 後餵資料不應拋錯
    expect(() => watcher.onData('❯ 1. Resume\n')).not.toThrow()
    tick(IDLE_MS)
    expect(onWaiting).not.toHaveBeenCalled()
    expect(onActive).not.toHaveBeenCalled()
  })
})

// ============================================================================
// 5. detectCliError — 各 pattern 正例 + 負例
// ============================================================================

describe('detectCliError', () => {
  // ——— 正例：6 條 pattern ———

  it('no_conversation_found：命中 "No conversation found"（大小寫不敏感）', () => {
    const result = detectCliError('No conversation found for session abc123')
    expect(result.error).toBe(true)
    expect(result.reason).toBe('no_conversation_found')
  })

  it('no_conversation_found：小寫也命中', () => {
    const result = detectCliError('no conversation found')
    expect(result.error).toBe(true)
    expect(result.reason).toBe('no_conversation_found')
  })

  it('error_colon：命中 "Error: something"', () => {
    const result = detectCliError('Error: ENOENT no such file or directory')
    expect(result.error).toBe(true)
    expect(result.reason).toBe('error_colon')
  })

  it('error_colon：大小寫混合仍命中（"ERROR: ..."）', () => {
    const result = detectCliError('ERROR: authentication failed')
    expect(result.error).toBe(true)
    expect(result.reason).toBe('error_colon')
  })

  it('enoent：命中 "ENOENT"', () => {
    const result = detectCliError("ENOENT: no such file or directory, open '/tmp/abc'")
    expect(result.error).toBe(true)
    expect(result.reason).toBe('enoent')
  })

  it('enoent：小寫 "enoent" 也命中（大小寫不敏感）', () => {
    const result = detectCliError('enoent: no such file')
    expect(result.error).toBe(true)
    expect(result.reason).toBe('enoent')
  })

  it("not_recognized：命中 \"'claude' is not recognized as an internal or external command\"", () => {
    const result = detectCliError(
      "'claude' is not recognized as an internal or external command, operable program or batch file.",
    )
    expect(result.error).toBe(true)
    expect(result.reason).toBe('not_recognized')
  })

  it('cannot_find_path：命中 "Cannot find path"', () => {
    const result = detectCliError('Cannot find path C:\\tools\\claude.exe')
    expect(result.error).toBe(true)
    expect(result.reason).toBe('cannot_find_path')
  })

  it('cannot_find_path：小寫 "cannot find path" 也命中', () => {
    const result = detectCliError('cannot find path to the binary')
    expect(result.error).toBe(true)
    expect(result.reason).toBe('cannot_find_path')
  })

  it('usage_claude：命中 "usage: claude"', () => {
    const result = detectCliError('usage: claude [options] <command>')
    expect(result.error).toBe(true)
    expect(result.reason).toBe('usage_claude')
  })

  it('usage_claude：大寫 "Usage: claude" 也命中（大小寫不敏感）', () => {
    const result = detectCliError('Usage: claude --help')
    expect(result.error).toBe(true)
    expect(result.reason).toBe('usage_claude')
  })

  // ——— 負例：正常輸出 ———

  it('正常輸出不命中', () => {
    const result = detectCliError('All tasks completed successfully.\nSession started.')
    expect(result.error).toBe(false)
    expect(result.reason).toBeUndefined()
  })

  it('空字串 → error: false', () => {
    const result = detectCliError('')
    expect(result.error).toBe(false)
  })

  it('"error" 出現在單字中段（"terrorform"）→ 不命中 error_colon（pattern 需含冒號）', () => {
    // error_colon pattern 為 /error:/i，必須有冒號；"terrorform" 完全無 "error:" 故不命中
    const result = detectCliError('running terrorform deploy')
    expect(result.error).toBe(false)
  })

  it('"error" 單詞但無冒號（"an error occurred"）→ 不命中 error_colon', () => {
    // "error_colon" 只匹配 "error:"，無冒號的 "error" 單獨出現不觸發
    const result = detectCliError('an error occurred during processing')
    expect(result.error).toBe(false)
  })

  it('行中段的 "an error: ..."（非行首）→ 不命中 error_colon（行首錨定）', () => {
    // 回歸：對話正文常含 "...an error: foo"，行首錨定避免誤判成 CLI 錯誤
    const result = detectCliError('I fixed the bug that caused an error: null pointer')
    expect(result.error).toBe(false)
  })

  it('多行 buffer 中有「整行以 Error: 開頭」→ 仍命中（CLI 錯誤行在尾段）', () => {
    const result = detectCliError('starting up...\nError: session expired\n')
    expect(result.error).toBe(true)
    expect(result.reason).toBe('error_colon')
  })

  it('含 "usage" 但非 "usage: claude" → 不命中', () => {
    const result = detectCliError('memory usage: 200MB')
    expect(result.error).toBe(false)
  })
})

// ============================================================================
// 6. PtyPromptWatcher — onError 相關行為
// ============================================================================

describe('PtyPromptWatcher — onError 行為', () => {
  const IDLE_MS = 200

  function makeFakeTimers() {
    let nextId = 1
    const pending = new Map<number, { fn: () => void; at: number }>()
    let now = 0

    const fakeSetTimeout = (fn: () => void, ms: number): number => {
      const id = nextId++
      pending.set(id, { fn, at: now + ms })
      return id
    }

    const fakeClearTimeout = (id: number): void => {
      pending.delete(id)
    }

    const tick = (ms: number) => {
      now += ms
      for (const [id, { fn, at }] of [...pending.entries()]) {
        if (at <= now) {
          pending.delete(id)
          fn()
        }
      }
    }

    return { fakeSetTimeout, fakeClearTimeout, tick }
  }

  it('餵錯誤輸出 → idle → onError 一次（onWaiting 不觸發）', () => {
    const { fakeSetTimeout, fakeClearTimeout, tick } = makeFakeTimers()
    const onWaiting = vi.fn()
    const onActive = vi.fn()
    const onError = vi.fn()

    const watcher = new PtyPromptWatcher(onWaiting, onActive, {
      idleMs: IDLE_MS,
      setTimeout: fakeSetTimeout as unknown as typeof globalThis.setTimeout,
      clearTimeout: fakeClearTimeout as unknown as typeof globalThis.clearTimeout,
    }, onError)

    watcher.onData("'claude' is not recognized as an internal or external command")
    expect(onError).not.toHaveBeenCalled()

    tick(IDLE_MS)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith('not_recognized')
    expect(onWaiting).not.toHaveBeenCalled()
    expect(onActive).not.toHaveBeenCalled()
  })

  it('error pattern 命中後 reason 為 no_conversation_found', () => {
    const { fakeSetTimeout, fakeClearTimeout, tick } = makeFakeTimers()
    const onWaiting = vi.fn()
    const onError = vi.fn()

    const watcher = new PtyPromptWatcher(onWaiting, vi.fn(), {
      idleMs: IDLE_MS,
      setTimeout: fakeSetTimeout as unknown as typeof globalThis.setTimeout,
      clearTimeout: fakeClearTimeout as unknown as typeof globalThis.clearTimeout,
    }, onError)

    watcher.onData('No conversation found for id abc-123')
    tick(IDLE_MS)
    expect(onError).toHaveBeenCalledWith('no_conversation_found')
    expect(onWaiting).not.toHaveBeenCalled()
  })

  it('錯誤輸出與選單同時在 buffer 尾段 → error 優先（onError 觸發，onWaiting 不觸發）', () => {
    const { fakeSetTimeout, fakeClearTimeout, tick } = makeFakeTimers()
    const onWaiting = vi.fn()
    const onError = vi.fn()

    const watcher = new PtyPromptWatcher(onWaiting, vi.fn(), {
      idleMs: IDLE_MS,
      setTimeout: fakeSetTimeout as unknown as typeof globalThis.setTimeout,
      clearTimeout: fakeClearTimeout as unknown as typeof globalThis.clearTimeout,
    }, onError)

    // 同時包含 error pattern 與 menu pattern
    watcher.onData('Error: session expired\n❯ 1. Resume from summary (recommended)\n')
    tick(IDLE_MS)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onWaiting).not.toHaveBeenCalled()
  })

  it('error 後餵新資料 → onActive → 可再進 waiting 狀態', () => {
    const { fakeSetTimeout, fakeClearTimeout, tick } = makeFakeTimers()
    const onWaiting = vi.fn()
    const onActive = vi.fn()
    const onError = vi.fn()

    // 使用小 bufferSize，使後來資料能覆蓋掉 error 舊文字
    const watcher = new PtyPromptWatcher(onWaiting, onActive, {
      idleMs: IDLE_MS,
      bufferSize: 50,
      setTimeout: fakeSetTimeout as unknown as typeof globalThis.setTimeout,
      clearTimeout: fakeClearTimeout as unknown as typeof globalThis.clearTimeout,
    }, onError)

    // 進入 error 狀態（短文字，在 buffer 內）
    watcher.onData('Error: auth')
    tick(IDLE_MS)
    expect(onError).toHaveBeenCalledTimes(1)

    // 餵新資料 → onActive，此時 buffer 被新資料覆蓋
    // 餵足夠多的無特徵資料把舊 error 文字擠出 buffer（bufferSize=50）
    watcher.onData('normal output that is long enough to flush'.padEnd(60, '.'))
    expect(onActive).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledTimes(1) // error 不再多觸發

    // 再進 waiting（此時 buffer 只有無特徵的長輸出末尾 + 選單）
    watcher.onData('❯ 1. Resume from summary\n')
    tick(IDLE_MS)
    expect(onWaiting).toHaveBeenCalledTimes(1)
  })

  it('error 後餵新資料 → onActive → 可再進 error 狀態', () => {
    const { fakeSetTimeout, fakeClearTimeout, tick } = makeFakeTimers()
    const onWaiting = vi.fn()
    const onActive = vi.fn()
    const onError = vi.fn()

    // 使用小 bufferSize，確保第一次 error 文字在新資料進來後被擠出
    const watcher = new PtyPromptWatcher(onWaiting, onActive, {
      idleMs: IDLE_MS,
      bufferSize: 50,
      setTimeout: fakeSetTimeout as unknown as typeof globalThis.setTimeout,
      clearTimeout: fakeClearTimeout as unknown as typeof globalThis.clearTimeout,
    }, onError)

    // 第一次進入 error（短文字）
    watcher.onData('ENOENT: bad')
    tick(IDLE_MS)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenNthCalledWith(1, 'enoent')

    // 新資料恢復 active，足夠多的無特徵資料把 ENOENT 擠出 buffer
    watcher.onData('normal normal normal normal normal normal normal')
    expect(onActive).toHaveBeenCalledTimes(1)

    // 第二次進入 error（cannot_find_path）
    // buffer 現在只有上面的 normal 文字 + 此 cannot_find_path
    watcher.onData('Cannot find path X')
    tick(IDLE_MS)
    expect(onError).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenNthCalledWith(2, 'cannot_find_path')
    expect(onWaiting).not.toHaveBeenCalled()
  })

  it('啟動視窗內（now < errorWindowMs）→ error 正常偵測', () => {
    const { fakeSetTimeout, fakeClearTimeout, tick } = makeFakeTimers()
    const onWaiting = vi.fn()
    const onError = vi.fn()
    let clock = 0 // 建構時 startedAt = 0
    const watcher = new PtyPromptWatcher(onWaiting, vi.fn(), {
      idleMs: IDLE_MS,
      errorWindowMs: 15_000,
      now: () => clock,
      setTimeout: fakeSetTimeout as unknown as typeof globalThis.setTimeout,
      clearTimeout: fakeClearTimeout as unknown as typeof globalThis.clearTimeout,
    }, onError)

    clock = 5_000 // 仍在 15s 視窗內
    watcher.onData('Error: boom')
    tick(IDLE_MS)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith('error_colon')
  })

  it('啟動視窗外（now ≥ errorWindowMs）→ error 不再偵測（避免對話內容「一直報錯」）', () => {
    const { fakeSetTimeout, fakeClearTimeout, tick } = makeFakeTimers()
    const onWaiting = vi.fn()
    const onError = vi.fn()
    let clock = 0
    const watcher = new PtyPromptWatcher(onWaiting, vi.fn(), {
      idleMs: IDLE_MS,
      errorWindowMs: 15_000,
      now: () => clock,
      setTimeout: fakeSetTimeout as unknown as typeof globalThis.setTimeout,
      clearTimeout: fakeClearTimeout as unknown as typeof globalThis.clearTimeout,
    }, onError)

    clock = 20_000 // 已過 15s 啟動視窗
    watcher.onData('Error: this is just conversation content mentioning error:')
    tick(IDLE_MS)
    expect(onError).not.toHaveBeenCalled()
  })

  it('啟動視窗外仍可偵測 waiting（選單/提示不受視窗限制）', () => {
    const { fakeSetTimeout, fakeClearTimeout, tick } = makeFakeTimers()
    const onWaiting = vi.fn()
    const onError = vi.fn()
    let clock = 0
    const watcher = new PtyPromptWatcher(onWaiting, vi.fn(), {
      idleMs: IDLE_MS,
      errorWindowMs: 15_000,
      now: () => clock,
      setTimeout: fakeSetTimeout as unknown as typeof globalThis.setTimeout,
      clearTimeout: fakeClearTimeout as unknown as typeof globalThis.clearTimeout,
    }, onError)

    clock = 30_000 // 遠超視窗
    watcher.onData('❯ 1. Resume from summary\n  2. Start fresh\n')
    tick(IDLE_MS)
    expect(onError).not.toHaveBeenCalled()
    expect(onWaiting).toHaveBeenCalledTimes(1)
    expect(onWaiting).toHaveBeenCalledWith('menu_digit', expect.any(Array), undefined)
  })

  it('未傳入 onError 時，error pattern 命中 → 不拋錯，onWaiting 也不觸發', () => {
    const { fakeSetTimeout, fakeClearTimeout, tick } = makeFakeTimers()
    const onWaiting = vi.fn()

    // 不傳第 4 參 onError
    const watcher = new PtyPromptWatcher(onWaiting, vi.fn(), {
      idleMs: IDLE_MS,
      setTimeout: fakeSetTimeout as unknown as typeof globalThis.setTimeout,
      clearTimeout: fakeClearTimeout as unknown as typeof globalThis.clearTimeout,
    })

    expect(() => {
      watcher.onData('Error: something went wrong')
      tick(IDLE_MS)
    }).not.toThrow()
    expect(onWaiting).not.toHaveBeenCalled()
  })

  /*
   * 早夭（ptyManager onExit）測試：NOT UNIT TESTABLE
   * 原因：PtyPromptWatcher 本身無 onExit 邏輯，早夭（PTY 進程結束）的處理
   * 在 ptyManager 中，需要真實 node-pty 進程或 IPC 才能觸發。
   * 純函式層面的 promptDetector 無法在 vitest 環境中模擬 PTY 進程退出事件，
   * 須歸入 E2E / 整合測試範疇（需 Electron 環境 + 真實 PTY）。
   */
})

// ============================================================================
// 7. extractMenuOptions
// ============================================================================

describe('extractMenuOptions', () => {
  // E1: 真實 claude resume 選單樣本
  it('E1: 真實 claude resume 選單 → 3 項，value/label 正確，順序 1,2,3', () => {
    const input = [
      '❯ 1. Resume from summary (recommended)',
      '  2. Resume full session as-is',
      '  3. Don\'t ask me again',
    ].join('\n')
    const result = extractMenuOptions(input)
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ value: '1', label: 'Resume from summary (recommended)' })
    expect(result[1]).toEqual({ value: '2', label: 'Resume full session as-is' })
    expect(result[2]).toEqual({ value: '3', label: "Don't ask me again" })
  })

  // E2: 只有一行 → []（≥2 規則）
  it('E2: 只有一行 "1. foo" → []（需 ≥2 個不同號碼）', () => {
    const result = extractMenuOptions('1. foo')
    expect(result).toEqual([])
  })

  // E3: TUI 重繪殘影—同號碼出現兩次，取最後者
  it('E3: 同號碼出現兩次（TUI 重繪殘影）→ 取最後出現的 label', () => {
    const input = [
      '❯ 1. First render',
      '  2. Option two',
      '❯ 1. Second render',
    ].join('\n')
    const result = extractMenuOptions(input)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ value: '1', label: 'Second render' })
    expect(result[1]).toEqual({ value: '2', label: 'Option two' })
  })

  // E4: 8 個選項 → 截 6
  it('E4: 8 個選項 → 只回傳前 6 個（上限 6）', () => {
    const lines = Array.from({ length: 8 }, (_, i) => `  ${i + 1}. Option ${i + 1}`)
    const result = extractMenuOptions(lines.join('\n'))
    expect(result).toHaveLength(6)
    expect(result[0].value).toBe('1')
    expect(result[5].value).toBe('6')
  })

  // E5: 括號樣式 "1)" 也命中
  it('E5: "1)" 括號樣式也能命中', () => {
    const input = [
      '  1) alpha',
      '  2) beta',
    ].join('\n')
    const result = extractMenuOptions(input)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ value: '1', label: 'alpha' })
    expect(result[1]).toEqual({ value: '2', label: 'beta' })
  })

  // E6: 無數字行 → []
  it('E6: 無數字選單行 → []', () => {
    const input = 'Are you sure? (y/n)\nPress Enter to continue'
    const result = extractMenuOptions(input)
    expect(result).toEqual([])
  })

  // E7: label 超 80 字 → 截斷至 80
  it('E7: label 超 80 字 → 截斷至 80 字', () => {
    const longLabel = 'A'.repeat(100)
    const input = [
      `1. ${longLabel}`,
      '2. Short label',
    ].join('\n')
    const result = extractMenuOptions(input)
    expect(result[0].label.length).toBeLessThanOrEqual(80)
    expect(result[0].label).toBe('A'.repeat(80))
  })

  // E8: watcher 整合——含 2 選項選單的 chunk → idle 後 onWaiting 收到 (reason, options 長度 2)
  it('E8: watcher 整合：含 2 選項選單的 chunk → idle 後 onWaiting 收到 (reason, options 長度 2)', () => {
    let nextId = 1
    const pending = new Map<number, { fn: () => void; at: number }>()
    let now = 0
    const fakeSetTimeout = (fn: () => void, ms: number): number => {
      const id = nextId++
      pending.set(id, { fn, at: now + ms })
      return id
    }
    const fakeClearTimeout = (id: number): void => { pending.delete(id) }
    const tick = (ms: number) => {
      now += ms
      for (const [id, { fn, at }] of [...pending.entries()]) {
        if (at <= now) { pending.delete(id); fn() }
      }
    }

    const onWaiting = vi.fn()
    const watcher = new PtyPromptWatcher(onWaiting, vi.fn(), {
      idleMs: 200,
      setTimeout: fakeSetTimeout as unknown as typeof globalThis.setTimeout,
      clearTimeout: fakeClearTimeout as unknown as typeof globalThis.clearTimeout,
    })

    const chunk = '❯ 1. Resume from summary (recommended)\n  2. Resume full session as-is\n'
    watcher.onData(chunk)
    expect(onWaiting).not.toHaveBeenCalled()

    tick(200)
    expect(onWaiting).toHaveBeenCalledTimes(1)
    const [reason, options] = onWaiting.mock.calls[0]
    expect(typeof reason).toBe('string')
    expect(Array.isArray(options)).toBe(true)
    expect(options).toHaveLength(2)
  })

  // E9: 帶外框的方塊選單（claude 權限/選項提示的真實形態）—— 回歸：行首框線 `│ `
  //     曾使選項完全掃不到（對話欄顯示等待卡卻無按鈕，使用者只能進終端機選）。
  it('E9: 帶外框方塊選單 → 解析出 3 項，label 去掉框線與填充空白', () => {
    const input = [
      '╭──────────────────────────────────────╮',
      '│ Do you want to proceed?              │',
      '│ ❯ 1. Yes                             │',
      "│   2. Yes, and don't ask again        │",
      '│   3. No                              │',
      '╰──────────────────────────────────────╯',
    ].join('\n')
    const result = extractMenuOptions(input)
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ value: '1', label: 'Yes' })
    expect(result[1]).toEqual({ value: '2', label: "Yes, and don't ask again" })
    expect(result[2]).toEqual({ value: '3', label: 'No' })
  })

  // E10: 外框 + 括號樣式 "1)"
  it('E10: 外框方塊內 "1)" 括號樣式 → 命中且去尾框', () => {
    const input = ['│ 1) Keep        │', '│ 2) Discard     │'].join('\n')
    const result = extractMenuOptions(input)
    expect(result).toEqual([
      { value: '1', label: 'Keep' },
      { value: '2', label: 'Discard' },
    ])
  })

  // E11: 框內統計/版本號等「行首框線 + 數字」雜訊不得誤判為選項
  it('E11: 框內數字雜訊（token 統計、版本號）→ []（無 [.)] 分隔不命中）', () => {
    const input = ['│ 1234 tokens used │', '│ v1.2 release │', '│ used 5 of 10 │'].join('\n')
    expect(extractMenuOptions(input)).toEqual([])
  })

  it('E12: Codex approval 選單使用 › 游標 → 解析出 3 項', () => {
    const input = [
      'Would you like to run the following command?',
      '› 1. Yes, proceed (y)',
      "  2. Yes, and don't ask again for commands that start with `New-Item` (p)",
      '  3. No, and tell Codex what to do differently (esc)',
      'Press enter to confirm or esc to cancel',
    ].join('\n')
    const result = extractMenuOptions(input)
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ value: '1', label: 'Yes, proceed (y)' })
    expect(result[1].label).toContain("Yes, and don't ask again")
    expect(result[2].label).toContain('No, and tell Codex')
  })
})

// ============================================================================
// 8. isBenignStartupPrompt — claude 開場/上手畫面辨識
// ============================================================================

describe('isBenignStartupPrompt', () => {
  it('信任資料夾畫面 → true', () => {
    expect(isBenignStartupPrompt('Is this a project you created or one you trust?')).toBe(true)
    expect(isBenignStartupPrompt('❯ 1. Yes, I trust this folder\n2. No, exit')).toBe(true)
    expect(isBenignStartupPrompt('Quick safety check: ...')).toBe(true)
  })

  it('歡迎畫面 → true', () => {
    expect(isBenignStartupPrompt('✻ Welcome to Claude Code')).toBe(true)
  })

  it('一般 resume 選單（非開場上手）→ false', () => {
    expect(isBenignStartupPrompt('❯ 1. Resume from summary\n  2. Start fresh')).toBe(false)
  })

  it('一般 y/n 提示 → false', () => {
    expect(isBenignStartupPrompt('Overwrite file? (y/n)')).toBe(false)
  })
})

// ============================================================================
// 9. PtyPromptWatcher — 暖機 / 開場畫面 / 防閃爍（回歸：開 CLI 後一直顯示）
// ============================================================================

describe('PtyPromptWatcher — 暖機 / benign / 防閃爍', () => {
  const IDLE_MS = 200

  function makeFakeTimers() {
    let nextId = 1
    const pending = new Map<number, { fn: () => void; at: number }>()
    let now = 0
    const fakeSetTimeout = (fn: () => void, ms: number): number => {
      const id = nextId++
      pending.set(id, { fn, at: now + ms })
      return id
    }
    const fakeClearTimeout = (id: number): void => { pending.delete(id) }
    const tick = (ms: number) => {
      now += ms
      for (const [id, { fn, at }] of [...pending.entries()]) {
        if (at <= now) { pending.delete(id); fn() }
      }
    }
    return { fakeSetTimeout, fakeClearTimeout, tick }
  }

  it('暖機視窗內（now < warmupMs）→ 任何 waiting/error 都不偵測', () => {
    const { fakeSetTimeout, fakeClearTimeout, tick } = makeFakeTimers()
    const onWaiting = vi.fn()
    const onError = vi.fn()
    let clock = 0
    const watcher = new PtyPromptWatcher(onWaiting, vi.fn(), {
      idleMs: IDLE_MS,
      warmupMs: 5_000,
      now: () => clock,
      setTimeout: fakeSetTimeout as unknown as typeof globalThis.setTimeout,
      clearTimeout: fakeClearTimeout as unknown as typeof globalThis.clearTimeout,
    }, onError)

    clock = 2_000 // 仍在暖機內
    watcher.onData('❯ 1. Resume from summary\n  2. Start fresh\n')
    tick(IDLE_MS)
    expect(onWaiting).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('暖機過後 → 真正的對話選單照常偵測（含 options）', () => {
    const { fakeSetTimeout, fakeClearTimeout, tick } = makeFakeTimers()
    const onWaiting = vi.fn()
    let clock = 0
    const watcher = new PtyPromptWatcher(onWaiting, vi.fn(), {
      idleMs: IDLE_MS,
      warmupMs: 5_000,
      now: () => clock,
      setTimeout: fakeSetTimeout as unknown as typeof globalThis.setTimeout,
      clearTimeout: fakeClearTimeout as unknown as typeof globalThis.clearTimeout,
    })

    clock = 8_000 // 暖機已過
    watcher.onData('❯ 1. Resume from summary\n  2. Start fresh\n')
    tick(IDLE_MS)
    expect(onWaiting).toHaveBeenCalledTimes(1)
    expect(onWaiting).toHaveBeenCalledWith('menu_digit', expect.any(Array), undefined)
  })

  it('開場信任畫面（benign）即使暖機過後也不彈卡', () => {
    const { fakeSetTimeout, fakeClearTimeout, tick } = makeFakeTimers()
    const onWaiting = vi.fn()
    let clock = 0
    const watcher = new PtyPromptWatcher(onWaiting, vi.fn(), {
      idleMs: IDLE_MS,
      warmupMs: 5_000,
      now: () => clock,
      setTimeout: fakeSetTimeout as unknown as typeof globalThis.setTimeout,
      clearTimeout: fakeClearTimeout as unknown as typeof globalThis.clearTimeout,
    })

    clock = 8_000
    watcher.onData('Is this a project you trust?\n❯ 1. Yes, I trust this folder\n2. No, exit\n')
    tick(IDLE_MS)
    expect(onWaiting).not.toHaveBeenCalled()
  })

  it('防閃爍：waiting 後餵「純控制序列」chunk（去 ANSI 後無可見字）→ 不解除 active', () => {
    const { fakeSetTimeout, fakeClearTimeout, tick } = makeFakeTimers()
    const onWaiting = vi.fn()
    const onActive = vi.fn()
    let clock = 0
    const watcher = new PtyPromptWatcher(onWaiting, onActive, {
      idleMs: IDLE_MS,
      warmupMs: 0,
      now: () => clock,
      setTimeout: fakeSetTimeout as unknown as typeof globalThis.setTimeout,
      clearTimeout: fakeClearTimeout as unknown as typeof globalThis.clearTimeout,
    })

    watcher.onData('❯ 1. Resume from summary\n  2. Start fresh\n')
    tick(IDLE_MS)
    expect(onWaiting).toHaveBeenCalledTimes(1)

    // 游標隱顯（純控制序列）→ 不應觸發 onActive（否則卡片閃掉又閃回）
    watcher.onData('\x1b[?25l\x1b[?25h')
    expect(onActive).not.toHaveBeenCalled()

    // 帶可見內容的 chunk → 才解除
    watcher.onData('real output appears')
    expect(onActive).toHaveBeenCalledTimes(1)
  })
})

// ============================================================================
// 10. extractPromptText — 抽取選項上方的「問題/標題」
// ============================================================================

describe('extractPromptText', () => {
  it('權限提示：抽出「Do you want to proceed?」', () => {
    const screen = [
      'Bash(echo hello)',
      'Do you want to proceed?',
      '❯ 1. Yes',
      '  2. No',
    ].join('\n')
    // 緊鄰選項上方往上收集（含 Bash 行），正序合併
    expect(extractPromptText(screen)).toBe('Bash(echo hello)\nDo you want to proceed?')
  })

  it('/model：抽出標題 + 說明', () => {
    const screen = [
      'Select model',
      'Switch between Claude models.',
      '❯ 1. Default',
      '  2. Sonnet',
    ].join('\n')
    expect(extractPromptText(screen)).toBe('Select model\nSwitch between Claude models.')
  })

  it('遇空白行即停（不跨區塊抓到無關內容）', () => {
    const screen = [
      'some earlier unrelated output',
      '',
      'Pick one:',
      '❯ 1. A',
      '  2. B',
    ].join('\n')
    expect(extractPromptText(screen)).toBe('Pick one:')
  })

  it('去除行首/行尾外框字（│ ❯ 等）', () => {
    const screen = [
      '│ Do you want to proceed?              │',
      '│ ❯ 1. Yes                             │',
      '│   2. No                              │',
    ].join('\n')
    expect(extractPromptText(screen)).toBe('Do you want to proceed?')
  })

  it('選項與問題間有空白行（/model 真實格式）→ 仍抓得到問題', () => {
    // 回歸：claude /model 在說明與選項之間隔一行空白，過去會在該空白行立即放棄
    const screen = [
      '────────────────────',
      '  Select model',
      '  Switch between Claude models.',
      '',
      '  ❯ 1. Default',
      '    2. Sonnet',
    ].join('\n')
    expect(extractPromptText(screen)).toBe('Select model\nSwitch between Claude models.')
  })

  it('選項在第一行（上方無內容）→ 空字串', () => {
    expect(extractPromptText('❯ 1. Yes\n  2. No')).toBe('')
  })

  it('無選項行 → 空字串', () => {
    expect(extractPromptText('just some text\nno menu here')).toBe('')
  })

  it('最多 3 行（maxLines）', () => {
    const screen = ['L1', 'L2', 'L3', 'L4', '❯ 1. X', '  2. Y'].join('\n')
    // 往上收 3 行 = L4,L3,L2 → 正序
    expect(extractPromptText(screen)).toBe('L2\nL3\nL4')
  })
})
