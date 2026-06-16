/**
 * askQuestionHelpers.ts — AgentTeams 對話面板「結構化選擇題卡片」偵測純函式 leaf
 *
 * 從對話訊息掃出「目前待回答」的 AskUserQuestion 工具呼叫，組成 UI 友善的
 * ActiveAskQuestion 形狀供卡片渲染。無 UI、無 IPC、無副作用、可單測、不需本機。
 *
 * 對齊 conversation/claude/helpers.tsx 的 isAskQuestion（:173）/ parseAskAnswers（:206）/
 * collectAskIds（:218）判定規則：AskUserQuestion tool_use block 須有 id，且其 input 的
 * JSON.parse 結果含非空 questions[]。本檔只取「最後一個未被回答」的問題，且只渲染 questions[0]。
 *
 * agentteams-ask-card（批 1）。
 */
import type { ConversationMessage } from "../../../shared/ipcContracts";
import { ASK_TOOL_NAME } from "../conversation/claude/helpers";

/** 待回答的 AskUserQuestion 結構化問題（已剝離平台細節，供卡片渲染）。 */
export interface ActiveAskQuestion {
  /** 對應 AskUserQuestion tool_use block 的 id（答案配對 / 已答判定用）。 */
  toolUseId: string;
  /** 題目文字（questions[0].question）。 */
  question: string;
  /** 題目標頭（questions[0].header；缺省則 undefined）。 */
  header?: string;
  /** 是否可複選（questions[0].multiSelect；預設 false）。 */
  multiSelect: boolean;
  /** 結構化選項（原序，不含 claude 自動附加的「其他」）。 */
  options: Array<{ label: string; description?: string }>;
}

/**
 * 從對話訊息找出「目前待回答」的 AskUserQuestion，組成 ActiveAskQuestion。
 *
 * 演算法：
 *   1. 掃所有 message 的 block，收集 kind==='tool_use' && name===ASK_TOOL_NAME && id 者。
 *   2. 由後往前找第一個「id 未在 answeredIds 內 && input JSON.parse 出非空 questions[]」者。
 *   3. 只取 questions[0]，組出 ActiveAskQuestion。
 *
 * 任何解析失敗 / 欄位缺失 / 多題（仍只取第一題）以容錯方式降級：
 *   - 整體掃不到可用問題 → 回 null（呼叫端退回現行 collapsible 卡）。
 *
 * @param messages   對話訊息列表
 * @param answeredIds 已回答的 tool_use_id 集合（重用既有 askAnswersMap 的 key 集合）
 */
export function extractActiveAskQuestion(
  messages: ConversationMessage[],
  answeredIds: Set<string>,
): ActiveAskQuestion | null {
  // 攤平所有 AskUserQuestion tool_use block（保留原始順序，供由後往前掃）。
  const askBlocks: Array<{ id: string; text: string }> = [];
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.kind === "tool_use" && block.name === ASK_TOOL_NAME && block.id) {
        askBlocks.push({ id: block.id, text: block.text });
      }
    }
  }

  // 由後往前：最近的、且尚未回答、且能解析出非空 questions[] 的問題優先。
  for (let i = askBlocks.length - 1; i >= 0; i -= 1) {
    const { id, text } = askBlocks[i];
    if (answeredIds.has(id)) continue;

    const questions = parseQuestions(text);
    if (!questions || questions.length === 0) continue; // 解析失敗 / 空 → 跳過

    const first = questions[0];
    if (!first || typeof first !== "object") continue;
    const record = first as Record<string, unknown>;

    return {
      toolUseId: id,
      question: typeof record.question === "string" ? record.question : "",
      header: typeof record.header === "string" ? record.header : undefined,
      multiSelect: record.multiSelect === true,
      options: normalizeOptions(record.options),
    };
  }

  return null;
}

/** 解析 tool_use input 的 JSON 字串取 questions 陣列；非陣列 / 解析失敗回 null（對齊 isAskQuestion）。 */
function parseQuestions(text: string): unknown[] | null {
  try {
    const parsed = JSON.parse(text) as { questions?: unknown };
    return Array.isArray(parsed.questions) ? parsed.questions : null;
  } catch {
    return null;
  }
}

/** 將 questions[0].options 正規化為 { label, description } 陣列；缺值 / 非陣列回空陣列（容錯）。 */
function normalizeOptions(raw: unknown): Array<{ label: string; description?: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ label: string; description?: string }> = [];
  for (const opt of raw) {
    if (typeof opt === "string") {
      out.push({ label: opt });
      continue;
    }
    if (opt && typeof opt === "object") {
      const record = opt as Record<string, unknown>;
      const label =
        typeof record.label === "string"
          ? record.label
          : typeof record.optionLabel === "string"
            ? record.optionLabel
            : "";
      if (label === "") continue; // 無 label 的選項無法渲染 → 略過
      out.push(
        typeof record.description === "string"
          ? { label, description: record.description }
          : { label },
      );
    }
  }
  return out;
}
