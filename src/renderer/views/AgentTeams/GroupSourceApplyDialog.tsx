/**
 * GroupSourceApplyDialog.tsx — 「套用並搬移」確認對話框（行為乙 BM7）
 *
 * 受控元件：父層（GroupConfigEditor）算好「將搬移的團隊白話名清單」與「新來源 label」後傳入。
 * 三種顯示態：
 *   1. 確認態（result===null && !busy）：列出將搬移的團隊，說明後果，提供「確定搬移 / 取消」。
 *   2. 搬移中（busy）：spinner + 「正在搬移團隊…請稍候」，按鈕鎖定。
 *   3. 結果態（result!==null）：顯示成功/失敗摘要，只剩「關閉」。
 *
 * UX 鐵則（目標用戶＝非工程師）：文案全白話，禁穿透檔名/欄位 key/teamId/skillName/CLI/路徑。
 * 樣式沿用既有 atrf-ge-* 慣例（按鈕、關閉鈕）；置中遮罩用 inline style，不新增 CSS。
 */
import React from "react";

// ---------------------------------------------------------------------------
// 介面
// ---------------------------------------------------------------------------

/** 搬移結果摘要（由父層從 ApplyGroupSourceResult 整理成白話）。 */
export interface ApplyResultSummary {
  /** 成功搬移的團隊數。 */
  successCount: number;
  /** 未能搬移的團隊：白話名 + 白話原因。 */
  failures: { displayName: string; reason: string }[];
}

