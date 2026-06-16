/**
 * askKeySeq.ts — AgentTeams 結構化選擇題卡片「送往 PTY 的鍵序組裝器」純函式 leaf
 *
 * 本檔集中所有 PTY 鍵序（方向鍵 / 空白 / Enter）與延遲常數，需靠本機真 claude
 * 互動逐步 tune；改延遲只動 ASK_TIMING、改鍵碼只動 ASK_KEYS，呼叫端不必改。
 *
 * 已知 claude 原生 bug（影響鍵序設計，調法見各函式註解）：
 *   - #12030：多選題（multiSelect）按 Enter 有時被當成 Tab（焦點移動而非確認）→
 *     buildMultiSelectSeq 在全部 toggle 完後才送單一 Enter，並把 beforeEnterMs 留足停頓，
 *     若實測仍誤判為 Tab，於此檔調大 beforeEnterMs 或在 Enter 前補一個 SPACE 重新聚焦。
 *   - #22300：選「其他」後輸入框內，開頭若是數字鍵會被選單攔截（誤判為選項序號）→
 *     buildOtherSeq 在進入輸入模式（otherEnterModeMs）後才送文字，並把 afterTextMs 留足，
 *     若文字以數字開頭仍被吃，於此檔在 text 前補一個無害字元或加大 otherEnterModeMs。
 *
 * 無 UI、無 IPC、無副作用、可單測、不需本機。agentteams-ask-card（批 1）。
 */

/** 送往 PTY 的原始鍵碼（ANSI escape / 控制字元）。集中於此，方便改鍵。 */
export const ASK_KEYS = {
  /** 方向鍵下（游標往後一個選項）。 */
  DOWN: "\x1b[B",
  /** 方向鍵上（游標往前一個選項）。 */
  UP: "\x1b[A",
  /** 空白鍵（多選 toggle 勾選）。 */
  SPACE: " ",
  /** Enter（確認 / 送出）。 */
  ENTER: "\r",
} as const;

/** 各鍵之間的延遲（毫秒）。需靠本機真 claude tune；TUI 重繪太快會吃鍵。 */
export const ASK_TIMING = {
  /** 連續方向鍵導航之間的間隔。 */
  betweenNavMs: 80,
  /** 移到目標後、按 SPACE toggle 前的停頓。 */
  beforeSpaceMs: 80,
  /** 送出 ENTER 前的停頓（讓選單狀態穩定，緩解 #12030）。 */
  beforeEnterMs: 150,
  /** 選「其他」後，等待選單切到自由輸入模式的停頓（緩解 #22300）。 */
  otherEnterModeMs: 250,
  /** 送出自由文字後、按最終 ENTER 前的停頓。 */
  afterTextMs: 150,
} as const;

/**
 * 備用：bracketed paste 包裹（避免貼上的文字被當成逐鍵輸入）。
 * 本批先放常數，buildOtherSeq 暫不使用；若實測「其他」輸入被選單攔，
 * 可改用 START + text + END 包裹自由文字。
 */
export const BRACKETED_PASTE_START = "\x1b[200~";
export const BRACKETED_PASTE_END = "\x1b[201~";

/** 一個鍵步：送出 data 後等待 delayMsAfter 毫秒再送下一步。 */
export interface KeyStep {
  /** 要寫入 PTY 的字串（鍵碼或文字）。 */
  data: string;
  /** 送出後的延遲（毫秒）；最後一步通常為 0。 */
  delayMsAfter: number;
}

/**
 * 單選題鍵序：直接按數字鍵選定，停頓後送 Enter 確認。
 * @param digit 1-based 選項數字鍵（字串，如 "1"）。
 */
export function buildSingleSelectSeq(digit: string): KeyStep[] {
  return [
    { data: digit, delayMsAfter: ASK_TIMING.beforeEnterMs },
    { data: ASK_KEYS.ENTER, delayMsAfter: 0 },
  ];
}

