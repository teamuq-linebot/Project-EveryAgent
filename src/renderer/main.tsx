import '@xyflow/react/dist/style.css'
import './global.css'
import '@xterm/xterm/css/xterm.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import type { InitProgressState, IpcResult } from '../shared/ipcContracts'

// 開機畫面（boot splash）控制：DOM/樣式由 index.html 內聯提供（見 src/renderer/index.html），
// 但控制邏輯必須在被 bundle 的此檔——生產版 CSP 為 script-src 'self'（無 unsafe-inline），
// index.html 的 inline <script> 會被擋掉。此檔屬 'self' 腳本，CSP 允許執行。
//
// __setBootStatus 仍掛到 window，供未來進度功能用。bundle 內於執行期掛 window 不受
// CSP script-src 限制（限制的是 inline <script> tag，非 'self' 腳本的執行期行為）。
declare global {
  interface Window {
    __setBootStatus?: (t: string) => void
  }
}

// 淡出並移除開機畫面（冪等：找不到節點直接返回）。
function dismissBootSplash(): void {
  const el = document.getElementById('boot-splash')
  if (!el) return
  el.classList.add('boot-splash--hide')
  setTimeout(() => el.remove(), 300)
}

// 更新開機畫面狀態文字（供未來進度功能用）。
function setBootStatus(t: string): void {
  const el = document.getElementById('boot-splash-status')
  if (el) el.textContent = t
}
window.__setBootStatus = setBootStatus

// 模組載入時記錄起始時間，用來計算 splash 的最短顯示時間（避免一閃而過）。
const bootStart = performance.now()

// ---------------------------------------------------------------------------
// 開機進度（init-progress-pipeline）：splash 顯示逐步驟白話進度，收到整體 done 才淡出。
// window.tuq 由並行 WIP（env.d.ts）更新；此處用本地 cast 取用，不碰 env.d.ts。
// ---------------------------------------------------------------------------
type InitProgressApi = {
  initProgress?: { get(): Promise<IpcResult<InitProgressState>> }
  onInitProgress?: (cb: (s: InitProgressState) => void) => () => void
}
const tuq = window.tuq as unknown as typeof window.tuq & InitProgressApi

// splash 只淡出一次：cold/warm/done/保底各路徑共用此旗標，確保冪等。
let splashDismissed = false
let unsubscribeProgress: (() => void) | null = null

// 排程淡出：保證 splash 至少顯示 ~600ms（避免一閃而過），且只執行一次；
// 順手解除進度訂閱（done 後不再需要 live UPDATE）。
function scheduleDismiss(): void {
  if (splashDismissed) return
  splashDismissed = true
  if (unsubscribeProgress) {
    unsubscribeProgress()
    unsubscribeProgress = null
  }
  const remaining = Math.max(0, 600 - (performance.now() - bootStart))
  setTimeout(dismissBootSplash, remaining)
}

// 套用一筆進度快照：更新狀態列文案（只顯示 main 給的 current.label，renderer 不自造），
// 收到整體 done 才排程淡出。
function applyProgress(state: InitProgressState): void {
  if (state?.current?.label) setBootStatus(state.current.label)
  if (state?.done) scheduleDismiss()
}

// 安全保底：萬一 render 拋錯/卡住或 main 進度卡住，15s 後無條件移除 splash，避免永久卡住擋住
// ErrorBoundary 的「啟動失敗」頁（取代原 index.html 被 CSP 擋掉的 inline timer）；走 scheduleDismiss 冪等。
setTimeout(scheduleDismiss, 15000)

/**
 * 頂層 ErrorBoundary：任何 renderer 例外都顯示錯誤訊息，
 * 避免整片白屏（白屏無從 debug）。常見原因：window.tuq 未注入（preload 失敗）。
 */
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }
  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // 印到 main stdout（main 有掛 console-message log）
    console.error('[renderer-fatal]', error, info.componentStack)
  }
  render(): React.ReactNode {
    if (this.state.error) {
      const tuqMissing = typeof window === 'undefined' || !window.tuq
      return (
        <div
          style={{
            padding: 24,
            fontFamily: 'system-ui, sans-serif',
            color: '#171717',
            lineHeight: 1.6,
          }}
        >
          <h2 style={{ color: '#fb2c36' }}>啟動失敗</h2>
          <p>
            <strong>{this.state.error.message}</strong>
          </p>
          {tuqMissing && (
            <p style={{ color: '#737373' }}>
              偵測到 <code>window.tuq</code> 未注入 —— preload 載入失敗，請看終端機的{' '}
              <code>[preload-error]</code> 訊息。
            </p>
          )}
          <pre
            style={{
              background: '#f8fafc',
              border: '1px solid #e5e5e5',
              borderRadius: 6,
              padding: 12,
              overflow: 'auto',
              fontSize: 12,
              whiteSpace: 'pre-wrap',
            }}
          >
            {this.state.error.stack}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

// Chromium 對 ResizeObserver 的「loop completed with undelivered notifications」是良性
// 警告（fit 已用 rAF 打斷實際迴圈）。它非真錯誤卻會洗版 console，於此吞掉這一類訊息。
window.addEventListener('error', (e) => {
  if (typeof e.message === 'string' && e.message.includes('ResizeObserver loop')) {
    e.stopImmediatePropagation()
    e.preventDefault()
  }
})

const root = document.getElementById('root')
if (!root) throw new Error('#root element not found')

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)

// 掛載後驅動開機畫面淡出。
// - 有進度管線（tuq.initProgress + onInitProgress）：先訂閱（避免漏接 live UPDATE），
//   再補拉一次目前快照；文案隨 UPDATE 變化，淡出由整體 done 主導（見 applyProgress / scheduleDismiss）。
// - 無進度管線（preload 未注入 / 啟動失敗）：fallback 排程淡出，維持原「render 後 ~600ms 淡出」效果，
//   確保 ErrorBoundary 的「啟動失敗」頁能露出。
// 兩路徑與模組頂端的 15s 無條件保底皆走 scheduleDismiss，冪等只淡出一次。
if (tuq?.initProgress?.get && tuq?.onInitProgress) {
  // 先訂閱，避免在 get() 往返期間漏接 live UPDATE。
  unsubscribeProgress = tuq.onInitProgress(applyProgress)
  tuq.initProgress
    .get()
    .then((res) => {
      if (res?.ok) applyProgress(res.data)
    })
    .catch(() => {})
} else {
  scheduleDismiss()
}
