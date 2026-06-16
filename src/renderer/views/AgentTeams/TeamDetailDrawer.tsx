/**
 * TeamDetailDrawer.tsx — 團隊詳情（設定）抽屜
 *
 * 從團隊 header 的「ⓘ 詳情」開啟，在右欄 docked 顯示：
 *   1. 檔案位置：這個團隊在 AgentOrg 的資料夾路徑 + 「開啟資料夾」按鈕（檔案總管打開）。
 *   2. 平台狀態：claude / codex / antigravity 三平台逐一顯示「已安裝/未安裝」+ 安裝/移除按鈕。
 *      安裝/移除即時讀寫檔案系統真相（badge 同源），不靠 DB enabled 旗標。
 *
 * 設計取向（agentteams-target-persona-non-programmers）：白話文案、路徑放抽屜不上卡片、
 * 移除有 inline 確認避免誤觸把團隊從某平台拔掉。沿用既有 at-drawer* docked 樣式。
 */
import React, { useCallback, useState } from "react";
import type { AgentTeamDto } from "../../../shared/ipcContracts";
import type { CliId } from "../../../shared/cliRegistry";
import { PLATFORM_GROUPS, isGroupOn, type PlatformGroup } from "./agentTeamsHelpers";

export type TeamPlatform = "claude" | "codex" | "antigravity";

// 平台呈現改用共用 PLATFORM_GROUPS（claude 一組、codex+Gemini 合併一組）；
// 定義在 agentTeamsHelpers.tsx 單一真相，與左側團隊卡徽章同源。

export interface TeamDetailDrawerProps {
  /** 團隊（取自目前 scan 結果，平台狀態以 team.platforms 為準）。 */
  team: AgentTeamDto;
  /** header 顯示名稱（manager displayName / 顯示用 teamId；複合鍵已隱藏 `sourceId::` 前綴）。 */
  teamLabel: string;
  /**
   * 來源顯示名（多來源團隊；非預設來源時顯示來源徽章/說明）。
   * 預設來源或單一來源時可傳 undefined（不顯示來源資訊）。
   */
  sourceLabel?: string;
  /** 這個團隊在 AgentOrg 的資料夾路徑（顯示用，best-effort）。 */
  folderPath: string;
  /** 點「開啟資料夾」→ 檔案總管打開（main 端 shell.openPath）。 */
  onOpenFolder: () => void;
  /** 逐群組加入/拿掉；platforms=該群組所有 CliId；回傳白話結果字串（空字串＝成功無訊息）。 */
  onSetPlatform: (platforms: CliId[], install: boolean) => Promise<string> | void;
  /**
   * 建立入口指令（當 team.hasEntrySkill === false 時顯示）。
   * 回傳白話結果字串（空字串＝成功無訊息）；建立成功後 caller 會重掃讓平台列出現。
   */
  onCreateEntrySkill: () => Promise<string> | void;
  /** 「建立入口指令」按鈕旁顯示的預設指令名（白話提示用，如 `tuq-goose-ops`）。 */
  defaultSkillName: string;
  /** 關閉抽屜。 */
  onClose: () => void;
  /** 健診：讓 AI 檢查這個團隊最近的狀況。 */
  onAudit: () => void;
  /** 改善：讓 AI 回顧團隊表現並提出改善建議。 */
  onReview: () => void;
}

