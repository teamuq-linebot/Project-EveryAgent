/**
 * AgentTermView.tsx — AgentTeams 終端檢視
 *
 * 以 xterm 渲染 agentConv:raw 的 PTY 原始輸出（含 ANSI），讓使用者看到真實 TUI。
 *
 * 設計重點：
 * - 固定 120×30（與 agentConversationService PTY 尺寸對齊），不使用 FitAddon
 *   （避免 display:none 時 fit 算 0 尺寸拋 TypeError 的坑）。
 * - xterm CSS 已在 main.tsx 全域引入，此處無需重複 import。
 * - 終端亦可直接互動：鍵盤輸入（方向鍵 ANSI escape、Enter、字元）原樣送進 PTY，
 *   不帶 skill 前綴，適合方向鍵操作 TUI 選單或直接輸入指令。
 *   卡片輸入框仍為主要輸入途徑（自動加 skill 前綴）；兩者並存、互不干擾。
 * - 「常駐掛載」語意：父層以 display:none/flex 切換可見，元件不卸載，不漏歷史輸出。
 *
 * agentteams-embedded-conversation-20260608 §批次 2b
 */
import React, { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  /** 對話 ID，同 agentConvRaw payload.conversationId。 */
  conversationId: string;
}

// ---------------------------------------------------------------------------
// AgentTermView
// ---------------------------------------------------------------------------

export function AgentTermView({ conversationId }: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;

    const term = new Terminal({
      cols: 120,
      rows: 30,
      // PTY 終端不可做 EOL 轉換：把裸 \n 轉成 \r\n 會破壞 TUI 自管的游標定位
      // （版面左移/文字重疊殘影）。
      convertEol: false,
      scrollback: 5000,
      cursorBlink: true,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(container);

    // 點擊即 focus，讓使用者可直接用方向鍵/Enter 與 TUI 選單互動
    container.addEventListener("click", () => term.focus());

    // buffer replay：先暫存即時流 chunk，等 buffer 拿回後先寫 buffer、再 flush pending，
    // 確保歷史輸出出現在即時輸出之前（時序正確）。
    let bufferReady = false;
    const pending: string[] = [];

    const unsubscribe = window.tuq.onAgentConvRaw((payload) => {
      if (payload.conversationId !== conversationId) return;
      if (bufferReady) {
        term.write(payload.chunk);
      } else {
        pending.push(payload.chunk);
      }
    });

    // 補齊掛載前 PTY 早期輸出（AgentTermView 晚訂閱導致的空白問題）
    window.tuq.agentConv.getBuffer(conversationId).then((r) => {
      if (r.ok && r.data?.buffer) {
        term.write(r.data.buffer);
      }
      bufferReady = true;
      for (const chunk of pending) {
        term.write(chunk);
      }
      pending.length = 0;
    }).catch(() => {
      bufferReady = true;
      for (const chunk of pending) {
        term.write(chunk);
      }
      pending.length = 0;
    });

    // 使用者在終端的原始按鍵（方向鍵 ANSI escape、Enter \r、字元等）原樣送進 PTY
    const dataDispose = term.onData((data: string) => {
      window.tuq.agentConv.sendInput(conversationId, data).catch(() => {
        // PTY 已死 → 忽略
      });
    });

    let rafId = 0;
    const safeFit = (): void => {
      if (disposed) return;
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      try {
        fitAddon.fit();
        const { cols, rows } = term;
        if (cols > 0 && rows > 0) {
          window.tuq.agentConv.resize(conversationId, cols, rows).catch(() => {});
        }
      } catch {
        // xterm renderService 尚未就緒，下一次 resize 會再試。
      }
    };
    const scheduleFit = (): void => {
      if (disposed) return;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(safeFit);
    };
    scheduleFit();
    const ro = new ResizeObserver(scheduleFit);
    ro.observe(container);

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      ro.disconnect();
      dataDispose.dispose();
      unsubscribe();
      term.dispose();
    };
    // conversationId 變更時（key={conversationId} 觸發重 mount）重建 terminal
  }, [conversationId]);

  return (
    <div className="at-conv-term">
      <div ref={containerRef} className="at-conv-term__xterm" />
    </div>
  );
}
