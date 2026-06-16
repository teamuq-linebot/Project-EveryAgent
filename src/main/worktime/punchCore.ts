/**
 * Source-agnostic 打卡聚合核心。
 * 忠實移植自 Python teamuq/worktime/sources/_punch_core.py。
 * 把「跨 session 掃 work_timeline → 依 punch_name 分組 / 整理打卡事件」的邏輯
 * 抽成不綁特定來源的核心，由各來源以自己的 getProject / punchNameForRow / eventKey 餵入。
 *
 * 全程容錯：缺資料 / 解析失敗回空結構，絕不丟例外。
 */

import { toEpochMs, toIsoFromEpochMs } from './jsonl';
import { unionDurationMs } from './timestats';

// ---------------------------------------------------------------------------
// 常數
// ---------------------------------------------------------------------------

/** 主對話打卡名稱（manager；is_main 判斷依據）。對應 Python MAIN_PUNCH_NAME。 */
export const MAIN_PUNCH_NAME = 'agent_manager';

/** subagent punch_name 後綴雜訊上限（超過視為雜訊，fallback agent_type）。 */
const _NAME_MAX_LEN = 40;

/** 偵測 CJK（中日韓）字元；subagent 名稱含 CJK 句子型文字視為雜訊。 */
const _CJK_RE = /[　-〿぀-ヿ㐀-䶿一-鿿＀-￯]/;

/** subagent row title 前綴。 */
const _SUBAGENT_TITLE_PREFIX = 'Sub-agent：';

// ---------------------------------------------------------------------------
// 抓 ```json ... ``` code fence 的 regex
// ---------------------------------------------------------------------------
const _RE_JSON_FENCE = /```(?:json)?\s*([\s\S]*?)```/gi;

// ---------------------------------------------------------------------------
// helper: sanitizePunchName
// ---------------------------------------------------------------------------

/**
 * subagent 的 punch_name 防呆：後綴若明顯是雜訊 → fallback agent_type。
 * 對應 Python sanitize_punch_name()。
 */
function sanitizePunchName(name: string, agentType: unknown): string {
  name = (name ?? '').trim();
  if (!name) return 'agent_unknown';
  if (name === MAIN_PUNCH_NAME) return name;

  const prefix = 'agent_';
  const suffix = name.startsWith(prefix) ? name.slice(prefix.length) : name;

  const noisy =
    suffix.includes('\n') ||
    suffix.includes('\r') ||
    suffix.length > _NAME_MAX_LEN ||
    _CJK_RE.test(suffix);

  if (!noisy) return name;

  const at = ((agentType as string | undefined) ?? '').trim();
  if (
    at &&
    !at.includes('\n') &&
    !at.includes('\r') &&
    at.length <= _NAME_MAX_LEN &&
    !_CJK_RE.test(at)
  ) {
    return prefix + at;
  }
  return prefix + 'unknown';
}

// ---------------------------------------------------------------------------
// helper: extractOutputJson
// ---------------------------------------------------------------------------

/**
 * 從 agent 最後輸出文字抓「結尾的 {title, description} JSON 白話總結」。
 * 對應 Python _extract_output_json()。
 * 全程容錯，失敗回 [null, null]。
 */