/**
 * 多選題鍵序：游標自選單頂端（index 0）出發，依序移到每個目標 index 按 SPACE toggle，
 * 全部勾選完後送單一 Enter 確認。
 *
 * 因 #12030（多選 Enter 可能被當 Tab），全程只送一次 Enter 並保留 beforeEnterMs 停頓。
 *
 * @param targetIndices 要勾選的 0-based 選項 index（會排序、去重容錯）。
 * @param totalOptions  選項總數（保留參數，供未來邊界 clamp；目前僅信任 targetIndices）。
 */
export function buildMultiSelectSeq(targetIndices: number[], totalOptions: number): KeyStep[] {
  void totalOptions; // 保留參數：未來可用於 clamp / 環狀導航；目前不需要
  const steps: KeyStep[] = [];
  // 去重 + 升冪排序，確保游標只往下單向移動（避免來回）。
  const targets = Array.from(new Set(targetIndices)).sort((a, b) => a - b);
  let cursor = 0;
  for (const target of targets) {
    // 從目前游標位置往下移動到 target（每按一次 ↓ 留 betweenNavMs）。
    for (let step = cursor; step < target; step += 1) {
      steps.push({ data: ASK_KEYS.DOWN, delayMsAfter: ASK_TIMING.betweenNavMs });
    }
    cursor = target;
    // 移到位後停頓，再 toggle 勾選。
    steps.push({ data: ASK_KEYS.SPACE, delayMsAfter: ASK_TIMING.beforeSpaceMs });
  }
  // 全部 toggle 完後，留足停頓再送單一 Enter（緩解 #12030）。
  steps.push({ data: ASK_KEYS.ENTER, delayMsAfter: ASK_TIMING.beforeEnterMs });
  return steps;
}

/**
 * 「其他」自由輸入鍵序：按「其他」選項數字鍵 → 進輸入模式 → 打字 → 送出。
 *
 * 因 #22300（輸入框開頭數字鍵被選單攔），進入輸入模式後保留 otherEnterModeMs
 * 停頓，再送文字；afterTextMs 後送最終 Enter。
 *
 * @param otherDigit 「其他」選項的 1-based 數字鍵（字串）。
 * @param text       使用者自由輸入的文字。
 */
export function buildOtherSeq(otherDigit: string, text: string): KeyStep[] {
  return [
    { data: otherDigit, delayMsAfter: ASK_TIMING.beforeEnterMs },
    { data: ASK_KEYS.ENTER, delayMsAfter: ASK_TIMING.otherEnterModeMs },
    { data: text, delayMsAfter: ASK_TIMING.afterTextMs },
    { data: ASK_KEYS.ENTER, delayMsAfter: 0 },
  ];
}

/**
 * 解析某個結構化選項應對應到的「數字鍵」字串。
 *
 * 優先使用 promptOptions[arrayIndex]（claude 偵測到的 TUI 選項，含 value=實際數字鍵）：
 *   若該項 label 去空白後與 optionLabel 近似（相等或互相 includes），回其 value；
 * 否則退回 String(arrayIndex + 1)（1-based 推算）。
 *
 * @param arrayIndex    結構化選項在原序陣列中的 0-based index。
 * @param promptOptions PtyPromptWatcher / promptDetector 解析出的 TUI 選項（value=送出的鍵）。
 * @param optionLabel   結構化選項的 label（用於跟 promptOptions 對位驗證）。
 */
export function resolveDigit(
  arrayIndex: number,
  promptOptions: Array<{ value: string; label: string }>,
  optionLabel: string,
): string {
  const fallback = String(arrayIndex + 1);
  const candidate = promptOptions[arrayIndex];
  if (!candidate) return fallback; // promptOptions 短於 arrayIndex → 推算
  const a = candidate.label.replace(/\s+/g, "");
  const b = optionLabel.replace(/\s+/g, "");
  if (a !== "" && b !== "" && (a === b || a.includes(b) || b.includes(a))) {
    return candidate.value;
  }
  return fallback;
}