export interface GroupSourceApplyDialogProps {
  open: boolean;
  /** 工作群組名（白話）。 */
  groupName: string;
  /** 新來源資料夾的白話 label。 */
  toSourceLabel: string;
  /** 將被搬移的團隊白話名清單（父層已轉好，非 teamId）。 */
  teamNames: string[];
  /** 搬移中（IPC 進行）：顯示 spinner、鎖定按鈕。 */
  busy: boolean;
  /** 搬移結果摘要；null＝尚未送出（確認態）。 */
  result: ApplyResultSummary | null;
  /** 整批失敗（IPC 回 !ok）時的白話錯誤；非 null 時顯示於結果態。 */
  errorMessage?: string | null;
  /** 按「確定搬移」。 */
  onConfirm: () => void;
  /** 按「取消 / 關閉」。 */
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// 主元件
// ---------------------------------------------------------------------------

export function GroupSourceApplyDialog({
  open,
  groupName,
  toSourceLabel,
  teamNames,
  busy,
  result,
  errorMessage,
  onConfirm,
  onClose,
}: GroupSourceApplyDialogProps): React.JSX.Element | null {
  if (!open) return null;

  const hasTeams = teamNames.length > 0;
  const showResult = result !== null || (errorMessage != null && errorMessage !== "");

  return (
    <div className="atrf-ge-overlay" style={CENTERED_OVERLAY} role="region" aria-label="搬移團隊確認">
      <div className="atrf-ge-backdrop" aria-hidden="true" onClick={busy ? undefined : onClose} />

      <div className="atrf-ge-panel" style={DIALOG_PANEL} role="dialog" aria-modal="true">
        {/* 頭部 */}
        <div className="atrf-ge-header">
          <h3 className="atrf-ge-title">
            {showResult
              ? "搬移結果"
              : hasTeams
                ? "要把這個工作群組的團隊搬到新資料夾嗎？"
                : "套用資料夾設定"}
          </h3>
          {!busy && (
            <button type="button" className="atrf-ge-close" onClick={onClose} aria-label="關閉">
              ✕
            </button>
          )}
        </div>

        {/* 內容 */}
        <div className="atrf-ge-body" style={DIALOG_BODY}>
          {showResult ? (
            <ResultView result={result} errorMessage={errorMessage} />
          ) : busy ? (
            <div style={BUSY_BOX}>
              <span style={SPINNER} aria-hidden="true" />
              <p style={{ margin: 0 }}>正在搬移團隊…請稍候</p>
            </div>
          ) : hasTeams ? (
            <ConfirmView groupName={groupName} toSourceLabel={toSourceLabel} teamNames={teamNames} />
          ) : (
            <p style={{ margin: 0, lineHeight: 1.6 }}>
              這個群組目前沒有需要搬移的團隊，套用後只會記住資料夾設定。
            </p>
          )}
        </div>

        {/* 底部按鈕 */}
        <div className="atrf-ge-footer">
          {showResult ? (
            <button type="button" className="atrf-ge-btn atrf-ge-btn--save" onClick={onClose}>
              關閉
            </button>
          ) : (
            <>
              <button
                type="button"
                className="atrf-ge-btn atrf-ge-btn--cancel"
                onClick={onClose}
                disabled={busy}
              >
                取消
              </button>
              <button
                type="button"
                className="atrf-ge-btn atrf-ge-btn--save"
                onClick={onConfirm}
                disabled={busy}
              >
                {hasTeams ? "確定搬移" : "確定"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 確認態內容
// ---------------------------------------------------------------------------

function ConfirmView({
  groupName,
  toSourceLabel,
  teamNames,
}: {
  groupName: string;
  toSourceLabel: string;
  teamNames: string[];
}): React.JSX.Element {
  return (
    <>
      <p style={{ margin: 0, lineHeight: 1.6 }}>
        「{groupName}」有 {teamNames.length} 個團隊會搬到「{toSourceLabel}」。
      </p>
      <div>
        <p style={{ margin: "0 0 6px", fontWeight: 600 }}>將搬移：</p>
        <ul style={LIST}>
          {teamNames.map((n, i) => (
            <li key={`${n}-${i}`} style={{ marginBottom: 2 }}>{n}</li>
          ))}
        </ul>
      </div>
      <p style={WARNING}>
        搬移會移動檔案並重新設定，請保持網路與雲端硬碟連線，完成前請勿關閉程式。
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// 結果態內容
// ---------------------------------------------------------------------------

function ResultView({
  result,
  errorMessage,
}: {
  result: ApplyResultSummary | null;
  errorMessage?: string | null;
}): React.JSX.Element {
  // 整批失敗（IPC !ok）：只顯示白話錯誤、不改設定。
  if (errorMessage != null && errorMessage !== "") {
    return (
      <>
        <p style={{ margin: 0, lineHeight: 1.6 }}>搬移沒有完成，設定維持原樣。</p>
        <p style={WARNING}>{errorMessage}</p>
      </>
    );
  }

  const summary = result ?? { successCount: 0, failures: [] };
  return (
    <>
      <p style={{ margin: 0, lineHeight: 1.6 }}>完成：成功 {summary.successCount} 個。</p>
      {summary.failures.length > 0 && (
        <div>
          <p style={{ margin: "8px 0 6px", fontWeight: 600 }}>
            未搬移 {summary.failures.length} 個：
          </p>
          <ul style={LIST}>
            {summary.failures.map((f, i) => (
              <li key={`${f.displayName}-${i}`} style={{ marginBottom: 4 }}>
                {f.displayName}
                {f.reason ? `（${f.reason}）` : ""}
              </li>
            ))}
          </ul>
          <p style={WARNING}>這些團隊仍在原本的資料夾。</p>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// inline 樣式（置中遮罩；不新增 CSS）
// ---------------------------------------------------------------------------

const CENTERED_OVERLAY: React.CSSProperties = {
  justifyContent: "center",
  alignItems: "center",
  zIndex: 400, // 蓋在分組設定面板（z-index:300）之上
};

const DIALOG_PANEL: React.CSSProperties = {
  position: "relative",
  width: 420,
  maxWidth: "92vw",
  height: "auto",
  maxHeight: "82vh",
  borderLeft: "none",
  borderRadius: 12,
  boxShadow: "0 12px 40px rgba(0,0,0,0.28)",
};

const DIALOG_BODY: React.CSSProperties = {
  gap: 12,
  fontSize: 13,
  color: "var(--text-primary)",
};

const LIST: React.CSSProperties = {
  margin: 0,
  paddingLeft: 20,
  fontSize: 13,
  lineHeight: 1.5,
};

const WARNING: React.CSSProperties = {
  margin: 0,
  fontSize: 12.5,
  lineHeight: 1.6,
  color: "var(--text-secondary, #64748b)",
};

const BUSY_BOX: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 12,
  padding: "16px 0",
};

const SPINNER: React.CSSProperties = {
  width: 28,
  height: 28,
  border: "3px solid var(--border, #e2e8f0)",
  borderTopColor: "var(--accent, #6366f1)",
  borderRadius: "50%",
  animation: "cli-thinking-spin 0.8s linear infinite",
};
