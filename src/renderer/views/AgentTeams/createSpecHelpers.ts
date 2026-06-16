/**
 * createSpecHelpers.ts — AgentTeams 建隊 spec 偵測／角色正規化／錯誤白話化純函式 leaf
 *
 * 從 AgentConversationPane.tsx 抽出的一批與 React 無關的純函式：
 *   - extractCreateTeamSpec / unwrapCreateSpec / readBalancedObject / tryParseJson
 *     — 從對話訊息文字偵測並解析建隊 spec。
 *   - normalizeMemberRole / normalizeRoleInTeam / isTeamPlatform
 *     — 角色與平台欄位正規化（避免 zod enum 擋下 AI 自由填值）。
 *   - humanizeCreateError / looksLikeZodIssues — 建立失敗錯誤白話化。
 *
 * 純移動，不改邏輯（agent-teams-live-preview-card-20260613）。
 */
import type {
  AgentTeamCreateSpecInput,
  ConversationMessage,
} from "../../../shared/ipcContracts";

// 建隊失敗訊息白話化：驗證失敗時 result.error 常是一整串 zod issues JSON
// （含 code/path/received/options），直接 dump 給非工程師使用者很糟。偵測到技術
// JSON 就改顯示白話訊息、並把原始細節 console.error 保留供除錯；一般訊息原樣顯示。
export function humanizeCreateError(error: string | undefined): string {
  if (!error) return "未知錯誤";
  const trimmed = error.trim();
  if (!looksLikeZodIssues(trimmed)) return error; // 一般訊息原樣顯示
  console.error("[createTeam] validation error", error);
  // 盡量指出是哪個欄位出錯，給使用者可行動的訊息；解析不出欄位才退回泛用訊息。
  const fields = describeZodIssueFields(trimmed);
  if (fields.length > 0) {
    return `團隊資料格式有問題：${fields.join("、")}。請調整後重新建立，或在對話裡微調團隊需求。`;
  }
  return "團隊資料格式有點問題，請再試一次，或在對話裡微調團隊需求後重新建立。";
}

// 欄位中文標籤：把 zod issue 的 path 首段對應成使用者看得懂的名稱。
const CREATE_FIELD_LABELS: Record<string, string> = {
  teamId: "團隊代號（teamId）",
  teamName: "團隊名稱（teamName）",
  skillName: "技能名稱（skillName，須為 tuq- 開頭）",
  platforms: "平台（platforms）",
  manager: "主管設定（manager）",
  members: "成員設定（members）",
  sourceId: "來源（sourceId）",
};

