/**
 * punchExecutor.ts — 打卡實際執行層。
 *
 * 忠實移植自 Python:
 *   teamuq/ui_qt/monitor_workers.py  _PunchWorker._do_start / _do_end / _do_oneshot
 *   monitor_workers._call_with_retry（只包 update_subtask；create 不 retry）
 *   monitor_workers._resolve_punch_description（description_is_fallback → summarize_description）
 *
 * 設計原則：
 *   - PunchExecutor 收 IAppSyncClient + IPunchLedger 注入（零 Qt / 零全域狀態）。
 *   - executeAction(action) → ExecuteResult，不 throw（全程 try/catch）。
 *   - _callWithRetry：暫時性錯誤(isRetryable) 退避 1/2/4s 重試，最多 3 次；
 *     **只包 update_subtask**；create（start/oneshot）不 retry（冪等風險）。
 *   - auth 類(isAuthError) → authDefer=true，不 retry。
 *   - _resolvePunchDescription：action.description_is_fallback + llm_source_text → summarizeDescription；
 *     失敗退回原 description。
 *   - punch-in title（名稱＝使用者問題）：summarizeTitle(input_prompt) → 整理過的 input_prompt
 *     → subtask_name → punch_name → 'agent_manager'（LLM 不可用時也以使用者問題為名）。
 *
 * sleep 可注入（sleepFn 參數）→ 測試 mock 不真等。
 */

import { isAuthError, isRetryable } from './errors';

import type { PunchAction } from '../services/punchService';
import { textToLexical } from '../services/lexical';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecuteResult {
  punch_uid: string;
  punch_name: string;
  phase: string;
  ok: boolean;
  authDefer?: boolean;
  subtask_id?: string | null;
  fallback_oneshot?: boolean;
  hours?: number;
  error?: string;
  /** 補償配對透傳：被吸收的新 uid（來自 action.absorbed_uid），executor 不解讀語意。 */
  absorbed_uid?: string | null;
}

/** sleep 注入型別（測試用 mock，生產用 real sleep）。 */
export type SleepFn = (ms: number) => Promise<void>;

// ---------------------------------------------------------------------------
// ILocalSubtaskStore — 打卡本地化注入介面（plan §2.9 + §2.14 D / §6 批次 6b·6d）
// ---------------------------------------------------------------------------
//
// 打卡 local-first：三段（start/end/oneshot）改寫**本地** subtask + 帳本，每段各自
// 包進 repo 層**單一 `db.transaction()`**（§2.9 rev10 簡化收益）。本介面是 punchExecutor
// 對 repo（`SqliteTaskRepository.createLocalSubtask/settleLocalSubtask/recordLocalOneshot`，
// §6 批次 6d 實作）的依賴契約；MonitorController（§6 批次 6c）負責注入。
//
// 關鍵：`createLocalSubtask` 把「建 'loc:…' subtask（origin='local'、pending_op='create'）
//   + ledger.punchIn」收進**同一 txn**，消除 rev5 前的 punchIn→setSubtaskId 中間態
//   （§2.14 情境 D：subtask_id=null 的 open 列被 preload 丟棄 → 重複 punch-in）。
//
// 注入為**可選**：未注入（local 缺）時 punchExecutor 退回既有 appsync + ledger 雙寫
//   路徑（向後相容，既有 wiring/spec 不變）；注入後走本地原子路徑。

/** createLocalSubtask 的輸入（start phase：建 'loc:' subtask + punchIn 同 txn）。 */
export interface LocalCreateSubtaskInput {
  punch_uid: string;
  session_id: string;
  task_local_id: unknown;
  /** ledger 帳本 type（punch_name）。 */
  type: string;
  name: string;
  assignee_id?: unknown;
  category_name?: string;
  input_prompt?: string;
  start_time: unknown;
  /** 來源 CLI（'claude' | 'codex'）：標記該 punch 由哪個 CLI 監測產生。 */
  cli?: string | null;
}

