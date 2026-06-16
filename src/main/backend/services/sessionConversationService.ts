/**
 * backend/services/sessionConversationService.ts — Session 綁定 + 對話查詢
 * delegate service（backend.ts 拆分計畫 Batch 11（11a 對話查詢 U 區）；行為保留 move-only）。
 *
 * 自 backend.ts 機械搬入（U 區，對應 Qt monitor_bind + 對話面板）：
 *   listProjectSessions / getSessionConversation / listSkills /
 *   getSubagentConversation / getConversationWindow / getSegments /
 *   getSegmentMessages / getRawLines / rebindSession / renameSession +
 *   私有 _resolveConvFile。
 *
 * 與 sessionService.ts（M+V+claim，11b）拆檔同批落地：兩者共讀 ctx.sessions /
 * ctx.activeSessions **同一**參照（R5），無互相直接相依；拆檔另因 ESLint
 * max-lines:500 守門（新檔不入 allowlist）。
 *
 * Backend 對應 public 方法改 thin delegation（facade 簽名不變，consumer 零改動）。
 */

import * as taskSessionsConfig from "../../config/taskSessions";
import { buildLaunchCommand } from "../../services/sessions";
import { writeSessionCustomTitle } from "../../services/sessionTitle";
import { listSkillCommands } from "../../services/skillsList";
import {
  listSessionFilesLight,
  readSessionSummaryLight,
  sessionDisplayLabel,
  resolveSubagentTranscript,
} from "../../worktime/claude/lightList";
import { resolveWorkflowAgentTranscript } from "../../worktime/claude/workflows";
import { findCodexRollout } from "../../worktime/codex/discover";
import type {
  BindSessionItem,
  ConversationMessage,
  SkillItem,
  SubagentConversationResult,
  SegmentInfo,
  ConversationWindowResult,
  SegmentListResult,
} from "../../../shared/ipcContracts";
import type { AgentRegistryRow } from "../../repo/sqliteTaskRepository";
import { _genUuid } from "../ids";
import type { BackendContext } from "../context";

// ---------------------------------------------------------------------------
// 純函式：依 agent_registry 列補 displayName（可獨測）
// ---------------------------------------------------------------------------

/**
 * 將 agent_registry 的中文顯示名對照到 SkillItem 陣列。
 * 僅處理 skill_name 非 null 的列；找不到對應 skill 的列忽略。
 * rows 為空或 skills 為空時回傳原始陣列（不改動）。
 */
export function attachSkillDisplayNames(
  skills: SkillItem[],
  rows: AgentRegistryRow[],
): SkillItem[] {
  if (rows.length === 0 || skills.length === 0) return skills;
  // 建 Map<skill_name, display_name>（只取 skill_name 非 null 的列）
  const map = new Map<string, string | null>();
  for (const r of rows) {
    if (r.skill_name !== null) {
      map.set(r.skill_name, r.display_name);
    }
  }
  return skills.map((s) => ({
    ...s,
    displayName: map.has(s.name) ? (map.get(s.name) ?? null) : null,
  }));
}

export class SessionConversationService {
  constructor(private readonly _ctx: BackendContext) {}

  // --------------------------------------------------------------------------
  // Session 綁定（對應 Qt monitor_bind：列 session / 換綁監測對象）
  // --------------------------------------------------------------------------

