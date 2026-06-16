import React, { useCallback, useState } from "react";
import type { ThemeMode } from "../../theme";
import CliBackendSection from "./CliBackendSection";
import { AgentTeamsSection } from "./sections/AgentTeamsSection";
import { AppearanceSection } from "./sections/AppearanceSection";
import { MilestoneSection } from "./sections/MilestoneSection";
import { AutoRecoverSection } from "./sections/AutoRecoverSection";
import { AdvancedSection } from "./sections/AdvancedSection";

/**
 * SettingsPage — 統一「設定」頁（四組；左側小目錄 + 右側內容；零動畫，對齊 management 頁風格）：
 *   🤖 AI 團隊    — AgentTeams 設定 + CLI 後端（AgentTeamsSection + CliBackendSection）。
 *   🎨 外觀       — 主題 light/dark（與 useTheme 同步 localStorage 'tuq.theme'；sidebar 底部鈕為捷徑）。
 *   ⏱ 監測與工時 — Milestone→專案路徑/工具綁定（config:get/setMilestone）＋「自動恢復監測」開關。
 *   🔧 進階       — 看板刷新間隔 / 監測掃描間隔 / 資料目錄（唯讀），走 settings:get/set + getDataDir。
 *
 * 各組為縱向 settings-section 區塊（可捲動）。bridge 未就緒時各區安全降級為提示，不丟例外。
 */

type GroupId = "llm" | "appearance" | "monitor" | "advanced";

const GROUPS: { id: GroupId; icon: string; label: string }[] = [
  { id: "llm", icon: "🤖", label: "AI 團隊" },
  { id: "appearance", icon: "🎨", label: "外觀" },
  { id: "monitor", icon: "⏱", label: "監測與工時" },
  { id: "advanced", icon: "🔧", label: "進階" },
];

const GROUP_KEY = "tuq.settings.group";

function readInitialGroup(): GroupId {
  try {
    const raw = localStorage.getItem(GROUP_KEY);
    if (raw && GROUPS.some((g) => g.id === raw)) return raw as GroupId;
  } catch {
    /* ignore */
  }
  return "llm";
}

interface Props {
  theme: ThemeMode;
  /** 設定頁切主題（與 useTheme.setTheme 同鏈路；App 提升下傳，兩處狀態一致）。 */
  onSetTheme: (mode: ThemeMode) => void;
}

export default function SettingsPage({
  theme,
  onSetTheme,
}: Props): React.JSX.Element {
  const [group, setGroup] = useState<GroupId>(readInitialGroup);

  const selectGroup = useCallback((id: GroupId) => {
    setGroup(id);
    try {
      localStorage.setItem(GROUP_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div className="settings-page">
      <nav className="settings-page__nav">
        <div className="settings-page__nav-title">⚙ 設定</div>
        {GROUPS.map((g) => (
          <button
            key={g.id}
            className={
              "settings-page__nav-item" +
              (group === g.id ? " settings-page__nav-item--active" : "")
            }
            onClick={() => selectGroup(g.id)}
          >
            <span className="settings-page__nav-icon">{g.icon}</span>
            <span className="settings-page__nav-label">{g.label}</span>
          </button>
        ))}
      </nav>

      <div className="settings-page__content">
        {group === "llm" && (
          <div className="settings-view">
            <h2 className="settings-view__title">AI 團隊</h2>
            <AgentTeamsSection />
            <CliBackendSection />
          </div>
        )}
        {group === "appearance" && (
          <div className="settings-view">
            <h2 className="settings-view__title">外觀</h2>
            <AppearanceSection theme={theme} onSetTheme={onSetTheme} />
          </div>
        )}
        {group === "monitor" && (
          <div className="settings-view">
            <h2 className="settings-view__title">監測與工時</h2>
            <MilestoneSection />
            <AutoRecoverSection />
          </div>
        )}
        {group === "advanced" && (
          <div className="settings-view">
            <h2 className="settings-view__title">進階</h2>
            <AdvancedSection />
          </div>
        )}
      </div>
    </div>
  );
}
