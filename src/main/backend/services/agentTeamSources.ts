/**
 * agentTeamSources.ts — 多來源團隊「來源清單」純函式（docs/multi-source-teams.md）。
 *
 * 從 AgentTeamsService 抽出無 this 依賴的純邏輯：來源清單解析、來源根解析、id 產生。
 * 服務層只負責讀寫 app_settings + fallback 預設根，把這些值餵給本檔的純函式。
 */
import type { TeamSource } from "../../../shared/ipcContracts";
import { parseTeamKey } from "../../../shared/ipcContracts";

/** 預設來源的固定識別碼。 */
export const DEFAULT_SOURCE_ID = "default";

/**
 * parseTeamSources — 把 app_settings(agentTeamSources) 原始值解析成合法 TeamSource[]。
 * id/path 缺一不可（path 空 → 無法推導團隊路徑，略過）；kind 限定枚舉，其餘忽略。
 * 解析不到任何合法來源 → 回 null（呼叫端 fallback 合成 default）。
 */
export function parseTeamSources(raw: unknown): TeamSource[] | null {
  const sources =
    raw && typeof raw === "object"
      ? (raw as Record<string, unknown>)["sources"]
      : undefined;
  if (!Array.isArray(sources)) return null;
  const parsed: TeamSource[] = [];
  for (const s of sources) {
    if (typeof s !== "object" || s === null) continue;
    const rec = s as Record<string, unknown>;
    const id = typeof rec["id"] === "string" ? rec["id"] : "";
    const path = typeof rec["path"] === "string" ? rec["path"].trim() : "";
    if (!id || !path) continue;
    const label =
      typeof rec["label"] === "string" && rec["label"].trim()
        ? (rec["label"] as string)
        : id;
    const kindVal = rec["kind"];
    const kind =
      kindVal === "gdrive-shared" ||
      kindVal === "local" ||
      kindVal === "project-repo" ||
      kindVal === "other"
        ? kindVal
        : undefined;
    parsed.push(kind ? { id, label, path, kind } : { id, label, path });
  }
  return parsed.length > 0 ? parsed : null;
}

/** 合成「單一 default 來源」（向後相容：path === 既有 agentOrgRootPath）。 */
export function synthDefaultSource(rootPath: string): TeamSource {
  return {
    id: DEFAULT_SOURCE_ID,
    label: "預設",
    path: rootPath,
    kind: "gdrive-shared",
  };
}

/**
 * sourceRootForTeam — 取某團隊所屬「來源根」（agents 根）。
 *   - 複合鍵 `sourceId::teamId` → 查對應來源 path；查無 → fallback default。
 *   - 裸 teamId / undefined → default 來源根。
 * parseTeamKey 以第一個 `::` 切 sourceId（sourceId 絕不含 `::`/`/`）。
 */
export function sourceRootForTeam(
  sources: TeamSource[],
  teamId: string | undefined,
  fallbackRoot: string,
): string {
  const defaultSource =
    sources.find((s) => s.id === DEFAULT_SOURCE_ID) ?? sources[0];
  if (teamId) {
    const { sourceId } = parseTeamKey(teamId);
    if (sourceId) {
      const matched = sources.find((s) => s.id === sourceId);
      if (matched) return matched.path;
    }
  }
  return defaultSource?.path ?? fallbackRoot;
}

/** 由 label 產生穩定且唯一的來源 id（小寫去特殊字元；撞號加序號；空 → 'source'）。 */
export function makeSourceId(label: string, existing: TeamSource[]): string {
  const base =
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "source";
  const taken = new Set(existing.map((s) => s.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}