  /**
   * 列出此 session 所屬專案的所有 claude session（給綁定下拉用）。
   * 對應 Qt monitor_bind._refresh_bind_combo 的資料來源。
   * 非 claude / 無 projectPath → 回 []。被別任務佔用者標 busy。
   */
  listProjectSessions(sessionId: string): BindSessionItem[] {
    const entry = this._ctx.sessions.get(sessionId);
    if (!entry || entry.tool !== "claude" || !entry.projectPath) return [];
    // 輕量列表 + 檔頭摘要標籤（64KB/檔）；不做 getProject 完整解析（大檔會卡死 main）。
    const sessions = listSessionFilesLight(entry.projectPath);
    const items: BindSessionItem[] = [];
    for (const s of sessions) {
      const id = s.session_id;
      if (!id) continue;
      const owner = this._ctx.activeSessions.get(id);
      const busy = owner !== undefined && owner !== entry.taskId;
      let label = id.slice(0, 8);
      let tooltip = id;
      try {
        const sum = readSessionSummaryLight(s.file);
        const time =
          sum.startedAt && sum.startedAt.length >= 16
            ? sum.startedAt.slice(11, 16)
            : "";
        const parts: string[] = [sessionDisplayLabel(sum)];
        if (time) parts.push(time);
        parts.push(id.slice(0, 8));
        label = parts.join("  ·  ");
        tooltip = sum.customTitle || sum.title || sum.summary || id;
      } catch {
        // 摘要失敗用短碼
      }
      items.push({
        id,
        label,
        tooltip,
        busy,
        current: id === entry.claudeSessionId,
      });
    }
    // 新開對話：claude CLI 尚未跑起來寫出 JSONL，綁定的 claudeSessionId 還不在磁碟清單裡，
    // 下拉就抓不到「目前對話」而退回「＋ 新 session」，須等檔案落地 + 手動重整才出現。
    // 後端已知綁定 id（openSession 解析 / rebind 生成），故補一筆合成項標 current，
    // 讓 mount 當下即顯示此對話的 session id。待檔案落地後重抓會換成帶摘要的真實項。
    const bound = entry.claudeSessionId;
    if (bound && !items.some((it) => it.id === bound)) {
      items.unshift({
        id: bound,
        label: bound.slice(0, 8),
        tooltip: bound,
        busy: false,
        current: true,
      });
    }
    return items;
  }

  /**
   * 依 session 的 tool 定檔對話 JSONL（claude / codex 分流；對話面板五方法共用）。
   *   - claude：綁 claudeSessionId（JSONL 檔名 stem）+ projectPath → listSessionFilesLight 命中檔。
   *   - codex：啟動不指定 session id（裸 codex），檔名 uuid 事前未知 → 依 projectPath（cwd）
   *            + openedAtMs 下界 re-discover ~/.codex/sessions 下最新 rollout。
   *   - 其他 tool（agy/vscode/custom）：本任務不支援 → null（呼叫端回 FAIL，卡片空白，不崩）。
   * @returns 命中 → { file, cliId }；無法定檔 → null。
   */
  private _resolveConvFile(
    sessionId: string,
  ): { file: string; cliId: "claude" | "codex" } | null {
    const entry = this._ctx.sessions.get(sessionId);
    if (!entry) return null;
    if (entry.tool === "claude") {
      if (!entry.claudeSessionId || !entry.projectPath) return null;
      const file = listSessionFilesLight(entry.projectPath).find(
        (s) => s.session_id === entry.claudeSessionId,
      )?.file;
      return file ? { file, cliId: "claude" } : null;
    }
    if (entry.tool === "codex") {
      if (!entry.projectPath) return null;
      const file = findCodexRollout(entry.projectPath, entry.openedAtMs);
      return file ? { file, cliId: "codex" } : null;
    }
    return null;
  }

  /**
   * 撈某 session 目前綁定的對話（給 session chat pane 用）。
   * claude → claudeSessionId+projectPath 定檔；codex → cwd+openedAtMs 定檔；其他 → 回 []。
   */
  getSessionConversation(sessionId: string): ConversationMessage[] {
    const r = this._resolveConvFile(sessionId);
    if (!r) return [];
    return this._ctx.convStore.getByFile(r.file, r.cliId);
  }

  /** 列出可用 skill 指令（~/.claude/skills + <專案>/.claude/skills；對話框派遣下拉用）。
   * 取得 skills 後，查 agent_registry 補 displayName（中文顯示名）。
   * registry 讀取失敗時容錯回原始 list，不影響既有功能。
   */
  listSkills(sessionId: string): SkillItem[] {
    const entry = this._ctx.sessions.get(sessionId);
    const skills = listSkillCommands(entry?.projectPath || null);
    try {
      const rows = this._ctx.repo.getAgentRegistry();
      return attachSkillDisplayNames(skills, rows);
    } catch {
      // registry 讀取失敗不阻斷技能清單
      return skills;
    }
  }