/** settleLocalSubtask 的輸入（end phase：補 end/duration/desc + punchOut 同 txn）。 */
export interface LocalSettleSubtaskInput {
  punch_uid: string;
  /** 'loc:…' 暫鍵或正式 local_id（指向 start 階段建的本地列）。 */
  local_id: string;
  /**
   * punches.task_id 欄的值（= action.task_id，可為 remote_id 或 local UUID）。
   * punchOut UPDATE 加 task_id 限定，防止同 punch_uid 跨 task 污染（F-PP-3）。
   */
  task_id: string | null;
  end_time: unknown;
  duration: number;
  /** Lexical JSON description。 */
  description: string;
}

/** recordLocalOneshot 的輸入（oneshot phase：一次寫齊 subtask + recordOneshot 同 txn）。 */
export interface LocalOneshotInput {
  punch_uid: string;
  session_id: string;
  task_local_id: unknown;
  type: string;
  name: string;
  assignee_id?: unknown;
  category_name?: string;
  input_prompt?: string;
  start_time: unknown;
  end_time: unknown;
  duration: number;
  /** Lexical JSON description。 */
  description: string;
  /** 來源 CLI（'claude' | 'codex'）：標記該 punch 由哪個 CLI 監測產生。 */
  cli?: string | null;
}

/**
 * 打卡本地化寫入目標（repo 提供，§6 批次 6d 實作）。
 * 三方法各自為 repo 層**單一 transaction**：subtask 列 + 帳本列原子一致。
 * 回傳本地 subtask 鍵（'loc:…'）；本地永遠有 id，故無 appsync id=null 的 fallback_oneshot。
 */
export interface ILocalSubtaskStore {
  /** start：建 'loc:' subtask（origin='local'、pending_op='create'）+ ledger.punchIn（同 txn）。 */
  createLocalSubtask(input: LocalCreateSubtaskInput): { localId: string };

  /** end：補 end/duration/description（is_settled=1）+ ledger.punchOut（同 txn）。 */
  settleLocalSubtask(input: LocalSettleSubtaskInput): void;

  /** oneshot：一次寫齊 'loc:' subtask（start+end+duration+desc）+ recordOneshot（同 txn）。 */
  recordLocalOneshot(input: LocalOneshotInput): { localId: string };
}

// ---------------------------------------------------------------------------
// IPunchArtifactStore — punch_artifacts 落表注入介面（plan §2.14d D31）
// ---------------------------------------------------------------------------
//
// 打卡成功（end / oneshot）後，把該 punch 涵蓋的 Edit/Write 操作（hunk 級精確行數，
// 取自 JSONL structuredPatch）落 punch_artifacts。純本地不上傳；INSERT OR IGNORE 冪等
// （PK = (punch_session_id, punch_uid, tool_use_id, hunk_index)）→ 重啟重放不重複。
//
// 注入為**可選**：未注入時略過落表（打卡本身不受影響）。SqliteTaskRepository 同時實作
// ILocalSubtaskStore 與本介面，故 MonitorController 注入同一 repo 即可。

/** 一筆 Edit/Write 操作（hunk 級）；欄名對齊 punchCore.PunchArtifact / repo.PunchArtifactInputItem。 */
export interface PunchArtifactItem {
  tool_use_id: string;
  hunk_index: number;
  file_path: string;
  tool: string;
  op_type?: string | null;
  old_start?: number | null;
  lines_added: number;
  lines_removed: number;
  content_lines?: number | null;
  ts?: string | null;
}

export interface IPunchArtifactStore {
  /**
   * 落一批 hunk 級 artifacts（關聯 punch_session_id + punch_uid）。回新插入列數。
   * 對應 SqliteTaskRepository.insertPunchArtifacts（§2.14d D31）。
   */
  insertPunchArtifacts(input: {
    punch_session_id: string;
    punch_uid: string;
    artifacts: PunchArtifactItem[];
  }): number;
}

// ---------------------------------------------------------------------------
// 內部 helpers（對應 Python 模組級函式）
// ---------------------------------------------------------------------------

