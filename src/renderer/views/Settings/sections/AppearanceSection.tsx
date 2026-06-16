// ---------------------------------------------------------------------------
// 🎨 外觀 — 主題 light/dark（與 useTheme 同步 localStorage 'tuq.theme'）
//   onSetTheme 來自 App 的 useTheme.setTheme（提升下傳），故此處切換與 sidebar 底部鈕一致。
// ---------------------------------------------------------------------------

import React from "react";
import type { ThemeMode } from "../../../theme";

interface AppearanceSectionProps {
  theme: ThemeMode;
  onSetTheme: (mode: ThemeMode) => void;
}

export function AppearanceSection({
  theme,
  onSetTheme,
}: AppearanceSectionProps): React.JSX.Element {
  const MODES: { id: ThemeMode; label: string; icon: string }[] = [
    { id: "light", label: "淺色", icon: "☀" },
    { id: "dark", label: "深色", icon: "☾" },
  ];
  return (
    <section className="settings-section">
      <h3 className="settings-section__title">主題</h3>
      <div className="settings-form">
        <p
          style={{
            fontSize: 12,
            color: "var(--text-muted)",
            margin: "0 0 var(--sp-2)",
          }}
        >
          切換淺色 / 深色（即時套用、記憶於本機；與側欄底部的快速切換鈕同步）。
        </p>
        <div style={{ display: "flex", gap: "var(--sp-2)" }}>
          {MODES.map((m) => (
            <button
              key={m.id}
              className={
                "settings-form__btn" +
                (theme === m.id ? " settings-form__btn--primary" : "")
              }
              onClick={() => onSetTheme(m.id)}
            >
              {m.icon} {m.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