  /**
   * 依 toolUseId 取 subagent 子對話（給對話面板展開 subagent 卡片用）。
   * 非 claude session / 無 claudeSessionId / 無 projectPath → 失敗回傳。
   * resolveSubagentTranscript 找不到對應 meta/JSONL → 失敗回傳。
   * 命中 → 從 _convStore 取 subagent 對話訊息，回 ok:true 結果。
   */
  getSubagentConversation(
    sessionId: string,
    toolUseId: string,
  ): SubagentConversationResult {
    const FAIL: SubagentConversationResult = {
      ok: false,
      agentId: null,
      agentType: null,
      description: null,
      messages: [],
    };
    const entry = this._ctx.sessions.get(sessionId);
    if (
      !entry ||
      entry.tool !== "claude" ||
      !entry.claudeSessionId ||
      !entry.projectPath
    )
      return FAIL;
    const info = resolveSubagentTranscript(
      entry.projectPath,
      entry.claudeSessionId,
      toolUseId,
    );
    if (!info) return FAIL;
    const messages = this._ctx.convStore.getByFile(info.file);
    return {
      ok: true,
      agentId: info.agentId,
      agentType: info.agentType,
      description: info.description,
      messages,
    };
  }

  /**
   * workflow 子代理完整逐字稿（進度卡展開 agent → 載入完整內容）。
   * 路徑 <project>/<convId>/subagents/workflows/<runId>/agent-<agentId>.jsonl，
   * 解析複用 conversationStore；非 claude / 無對應檔 → ok:false 空結果。
   */
  getWorkflowAgentConversation(
    sessionId: string,
    runId: string,
    agentId: string,
  ): SubagentConversationResult {
    const FAIL: SubagentConversationResult = {
      ok: false,
      agentId: null,
      agentType: null,
      description: null,
      messages: [],
    };
    const entry = this._ctx.sessions.get(sessionId);
    if (
      !entry ||
      entry.tool !== "claude" ||
      !entry.claudeSessionId ||
      !entry.projectPath
    )
      return FAIL;
    const info = resolveWorkflowAgentTranscript(
      entry.projectPath,
      entry.claudeSessionId,
      runId,
      agentId,
    );
    if (!info) return FAIL;
    const messages = this._ctx.convStore.getByFile(info.file);
    return {
      ok: true,
      agentId: info.agentId,
      agentType: info.agentType,
      description: null,
      messages,
    };
  }

  /**
   * 動態初始窗口：觸發增量解析後依讀取水位回傳未讀訊息範圍。
   * 依 tool 定檔（claude / codex）；無法定檔 / 解析失敗 → ok:false 空結果。
   */
  getConversationWindow(sessionId: string): ConversationWindowResult {
    const FAIL: ConversationWindowResult = {
      ok: false,
      messages: [],
      startSeq: 0,
      totalCount: 0,
    };
    const r = this._resolveConvFile(sessionId);
    if (!r) return FAIL;
    const result = this._ctx.convStore.getWindow(r.file, r.cliId);
    return {
      ok: true,
      messages: result.messages,
      startSeq: result.startSeq,
      totalCount: result.totalCount,
    };
  }

  /**
   * 取段落索引列表（直接查 DB，不觸發增量解析）。
   * 依 tool 定檔（claude / codex）；無法定檔 / 解析失敗 → ok:false 空結果。
   */
  getSegments(sessionId: string): SegmentListResult {
    const FAIL: SegmentListResult = { ok: false, segments: [], totalCount: 0 };
    const r = this._resolveConvFile(sessionId);
    if (!r) return FAIL;
    const result = this._ctx.convStore.getSegments(r.file);
    const segments: SegmentInfo[] = result.segments.map(
      ({
        seg_no,
        start_seq,
        end_seq,
        start_ts,
        end_ts,
        label,
        is_command,
        msg_count,
        head_kind,
      }) => ({
        seg_no,
        start_seq,
        end_seq,
        start_ts,
        end_ts,
        label,
        is_command,
        msg_count,
        // head_kind 非法值 fallback 'other'（DB 舊資料或未知型別的防衛）
        head_kind: (["typed", "command", "notify", "other"].includes(head_kind)
          ? head_kind
          : "other") as SegmentInfo["head_kind"],
      }),
    );
    return { ok: true, segments, totalCount: result.totalCount };
  }

