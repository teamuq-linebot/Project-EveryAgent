import React from "react";
import type { CliId, CliStatusDto, CliPlanDto } from "../../../shared/ipcContracts";
import TerminalPanel from "../Session/Terminal";

/**
 * CliCard — 單張 CLI 卡片的展示元件（SRP：純渲染，無 state / effect）。
 *
 * 顯示：名稱 / bin / 版本 / 路徑 / 狀態徽章 / 動作按鈕 / 內嵌終端機面板（展開時）。
 * 所有 state、effect、marker/auto-close 邏輯皆留在父元件 CliBackendSection。
 */

/** 當前開著的終端機面板狀態（由父元件傳入，僅本卡 isOpen 時非 null）。 */
export interface ActiveTerminalProps {
  ptyId: string;
  plan: CliPlanDto;
}

export interface CliCardProps {
  card: CliStatusDto;
  /** 此卡片的終端機面板是否展開（active?.id === card.id）。 */
  activeTerminal: ActiveTerminalProps | null;
  /** 此卡片「驗證登入」按鈕是否 loading。 */
  isVerifying: boolean;
  onInstall: (id: CliId) => void;
  onLogin: (id: CliId) => void;
  onVerify: (id: CliId) => void;
  onFinish: () => void;
}

/** plan.shell → Terminal 的 shell prop；undefined = 用 OS 預設 shell。 */
function mapShell(shell: CliPlanDto["shell"]): string | undefined {
  return shell === "powershell" ? "powershell.exe" : undefined;
}

/** 由 installed + loginState 推導徽章樣式與文字。 */
function deriveBadge(card: CliStatusDto): { cls: string; label: string } {
  if (!card.installed) return { cls: "cli-badge--off", label: "未安裝" };
  switch (card.loginState) {
    case "logged_in":
      return { cls: "cli-badge--ok", label: "已登入" };
    case "logged_out":
      return { cls: "cli-badge--warn", label: "已安裝・未登入" };
    default:
      return { cls: "cli-badge--unknown", label: "已安裝・登入未知" };
  }
}

export function CliCard({
  card,
  activeTerminal,
  isVerifying,
  onInstall,
  onLogin,
  onVerify,
  onFinish,
}: CliCardProps): React.JSX.Element {
  const badge = deriveBadge(card);
  const isOpen = activeTerminal !== null;

  return (
    <div className="cli-card">
      <div className="cli-card__head">
        <div className="cli-card__head-main">
          <span className="cli-card__name">{card.name}</span>
          <span className="cli-card__bin">{card.bin}</span>
        </div>
        <span className={`cli-badge ${badge.cls}`}>{badge.label}</span>
      </div>

      <div className="cli-card__meta">
        <span>版本：{card.version ?? "—"}</span>
        {card.path && (
          <span className="cli-card__path" title={card.path}>
            路徑：{card.path}
          </span>
        )}
      </div>

      {card.detail && card.installed && (
        <p className="cli-card__detail">{card.detail}</p>
      )}

      <div className="cli-card__actions">
        {!card.installed ? (
          <button
            className="settings-form__btn settings-form__btn--primary"
            onClick={() => onInstall(card.id)}
          >
            一鍵安裝
          </button>
        ) : (
          <>
            <button
              className="settings-form__btn settings-form__btn--primary"
              onClick={() => onLogin(card.id)}
            >
              {card.loginState === "logged_in" ? "重新登入" : "一鍵登入"}
            </button>
            <button
              className="settings-form__btn"
              onClick={() => onVerify(card.id)}
              disabled={isVerifying}
            >
              {isVerifying ? "驗證中…" : "驗證登入"}
            </button>
          </>
        )}
      </div>

      {isOpen && activeTerminal && (
        /* 登入/安裝多為全螢幕 TUI（claude / agy）：需要足夠寬高才不會被裁切，且 TUI 無 scrollback
           無法捲動。故脫離 720px 設定欄、以大尺寸 overlay 呈現（仿對話面板的大面積）。 */
        <div className="cli-term-backdrop" role="dialog" aria-modal="true">
          <div className="cli-term">
            <div className="cli-term__bar">
              <span className="cli-term__title">{card.name} · 終端機</span>
              <button
                className="cli-term__close"
                onClick={onFinish}
                title="完成並重新偵測"
                aria-label="關閉"
              >
                ✕
              </button>
            </div>
            {activeTerminal.plan.note && (
              <p className="cli-term__note">{activeTerminal.plan.note}</p>
            )}
            <div className="cli-term__body">
              <TerminalPanel
                ptyId={activeTerminal.ptyId}
                shell={mapShell(activeTerminal.plan.shell)}
                cwd={activeTerminal.plan.cwd ?? undefined}
              />
            </div>
            <div className="cli-term__foot">
              <button
                className="settings-form__btn settings-form__btn--primary"
                onClick={onFinish}
              >
                完成並重新偵測
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
