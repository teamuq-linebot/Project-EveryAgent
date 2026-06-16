/**
 * PreviewTeamCard.tsx — 即時預覽卡（agent-teams-live-preview-card-20260613，批 3）
 *
 * 純展示元件：對話偵測到建隊 spec 時，在使用者按「✨ 建團隊」的群內就地長出
 * 一張發光草稿卡。對話更新 → spec 更新 → 卡片即時重渲染；按「✅ 建立」才真正建團隊。
 * 非工程師友善：白話成員摘要，不穿透欄位 key / 指令名。
 * 不自行抓資料、不碰 IPC；所有資料 + 行為由上層 props 傳入。
 */
import React, { useCallback } from "react";
import type { AgentTeamCreateSpecInput } from "../../../shared/ipcContracts";
import { roleIcon, typeBadgeLabel } from "./agentTeamsHelpers";

interface PreviewTeamCardProps {
  spec: AgentTeamCreateSpecInput;
  onCreate?: () => void;
  onCancel?: () => void;
  creating?: boolean;
  status?: string | null;
  /** 點預覽卡成員 tile：傳 "manager" 或第 i 個 member 的 index。 */
  onSelectPreviewMember?: (who: "manager" | number) => void;
}

/** 單一預覽成員 tile（仿真團隊卡 AgentCard，重用 at-ol-card* 樣式）。 */
interface PreviewMemberTileProps {
  who: "manager" | number;
  displayName: string;
  isManager: boolean;
  roleInTeam?: string | null;
  onSelect?: (who: "manager" | number) => void;
}

function PreviewMemberTile({
  who,
  displayName,
  isManager,
  roleInTeam,
  onSelect,
}: PreviewMemberTileProps): React.JSX.Element {
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation(); // 別誤觸卡片「✅ 建立」鈕
      onSelect?.(who);
    },
    [who, onSelect],
  );
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        onSelect?.(who);
      }
    },
    [who, onSelect],
  );

  const icon = roleIcon(isManager ? "manager" : (roleInTeam ?? null));
  const label = isManager ? "主管" : typeBadgeLabel(roleInTeam ?? null);

  return (
    <div
      className={`at-ol-card${isManager ? " at-ol-card--manager" : ""}`}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      aria-label={`${displayName}（${label}）`}
      title={`點擊查看 ${displayName} 的職責說明`}
    >
      <span className="at-ol-card__row1">
        <span className="at-ol-card__icon" aria-hidden="true">{icon}</span>
        <span className="at-ol-card__name">{displayName}</span>
        {isManager && <span className="at-ol-card__chevron" aria-hidden="true">›</span>}
      </span>
      <span
        className={`at-ol-card__badge at-ol-card__badge--${isManager ? "manager" : (roleInTeam ?? "other")}`}
      >
        {label}
      </span>
    </div>
  );
}

export function PreviewTeamCard({
  spec,
  onCreate,
  onCancel,
  creating = false,
  status = null,
  onSelectPreviewMember,
}: PreviewTeamCardProps): React.JSX.Element {
  const managerName = spec.manager?.displayName ?? `${spec.teamName}組長`;
  const members = spec.members ?? [];
  const memberCount = members.length;

  return (
    <div className="at-ol-team-preview" role="group" aria-label={`預覽團隊：${spec.teamName}`}>
      <div className="at-ol-team-preview__head">
        <span className="at-ol-team-preview__name">{spec.teamName}</span>
        <span className="at-ol-team-preview__tag">預覽・尚未建立</span>
      </div>

      <div className="at-ol-team-preview__summary">
        主管：{managerName}・成員 {memberCount} 位
      </div>

      {/* 成員 tile 橫向捲動列：manager 當第一個 tile，其餘 members 依序排列 */}
      <div className="at-ol-team-preview__members">
        <PreviewMemberTile
          who="manager"
          displayName={managerName}
          isManager
          onSelect={onSelectPreviewMember}
        />
        {members.map((m, i) => (
          <PreviewMemberTile
            key={`${m.name ?? "member"}-${i}`}
            who={i}
            displayName={m.displayName ?? m.title ?? m.name ?? `成員 ${i + 1}`}
            isManager={false}
            roleInTeam={m.roleInTeam}
            onSelect={onSelectPreviewMember}
          />
        ))}
      </div>

      <div className="at-ol-team-preview__actions">
        <button
          type="button"
          className="at-ol-team-preview__create"
          onClick={onCreate}
          disabled={creating}
        >
          {creating ? "建立中…" : "✅ 建立"}
        </button>
        <button
          type="button"
          className="at-ol-team-preview__cancel"
          onClick={onCancel}
          disabled={creating}
        >
          取消
        </button>
      </div>

      {status && <div className="at-ol-team-preview__status">{status}</div>}
    </div>
  );
}