/** 生產預設 sleep（使用真實 setTimeout）。 */
function _defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 呼叫 fn()；若拋出且 isRetryable 且未達上限 → 指數退避後重試；否則 rethrow。
 *
 * retries=3：最多嘗試 3 次（初次 + 2 次重試）。退避序列：
 *   attempt 0（第 1 次失敗後）→ sleep(baseDelayMs * 1)
 *   attempt 1（第 2 次失敗後）→ sleep(baseDelayMs * 2)
 * 第 3 次失敗 → 直接 rethrow，不再 sleep。
 *
 * sleep=undefined → 用真實 setTimeout（_defaultSleep）。
 * 只用於冪等安全的呼叫（update_subtask）。
 * 對應 Python _call_with_retry。
 */
export async function callWithRetry<T>(
  fn: () => Promise<T>,
  opts: {
    retries?: number;
    baseDelayMs?: number;
    sleep?: SleepFn;
  } = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  const sleep = opts.sleep ?? _defaultSleep;
  let attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (e: unknown) {
      if (isRetryable(e) && attempt < retries - 1) {
        await sleep(baseDelayMs * Math.pow(2, attempt));
        attempt++;
        continue;
      }
      throw e;
    }
  }
}

/**
 * 決定 punch-out 要送後端的 description。
 *
 * 純本地路徑：直接回 action.description（無 LLM 呼叫）。
 * 對應 Python _resolve_punch_description（純本地後 summarizeDescription 分支已移除）。
 */
export async function resolvePunchDescription(action: PunchAction): Promise<string> {
  return action.description ?? '';
}

// ---------------------------------------------------------------------------
// PunchExecutor
// ---------------------------------------------------------------------------

export interface PunchExecutorOptions {
  /** 打卡本地化寫入目標（唯一路徑）。 */
  local: ILocalSubtaskStore;
  /**
   * punch_artifacts 落表目標（plan §2.14d D31）。注入 → end / oneshot 成功後把該 punch
   * 涵蓋的 Edit/Write 操作落表（純本地不上傳）；未注入 → 略過（打卡本身不受影響）。
   */
  artifactStore?: IPunchArtifactStore | null;
  sessionId?: string;
  /** 來源 CLI（'claude' | 'codex'）：蓋章到本 executor 寫入的每筆 punch（cli 欄）。 */
  cli?: string;
  /** 注入 sleep（測試用；不傳則用真實 setTimeout）。 */
  sleep?: SleepFn;
}

/**
 * 把「使用者一開始輸入的問題」整理成一句精簡打卡標題（非 LLM；LLM 不可用時的後援）。
 *
 * 整理：去 code fence / inline code、換行 tab → 空白、去行首引用清單符號、收斂連續空白、
 *   去包夾引號書名號、超長硬截斷加省略號（CJK 無詞界）。空 → null（讓呼叫端續走 fallback 鏈）。
 *
 * 用途：打卡名稱原本 LLM summarizeTitle 回 null 時會退回 punch_name（= 'agent_manager' 等
 *   agent 名），改為優先退回「整理過的使用者問題」，符合 plan「名稱＝使用者問題」需求。
 */