export function TeamDetailDrawer({
  team,
  teamLabel,
  sourceLabel,
  folderPath,
  onOpenFolder,
  onSetPlatform,
  onCreateEntrySkill,
  defaultSkillName,
  onClose,
  onAudit,
  onReview,
}: TeamDetailDrawerProps): React.JSX.Element {
  // 進行中的平台群組 key（async 期間 disable 該列按鈕）
  const [busy, setBusy] = useState<string | null>(null);
  // 待確認拿掉的平台群組 key（null = 無）
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  // 錯誤/結果訊息（null = 無）
  const [msg, setMsg] = useState<string | null>(null);
  // 「建立入口指令」進行中
  const [creatingEntry, setCreatingEntry] = useState(false);

  // hasEntrySkill === false → 顯示「建立入口指令」而非直接安裝（避免「找不到入口指令」爛體驗）。
  // undefined（舊路徑/未計算）視為「有」，維持既有平台列行為，向後相容。
  const noEntrySkill = team.hasEntrySkill === false;

  const doSet = useCallback(
    async (group: PlatformGroup, install: boolean) => {
      setBusy(group.key);
      setConfirmRemove(null);
      setMsg(null);
      try {
        const r = await onSetPlatform(group.members, install);
        if (typeof r === "string" && r.trim()) setMsg(r);
      } finally {
        setBusy(null);
      }
    },
    [onSetPlatform],
  );

  const doCreateEntry = useCallback(async () => {
    setCreatingEntry(true);
    setMsg(null);
    try {
      const r = await onCreateEntrySkill();
      if (typeof r === "string" && r.trim()) setMsg(r);
    } finally {
      setCreatingEntry(false);
    }
  }, [onCreateEntrySkill]);

  return (
    <div className="at-drawer at-drawer--docked" role="complementary" aria-label="團隊設定">
      <div className="at-drawer-panel">
        {/* 頭部 */}
        <div className="at-drawer-header">
          <div className="at-drawer-title-row">
            <span className="at-drawer-icon">🛠</span>
            <div className="at-drawer-title-block">
              <h3 className="at-drawer-name">{teamLabel}</h3>
              <p className="at-drawer-team">
                團隊設定
                {sourceLabel && (
                  <span className="at-td-source-tag" title={`這個團隊來自：${sourceLabel}`}>
                    {" · 來源："}
                    {sourceLabel}
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="at-drawer-header-actions">
            <button type="button" className="at-drawer-close" onClick={onClose} aria-label="關閉">
              ✕
            </button>
          </div>
        </div>

        <div className="at-drawer-body">
          {/* 幫這個團隊做檢查（健診 / 改善） */}
          <section className="at-td-section">
            <h4 className="at-td-section__title">🩺 幫這個團隊做檢查</h4>
            <div className="at-td-action-row">
              <div className="at-td-action-item">
                <button type="button" className="at-td-action-btn" onClick={onAudit}>
                  🔍 健診
                </button>
                <p className="at-td-action-hint">讓 AI 檢查這個團隊最近的狀況，找出哪裡卡住了。</p>
              </div>
              <div className="at-td-action-item">
                <button type="button" className="at-td-action-btn" onClick={onReview}>
                  📋 改善
                </button>
                <p className="at-td-action-hint">讓 AI 回顧團隊的工作表現，並提出改善建議。</p>
              </div>
            </div>
          </section>

          {/* 檔案位置 */}
          <section className="at-td-section">
            <h4 className="at-td-section__title">📂 這個團隊住在這裡</h4>
            <p className="at-td-path" title={folderPath}>
              {folderPath || "（找不到資料夾位置）"}
            </p>
            <button
              type="button"
              className="at-td-folder-btn"
              onClick={onOpenFolder}
              disabled={!folderPath}
            >
              開啟資料夾
            </button>
          </section>

          {/* 平台狀態 */}
          <section className="at-td-section">
            <h4 className="at-td-section__title">在哪些 AI 工具可以使用</h4>
            {noEntrySkill ? (
              // 「有團隊、無入口 skill」：不顯示安裝列（按了只會冒「找不到入口指令」），
              // 改顯示白話說明 + 「建立入口指令」按鈕。建立後 caller 重掃，平台列才會出現。
              <div className="at-td-no-entry">
                <p className="at-td-no-entry__msg">
                  這個團隊還沒有入口指令，所以還不能在 AI 工具裡叫出來。
                  按下面的按鈕幫它建立一個，建立好就能安裝到各個工具了。
                </p>
                <button
                  type="button"
                  className="at-td-no-entry__btn"
                  disabled={creatingEntry}
                  onClick={() => void doCreateEntry()}
                >
                  {creatingEntry ? "建立中…" : "建立入口指令"}
                </button>
                <p className="at-td-no-entry__hint" title={defaultSkillName}>
                  指令名稱：{defaultSkillName}
                </p>
                {msg && <p className="at-td-msg">{msg}</p>}
              </div>
            ) : (
            <>
            <p className="at-td-section__hint">
              亮起來＝這個團隊已經可以在那個工具裡用了。點「加入使用」把團隊加進去，點「拿掉」把它移走。
            </p>
            <ul className="at-td-platforms">
              {PLATFORM_GROUPS.map((group) => {
                const { key, label, hint } = group;
                const on = isGroupOn(team.platforms, group);
                const rowBusy = busy === key;
                return (
                  <li key={key} className="at-td-platform-row">
                    <span
                      className={`at-td-platform-dot ${on ? "at-td-platform-dot--on" : "at-td-platform-dot--off"}`}
                      aria-hidden="true"
                    />
                    <span className="at-td-platform-info">
                      <span className="at-td-platform-label">{label}</span>
                      <span className="at-td-platform-status">{on ? "可以用了" : "還沒加入"}</span>
                      <span className="at-td-platform-hint">{hint}</span>
                    </span>
                    {on ? (
                      <button
                        type="button"
                        className="at-td-platform-btn at-td-platform-btn--remove"
                        disabled={rowBusy}
                        onClick={() => setConfirmRemove(key)}
                      >
                        {rowBusy ? "處理中…" : "拿掉"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="at-td-platform-btn at-td-platform-btn--install"
                        disabled={rowBusy}
                        onClick={() => void doSet(group, true)}
                      >
                        {rowBusy ? "處理中…" : "加入使用"}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>

            {/* inline 移除確認 */}
            {confirmRemove && (
              <div className="at-td-confirm">
                <span className="at-td-confirm__msg">
                  把「{PLATFORM_GROUPS.find((g) => g.key === confirmRemove)?.label}」拿掉後，這個團隊在那個工具就用不了了。確定要拿掉嗎？
                </span>
                <div className="at-td-confirm__actions">
                  <button
                    type="button"
                    className="at-td-confirm__btn at-td-confirm__btn--danger"
                    disabled={busy === confirmRemove}
                    onClick={() => { const g = PLATFORM_GROUPS.find((x) => x.key === confirmRemove); if (g) void doSet(g, false); }}
                  >
                    確定拿掉
                  </button>
                  <button
                    type="button"
                    className="at-td-confirm__btn"
                    disabled={busy === confirmRemove}
                    onClick={() => setConfirmRemove(null)}
                  >
                    取消
                  </button>
                </div>
              </div>
            )}

            {msg && <p className="at-td-msg">{msg}</p>}
            </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

export default TeamDetailDrawer;