function extractOutputJson(lastOutput: string): [string | null, string | null] {
  const text = (lastOutput ?? '').trim();
  if (!text) return [null, null];

  const candidates: string[] = [];

  // 1) code fence 內的內容（依出現順序）
  _RE_JSON_FENCE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = _RE_JSON_FENCE.exec(text)) !== null) {
    const body = (m[1] ?? '').trim();
    if (body) candidates.push(body);
  }

  // 2) 文字中每個 '{' 起頭、平衡括號切片
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          candidates.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }

  let result: [string | null, string | null] = [null, null];
  for (const cand of candidates) {
    try {
      const parsed: unknown = JSON.parse(cand);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;
      const obj = parsed as Record<string, unknown>;
      const title = obj['title'];
      const desc = obj['description'];
      if (typeof title === 'string' && typeof desc === 'string') {
        const t = title.trim();
        const d = desc.trim();
        if (t && d) result = [t, d];
      }
    } catch {
      continue;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// helper: subagentDescription
// ---------------------------------------------------------------------------

/**
 * 從 subagent row 取出乾淨的「任務描述」。
 * 對應 Python subagent_description()。
 */
function subagentDescription(row: Record<string, unknown>): string {
  const title = ((row['title'] as string | undefined) ?? '').trim();
  if (title.startsWith(_SUBAGENT_TITLE_PREFIX)) {
    const desc = title.slice(_SUBAGENT_TITLE_PREFIX.length).trim();
    if (desc && desc !== '未命名任務' && desc !== '未對應主呼叫') {
      return desc;
    }
  }
  return ((row['agent_type'] as string | undefined) ?? '').trim();
}

// ---------------------------------------------------------------------------
// helper: subagentTokens
// ---------------------------------------------------------------------------

/**
 * 從 subagent row 的 token_usage 取 total（四捨五入為 int）；缺 → 0。
 * 對應 Python subagent_tokens()。
 */
function subagentTokens(row: Record<string, unknown>): number {
  const tu = row['token_usage'];
  if (typeof tu !== 'object' || tu === null || Array.isArray(tu)) return 0;
  const total = (tu as Record<string, unknown>)['total'];
  try {
    const n = parseFloat(String(total));
    return isNaN(n) ? 0 : Math.round(n);
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// helper: isEndTurn
// ---------------------------------------------------------------------------

/**
 * 主對話那一輪是否已收尾（stop=='end_turn'）。
 * 對應 Python _is_end_turn()。
 */
function isEndTurn(r: Record<string, unknown>): boolean {
  if ((r['stop'] ?? '') === 'end_turn') return true;
  // 相容尚未帶 stop 欄位的舊資料：用 detail 字串推斷
  return String(r['detail'] ?? '').includes('stop: end_turn');
}

// ---------------------------------------------------------------------------
// helper: roundPunchUid
// ---------------------------------------------------------------------------

/**
 * per-round main 的跨掃描穩定去重鍵（同輪恆定、輪間互異）。
 *
 * 優先用該輪 end_turn 的 main-ai 的 request_id（跨掃描恆定）；
 * 退而求其次任一帶 request_id 的 row；最後才用 round key 兜底。
 * 對應 Python _round_punch_uid()。
 */
function roundPunchUid(rkey: unknown, grp: Record<string, unknown>[], sessionId: unknown): string {
  for (const r of grp) {
    if (r['kind'] === 'main-ai' && isEndTurn(r) && r['request_id']) {
      return `main|${sessionId}|${r['request_id']}`;
    }
  }
  for (const r of grp) {
    if (r['request_id']) {
      return `main|${sessionId}|${r['request_id']}`;
    }
  }
  return `main|${sessionId}|round-${rkey}`;
}

// ---------------------------------------------------------------------------
// helper: wallclockStartEnd
// ---------------------------------------------------------------------------

/**
 * 回 [started_at, ended_at] 真實牆鐘字串。
 * 修「開始=結束」bug：subagent 打卡要送真實且不同的 start/end。
 * 對應 Python _wallclock_start_end()。
 */
function wallclockStartEnd(row: Record<string, unknown>): [unknown, string | null] {
  const started_at = row['started_at'] as string | null | undefined;
  const ended_at = row['ended_at'] as string | null | undefined;
  const startMs = toEpochMs(started_at);
  if (startMs === null) return [started_at ?? null, ended_at ?? null];
  const endMs = toEpochMs(ended_at);
  // ended_at 有效且嚴格大於 start → 直接用牆鐘
  if (endMs !== null && endMs > startMs) return [started_at ?? null, ended_at ?? null];
  // fallback：start + duration_ms（至少 +1ms 保證 end != start）
  let durMs = row['duration_ms'];
  if (
    typeof durMs !== 'number' ||
    typeof durMs === 'boolean' ||
    !(durMs > 0)
  ) {
    durMs = 1;
  }
  return [started_at ?? null, toIsoFromEpochMs(startMs + Math.trunc(durMs as number))];
}

// ---------------------------------------------------------------------------
// helper: rowArtifacts（§2.14d D31）
// ---------------------------------------------------------------------------

/**
 * 從 work_timeline row 讀 `edit_artifacts`（parse.buildWorkTimeline 掛的 Edit/Write 操作）。
 * 容錯：非陣列回 []；逐列正規化為 PunchArtifact（缺欄補預設、型別不符回保守值）。
 */
function rowArtifacts(row: Record<string, unknown>): PunchArtifact[] {
  const raw = row['edit_artifacts'];
  if (!Array.isArray(raw)) return [];
  const out: PunchArtifact[] = [];
  for (const a of raw) {
    if (typeof a !== 'object' || a === null) continue;
    const o = a as Record<string, unknown>;
    const toolUseId = String(o['tool_use_id'] ?? '').trim();
    if (!toolUseId) continue;
    const hunkIndexRaw = o['hunk_index'];
    const oldStartRaw = o['old_start'];
    const contentLinesRaw = o['content_lines'];
    const addedRaw = o['lines_added'];
    const removedRaw = o['lines_removed'];
    out.push({
      tool_use_id: toolUseId,
      hunk_index:
        typeof hunkIndexRaw === 'number' && Number.isFinite(hunkIndexRaw)
          ? Math.trunc(hunkIndexRaw)
          : 0,
      file_path: String(o['file_path'] ?? ''),
      tool: String(o['tool'] ?? ''),
      op_type: o['op_type'] == null ? null : String(o['op_type']),
      old_start:
        typeof oldStartRaw === 'number' && Number.isFinite(oldStartRaw)
          ? Math.trunc(oldStartRaw)
          : null,
      lines_added:
        typeof addedRaw === 'number' && Number.isFinite(addedRaw) ? Math.trunc(addedRaw) : 0,
      lines_removed:
        typeof removedRaw === 'number' && Number.isFinite(removedRaw)
          ? Math.trunc(removedRaw)
          : 0,
      content_lines:
        typeof contentLinesRaw === 'number' && Number.isFinite(contentLinesRaw)
          ? Math.trunc(contentLinesRaw)
          : null,
      ts: o['ts'] == null ? null : String(o['ts']),
    })
  }
  return out;
}

/** 依 (tool_use_id, hunk_index) 去重，保留首見次序（同一 hunk 不重覆計入聚合）。 */
function dedupeArtifacts(arts: PunchArtifact[]): PunchArtifact[] {
  const seen = new Set<string>();
  const out: PunchArtifact[] = [];
  for (const a of arts) {
    const key = `${a.tool_use_id}|${a.hunk_index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

// ---------------------------------------------------------------------------
// helper: normalizeSessionIds
// ---------------------------------------------------------------------------

function normalizeSessionIds(
  sessionIds: unknown,
): [false, null] | [true, Set<string>] {
  if (sessionIds === null || sessionIds === undefined) return [false, null];
  if (!Array.isArray(sessionIds) && !(sessionIds instanceof Set)) return [false, null];
  try {
    const iter: Iterable<unknown> = sessionIds as Iterable<unknown>;
    const s = new Set<string>();
    for (const v of iter) s.add(String(v));
    return [true, s];
  } catch {
    return [false, null];
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * 單一 Edit/Write 操作（hunk 級；§2.14d D31）。對應 punch_artifacts 一列（去 punch 關聯鍵）。
 * 由 parse.buildWorkTimeline 萃取後掛在 row.edit_artifacts；此處依 punch 聚合進 event.artifacts。
 * 欄名對齊 punch_artifacts schema（sqliteTaskRepository SCHEMA_PUNCH_ARTIFACTS）。
 */
export interface PunchArtifact {
  tool_use_id: string;
  hunk_index: number;
  file_path: string;
  tool: string; // 'Edit' | 'Write'
  op_type: string | null;
  old_start: number | null;
  lines_added: number;
  lines_removed: number;
  content_lines: number | null;
  ts: string | null;
}

export interface SubagentEvent {
  event_key: string;
  punch_uid: string;
  punch_name: string;
  started_at: unknown;
  ended_at: string | null;
  duration_hours: number;
  is_complete: boolean;
  description: string;
  model: string;
  tokens: number;
  input_prompt: string;
  output_json_title: string | null;
  output_json_description: string | null;
  last_output: string;
  /** §2.14d D31：本 event 涵蓋的 Edit/Write 操作（hunk 級，精確行數）。純本地不上傳。 */
  artifacts: PunchArtifact[];
}

export interface MainEvent {
  punch_uid: string;
  punch_name: string;
  round: unknown;
  started_at: string | null;
  ended_at: string | null;
  duration_hours: number;
  is_complete: boolean;
  description: string;
  input_prompt: string;
  output_json_title: string;
  output_json_description: string;
  last_output: string;
  /** §2.14d D31：本輪涵蓋的 Edit/Write 操作（hunk 級，精確行數）。純本地不上傳。 */
  artifacts: PunchArtifact[];
}

export interface MainSummary {
  duration_hours: number;
  started_at: unknown;
  ended_at: string | null;
  event_count: number;
  description: string;
  output_json_title: string | null;
  output_json_description: string | null;
}

export interface PunchEventsResult {
  subagent_events: SubagentEvent[];
  main: MainSummary;
  main_events: MainEvent[];
}

// ---------------------------------------------------------------------------
// collectPunchEventsCore
// ---------------------------------------------------------------------------

/**
 * 掃 project 所有 session 的 work_timeline，整理成可即時打卡的結構。
 *
 * @param getProject   注入的 project 取得函式（(path) => {sessions: ...}）
 * @param punchNameFn  注入的 row→打卡名 函式
 * @param eventKeyFn   注入的 event 穩定 key 函式
 * @param projectPath  project 路徑
 * @param sinceMs      僅取 started_at >= sinceMs 的事件（null 不過濾）
 * @param sessionIds   僅取集合內的 session（null 不過濾）
 *
 * 對應 Python collect_punch_events_core()。全程容錯，失敗回空結構。
 */
export function collectPunchEventsCore(
  getProject: (path: unknown) => unknown,
  punchNameFn: (row: Record<string, unknown>) => string | null,
  eventKeyFn: (sessionId: unknown, row: Record<string, unknown>) => string,
  projectPath: unknown,
  sinceMs: number | null,
  sessionIds: unknown,
): PunchEventsResult {
  const empty: PunchEventsResult = {
    subagent_events: [],
    main: {
      duration_hours: 0.0,
      started_at: null,
      ended_at: null,
      event_count: 0,
      description: '',
      output_json_title: null,
      output_json_description: null,
    },
    main_events: [],
  };

  const [filterActive, idSet] = normalizeSessionIds(sessionIds);

  let project: unknown;
  try {
    project = getProject(projectPath);
  } catch {
    return empty;
  }

  if (typeof project !== 'object' || project === null) return empty;
  const projectObj = project as Record<string, unknown>;
  const sessions = projectObj['sessions'];
  if (!Array.isArray(sessions)) return empty;

  function afterSince(row: Record<string, unknown>): boolean {
    if (sinceMs === null) return true;
    const epoch = toEpochMs(row['started_at']);
    if (epoch === null) return false;
    return epoch >= sinceMs;
  }

  const subagentEvents: SubagentEvent[] = [];
  const mainRows: Record<string, unknown>[] = [];
  // per-round 分桶：round_key → list[row]
  const mainRoundGroups = new Map<unknown, Record<string, unknown>[]>();
  // main 的第一句使用者訊息（不受 since_ms 過濾後最早）
  let mainFirstUser: [number, string] | null = null;
  // 全量 main-user 起始時間（不受 since_ms 過濾）：供 m_start 回推用
  const mainUserAllMs: number[] = [];
  // round → 首句 input_prompt map
  const roundInputMap = new Map<unknown, string>();
  // main 的最後 assistant 輸出
  let mainLastOutput: [number, string] | null = null;

  // 最後一個被迭代到的 session_id（供 _round_punch_uid 使用）。
  // Python: session_id = session.get("session_id") 在 per-session 迴圈**最頂端**即設定，
  // 因此 _round_punch_uid 用的是「迴圈最後被迭代到的那個 session」的 id，與
  // filter_active / 有無 main row 無關。TS 同步此語意：每進一個 session 就更新。
  let lastSessionId: unknown = null;

  try {
    for (const session of sessions) {
      if (typeof session !== 'object' || session === null) continue;
      const sessionObj = session as Record<string, unknown>;
      const sessionId = sessionObj['session_id'];
      // 對齊 Python：在 per-session 迴圈頂端就更新 lastSessionId（與 filter/row 種類無關）
      lastSessionId = sessionId;
      if (filterActive && !idSet!.has(String(sessionId))) continue;

      const timeline = sessionObj['work_timeline'];
      const rows: unknown[] = Array.isArray(timeline) ? timeline : [];

      for (const rowRaw of rows) {
        if (typeof rowRaw !== 'object' || rowRaw === null) continue;
        const row = rowRaw as Record<string, unknown>;
        const kind = row['kind'];

        if (kind === 'subagent') {
          if (!afterSince(row)) continue;
          const rawName = punchNameFn(row);
          if (!rawName) continue;
          const punchName = sanitizePunchName(rawName, row['agent_type']);
          let ekey: string;
          try {
            ekey = eventKeyFn(sessionId, row);
          } catch {
            ekey = '';
          }
          // 跨掃描穩定去重鍵（source-first）
          const punchUid =
            String(row['source'] ?? '').trim() ||
            String(row['agent_id'] ?? '').trim() ||
            String(row['tool_use_id'] ?? '').trim() ||
            ekey;

          let durMs = row['duration_ms'];
          if (typeof durMs !== 'number' || typeof durMs === 'boolean') {
            durMs = 0;
          }
          const [startedAt, endedAt] = wallclockStartEnd(row);
          // 真正完成判定只看 row 原始 ended_at（非 _wallclock 的 +1ms fallback）
          const rawEndedAt = row['ended_at'];
          const rawEndMs = rawEndedAt ? toEpochMs(rawEndedAt) : null;
          const startMs2 = toEpochMs(startedAt);

          let durationHours: number;
          if ((durMs as number) > 0) {
            durationHours = (durMs as number) / 3_600_000;
          } else if (rawEndMs !== null && startMs2 !== null && rawEndMs > startMs2) {
            durationHours = (rawEndMs - startMs2) / 3_600_000;
          } else {
            durationHours = 0.0;
          }

          const isComplete = rawEndMs !== null && durationHours > 0;
          const [outTitle, outDesc] = extractOutputJson(
            String(row['last_output'] ?? ''),
          );

          subagentEvents.push({
            event_key: ekey,
            punch_uid: punchUid,
            punch_name: punchName,
            started_at: startedAt,
            ended_at: endedAt,
            duration_hours: durationHours,
            is_complete: isComplete,
            description: subagentDescription(row),
            model: String(row['model'] ?? '').trim(),
            tokens: subagentTokens(row),
            input_prompt: String(row['input_prompt'] ?? ''),
            output_json_title: outTitle,
            output_json_description: outDesc,
            last_output: String(row['last_output'] ?? ''),
            // §2.14d D31：subagent row 若帶 edit_artifacts（其 transcript 自身的 Edit/Write）即聚合。
            artifacts: dedupeArtifacts(rowArtifacts(row)),
          });
        } else if (kind === 'main-ai' || kind === 'main-dispatch') {
          if (!afterSince(row)) continue;
          mainRows.push(row);
          // 額外按 round 分桶
          const rk = row['round'] as unknown;
          if (!mainRoundGroups.has(rk)) mainRoundGroups.set(rk, []);
          mainRoundGroups.get(rk)!.push(row);
          // 記下「有 main 活動」的 session 的最後 assistant 輸出
          const sOut = String(sessionObj['last_assistant_output'] ?? '').trim();
          if (sOut) {
            const sEp = toEpochMs(sessionObj['started_at']) ?? 0;
            if (mainLastOutput === null || sEp >= mainLastOutput[0]) {
              mainLastOutput = [sEp, sOut];
            }
          }
        } else if (kind === 'main-user') {
          // 先收全量 main-user 起始時間（不套 since_ms），供 m_start 回推用
          const epAll = toEpochMs(row['started_at']);
          if (epAll !== null) mainUserAllMs.push(epAll);
          // 收 round → 首句 input_prompt（不套 since_ms）
          const rkU = row['round'] as unknown;
          if (!roundInputMap.has(rkU)) {
            const ip = String(row['input_prompt'] ?? '').trim();
            if (ip) roundInputMap.set(rkU, ip);
          }
          // 取最早一句使用者訊息的可讀文字當 main 描述
          if (!afterSince(row)) continue;
          const text =
            String(row['detail'] ?? '').trim() || String(row['title'] ?? '').trim();
          if (text) {
            const ep = toEpochMs(row['started_at']) ?? 0;
            if (mainFirstUser === null || ep < mainFirstUser[0]) {
              mainFirstUser = [ep, text];
            }
          }
        }
      }
    }
  } catch {
    return empty;
  }

  // sort subagent events by started_at
  subagentEvents.sort((a, b) => (toEpochMs(a.started_at) ?? 0) - (toEpochMs(b.started_at) ?? 0));

  // 主對話最後 assistant 輸出解析結尾 JSON
  const [mainOutTitle, mainOutDesc] = extractOutputJson(
    mainLastOutput ? mainLastOutput[1] : '',
  );

  let main: MainSummary;
  if (mainRows.length > 0) {
    let mainDurMs: number;
    try {
      mainDurMs = unionDurationMs(mainRows);
    } catch {
      mainDurMs = 0;
    }
    const starts = mainRows.map((r) => r['started_at']).filter((s) => s != null);
    const ends = mainRows.map((r) => r['ended_at']).filter((e) => e != null);
    // T_gen = since_ms 過濾後最早的主對話生成 started_at
    const tGen = starts.length > 0
      ? starts.reduce((a, b) => ((toEpochMs(a) ?? 0) < (toEpochMs(b) ?? 0) ? a : b))
      : null;
    // m_start 回推到觸發該段生成的 user 訊息時間
    const tGenMs = tGen != null ? toEpochMs(tGen) : null;
    let mStart: unknown = tGen;
    if (tGenMs !== null) {
      const prior = mainUserAllMs.filter((ms) => ms <= tGenMs);
      if (prior.length > 0) {
        mStart = toIsoFromEpochMs(Math.max(...prior));
      }
    }
    // m_end = 最後一段 stop=='end_turn' 主對話輸出的 ended_at
    const endTurnEnds = mainRows
      .filter((r) => r['kind'] === 'main-ai' && r['ended_at'] && isEndTurn(r))
      .map((r) => r['ended_at']);
    let mEnd: string | null;
    if (endTurnEnds.length > 0) {
      mEnd = endTurnEnds.reduce((a, b) => ((toEpochMs(a) ?? 0) >= (toEpochMs(b) ?? 0) ? a : b)) as string;
    } else {
      mEnd = ends.length > 0
        ? (ends.reduce((a, b) => ((toEpochMs(a) ?? 0) >= (toEpochMs(b) ?? 0) ? a : b)) as string)
        : null;
    }
    main = {
      duration_hours: (mainDurMs ?? 0) / 3_600_000,
      started_at: mStart,
      ended_at: mEnd,
      event_count: mainRows.length,
      description: mainFirstUser ? mainFirstUser[1] : '',
      output_json_title: mainOutTitle,
      output_json_description: mainOutDesc,
    };
  } else {
    main = {
      duration_hours: 0.0,
      started_at: null,
      ended_at: null,
      event_count: 0,
      description: mainFirstUser ? mainFirstUser[1] : '',
      output_json_title: mainOutTitle,
      output_json_description: mainOutDesc,
    };
  }

  // per-round main_events（B2）：依 round 分桶各發一個獨立 main 事件
  const mainEvents: MainEvent[] = [];

  // 依 round 排序：None/undefined 先，int 依序
  const sortedRkeys = Array.from(mainRoundGroups.keys()).sort((a, b) => {
    const aNull = a === null || a === undefined;
    const bNull = b === null || b === undefined;
    if (aNull && bNull) return 0;
    if (aNull) return -1;
    if (bNull) return 1;
    const aNum = typeof a === 'number' ? a : 0;
    const bNum = typeof b === 'number' ? b : 0;
    return aNum - bNum;
  });

  for (const rkey of sortedRkeys) {
    const grp = mainRoundGroups.get(rkey)!;
    let gDurMs: number;
    try {
      gDurMs = unionDurationMs(grp);
    } catch {
      gDurMs = 0;
    }
    const gStarts = grp.map((r) => r['started_at']).filter((s) => s != null);
    const gStart = gStarts.length > 0
      ? (gStarts.reduce((a, b) => ((toEpochMs(a) ?? 0) < (toEpochMs(b) ?? 0) ? a : b)) as string)
      : null;

    // 該輪所有 end_turn main-ai row（依時間序）
    const endTurnRows = grp
      .filter((r) => r['kind'] === 'main-ai' && r['ended_at'] && isEndTurn(r))
      .slice()
      .sort((a, b) => (toEpochMs(a['ended_at']) ?? 0) - (toEpochMs(b['ended_at']) ?? 0));

    const gEnd = endTurnRows.length > 0
      ? (endTurnRows[endTurnRows.length - 1]['ended_at'] as string)
      : null;
    const gHours = (gDurMs ?? 0) / 3_600_000;
    const gComplete = gEnd !== null && gHours > 0;

    // 最後 end_turn main-ai row 的 last_output
    const gLastOutput =
      (endTurnRows.length > 0
        ? (endTurnRows[endTurnRows.length - 1]['last_output'] as string | undefined)
        : undefined) ?? '';

    const [gTitle, gDesc] = extractOutputJson(gLastOutput);

    // §2.14d D31：聚合本輪所有 main row 的 edit_artifacts（parse 僅掛該 round 首列，但仍掃全桶
    //   並去重，容忍 collapse / 來源變動）。對應 punch = roundPunchUid 該輪 main 帳本列。
    const gArtifacts = dedupeArtifacts(grp.flatMap((r) => rowArtifacts(r)));

    mainEvents.push({
      punch_uid: roundPunchUid(rkey, grp, lastSessionId),
      punch_name: MAIN_PUNCH_NAME,
      round: rkey,
      started_at: gStart,
      ended_at: gEnd,
      duration_hours: gHours,
      is_complete: gComplete,
      description: '',
      input_prompt: roundInputMap.get(rkey) ?? '',
      output_json_title: gTitle ?? '',
      output_json_description: gDesc ?? '',
      last_output: gLastOutput,
      artifacts: gArtifacts,
    });
  }

  return { subagent_events: subagentEvents, main, main_events: mainEvents };
}
