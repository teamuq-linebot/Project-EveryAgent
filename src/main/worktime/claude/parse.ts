/**
 * Claude session 記錄解析：build_work_timeline（含完成訊號標記）。
 * 忠實移植自 Python teamuq/worktime/sources/claude/parse.py。
 * 只移植 build_work_timeline 真正用到的函式，行為一字不改。
 *
 * 本檔為純 barrel/facade：實作已拆分至 ./parse/ 子目錄各 sibling 模組，
 * 此處僅 re-export 以維持原 import path（'./parse'）與全部對外 public 介面不變，
 * consumer（index.ts / discover.ts / tests/parse.spec.ts）零改動。
 *   - ./parse/shared            常數 / leaf helper / subagent 身分識別
 *   - ./parse/tokenCost         token usage / 成本計算
 *   - ./parse/artifactExtractor edit/write artifact 萃取
 *   - ./parse/workTimelineBuilder buildWorkTimeline 組裝（主目標）
 */

// 常數 / leaf helper / subagent 身分識別
export { ASK_WAIT_SPLIT_MS, getTimestamp, findToolResultTimestamp, assistantTextOf, userTextOf, extractSubagentIdentity } from './parse/shared';
export type { SubagentIdentity } from './parse/shared';

// token usage / 成本計算
export { usageToTokenStats } from './parse/tokenCost';

// edit/write artifact 萃取
export { findToolUseResult, extractEditArtifacts, collectEditArtifactsForRecord } from './parse/artifactExtractor';
export type { WorkArtifact } from './parse/artifactExtractor';

// buildWorkTimeline 組裝（主目標）
export { buildWorkTimeline } from './parse/workTimelineBuilder';

// Re-export helpers used by tests
export { addTokenUsage, emptyTokenUsage } from '../tokens';