// 解析 zod issues JSON，回傳出錯欄位的中文標籤（去重、保序）。非預期格式回 []。
export function describeZodIssueFields(trimmed: string): string[] {
  let issues: unknown;
  try {
    issues = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (!Array.isArray(issues)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const issue of issues) {
    if (!issue || typeof issue !== "object") continue;
    const path = (issue as { path?: unknown }).path;
    const top = Array.isArray(path) && path.length > 0 ? String(path[0]) : "";
    const label = CREATE_FIELD_LABELS[top] ?? (top || "欄位");
    if (seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

export function looksLikeZodIssues(trimmed: string): boolean {
  if (trimmed.startsWith("[") && (trimmed.includes('"code"') || trimmed.includes('"path"'))) {
    return true;
  }
  try {
    return Array.isArray(JSON.parse(trimmed));
  } catch {
    return false; // 非 JSON → 當作一般訊息
  }
}

export function extractCreateTeamSpec(messages: ConversationMessage[]): AgentTeamCreateSpecInput | null {
  const text = messages
    .flatMap((message) => message.blocks)
    .filter((block) => block.kind === "text" || block.kind === "tool_result")
    .map((block) => block.text)
    .join("\n\n");

  const candidates: unknown[] = [];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenced.exec(text)) !== null) {
    const parsed = tryParseJson(match[1]);
    if (parsed !== null) candidates.push(parsed);
  }

  const markerIndex = text.lastIndexOf("agent_team_create_spec");
  if (markerIndex >= 0) {
    const objectStart = text.indexOf("{", markerIndex);
    const objectText = objectStart >= 0 ? readBalancedObject(text, objectStart) : null;
    const parsed = objectText ? tryParseJson(objectText) : null;
    if (parsed !== null) candidates.push(parsed);
  }

  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const candidate = unwrapCreateSpec(candidates[i]);
    if (candidate) return candidate;
  }
  return null;
}

// 規格化完成偵測：規格化對話完成時 AI 輸出 marker
//   {"agent_team_standardized": {"teamId": "<teamId>"}}
// 仿 extractCreateTeamSpec：掃對話文字找 ```json fenced 物件，以及**每一個** marker 字串後的
// 平衡括號物件，解出各自的 teamId。一條對話可能先後出現多隊的 marker（多隊規格化），
// 故回傳「所有不同 teamId」（去重、保序），讓上層對每隊各標一次；無則回 []。
// agentteams-standardize-flow-20260613 Batch 2b；F3 多隊支援。
export function extractStandardizedTeamIds(messages: ConversationMessage[]): string[] {
  const text = messages
    .flatMap((message) => message.blocks)
    .filter((block) => block.kind === "text" || block.kind === "tool_result")
    .map((block) => block.text)
    .join("\n\n");

  const candidates: unknown[] = [];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenced.exec(text)) !== null) {
    const parsed = tryParseJson(match[1]);
    if (parsed !== null) candidates.push(parsed);
  }

  // 掃**所有** marker 出現位置（非僅 lastIndexOf），各取其後的平衡括號物件，
  // 才能涵蓋同一條對話中多隊先後規格化的情況。
  const marker = "agent_team_standardized";
  let markerIndex = text.indexOf(marker);
  while (markerIndex >= 0) {
    const objectStart = text.indexOf("{", markerIndex);
    const objectText = objectStart >= 0 ? readBalancedObject(text, objectStart) : null;
    const parsed = objectText ? tryParseJson(objectText) : null;
    if (parsed !== null) candidates.push(parsed);
    markerIndex = text.indexOf(marker, markerIndex + marker.length);
  }

  const teamIds: string[] = [];
  for (const candidate of candidates) {
    const teamId = unwrapStandardizedTeamId(candidate);
    if (teamId && !teamIds.includes(teamId)) teamIds.push(teamId);
  }
  return teamIds;
}

function unwrapStandardizedTeamId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const inner = "agent_team_standardized" in record ? record.agent_team_standardized : record;
  if (!inner || typeof inner !== "object") return null;
  const teamId = (inner as Record<string, unknown>).teamId;
  return typeof teamId === "string" && teamId.trim() !== "" ? teamId : null;
}

export function unwrapCreateSpec(value: unknown): AgentTeamCreateSpecInput | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const spec = "agent_team_create_spec" in record ? record.agent_team_create_spec : record;
  if (!spec || typeof spec !== "object") return null;
  const maybe = spec as Record<string, unknown>;
  if (typeof maybe.teamId !== "string" || typeof maybe.teamName !== "string") return null;
  return {
    teamId: maybe.teamId,
    teamName: maybe.teamName,
    skillName: typeof maybe.skillName === "string" ? maybe.skillName : undefined,
    platforms: Array.isArray(maybe.platforms)
      ? maybe.platforms.filter(isTeamPlatform)
      : ["claude", "codex", "antigravity"],
    manager: typeof maybe.manager === "object" && maybe.manager !== null
      ? maybe.manager as AgentTeamCreateSpecInput["manager"]
      : {},
    members: Array.isArray(maybe.members)
      ? maybe.members.map(normalizeMemberRole) as AgentTeamCreateSpecInput["members"]
      : [],
  };
}

