/**
 * parse/artifactExtractor.ts — edit/write artifact 萃取組。
 *
 * 行為保留（move-only）：自原 parse.ts 原樣搬出，控制流/容錯/簽名一字未改。
 * getTimestamp 改 import 自 ./shared（原本 parse.ts 內同檔可見，為同一函式參考，行為不變）。
 */

import { getTimestamp } from './shared';
import type { JsonlItem } from '../../types';

// ---------------------------------------------------------------------------
// punch_artifacts 萃取（§2.14d D31 — 逐筆精確 Edit/Write 行數，零估算）
//
// 資料源（2026-06-04 真實 transcript 實證）：
//   tool_result 的配對 user record **頂層欄位** `toolUseResult`（非 message.content）帶：
//     - structuredPatch: Array<{ oldStart, oldLines, newStart, newLines, lines: string[] }>
//       lines 是 unified diff 行，前綴 ' '(context) / '+'(新增) / '-'(刪除)；
//       每 hunk 一列 punch_artifact，old_start = hunk.oldStart（1-indexed 精確起始行號），
//       lines_added = lines 中 '+' 行數、lines_removed = '-' 行數（皆精確）。
//     - Write（type==='create'|'update'）：structuredPatch 通常空 → 記 content_lines
//       （content 總行數，create=精確新增）+ op_type；刪除數留 NULL（originalFile 不可靠）。
//   現有 parse.ts/punchCore.ts 完全未讀 toolUseResult — 本批擴充讀取（仿 findToolResultTimestamp
//   配對手法找對應 user record）。純本地不上傳；§2.14d schema = punch_artifacts。
// ---------------------------------------------------------------------------

/** 從 work_timeline row 抽出的單一 Edit/Write 操作（hunk 級）。對應 punch_artifacts 一列（去 punch 關聯鍵）。 */
export interface WorkArtifact {
  /** toolu_…，回指 JSONL 證據（證據鏈）。 */
  tool_use_id: string;
  /** 一次 Edit 可有多個 hunk（0-indexed）。 */
  hunk_index: number;
  file_path: string;
  /** 'Edit' | 'Write'。 */
  tool: 'Edit' | 'Write';
  /** Write 才有：'create' | 'update'。 */
  op_type: string | null;
  /** Edit hunk 精確起始行號（1-indexed）；Write 無 → null。 */
  old_start: number | null;
  /** 精確：hunk lines 中 '+' 行數。 */
  lines_added: number;
  /** 精確：hunk lines 中 '-' 行數。 */
  lines_removed: number;
  /** Write 用：content 總行數（create=精確新增）；Edit 無 → null。 */
  content_lines: number | null;
  /** toolUseResult record 時間戳。 */
  ts: string | null;
}

/**
 * 找 tool_use_id 對應 tool_result 之 user record 的**頂層 `toolUseResult`** 欄位。
 * 配對手法同 findToolResultTimestamp（掃 message.content 內 type=tool_result 配 tool_use_id），
 * 命中後回 [toolUseResult, timestamp]；無則 [null, null]。
 */
export function findToolUseResult(
  records: JsonlItem[],
  toolUseId: string | null | undefined,
  afterIndex: number,
): [Record<string, unknown> | null, string | null] {
  if (!toolUseId) return [null, null];
  for (const item of records) {
    if ((item.index ?? -1) <= afterIndex) continue;
    const record = item.record;
    const msg = record['message'];
    const content = msg && typeof msg === 'object' ? (msg as Record<string, unknown>)['content'] : null;
    if (!Array.isArray(content)) continue;
    const matched = content.some(
      (block) =>
        typeof block === 'object' &&
        block !== null &&
        (block as Record<string, unknown>)['type'] === 'tool_result' &&
        (block as Record<string, unknown>)['tool_use_id'] === toolUseId,
    );
    if (matched) {
      const tur = record['toolUseResult'];
      const obj =
        tur !== null && typeof tur === 'object' && !Array.isArray(tur)
          ? (tur as Record<string, unknown>)
          : null;
      return [obj, getTimestamp(record)];
    }
  }
  return [null, null];
}

/** 數 unified diff lines 陣列裡的 '+' / '-' 行數（context 行 ' ' 不計）。容錯：非陣列回 [0,0]。 */
function countHunkLines(lines: unknown): [number, number] {
  if (!Array.isArray(lines)) return [0, 0];
  let added = 0;
  let removed = 0;
  for (const ln of lines) {
    if (typeof ln !== 'string' || ln.length === 0) continue;
    const c = ln[0];
    if (c === '+') added += 1;
    else if (c === '-') removed += 1;
  }
  return [added, removed];
}

