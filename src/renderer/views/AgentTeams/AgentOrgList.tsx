/**
 * AgentOrgList.tsx — 三層可收合卡片清單：群組 → 團隊 → 成員卡片
 *
 * 取代左欄 React Flow OrgFlowCanvas，以一般清單取代圖形佈局。
 * 資料：groupTeams(teams, groupConfig) 產出 GroupedTeams[]。
 * 互動：群組/團隊收合由外層 state 控制（controlled）；點成員卡片呼 onSelectAgent。
 * a11y：可收合標頭用 button + aria-expanded；卡片支援 keyboard Enter/Space。
 */
import React, { useCallback, useState } from "react";
import type { AgentTeamDto, AgentNodeDto, AgentTeamCreateSpecInput } from "../../../shared/ipcContracts";
import type { CliId } from "../../../shared/cliRegistry";
import type { GroupConfig } from "./groupConfig";
import { groupTeams, UNCLASSIFIED_GROUP } from "./groupConfig";
import {
  buildTeamStandardizePrompt,
  roleIcon,
  modelLabel,
  typeBadgeLabel,
  teamDisplayId,
  teamIsFromNonDefaultSource,
  PLATFORM_GROUPS,
  isGroupOn,
  type PlatformGroup,
} from "./agentTeamsHelpers";
import { PreviewTeamCard } from "./PreviewTeamCard";

// ---------------------------------------------------------------------------
// 平台徽章：改用共用 PLATFORM_GROUPS（claude 一組、codex+Gemini 合併一組）。
// 定義移到 agentTeamsHelpers.tsx 單一真相；亮/暗判定用 isGroupOn(team.platforms)。
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AgentOrgListProps {
  teams: AgentTeamDto[];
  groupConfig: GroupConfig;
  collapsedGroups: Set<string>;
  collapsedTeams: Set<string>;
  onToggleGroup: (groupId: string) => void;
  onToggleTeam: (teamId: string) => void;
  onSelectAgent: (teamId: string, agentName: string) => void;
  /** 逐群組加入/拿掉（平台 badge 點擊 + 詳情抽屜共用）。install=true 加入、false 拿掉；platforms=該群組所有 CliId；回傳白話結果字串。 */
  onSetPlatform?: (teamId: string, platforms: CliId[], install: boolean) => Promise<string | void> | void;
  /** 開團隊詳情/設定抽屜（ⓘ 詳情鈕）。 */
  onOpenTeamDetail?: (teamId: string) => void;
  onOpenTeamChat?: (teamId: string, teamLabel: string) => void;
  /** 團隊層級操作（健診 / 改善）：Persona Gate M2 — 呼叫方自行組 prompt，不透露指令名 */
  onOpenTeamOpsSession?: (label: string, prompt: string) => void;
  /** Batch A 預留：群組 header「✏️ 編輯」鈕呼叫（開分組設定抽屜並聚焦該群進改名態）。Batch C 接 UI。 */
  onEditGroup?: (groupId: string) => void;
  /** Batch A 預留：清單底部「＋ 新增工作群組」鈕呼叫（開抽屜直接進新增群模式）。Batch C 接 UI。 */
  onAddGroup?: () => void;
  /** Batch B 預留：群組 header「✨ 建團隊」鈕呼叫（開建團隊對話，新團隊自動歸入該群）。Batch C 接 UI。 */
  onCreateTeamInGroup?: (groupId: string, groupName: string) => void;
  // ── 即時預覽卡（agent-teams-live-preview-card-20260613）：批 2 由父層往下傳，批 3 在此檔接 UI ──
  /** 對話偵測到的建隊 spec（null = 尚未偵測到/已清除）。批 3 用來在 previewGroupId 群內就地長預覽卡。 */
  previewSpec?: AgentTeamCreateSpecInput | null;
  /** 預覽卡要長在哪個群組（按「✨ 建團隊」當下記住）。 */
  previewGroupId?: string | null;
  /** 預覽卡「建立」鈕呼叫：真正建團隊並重掃。 */
  onCreatePreview?: () => void;
  /** 預覽卡「取消」鈕呼叫：清掉預覽 state。 */
  onCancelPreview?: () => void;
  /** 預覽卡建立中（async 執行中）。 */
  creatingPreview?: boolean;
  /** 預覽卡狀態白話字串（建立中/失敗訊息；null = 無）。 */
  previewStatus?: string | null;
  /** 點預覽卡成員 tile：傳 "manager" 或第 i 個 member 的 index（批 2 接線右欄唯讀抽屜）。 */
  onSelectPreviewMember?: (who: "manager" | number) => void;
}

