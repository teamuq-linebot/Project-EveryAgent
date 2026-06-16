/**
 * PreviewAgentDrawer.tsx — 唯讀「成員 instruction 預覽」抽屜
 *
 * 即時預覽卡點選成員後，在右側顯示由 spec 即時渲染的 introduction（= introduction.json
 * 內容，不寫檔）。重用 AgentDetailDrawer 的 IntroductionBody 渲染，沿用既有 at-drawer*
 * docked 樣式。**唯讀**：不碰 IPC、不持有 draft 狀態機、無編輯按鈕。
 *
 * agent-teams-live-preview-card-20260613（批 1）。
 */
import React from "react";
import type { AgentIntroduction } from "../../../shared/ipcContracts";
import { IntroductionBody } from "./AgentDetailDrawer";

export interface PreviewAgentDrawerProps {
  /** 由 previewIntroduction.ts 即時渲染的介紹（唯讀）。 */
  intro: AgentIntroduction;
  /** header 顯示名稱（成員 displayName / title / name）。 */
  displayName: string;
  /** header 角色標籤（如「組長」「執行者」；無則不顯示）。 */
  roleLabel?: string;
  /** 關閉抽屜。 */
  onClose: () => void;
}

export function PreviewAgentDrawer({
  intro,
  displayName,
  roleLabel,
  onClose,
}: PreviewAgentDrawerProps): React.JSX.Element {
  return (
    <div
      className="at-drawer at-drawer--docked"
      role="complementary"
      aria-label="成員預覽"
    >
      <div className="at-drawer-panel">
        {/* 頭部 */}
        <div className="at-drawer-header">
          <div className="at-drawer-title-row">
            <span className="at-drawer-icon">👤</span>
            <div className="at-drawer-title-block">
              <h3 className="at-drawer-name">{displayName}</h3>
              {roleLabel && <p className="at-drawer-team">{roleLabel}</p>}
            </div>
          </div>
          <div className="at-drawer-header-actions">
            <button
              type="button"
              className="at-drawer-close"
              onClick={onClose}
              aria-label="關閉"
            >
              ✕
            </button>
          </div>
        </div>

        {/* 介紹內容（唯讀） */}
        <div className="at-drawer-body">
          <IntroductionBody intro={intro} />
        </div>
      </div>
    </div>
  );
}

export default PreviewAgentDrawer;