/**
 * 把一個 Edit/Write tool_use + 其配對 toolUseResult 萃取成 WorkArtifact[]（每 hunk 一列）。
 *   - Edit：每個 structuredPatch hunk 一列（old_start=oldStart 精確、+/- 行數精確）。
 *   - Write：structuredPatch 通常空 → 單列記 op_type + content_lines（create=精確新增），
 *     old_start/lines_removed 留 null/0。若 Write 罕見帶 hunk（update overwrite）亦逐 hunk 展開。
 * 全程容錯：缺資料回 []。
 */
export function extractEditArtifacts(
  toolName: string,
  toolUseId: string,
  toolUseResult: Record<string, unknown> | null,
  ts: string | null,
): WorkArtifact[] {
  if (!toolUseId) return [];
  const tool: 'Edit' | 'Write' = toolName === 'Write' ? 'Write' : 'Edit';
  if (toolName !== 'Edit' && toolName !== 'Write') return [];

  const out: WorkArtifact[] = [];
  const patch = toolUseResult ? toolUseResult['structuredPatch'] : null;
  const opTypeRaw = toolUseResult ? toolUseResult['type'] : null;
  const opType =
    typeof opTypeRaw === 'string' && (opTypeRaw === 'create' || opTypeRaw === 'update')
      ? opTypeRaw
      : null;

  if (Array.isArray(patch) && patch.length > 0) {
    // Edit（或罕見帶 hunk 的 Write update）：逐 hunk 精確。
    for (let i = 0; i < patch.length; i++) {
      const h = patch[i];
      if (typeof h !== 'object' || h === null) continue;
      const hunk = h as Record<string, unknown>;
      const [added, removed] = countHunkLines(hunk['lines']);
      const oldStartRaw = hunk['oldStart'];
      const oldStart =
        typeof oldStartRaw === 'number' && Number.isFinite(oldStartRaw)
          ? Math.trunc(oldStartRaw)
          : null;
      out.push({
        tool_use_id: toolUseId,
        hunk_index: i,
        file_path: String((toolUseResult && toolUseResult['filePath']) ?? ''),
        tool,
        op_type: tool === 'Write' ? opType : null,
        old_start: oldStart,
        lines_added: added,
        lines_removed: removed,
        content_lines: null,
        ts,
      });
    }
    return out;
  }

  // Write 覆寫（structuredPatch 空）：記 content_lines（create=精確新增），刪除數留 null。
  if (tool === 'Write') {
    const contentRaw = toolUseResult ? toolUseResult['content'] : null;
    const contentLines =
      typeof contentRaw === 'string' && contentRaw.length > 0
        ? contentRaw.split('\n').length
        : null;
    out.push({
      tool_use_id: toolUseId,
      hunk_index: 0,
      file_path: String((toolUseResult && toolUseResult['filePath']) ?? ''),
      tool: 'Write',
      op_type: opType,
      old_start: null,
      lines_added: contentLines ?? 0,
      lines_removed: 0,
      content_lines: contentLines,
      ts,
    });
  }
  return out;
}

/**
 * 掃一筆 assistant record 的 content，對所有 Edit/Write tool_use 抽 artifacts。
 * 仿 build_work_timeline 既有的 tool_use 分類手法（type==='tool_use' + name 判定）。
 * 配對用 findToolUseResult 找對應 user record 的頂層 toolUseResult。
 */
export function collectEditArtifactsForRecord(
  records: JsonlItem[],
  content: unknown[],
  afterIndex: number,
): WorkArtifact[] {
  const out: WorkArtifact[] = [];
  for (const b of content) {
    if (typeof b !== 'object' || b === null) continue;
    const block = b as Record<string, unknown>;
    if (block['type'] !== 'tool_use') continue;
    const name = block['name'];
    if (name !== 'Edit' && name !== 'Write') continue;
    const toolUseId = typeof block['id'] === 'string' ? block['id'] : '';
    if (!toolUseId) continue;
    const [tur, ts] = findToolUseResult(records, toolUseId, afterIndex);
    for (const a of extractEditArtifacts(name as string, toolUseId, tur, ts)) {
      out.push(a);
    }
  }
  return out;
}
