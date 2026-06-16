import React, { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { getXtermTheme, FONT_MONO } from '../../theme'
import type { PtyDataPayload } from '../../../shared/ipcContracts'

/**
 * PTY 就緒回呼登記簿。
 *
 * 呼叫端（如 CliBackendSection）可在 TerminalPanel mount 之前，
 * 以 ptyId 為鍵登記一個回呼；spawn 成功後 TerminalPanel 會觸發一次並自動移除。
 * 這讓外部模組不需透過 CliCard 中間層傳遞 onReady prop 即可得到通知。
 */
export const ptyReadyCallbacks = new Map<string, () => void>()

interface Props {
  ptyId: string
  shell?: string
  cwd?: string
  /** PTY spawn 成功後呼叫一次（StrictMode 雙 mount 防重）。可選；另可用 ptyReadyCallbacks 登記。 */
  onReady?: () => void
}

type Status = 'connecting' | 'running' | 'killed' | 'error'

export default function TerminalPanel({ ptyId, shell, cwd, onReady }: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [status, setStatus] = useState<Status>('connecting')
  const [errorMsg, setErrorMsg] = useState<string>('')
  // StrictMode 雙 mount 防重：確保 onReady / ptyReadyCallbacks 只觸發一次。
  const onReadyFiredRef = useRef(false)

  // -- Mount: create terminal, spawn pty -----------------------------------
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // disposed：effect 已 cleanup（StrictMode 雙重 mount / 真卸載）後，延遲/非同步回呼
    // （ResizeObserver / rAF / spawn.then / pty data）必須先檢查此旗標再動作，
    // 否則對已 dispose 的 xterm 呼叫會拋 `Cannot read properties of undefined (reading 'dimensions')`。
    let disposed = false

    // 終端固定深色主題：一鍵登入展開的多為全螢幕 TUI（claude / agy 裸啟動進入登入畫面），
    // 自帶深色 UI；隨 app 淺色主題會對比極低幾乎看不到，故鎖定 'dark'（與 Session TerminalPanel 一致）。
    const term = new Terminal({
      theme: getXtermTheme('dark'),
      fontFamily: FONT_MONO,
      // 登入終端裝的是全螢幕 TUI（無 scrollback 不能捲）：用較小字級 + 緊湊行高塞進更多列，
      // 配合近全螢幕的 overlay，讓登入畫面盡量完整顯示不被裁切。
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      allowTransparency: false,
      scrollback: 5000,
      // PTY 終端不可做 EOL 轉換：把裸 \n 轉成 \r\n 會破壞 TUI 自管的游標定位
      // （版面左移/文字重疊殘影），登入畫面會錯位看似「無法捲動」。故設 false（與 Session TerminalPanel 一致）。
      convertEol: false,
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(container)

    termRef.current = term
    fitRef.current = fitAddon

    // 安全 fit：容器隱藏或尚未佈局時為 0 尺寸，此時 fitAddon.fit() 會讀到 undefined 的
    // renderService.dimensions 而拋 TypeError。故：先擋 0 尺寸 + try/catch，並用 rAF 推到下一幀
    // （打斷 ResizeObserver 同步迴圈）。dispose 後不再 fit。
    let rafId = 0
    const safeFit = (): void => {
      if (disposed) return
      const el = term.element
      if (!el || el.clientWidth === 0 || el.clientHeight === 0) return
      try {
        fitAddon.fit()
        const { cols, rows } = term
        if (cols > 0 && rows > 0) window.tuq.pty.resize(ptyId, cols, rows)
      } catch {
        // xterm renderService 尚未就緒 → 略過本次（下次 resize 會再試）
      }
    }
    const scheduleFit = (): void => {
      if (disposed) return
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(safeFit)
    }
    scheduleFit()

    // User typing → send to PTY
    const inputDispose = term.onData((data: string) => {
      window.tuq.pty.write(ptyId, data)
    })

    // PTY output → write to terminal
    const unsubData = window.tuq.onPtyData((payload: PtyDataPayload) => {
      if (disposed) return
      if (payload.id !== ptyId) return
      term.write(payload.data)
    })

    // Spawn the PTY
    const { cols, rows } = term
    window.tuq.pty
      .spawn({ id: ptyId, shell, cwd, cols, rows })
      .then((result) => {
        if (disposed) return
        if (result.ok) {
          setStatus('running')
          // PTY 就緒通知：onReady prop + ptyReadyCallbacks 登記，只觸發一次（StrictMode 防重）。
          if (!onReadyFiredRef.current) {
            onReadyFiredRef.current = true
            onReady?.()
            const cb = ptyReadyCallbacks.get(ptyId)
            if (cb) {
              ptyReadyCallbacks.delete(ptyId)
              cb()
            }
          }
        } else {
          setStatus('error')
          setErrorMsg(result.error)
        }
      })
      .catch((e: unknown) => {
        if (disposed) return
        setStatus('error')
        setErrorMsg(e instanceof Error ? e.message : String(e))
      })

    // ResizeObserver → 經 rAF 安全 fit + resize PTY（rAF 打斷同步迴圈）
    const ro = new ResizeObserver(() => {
      scheduleFit()
    })
    ro.observe(container)

    return () => {
      disposed = true
      cancelAnimationFrame(rafId)
      ro.disconnect()
      inputDispose.dispose()
      unsubData()
      window.tuq.pty.kill(ptyId)
      term.dispose()
      termRef.current = null
      fitRef.current = null
      setStatus('killed')
      // ⚠️ 不在 cleanup 刪除 ptyReadyCallbacks[ptyId]：StrictMode（dev）會 mount→cleanup→mount，
      // 若第一次 cleanup 就刪掉回呼，第二次 mount 的 spawn 完成時 get(ptyId) 會是 undefined →
      // 注入回呼永遠不觸發 → 一鍵安裝/登入的終端機開了卻空白、指令沒被打進去（regression）。
      // 回呼改由「spawn 成功的 fire 路徑」刪除（見上方 onReady 區塊）；開新面板時呼叫端
      // （CliBackendSection.handleOpenTerminal）也會刪掉前一個 ptyId 的殘留，故此處不刪無洩漏疑慮。
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ptyId])

  const statusLabel: Record<Status, string> = {
    connecting: '正在啟動…',
    running: '運行中',
    killed: '已關閉',
    error: `錯誤：${errorMsg}`,
  }

  return (
    <div className="terminal-panel" style={{ height: '100%' }}>
      <div className="terminal-panel__header">
        <span className="terminal-panel__header-title">
          {shell ?? (navigator.platform.startsWith('Win') ? 'cmd.exe' : '$SHELL')}
        </span>
        <span
          className="terminal-panel__status"
          style={{ color: status === 'error' ? 'var(--error)' : undefined }}
        >
          {statusLabel[status]}
        </span>
      </div>
      <div
        ref={containerRef}
        className="terminal-panel__body"
        style={{ flex: 1, minHeight: 0 }}
      />
    </div>
  )
}