// AI 有時把 member 的 roleInTeam 填成 schema 不收的值（如 "project-manager"），
// 直接送出會被 zod enum 擋下並丟出技術錯誤。這裡只正規化 roleInTeam 一個欄位，
// 其餘欄位原樣保留，確保輸出值 ∈ {researcher,doer,verifier,shared}。
export function normalizeMemberRole(member: unknown): unknown {
  if (!member || typeof member !== "object") return member;
  const record = member as Record<string, unknown>;
  const raw = record.roleInTeam;
  // 缺 roleInTeam（含未填/空字串）→ 原樣保留，交給 schema .default("doer")。
  if (raw === undefined || raw === null || raw === "") return member;
  return { ...record, roleInTeam: normalizeRoleInTeam(raw) };
}

// 白名單映射：合法四值原樣保留；研究/驗收類同義詞寬鬆對應；
// 其餘（含 manager/pm/lead/project-manager 等，本應走頂層 manager 物件）一律退成 doer。
export function normalizeRoleInTeam(raw: unknown): "researcher" | "doer" | "verifier" | "shared" {
  const value = String(raw).trim().toLowerCase();
  if (value === "researcher" || value === "doer" || value === "verifier" || value === "shared") return value;
  if (value.includes("research")) return "researcher";
  if (/verif|qa|review|test|audit/.test(value)) return "verifier";
  return "doer";
}

function isTeamPlatform(value: unknown): value is NonNullable<AgentTeamCreateSpecInput["platforms"]>[number] {
  return value === "claude" || value === "codex" || value === "antigravity";
}

function tryParseJson(text: string): unknown | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // 嚴格解析失敗：嘗試寬鬆清理後重試。
    // AI 輸出常見瑕疵：trailing comma、// 單行註解、/* */ 多行註解。
    // 清理用狀態機掃描跳過字串字面值，避免誤傷字串內的逗號/斜線/*。
    const cleaned = sanitizeLenientJson(trimmed);
    if (cleaned === null) return null;
    try {
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }
}

// 寬鬆 JSON 清理：移除 "//" 單行註解、"/* */" 多行註解、以及 trailing comma
// （",}" → "}"、",]" → "]"）。使用狀態機追蹤字串字面值與多行狀態，
// 確保字串內的逗號/斜線/星號不被誤傷。
// 若清理後與輸入相同（沒有實際改動），回 null（讓呼叫端沿用原始 parse 失敗）。
function sanitizeLenientJson(text: string): string | null {
  const result: string[] = [];
  let i = 0;
  let changed = false;
  const len = text.length;

  while (i < len) {
    const ch = text[i];

    // --- 字串字面值：掃到對應 " 為止，逐字符搬移，不做任何清理 ---
    if (ch === '"') {
      result.push(ch);
      i += 1;
      while (i < len) {
        const sc = text[i];
        result.push(sc);
        if (sc === '\\') {
          i += 1;
          if (i < len) {
            result.push(text[i]);
            i += 1;
          }
        } else if (sc === '"') {
          i += 1;
          break;
        } else {
          i += 1;
        }
      }
      continue;
    }

    // --- // 單行註解：移除到行尾（不含換行符）---
    if (ch === '/' && i + 1 < len && text[i + 1] === '/') {
      changed = true;
      i += 2;
      while (i < len && text[i] !== '\n' && text[i] !== '\r') {
        i += 1;
      }
      continue;
    }

    // --- /* */ 多行註解：移除 ---
    if (ch === '/' && i + 1 < len && text[i + 1] === '*') {
      changed = true;
      i += 2;
      while (i + 1 < len && !(text[i] === '*' && text[i + 1] === '/')) {
        i += 1;
      }
      i += 2; // 跳過 */
      continue;
    }

    // --- trailing comma 偵測：`,` 後跳過空白，若接 `}` 或 `]` 則刪 `,` ---
    if (ch === ',') {
      let j = i + 1;
      while (j < len && (text[j] === ' ' || text[j] === '\t' || text[j] === '\n' || text[j] === '\r')) {
        j += 1;
      }
      if (j < len && (text[j] === '}' || text[j] === ']')) {
        // trailing comma：跳過逗號（改動）
        changed = true;
        i += 1;
        continue;
      }
    }

    result.push(ch);
    i += 1;
  }

  return changed ? result.join('') : null;
}

function readBalancedObject(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