export function tidyQuestionTitle(input: string | null | undefined, maxLen = 40): string | null {
  if (!input) return null;
  let s = input
    .replace(/```[\s\S]*?```/g, ' ') // fenced code block
    .replace(/`+/g, ' ') // inline code 標記
    .replace(/[\r\n\t]+/g, ' ') // 換行 / tab → 空白
    .replace(/^[\s>*\-•·]+/u, '') // 行首引用 / 清單符號
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/^["'「『《(\[]+/u, '') // 包夾開引號 / 書名號
    .replace(/["'」』》)\]]+$/u, '')
    .trim();
  if (s === '') return null;
  if (s.length > maxLen) s = s.slice(0, maxLen).trim() + '…';
  return s;
}

/**
 * 打卡實際執行層。
 *
 * executeAction(action) → ExecuteResult；不 throw（全程 try/catch）。
 * 對應 Python _PunchWorker._process_actions 的單筆分支邏輯。
 */
export class PunchExecutor {
  private readonly _local: ILocalSubtaskStore;
  private readonly _artifactStore: IPunchArtifactStore | null;
  private readonly _sessionId: string;
  /** 來源 CLI（'claude' | 'codex'）；蓋章到本 executor 寫入的每筆 punch。null=未指定。 */
  private readonly _cli: string | null;
  private readonly _sleep: SleepFn;

  constructor(opts: PunchExecutorOptions) {
    this._local = opts.local;
    this._artifactStore = opts.artifactStore ?? null;
    this._sessionId = opts.sessionId ?? '';
    this._cli = (opts.cli ?? '').trim().toLowerCase() || null;
    this._sleep = opts.sleep ?? _defaultSleep;
  }

  /**
   * 落 punch_artifacts（plan §2.14d D31）。打卡成功（end / oneshot）後呼叫。
   * 容錯：無 store / 無 artifacts → no-op；落表失敗只記，絕不可擋打卡（artifacts 為附加證據鏈）。
   */
  private _persistArtifacts(action: PunchAction): void {
    const store = this._artifactStore;
    if (!store) return;
    const arts = Array.isArray(action.artifacts) ? action.artifacts : [];
    if (arts.length === 0) return;
    const punchUid = String(action.punch_uid || action.punch_key || '');
    if (!punchUid) return;
    const sessionId = String(action.session_id ?? this._sessionId);
    try {
      store.insertPunchArtifacts({
        punch_session_id: sessionId,
        punch_uid: punchUid,
        artifacts: arts,
      });
    } catch {
      // 落 artifacts 失敗不影響打卡結果（純本地附加證據）。
    }
  }

  /**
   * 執行單一打卡 action。
   * 依 action.phase 分支：start / end / oneshot。
   * 任何錯誤全程 catch → ok=false，auth error → authDefer=true。
   */
  async executeAction(action: PunchAction): Promise<ExecuteResult> {
    const base: ExecuteResult = {
      punch_uid: action.punch_uid || action.punch_key,
      punch_name: action.punch_name,
      phase: action.phase,
      ok: false,
    };

    try {
      switch (action.phase) {
        case 'start':
          return { ...base, ...await this._doStart(action) };
        case 'end':
          return { ...base, ...await this._doEnd(action) };
        default: // 'oneshot'（含舊 dict / 未帶 phase 的相容路徑）
          return { ...base, ...await this._doOneshot(action) };
      }
    } catch (e: unknown) {
      this._ledgerEvent('error', `punch ${action.phase} 失敗`, String((e as Error)?.message ?? e), action);
      const result: ExecuteResult = {
        ...base,
        ok: false,
        error: String((e as Error)?.message ?? e),
      };
      if (isAuthError(e)) {
        result.authDefer = true;
      }
      return result;
    }
  }

  // ---- phase 分支實作（對應 Python _do_start / _do_end / _do_oneshot）--------

  /**
   * phase=start：Qwen 標題 → 建 subtask（end=None）→ punch_in。
   * 對應 Python _PunchWorker._do_start。
   *
   * 本地化（plan §2.9 / §2.14 D）：注入 local store 時，「建 'loc:' subtask（origin='local'、
   * pending_op='create'）+ ledger.punchIn」**收進 repo 層單一 txn**（createLocalSubtask），
   * 消除 rev5 前 punchIn→setSubtaskId 中間態。本地永遠有 'loc:' id，故無 appsync 的
   * id=null fallback_oneshot 分支。未注入 → 退回既有 appsync + ledger 雙寫路徑（向後相容）。
   */
  private async _doStart(action: PunchAction): Promise<Partial<ExecuteResult>> {
    const ip = action.input_prompt ?? '';
    // title 優先序（純本地，無 LLM）：整理過的 input_prompt → subtask_name → punch_name → 'agent_manager'。
    const title =
      tidyQuestionTitle(ip) ||
      (action.subtask_name ?? '') ||
      (action.punch_name ?? '') ||
      'agent_manager';

    // 本地化路徑（唯一路徑）：建 'loc:' subtask + punchIn 同 txn。
    const { localId } = this._local!.createLocalSubtask({
      punch_uid: action.punch_uid,
      session_id: String(action.session_id ?? this._sessionId),
      task_local_id: action.task_id,
      type: action.punch_name ?? '',
      name: title,
      assignee_id: action.assignee_id,
      category_name: action.category_name,
      input_prompt: action.input_prompt,
      start_time: action.start_time,
      cli: this._cli,
    });
    // 'loc:' 鍵接續：回 subtask_id 供 PunchService.mark_punched_in / decide_two_phase end 階段帶回。
    return { ok: true, subtask_id: localId };
  }

  /**
   * phase=end：把描述轉 Lexical → update_subtask 補 end/duration（含 retry）→ punch_out。
   * 對應 Python _PunchWorker._do_end。
   * update_subtask 冪等安全 → 包 retry；create（start/oneshot）不包。
   */
  private async _doEnd(action: PunchAction): Promise<Partial<ExecuteResult>> {
    const desc = await resolvePunchDescription(action);
    const lex = textToLexical(desc);

    // 本地化路徑（唯一路徑）：補 end/duration/desc（is_settled=1）+ punchOut 同 txn。
    this._local!.settleLocalSubtask({
      punch_uid: action.punch_uid,
      local_id: String(action.subtask_id ?? ''),
      task_id: String(action.task_id ?? '') || null,
      end_time: action.end_time,
      duration: action.duration ?? 0,
      description: lex,
    });
    // §2.14d D31：工作結束 → 落 punch_artifacts（hunk 級精確行數，純本地）。
    this._persistArtifacts(action);
    return {
      ok: true,
      subtask_id: action.subtask_id,
      hours: action.duration,
      absorbed_uid: action.absorbed_uid ?? null,
    };
  }

  /**
   * phase=oneshot：一次寫齊 create_subtask（start+end+duration+desc）→ record_oneshot。
   * 對應 Python _PunchWorker._do_oneshot。
   *
   * title 優先序（名稱＝使用者問題，對齊 _doStart）：
   *   1. LLM 摘要(input_prompt)。
   *   2. 整理過的 input_prompt（LLM 不可用時的非 LLM 後援）。
   *   3. subtask_name（有意義時：非空、≠punch_name、≠'agent_manager'）。
   *   4. punch_name → 'agent_manager'。
   * 改：原本「subtask_name 有意義 → 直接用、跳過 LLM」會讓 agent 輸出標題壓過使用者問題；
   *   依需求改為一律以使用者問題（input_prompt）優先。
   */
  private async _doOneshot(action: PunchAction): Promise<Partial<ExecuteResult>> {
    const desc = await resolvePunchDescription(action);

    // title 優先序（純本地，無 LLM）：整理過的 input_prompt → 有意義的 subtask_name → punch_name → 'agent_manager'。
    const sn = (action.subtask_name ?? '').trim();
    const pn = (action.punch_name ?? '').trim();
    const ip = action.input_prompt ?? '';
    const meaningfulSn = sn !== '' && sn !== pn && sn !== 'agent_manager' ? sn : '';
    const title =
      tidyQuestionTitle(ip) ||
      meaningfulSn ||
      pn ||
      'agent_manager';
    const lex = textToLexical(desc);

    // 本地化路徑（唯一路徑）：一次寫齊 'loc:' subtask + recordOneshot 同 txn。
    const { localId } = this._local!.recordLocalOneshot({
      punch_uid: action.punch_uid,
      session_id: String(action.session_id ?? this._sessionId),
      task_local_id: action.task_id,
      type: action.punch_name ?? '',
      name: title,
      assignee_id: action.assignee_id,
      category_name: action.category_name,
      input_prompt: action.input_prompt,
      start_time: action.start_time,
      end_time: action.end_time,
      duration: action.duration ?? 0,
      description: lex,
      cli: this._cli,
    });
    // §2.14d D31：oneshot 一次寫齊 → 落 punch_artifacts（純本地）。
    this._persistArtifacts(action);
    return {
      ok: true,
      subtask_id: localId,
      hours: action.duration,
    };
  }

  // ---- ledger event 寫失敗記錄 -----------------------------------------------

  private _ledgerEvent(
    severity: string,
    title: string,
    body: string,
    action: PunchAction,
  ): void {
    // 純本地後無帳本直呼；保留簽名供 executeAction catch 使用（容錯 no-op）。
    void severity; void title; void body; void action;
  }
}
