import React, { useEffect, useState } from "react";
import type { CliId, CliOnboardingStateDto } from "../../../shared/ipcContracts";

/**
 * CliOnboardingModal — 首啟「幫你準備 AI 工具」一次性引導提示（方案 C，引導式）。
 *
 * mount 時呼叫 window.tuq.cliBackend.getOnboardingState()：
 *   - shouldPrompt 為 true（旗標未 dismiss 且偵測到缺工具）才顯示遮罩；否則自身不渲染任何 DOM。
 * 「開始安裝」→ 切到設定頁（onGoToSettings）後 dismiss + 關閉（使用者之後仍可在設定頁操作）。
 * 「稍後再說」→ 僅 dismiss + 關閉。
 * 對象為非工程師：文案禁出現檔名 / 旗標 / 指令字串 / CLI id（只用白話名稱）。
 * 不做任何安裝動作 —— 安裝/登入沿用設定頁 CliBackendSection 既有可見終端機流程。
 */

interface Props {
  /** 切到設定頁（App 傳 () => setActiveTab("platforms")）。 */
  onGoToSettings: () => void;
}

/** CliId → 給使用者看的白話名稱（不顯示 id）。 */
const FRIENDLY_NAME: Record<CliId, string> = {
  claude: "Claude",
  codex: "Codex",
  antigravity: "Gemini",
};

/** SettingsPage 用以決定初始分組的 localStorage key；種子讓使用者切過去直接落在「AI 團隊」CLI 區。 */
const SETTINGS_GROUP_KEY = "tuq.settings.group";

export default function CliOnboardingModal({
  onGoToSettings,
}: Props): React.JSX.Element | null {
  // null = 尚未決定是否顯示（拉取中或不該顯示）；非 null 才渲染遮罩。
  const [state, setState] = useState<CliOnboardingStateDto | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const bridge = window.tuq?.cliBackend;
    if (!bridge?.getOnboardingState) return;
    void bridge
      .getOnboardingState()
      .then((r) => {
        if (cancelled || !r.ok) return;
        if (r.data.shouldPrompt) {
          setState(r.data);
          setOpen(true);
        }
      })
      .catch(() => {
        /* 拉取失敗 → 靜默不顯示（不打擾使用者） */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 共用收尾：永久關閉旗標 + 關閉遮罩（dismiss 失敗不擋關閉）。
  const dismissAndClose = (): void => {
    void window.tuq?.cliBackend?.dismissOnboarding?.().catch(() => {
      /* 寫旗標失敗 → 仍關閉本次提示 */
    });
    setOpen(false);
  };

  const handleStart = (): void => {
    // 先種設定頁初始分組為「AI 團隊」，讓切過去就直接看到三張 CLI 卡（非預設「連線平台」組）。
    try {
      localStorage.setItem(SETTINGS_GROUP_KEY, "llm");
    } catch {
      /* localStorage 不可用 → 忽略；仍切到設定頁 */
    }
    onGoToSettings();
    dismissAndClose();
  };

  if (!open || !state) return null;

  const names = state.missing.map((id) => FRIENDLY_NAME[id] ?? id);

  return (
    <div className="cli-term-backdrop" role="dialog" aria-modal="true">
      <div className="cli-onboarding">
        <h3 className="cli-onboarding__title">幫你準備 AI 工具</h3>
        <p className="cli-onboarding__body">
          快組隊需要 1–3 個 AI 工具才能運作。我們偵測到還沒準備好的工具，點下方按鈕，
          我們會帶你到設定頁一鍵安裝並登入。
        </p>
        {names.length > 0 && (
          <ul className="cli-onboarding__list">
            {names.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        <div className="cli-onboarding__actions">
          <button className="settings-form__btn" onClick={dismissAndClose}>
            稍後再說
          </button>
          <button
            className="settings-form__btn settings-form__btn--primary"
            onClick={handleStart}
          >
            開始安裝
          </button>
        </div>
      </div>
    </div>
  );
}