  /**
   * 依 seq 範圍查詢訊息（含端點；直接查 DB）。
   * 依 tool 定檔（claude / codex）；無法定檔 / 解析失敗 → ok:false 空結果。
   */
  getSegmentMessages(
    sessionId: string,
    startSeq: number,
    endSeq: number,
  ): { ok: boolean; messages: ConversationMessage[] } {
    const FAIL = { ok: false, messages: [] as ConversationMessage[] };
    const r = this._resolveConvFile(sessionId);
    if (!r) return FAIL;
    const messages = this._ctx.convStore.getMessagesRange(
      r.file,
      startSeq,
      endSeq,
      r.cliId,
    );
    return { ok: true, messages };
  }

  /**
   * 依 seq 範圍取原始 JSONL 行（Raw 模式按需使用；cap 500 行或 2MB）。
   * 依 tool 定檔（claude / codex）；無法定檔 / 讀失敗 → ok:false 空結果。
   */
  getRawLines(
    sessionId: string,
    startSeq: number,
    endSeq: number,
  ): { ok: boolean; lines: string[]; truncated: boolean } {
    const FAIL = { ok: false, lines: [] as string[], truncated: false };
    const r = this._resolveConvFile(sessionId);
    if (!r) return FAIL;
    const result = this._ctx.convStore.getRawLines(r.file, startSeq, endSeq);
    return { ok: true, ...result };
  }

  /**
   * 換綁監測對象（對應 Qt monitor_bind._on_bind_session）。
   * claudeSessionId=null → 新開一個 session（生成新 uuid）。
   * 寫回 config active、重算 launchCommand、重置監測 since/去重並立即重掃。
   * 回新的 claudeSessionId + launchCommand（供終端 resume 新綁對象）。
   */
  rebindSession(
    sessionId: string,
    claudeSessionId: string | null,
  ): {
    ok: boolean;
    claudeSessionId: string | null;
    launchCommand: string | null;
  } {
    const entry = this._ctx.sessions.get(sessionId);
    if (!entry)
      return { ok: false, claudeSessionId: null, launchCommand: null };
    if (entry.tool !== "claude")
      return { ok: false, claudeSessionId: null, launchCommand: null };

    const target = claudeSessionId || _genUuid();
    const mode: "resume" | "new_id" = claudeSessionId ? "resume" : "new_id";

    entry.claudeSessionId = target;
    // 持久化 active（綁定語意，使用者主動觸發 → 寫 config 正確）。
    try {
      taskSessionsConfig.setActive(entry.taskId, target, {
        source: "claude",
        project_path: entry.projectPath || null,
      });
    } catch {
      // 寫設定失敗不阻斷
    }
    const { command } = buildLaunchCommand(
      entry.tool,
      entry.projectPath,
      target,
      null,
      mode,
    );
    entry.launchCommand = command;

    // 重綁監測 target（重置 since/去重 + 立即掃一次）。
    try {
      entry.monitor.rebind(target);
    } catch {
      // 容錯
    }

    return { ok: true, claudeSessionId: target, launchCommand: command };
  }

  /**
   * 改名：往目前綁定的 claude session JSONL 追加 custom-title 記錄。
   * 對應 Qt session 改名（write_session_custom_title）。
   * 無綁定 session / 寫入失敗 → false。
   */
  renameSession(sessionId: string, customTitle: string): boolean {
    const entry = this._ctx.sessions.get(sessionId);
    if (!entry || !entry.claudeSessionId || !entry.projectPath) return false;
    return writeSessionCustomTitle(
      entry.projectPath,
      entry.claudeSessionId,
      customTitle,
    );
  }
}