// ---------------------------------------------------------------------------
// 成員卡片 Row
// ---------------------------------------------------------------------------

interface AgentCardProps {
  agent: AgentNodeDto;
  teamId: string;
  isManager?: boolean;
  onSelectAgent: (teamId: string, agentName: string) => void;
}

function AgentCard({ agent, teamId, isManager = false, onSelectAgent }: AgentCardProps): React.JSX.Element {
  const handleClick = useCallback(() => {
    onSelectAgent(teamId, agent.name);
  }, [teamId, agent.name, onSelectAgent]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelectAgent(teamId, agent.name);
      }
    },
    [teamId, agent.name, onSelectAgent],
  );

  const icon = roleIcon(isManager ? "manager" : agent.roleInTeam);
  const mlabel = modelLabel(agent.model);
  const roleLabel = isManager ? "主管" : typeBadgeLabel(agent.roleInTeam);
  const displayName = agent.displayName ?? agent.name;

  const badgeTitleMap: Record<string, string> = {
    manager: "帶領整個團隊、協調成員分工",
    researcher: "負責調查、蒐集資訊與規劃方案",
    doer: "負責動手執行、完成具體任務",
    verifier: "負責檢查成果品質，確保交付正確",
  };
  const roleKey = isManager ? "manager" : (agent.roleInTeam ?? "");
  const badgeTitle = badgeTitleMap[roleKey] ?? roleLabel;

  return (
    <div
      className={`at-ol-card${isManager ? " at-ol-card--manager" : ""}`}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      aria-label={`${displayName}（${roleLabel}）`}
      title={`點擊查看 ${displayName} 詳情`}
    >
      {/* 第1行：icon + 名字（ellipsis） */}
      <span className="at-ol-card__row1">
        <span className="at-ol-card__icon" aria-hidden="true">{icon}</span>
        <span className="at-ol-card__name">{displayName}</span>
        {isManager && <span className="at-ol-card__chevron" aria-hidden="true">›</span>}
      </span>
      {/* 第2行：身分 badge */}
      <span
        className={`at-ol-card__badge at-ol-card__badge--${isManager ? "manager" : (agent.roleInTeam ?? "other")}`}
        title={badgeTitle}
      >
        {roleLabel}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RDV 排序 helper
// ---------------------------------------------------------------------------

/** RDV 角色順序（researcher→doer→verifier→其餘/null 排末） */
const RDV_ORDER: Record<string, number> = {
  researcher: 0,
  doer: 1,
  verifier: 2,
};

function sortByRdv(agents: AgentNodeDto[]): AgentNodeDto[] {
  return agents.slice().sort((a, b) => {
    const oa = RDV_ORDER[a.roleInTeam ?? ""] ?? 99;
    const ob = RDV_ORDER[b.roleInTeam ?? ""] ?? 99;
    return oa - ob;
  });
}

// ---------------------------------------------------------------------------
// 團隊區塊（可收合）
// ---------------------------------------------------------------------------

interface TeamSectionProps {
  team: AgentTeamDto;
  collapsed: boolean;
  onToggleTeam: (teamId: string) => void;
  onSelectAgent: (teamId: string, agentName: string) => void;
  /** 逐群組加入/拿掉（平台 badge 點擊 + 詳情抽屜共用）。install=true 加入、false 拿掉；platforms=該群組所有 CliId；回傳白話結果字串。 */
  onSetPlatform?: (teamId: string, platforms: CliId[], install: boolean) => Promise<string | void> | void;
  /** 開團隊詳情/設定抽屜（ⓘ 詳情鈕）。 */
  onOpenTeamDetail?: (teamId: string) => void;
  onOpenTeamChat?: (teamId: string, teamLabel: string) => void;
  onOpenTeamOpsSession?: (label: string, prompt: string) => void;
}

function TeamSection({ team, collapsed, onToggleTeam, onSelectAgent, onSetPlatform, onOpenTeamDetail, onOpenTeamChat, onOpenTeamOpsSession }: TeamSectionProps): React.JSX.Element {
  const handleToggle = useCallback(() => {
    onToggleTeam(team.id);
  }, [team.id, onToggleTeam]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onToggleTeam(team.id);
      }
    },
    [team.id, onToggleTeam],
  );

  // ── 團隊層級「在哪些平台可用」控制 ──
  // 真相來源 = team.platforms（檔案系統上 skill 是否實際存在；平台 badge + 詳情抽屜同源），
  // 不再用 DB enabled 旗標（根除 DB 與 fs 分岐的舊 bug：開關顯示開啟、實際卻被移除）。
  // platformBusy 標示哪個平台正在 async 安裝/移除（該 badge 顯示「…」並 disable）；
  // confirmRemovePlatform 控制 inline 移除確認列。
  const [platformBusy, setPlatformBusy] = useState<string | null>(null);
  const [confirmRemovePlatform, setConfirmRemovePlatform] = useState<string | null>(null);

  const doSetPlatform = useCallback(async (group: PlatformGroup, install: boolean) => {
    if (!onSetPlatform) return;
    setPlatformBusy(group.key);
    setConfirmRemovePlatform(null);
    try {
      // 完成後父層 doScan 重掃，team.platforms 反映 fs 真相 → badge 自動更新。
      await onSetPlatform(team.id, group.members, install);
    } finally {
      setPlatformBusy(null);
    }
  }, [onSetPlatform, team.id]);

  // 點平台 badge：未加入→直接加入（安全）；已加入→開 inline 拿掉確認（避免誤觸把團隊從工具拔掉）。
  const handleBadgeActivate = useCallback((group: PlatformGroup) => {
    if (!onSetPlatform) return;
    const on = isGroupOn(team.platforms, group);
    if (on) setConfirmRemovePlatform(group.key);
    else void doSetPlatform(group, true);
  }, [onSetPlatform, team.platforms, doSetPlatform]);

  const managerDisplayName = team.manager?.displayName ?? team.manager?.name ?? null;
  // 複合鍵團隊（`sourceId::teamId`）顯示時隱藏 `sourceId::` 前綴；裸 teamId 原樣。
  const displayId = teamDisplayId(team.id);
  const teamLabel = managerDisplayName ?? displayId;
  const memberCount = (team.manager ? 1 : 0) + team.agents.length;
  // 來源徽章：非預設來源才顯示（白話來源名，不外露技術前綴）。
  const fromNonDefaultSource = teamIsFromNonDefaultSource(team.id);
  const sourceBadgeLabel = team.sourceLabel ?? null;

  const handleOpenChatClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenTeamChat?.(team.id, teamLabel);
  }, [team.id, teamLabel, onOpenTeamChat]);

  return (
    <div className="at-ol-team">
      <button
        type="button"
        className="at-ol-team__header"
        aria-expanded={!collapsed}
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        aria-controls={`at-ol-team-body-${team.id}`}
      >
        <span className={`at-ol-chevron${collapsed ? "" : " at-ol-chevron--open"}`} aria-hidden="true">▶</span>
        <span className="at-ol-team__display-name">{teamLabel}</span>
        {onOpenTeamChat && (
          <span
            role="button"
            tabIndex={0}
            className="at-ol-team__chat-btn"
            aria-label={`與 ${teamLabel} 團隊對話`}
            title={`與 ${teamLabel} 團隊開始對話`}
            onClick={handleOpenChatClick}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onOpenTeamChat?.(team.id, teamLabel); } }}
          >
            💬 對話
          </span>
        )}
        <span className="at-ol-team__header-spacer" aria-hidden="true" />
        {/* 來源徽章：非預設來源團隊才顯示（撞名時用來區分不同來源的同名團隊）。 */}
        {fromNonDefaultSource && sourceBadgeLabel && (
          <span
            className="at-ol-team__source-badge"
            title={`來源：${sourceBadgeLabel}`}
            aria-label={`來源：${sourceBadgeLabel}`}
          >
            {sourceBadgeLabel}
          </span>
        )}
        <span className="at-ol-team__id-secondary" title={fromNonDefaultSource && sourceBadgeLabel ? `${displayId}（來源：${sourceBadgeLabel}）` : displayId}>{managerDisplayName ? displayId : null}</span>
        <span className="at-ol-team__count">{memberCount}</span>

        {/* 平台徽章＝可點控制：亮=已安裝（點→移除確認）、灰=未安裝（點→直接安裝）。
            真相來源 team.platforms（檔案系統上 skill 是否存在），即「在哪些 AI 工具可用」的唯一真相；
            取代舊的獨立上線開關（開關存 DB enabled，會與 fs 分岐）。無 onSetPlatform 時退化為唯讀。 */}
        <span className="at-ol-team__platforms" aria-hidden={false}>
          {PLATFORM_GROUPS.map((group) => {
            const { key, label } = group;
            const on = isGroupOn(team.platforms, group);
            const busy = platformBusy === key;
            const interactive = !!onSetPlatform;
            const actionLabel = on ? `已加到 ${label}，點一下拿掉` : `點一下把這個團隊加到 ${label} 使用`;
            const roLabel = on ? "已加入" : "未加入";
            return (
              <span
                key={key}
                role={interactive ? "button" : undefined}
                tabIndex={interactive && !busy ? 0 : undefined}
                aria-disabled={busy || undefined}
                className={`at-ol-team__platform-badge ${on ? "at-ol-team__platform-badge--on" : "at-ol-team__platform-badge--off"}${interactive ? " at-ol-team__platform-badge--clickable" : ""}`}
                title={interactive ? `${label}：${actionLabel}` : `${label}：${roLabel}`}
                aria-label={interactive ? `${label}：${actionLabel}` : `${label}：${roLabel}`}
                onClick={interactive && !busy ? (e) => { e.stopPropagation(); handleBadgeActivate(group); } : undefined}
                onKeyDown={interactive && !busy ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); handleBadgeActivate(group); } } : undefined}
              >
                {busy ? "…" : label}
              </span>
            );
          })}
        </span>

        {/* 「待優化」徽章：團隊尚未規格化時顯示（standardized === false）。
            點擊 = 啟動規格化對話（把快速建立的團隊正式化、補完到 agent-ops 標準），
            完成後系統會自動清除此徽章；無 handler 時退化為純提示。
            （與「🔍 健診」鈕語意分開：徽章=去規格化，健診鈕=一般健診。） */}
        {team.standardized === false && (
          <span
            role={onOpenTeamOpsSession ? "button" : undefined}
            tabIndex={onOpenTeamOpsSession ? 0 : undefined}
            className="at-ol-team__badge at-ol-team__badge--pending"
            aria-label={onOpenTeamOpsSession ? `${teamLabel} 待優化，點擊讓 AI 幫忙正式化這個團隊` : `${teamLabel} 待優化`}
            title={onOpenTeamOpsSession ? "這個團隊還沒整理好，點一下讓 AI 幫忙把它正式化、補完到正式標準" : "這個團隊還沒整理好"}
            onClick={onOpenTeamOpsSession ? (e) => { e.stopPropagation(); onOpenTeamOpsSession(`✨ 規格化 ${teamLabel}`, buildTeamStandardizePrompt(team.id, teamLabel)); } : undefined}
            onKeyDown={onOpenTeamOpsSession ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onOpenTeamOpsSession(`✨ 規格化 ${teamLabel}`, buildTeamStandardizePrompt(team.id, teamLabel)); } } : undefined}
          >
            待優化
          </span>
        )}

        {/* 團隊詳情/設定（檔案位置、在哪些 AI 工具可用）；stopPropagation 避免誤觸收合。
            取代舊的上線 switch：上線與否改由平台 badge 直接控制 + 詳情抽屜內逐平台安裝/移除。 */}
        {onOpenTeamDetail && (
          <span
            role="button"
            tabIndex={0}
            className="at-ol-team__detail-btn"
            aria-label={`${teamLabel} 團隊設定與詳情`}
            title="團隊設定：檔案位置、在哪些 AI 工具可用"
            onClick={(e) => { e.stopPropagation(); onOpenTeamDetail(team.id); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onOpenTeamDetail(team.id); } }}
          >
            ⓘ 詳情
          </span>
        )}
      </button>

      {/* inline 移除確認（點「已安裝」的平台 badge 後展開；避免誤觸把團隊從某平台拔掉）*/}
      {confirmRemovePlatform && (
        <div className="at-ol-team__pause-confirm" onClick={(e) => e.stopPropagation()}>
          <span className="at-ol-team__pause-confirm__msg">
            要把這個團隊從「{PLATFORM_GROUPS.find((g) => g.key === confirmRemovePlatform)?.label}」拿掉嗎？拿掉後在那個工具就用不了。
          </span>
          <button
            type="button"
            className="at-online-confirm__btn at-online-confirm__btn--danger"
            disabled={platformBusy === confirmRemovePlatform}
            onClick={(e) => { e.stopPropagation(); const g = PLATFORM_GROUPS.find((x) => x.key === confirmRemovePlatform); if (g) void doSetPlatform(g, false); }}
          >
            確定拿掉
          </button>
          <button
            type="button"
            className="at-online-confirm__btn"
            disabled={platformBusy === confirmRemovePlatform}
            onClick={(e) => { e.stopPropagation(); setConfirmRemovePlatform(null); }}
          >
            取消
          </button>
        </div>
      )}


      {!collapsed && (
        <div id={`at-ol-team-body-${team.id}`}>
          {/* 組長 + 組員同一水平捲動列（manager 當第一個 tile） */}
          {(team.manager || team.agents.length > 0) ? (
            <div className="at-ol-team__body">
              {team.manager && (
                <AgentCard
                  agent={team.manager}
                  teamId={team.id}
                  isManager
                  onSelectAgent={onSelectAgent}
                />
              )}
              {sortByRdv(team.agents).map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  teamId={team.id}
                  onSelectAgent={onSelectAgent}
                />
              ))}
            </div>
          ) : (
            <p className="at-ol-team__empty">此團隊目前無成員</p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 群組區塊（可收合）
// ---------------------------------------------------------------------------

interface GroupSectionProps {
  group: { id: string; name: string; icon?: string; color?: string; isSystem?: boolean };
  groupTeamList: AgentTeamDto[];
  collapsed: boolean;
  collapsedTeams: Set<string>;
  onToggleGroup: (groupId: string) => void;
  onToggleTeam: (teamId: string) => void;
  onSelectAgent: (teamId: string, agentName: string) => void;
  /** 逐群組加入/拿掉（平台 badge 點擊 + 詳情抽屜共用）。install=true 加入、false 拿掉；platforms=該群組所有 CliId；回傳白話結果字串。 */
  onSetPlatform?: (teamId: string, platforms: CliId[], install: boolean) => Promise<string | void> | void;
  /** 開團隊詳情/設定抽屜（ⓘ 詳情鈕）。 */
  onOpenTeamDetail?: (teamId: string) => void;
  onOpenTeamChat?: (teamId: string, teamLabel: string) => void;
  onOpenTeamOpsSession?: (label: string, prompt: string) => void;
  /** 群 header「✨ 建團隊」鈕：開建團隊對話、新團隊自動歸入此群（未分類偽群不渲染此鈕）。 */
  onCreateTeamInGroup?: (groupId: string, groupName: string) => void;
  /** 群 header「✏️ 編輯」鈕：開分組設定抽屜並聚焦此群進改名態（未分類偽群不渲染此鈕）。 */
  onEditGroup?: (groupId: string) => void;
  // ── 即時預覽卡：previewSpec 只在此群為目標群時非 null（由主元件比對 previewGroupId）──
  /** 偵測到的建隊 spec（非目標群為 null）；非 null 時於群內團隊卡最前面長發光預覽卡。 */
  previewSpec?: AgentTeamCreateSpecInput | null;
  /** 預覽卡「建立」鈕呼叫。 */
  onCreatePreview?: () => void;
  /** 預覽卡「取消」鈕呼叫。 */
  onCancelPreview?: () => void;
  /** 預覽卡建立中（disable 建立鈕）。 */
  creatingPreview?: boolean;
  /** 預覽卡白話狀態文字（建立中/失敗）。 */
  previewStatus?: string | null;
  /** 點預覽卡成員 tile：傳 "manager" 或第 i 個 member 的 index。 */
  onSelectPreviewMember?: (who: "manager" | number) => void;
}

function GroupSection({
  group,
  groupTeamList,
  collapsed,
  collapsedTeams,
  onToggleGroup,
  onToggleTeam,
  onSelectAgent,
  onSetPlatform,
  onOpenTeamDetail,
  onOpenTeamChat,
  onOpenTeamOpsSession,
  onCreateTeamInGroup,
  onEditGroup,
  previewSpec,
  onCreatePreview,
  onCancelPreview,
  creatingPreview,
  previewStatus,
  onSelectPreviewMember,
}: GroupSectionProps): React.JSX.Element {
  const handleToggle = useCallback(() => {
    onToggleGroup(group.id);
  }, [group.id, onToggleGroup]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onToggleGroup(group.id);
      }
    },
    [group.id, onToggleGroup],
  );

  return (
    <div className="at-ol-group">
      <button
        type="button"
        className="at-ol-group__header"
        aria-expanded={!collapsed}
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        aria-controls={`at-ol-group-body-${group.id}`}
        style={group.color ? { borderLeftColor: group.color } : undefined}
      >
        {group.icon && (
          <span className="at-ol-group__icon" aria-hidden="true">{group.icon}</span>
        )}
        <span className="at-ol-group__name">{group.name}</span>
        <span className="at-ol-group__count">{groupTeamList.length} 個團隊</span>

        {/* 群操作鈕（建團隊 / 編輯）：未分類偽群不顯示。header 本身是 button，故用 span role=button 避免巢狀 button */}
        {group.id !== UNCLASSIFIED_GROUP.id && !group.isSystem && onCreateTeamInGroup && (
          <span
            role="button"
            tabIndex={0}
            className="at-ol-group__action-btn"
            aria-label={`在「${group.name}」新增一個團隊`}
            title={`在「${group.name}」底下新增一個團隊`}
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); onCreateTeamInGroup(group.id, group.name); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onCreateTeamInGroup(group.id, group.name); } }}
          >
            ✨ 建團隊
          </span>
        )}
        {group.id !== UNCLASSIFIED_GROUP.id && !group.isSystem && onEditGroup && (
          <span
            role="button"
            tabIndex={0}
            className="at-ol-group__action-btn at-ol-group__action-btn--edit"
            aria-label={`編輯「${group.name}」`}
            title={`修改「${group.name}」的名稱`}
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); onEditGroup(group.id); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onEditGroup(group.id); } }}
          >
            ✏️ 編輯
          </span>
        )}

        <span className={`at-ol-chevron${collapsed ? "" : " at-ol-chevron--open"}`} aria-hidden="true">▶</span>
      </button>

      {!collapsed && (
        <div
          id={`at-ol-group-body-${group.id}`}
          className="at-ol-group__body"
        >
          {previewSpec && (
            <PreviewTeamCard
              spec={previewSpec}
              onCreate={onCreatePreview}
              onCancel={onCancelPreview}
              creating={creatingPreview}
              status={previewStatus}
              onSelectPreviewMember={onSelectPreviewMember}
            />
          )}
          {groupTeamList.map((team) => (
            <TeamSection
              key={team.id}
              team={team}
              collapsed={collapsedTeams.has(team.id)}
              onToggleTeam={onToggleTeam}
              onSelectAgent={onSelectAgent}
              onSetPlatform={onSetPlatform}
              onOpenTeamDetail={onOpenTeamDetail}
              onOpenTeamChat={onOpenTeamChat}
              onOpenTeamOpsSession={onOpenTeamOpsSession}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AgentOrgList — 主元件
// ---------------------------------------------------------------------------

export function AgentOrgList({
  teams,
  groupConfig,
  collapsedGroups,
  collapsedTeams,
  onToggleGroup,
  onToggleTeam,
  onSelectAgent,
  onSetPlatform,
  onOpenTeamDetail,
  onOpenTeamChat,
  onOpenTeamOpsSession,
  onCreateTeamInGroup,
  onEditGroup,
  onAddGroup,
  previewSpec,
  previewGroupId,
  onCreatePreview,
  onCancelPreview,
  creatingPreview,
  previewStatus,
  onSelectPreviewMember,
}: AgentOrgListProps): React.JSX.Element {
  const grouped = groupTeams(teams, groupConfig);

  if (grouped.length === 0) {
    return (
      <div className="at-ol-empty">
        <p>尚無分組資料</p>
      </div>
    );
  }

  return (
    <div className="at-ol-root" role="tree" aria-label="AI 團隊組織清單">
      {grouped.map(({ group, teams: groupTeamList }) => (
        <GroupSection
          key={group.id}
          group={group}
          groupTeamList={groupTeamList}
          collapsed={collapsedGroups.has(group.id)}
          collapsedTeams={collapsedTeams}
          onToggleGroup={onToggleGroup}
          onToggleTeam={onToggleTeam}
          onSelectAgent={onSelectAgent}
          onSetPlatform={onSetPlatform}
          onOpenTeamDetail={onOpenTeamDetail}
          onOpenTeamChat={onOpenTeamChat}
          onOpenTeamOpsSession={onOpenTeamOpsSession}
          onCreateTeamInGroup={onCreateTeamInGroup}
          onEditGroup={onEditGroup}
          previewSpec={group.id === previewGroupId ? (previewSpec ?? null) : null}
          onCreatePreview={onCreatePreview}
          onCancelPreview={onCancelPreview}
          creatingPreview={creatingPreview}
          previewStatus={previewStatus}
          onSelectPreviewMember={onSelectPreviewMember}
        />
      ))}

      {/* 清單底部：新增一個工作群組（清單層級，非每群） */}
      {onAddGroup && (
        <button
          type="button"
          className="at-ol-add-group-btn"
          onClick={() => onAddGroup()}
          title="新增一個工作群組"
        >
          ＋ 新增工作群組
        </button>
      )}
    </div>
  );
}
