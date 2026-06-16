/** AgentTeams 專屬對話後端服務（claude / codex 路由）。 */

import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import * as path from 'path';
import { findProjectFolder } from '../worktime/claude/discover';
import { recordToConversationMessage } from '../worktime/claude/index';
import { findCodexRolloutInWindow } from '../worktime/codex/discover';
import { codexRecordToConversationMessage } from '../worktime/codex/parse';
import { readJsonl } from '../worktime/jsonl';
import { PtyPromptWatcher } from '../pty/promptDetector';
import type {
  ConversationMessage,
  ConversationWindowResult,
  SegmentInfo,
  SegmentListResult,
} from '../../shared/ipcContracts';
import { AGENT_CONV_CHANNELS } from '../../shared/ipcContracts';
import { ConversationStore } from './conversationStore';
import { AgentConvSessionStore, type AgentConvSessionRecord } from './agentConvSessionStore';
import {
  type FileSig,
  initialPromptEnterDelayMs,
  defaultShell,
  statSig,
  fileExists,
  defaultLabel,
} from './agentConversationHelpers';

// 純函式 leaf 已移至 agentConversationHelpers.ts（零邏輯改動）。
// initialPromptEnterDelayMs re-export 保留：tests/ 仍從本模組路徑 import。
export { initialPromptEnterDelayMs };

export type AgentConvEmit = (channel: string, payload: unknown) => void;

export interface AgentConvOpenInput {
  /** = claude --session-id（renderer 自取 uuid）。同時是 JSONL 檔名 stem。 */
  conversationId: string;
  /** agentOrgRoot：PTY cwd + JSONL 定檔來源。 */
  cwd: string;
  /** `claude --session-id <conversationId>`（由 router 組，避免 renderer 注入任意指令）。 */
  launchCommand: string;
  /** 第二段注入指令（如 `/tuq-agent`）；null=不注入。 */
  initialPrompt: string | null;
  /** UI label；存 DB 供重啟後還原側欄。 */
  label?: string | null;
  /** 裸 skill name；存 DB 供輸入框預設。 */
  initialSkill?: string | null;
  /** 使用的 CLI（'claude' | 'codex' | 'antigravity'）；預設 'claude'。 */
  cliId?: string;
  /**
   * true=以 resume 模式開啟（launchCommand 已是 `claude --resume <id>`）。
   * resume 時：跳過第二段 initialPrompt 注入（避免重送 /tuq-agent）；
   * launchCommand 永遠保持 --resume，絕不退回 --session-id（會撞 claude 的 session-id-in-use）；
   * 開啟前僅檢查 JSONL 是否存在以 warn 提示，找不到時仍以 --resume 嘗試。
   */
  resume?: boolean;
}

const LAUNCH_DELAY_MS = 300;
const PROMPT_DELAY_MS = 1500;
const TAIL_INTERVAL_MS = 600;
const BUSY_DEBOUNCE_MS = 1500;
const MAX_CONVERSATIONS = 6;
/** 開啟後若超過此時間仍找不到 JSONL，強制 done 以清 pending。
 *  防止 cmd.exe 在 claude 指令找不到時停在 shell prompt 導致 PTY 永不退出。 */
const PENDING_TIMEOUT_MS = 30_000;
/** spawn 後等第一個 byte 的看門狗：ConPTY 偶發殭屍（spawn 成功但永遠零輸出，
 *  node-pty Windows 已知問題）時 kill + respawn 自癒。 */
const FIRST_BYTE_TIMEOUT_MS = 3_000;
/** 最多 spawn 次數；最後一次退 winpty（useConpty:false，實測對殭屍免疫）。 */
const MAX_SPAWN_ATTEMPTS = 3;
/** TUI 已啟動但 initial prompt 沒產生 JSONL 時，清空輸入列後重送。 */
const INITIAL_PROMPT_RETRY_DELAYS_MS = [5_000, 12_000];
/** Ctrl+U：多數 CLI readline/TUI 會清空目前輸入列。 */
const CLEAR_INPUT_LINE = '\x15';

/** 每條對話 PTY 原始輸出緩衝上限（bytes）。 */
const RAW_BUFFER_MAX_BYTES = 200_000;

interface ConvEntry {
  conversationId: string;
  cwd: string;
  /** 使用的 CLI（'claude' | 'codex' | 'antigravity'）。 */
  cliId: string;
  /** open() 建立時的 Unix 毫秒時間戳（供 findCodexRollout 過濾舊 session）。 */
  openedAtMs: number;
  pty: IPty;
  /** 已定位的 JSONL 絕對路徑；尚未出現時為 null。 */
  jsonlFile: string | null;
  /** 上次解析時的檔案簽名（去重用）。 */
  lastSig: FileSig | null;
  /** tail 輪詢 timer。 */
  tailTimer: ReturnType<typeof setInterval> | null;
  /** 兩段注入排程的 timer（close 時要清，避免注入到已 kill 的 PTY）。 */
  injectTimers: Array<ReturnType<typeof setTimeout>>;
  /** node-pty listener disposables。 */
  disposables: Array<{ dispose: () => void }>;
  /** PTY 是否已結束（claude 退出）。 */
  done: boolean;
  /** PTY 正在輸出（claude 處理中）→ true；靜默 1500ms 後 debounce 歸 false。 */
  busy: boolean;
  /** busy debounce timer（onData 每次更新時重設）。 */
  busyDebounce: ReturnType<typeof setTimeout> | null;
  /** _tailOnce 最後一次解析出的訊息快取（busy change emit 時用，避免重讀 JSONL）。 */
  lastMessages: ConversationMessage[];
  /** PTY 互動提問偵測器（純 leaf；idle 1500ms 後偵測 PROMPT_PATTERNS）。 */
  promptWatcher: PtyPromptWatcher;
  /** PTY 原始輸出緩衝（供 AgentTermView 晚訂閱時補齊早期輸出）。最多 RAW_BUFFER_MAX_BYTES bytes。 */
  rawBuffer: string;
  /** 啟動逾時計時器：PENDING_TIMEOUT_MS 後若 JSONL 仍未出現則強制 done。 */
  pendingTimeoutTimer: ReturnType<typeof setTimeout> | null;
  /** 本輪 spawn 是否已收到任何 PTY 輸出（spawn 看門狗判定殭屍用）。 */
  gotData: boolean;
  /** spawn 看門狗 timer：FIRST_BYTE_TIMEOUT_MS 內零輸出 → kill + respawn。 */
  spawnWatchdog: ReturnType<typeof setTimeout> | null;
}

interface ClosedConvEntry {
  file: string;
  cliId: 'claude' | 'codex';
  rawBuffer: string;
}

export class AgentConversationService {
  private readonly _convs = new Map<string, ConvEntry>();
  private readonly _closedConvs = new Map<string, ClosedConvEntry>();
  private _emit: AgentConvEmit;

  constructor(
    emit: AgentConvEmit,
    private readonly _convStore: ConversationStore = new ConversationStore(),
    private readonly _sessionStore: AgentConvSessionStore | null = null,
  ) {
    this._emit = emit;
  }

  /** 注入 / 替換 emit（真機 main setEmit 時轉發；測試可換 mock）。 */
  setEmit(emit: AgentConvEmit): void {
    this._emit = emit;
  }

  /**
   * 開新一條對話：多對話並存（不關既有）→ spawn 裸 shell → 兩段時序注入 → 啟 tail。
   * 回 conversationId。spawn 失敗 throw。超過上限 throw（讓 renderer 回報提示）。
   */
  open(input: AgentConvOpenInput): string {
    // 只關同 id（多條並存：不再關閉其他既有 conversation）。
    // 理論上 renderer 每次 crypto.randomUUID() 不會撞，但同 id 重開時保險清舊。
    if (this._convs.has(input.conversationId)) {
      this.close(input.conversationId);
    }

    // 並行上限：超過 MAX_CONVERSATIONS 時 throw，讓 router 回 err + renderer 彈提示。
    if (this._convs.size >= MAX_CONVERSATIONS) {
      throw new Error('AGENT_CONV_LIMIT');
    }

    const cliId = input.cliId ?? 'claude';
    // resume 旗標：本批僅 claude 支援（codex/antigravity 的 AgentTeams 路徑無 session 概念）。
    // 非 claude 時即使 input.resume=true 也視為非 resume（launchCommand 也已是非 resume 指令）。
    const resume = input.resume === true && cliId === 'claude';
    const launchCommand = input.launchCommand;

    // JSONL 存在性 guard（log-only）：resume 時 launchCommand 永遠保持 handler 組好的
    // `claude --resume <id>`，絕不 fallback 成 `--session-id <同一 id>`——後者會撞 claude 的
    // 「Session ID ... is already in use」（--session-id 是「用此 id 開新」，cwd-scoped 不可重用）。
    // JSONL 此刻可能尚未 flush / 暫時找不到，僅 warn 提示；真的不存在時 claude 會在 TUI 自報
    // 「No conversation found」，由既有 PENDING_TIMEOUT_MS 守護收尾，遠優於 session 衝突。
    if (resume) {
      const match = findProjectFolder(input.cwd);
      const candidate = match.match === 'not-found'
        ? null
        : path.join(match.folder_path, input.conversationId + '.jsonl');
      if (!candidate || !fileExists(candidate)) {
        console.warn(
          `[agentConv:open] id=${input.conversationId.slice(0, 8)} resume 要求但 JSONL 暫找不到 → 仍以 --resume 嘗試（不退回 --session-id）`,
        );
      }
    }

    const shell = defaultShell();
    const env = { ...process.env } as Record<string, string>;

    // Windows 上 node-pty 對 forward-slash cwd 有時行為不一致；先 path.resolve 正規化為反斜線格式。
    const resolvedCwd = path.resolve(input.cwd);

    console.log(`[agentConv:open] id=${input.conversationId.slice(0, 8)} shell=${shell} cwd="${resolvedCwd}" launchCommand="${launchCommand}" resume=${resume}`);
    this._safeStore(() => this._sessionStore?.upsertOpen({
      conversationId: input.conversationId,
      label: input.label || defaultLabel(input.initialPrompt),
      cliId,
      cwd: resolvedCwd,
      initialPrompt: input.initialPrompt,
      skillName: input.initialSkill ?? null,
    }));

    // 建立互動提問偵測器（純 leaf；onWaiting = emit PROMPT_STATE with options；onActive = emit null）。
    const promptWatcher = new PtyPromptWatcher(
      (reason, options) => {
        // idle 到期偵測到 waiting → 推 PROMPT_STATE（options 有值）。
        this._emit(AGENT_CONV_CHANNELS.PROMPT_STATE, {
          conversationId: input.conversationId,
          options: options ?? null,
        });
      },
      () => {
        // 新資料到來 → 提問解除 → 推 PROMPT_STATE（options: null）。
        this._emit(AGENT_CONV_CHANNELS.PROMPT_STATE, {
          conversationId: input.conversationId,
          options: null,
        });
      },
    );

    const entry: ConvEntry = {
      conversationId: input.conversationId,
      cwd: resolvedCwd,
      cliId,
      openedAtMs: Date.now(),
      // 佔位：spawnAndWire(1) 於下方立即指派真 PTY。
      pty: null as unknown as IPty,
      jsonlFile: null,
      lastSig: null,
      tailTimer: null,
      injectTimers: [],
      disposables: [],
      done: false,
      busy: false,
      busyDebounce: null,
      lastMessages: [],
      promptWatcher,
      pendingTimeoutTimer: null,
      rawBuffer: '',
      gotData: false,
      spawnWatchdog: null,
    };
    this._convs.set(input.conversationId, entry);

    // spawn + 接線 + 兩段注入，包成可重試閉包：
    // ConPTY 偶發殭屍（spawn 回傳成功但 onData/onExit 永不觸發）時由看門狗
    // kill + respawn 自癒；最後一次退 winpty（useConpty:false，實測免疫）。
    const spawnAndWire = (attempt: number): void => {
      // 清掉上一輪的 listener / 注入 timer / PTY（attempt=1 時皆為空操作）。
      for (const d of entry.disposables) {
        try { d.dispose(); } catch { /* ignore */ }
      }
      entry.disposables = [];
      for (const t of entry.injectTimers) clearTimeout(t);
      entry.injectTimers = [];
      if (attempt > 1) {
        try { entry.pty.kill(); } catch { /* zombie already dead */ }
      }
      entry.gotData = false;

      const useConpty = attempt < MAX_SPAWN_ATTEMPTS;
      const p = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd: resolvedCwd,
        env,
        // 非 Windows 平台 node-pty 忽略此旗標。
        useConpty,
      });
      console.log(`[agentConv:spawn] id=${input.conversationId.slice(0, 8)} attempt=${attempt} pid=${p.pid}`);
      entry.pty = p;

      // PTY onData → (1) busy 追蹤；(2) 推 agentConv:raw 原始串流。
      // chunk 為 node-pty 給的原始字串（含 ANSI escape），兩條路徑獨立、互不干擾：
      //   busy 追蹤只看「有無輸出」，raw emit 只把 chunk 原樣推給 renderer（不解析、不去色）。
      let _firstChunkLogged = false;
      const dataListener = p.onData((chunk: string) => {
        const e = this._convs.get(input.conversationId);
        if (!e) return;

        // 首 byte 到達 → 解除 spawn 看門狗（本輪非殭屍）。
        if (!e.gotData) {
          e.gotData = true;
          if (e.spawnWatchdog !== null) {
            clearTimeout(e.spawnWatchdog);
            e.spawnWatchdog = null;
          }
        }

        // 前幾個 chunk log：確認 PTY 有真實輸出（不含 ANSI 的可見字元）。
        if (!_firstChunkLogged) {
          _firstChunkLogged = true;
          const visible = chunk.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/[\r\n]/g, ' ').slice(0, 80);
          console.log(`[agentConv:data] id=${input.conversationId.slice(0, 8)} first chunk: ${JSON.stringify(visible)}`);
        }

        // —— (1) busy 追蹤（保留既有邏輯，未動） ——
        const wasbusy = e.busy;
        e.busy = true;
        // 重設 debounce（每次有輸出就延後歸 false）。
        if (e.busyDebounce !== null) {
          clearTimeout(e.busyDebounce);
        }
        e.busyDebounce = setTimeout(() => {
          const ec = this._convs.get(input.conversationId);
          if (!ec) return;
          ec.busy = false;
          ec.busyDebounce = null;
          // busy 歸 false 時立即推一次（即時反映靜默狀態）。
          // 同時清 lastSig：強制下一輪 _tailOnce poll 重解析 JSONL，確保 messages
          // 與 busy=false 狀態同步（避免 lastMessages 過舊導致 renderer 看到空訊息列表）。
          ec.lastSig = null;
          this._emitBusyChange(ec);
        }, BUSY_DEBOUNCE_MS);
        // busy false→true 時立即推一次（即時反映開始處理）。
        if (!wasbusy) {
          this._emitBusyChange(e);
        }

        // —— (2) agentConv:raw — 原始輸出串流（含 ANSI；原樣推，renderer xterm 處理）。
        // 同步存入 rawBuffer（供 AgentTermView 晚訂閱時 replay；超限截頭）。
        e.rawBuffer += chunk;
        if (e.rawBuffer.length > RAW_BUFFER_MAX_BYTES) {
          e.rawBuffer = e.rawBuffer.slice(e.rawBuffer.length - RAW_BUFFER_MAX_BYTES);
        }
        this._emit(AGENT_CONV_CHANNELS.RAW, {
          conversationId: input.conversationId,
          chunk,
        });

        // —— (3) 互動提問偵測（純 leaf，不影響 busy/raw；watcher 內部 idle 1500ms 後偵測）。
        e.promptWatcher.onData(chunk);
      });
      entry.disposables.push(dataListener);

      // PTY 結束 → 自動 close（claude 自退時也清乾淨，不留孤兒）。
      const exitListener = p.onExit(({ exitCode }) => {
        console.log(`[agentConv:exit] id=${input.conversationId.slice(0, 8)} exitCode=${exitCode}`);
        const e = this._convs.get(input.conversationId);
        if (!e) return;
        // 殭屍保護：respawn 後 entry.pty 已換新 PTY；舊 PTY 的 onExit 若仍觸發（node-pty
        // dispose 不保證將已排隊的回呼移出 event loop）→ 直接忽略，避免過早 done=true。
        if (e.pty !== p) return;
        e.done = true;
        this._safeStore(() => this._sessionStore?.updateStatus(input.conversationId, 'done'));
        // PTY 結束 → busy 歸 false（不管 debounce）。
        if (e.busyDebounce !== null) {
          clearTimeout(e.busyDebounce);
          e.busyDebounce = null;
        }
        e.busy = false;
        // 結束前再 tail 一次推全量 + done 旗標，再清理。
        this._tailOnce(e);
        this.close(input.conversationId);
      });
      entry.disposables.push(exitListener);

      // 兩段時序注入（main 端 setTimeout；respawn 時相對新 spawn 重新排程）。
      const t1 = setTimeout(() => {
        const e = this._convs.get(input.conversationId);
        if (!e) return;
        e.pty.write(launchCommand + '\r');
      }, LAUNCH_DELAY_MS);
      entry.injectTimers.push(t1);

      // resume 模式：第一段 launchCommand（`claude --resume <id>`）注入照常；
      // 跳過第二段 initialPrompt 注入（保險：即使 initialPrompt 有值也不重送，避免重打 /tuq-agent）。
      if (input.initialPrompt && !resume) {
        const prompt = input.initialPrompt;
        const schedulePromptSend = (
          attemptIndex: number,
          delayMs: number,
          clearBeforeSend: boolean,
        ): void => {
          const tPrompt = setTimeout(() => {
            const e = this._convs.get(input.conversationId);
            if (!e || e.done || e.jsonlFile !== null) return;
            if (clearBeforeSend) {
              console.warn(
                `[agentConv:prompt-retry] id=${input.conversationId.slice(0, 8)} attempt=${attemptIndex + 1} no JSONL yet → resend initialPrompt`,
              );
              e.pty.write(CLEAR_INPUT_LINE);
            }
            // 修復：不可一次寫入 prompt+'\r'。claude TUI 啟用 bracketed paste mode，
            // 一包寫入時 \r 可能被當換行而非送出。
            e.pty.write(prompt);
            const enterDelay = initialPromptEnterDelayMs(prompt, input.cliId);
            const tEnter = setTimeout(() => {
              const ec = this._convs.get(input.conversationId);
              if (!ec || ec.done || ec.jsonlFile !== null) return;
              ec.pty.write('\r');

              if (ec.pendingTimeoutTimer === null) {
                ec.pendingTimeoutTimer = setTimeout(() => {
                  const ef = this._convs.get(input.conversationId);
                  if (!ef || ef.jsonlFile !== null || ef.done) return;
                  ef.done = true;
                  this._safeStore(() => this._sessionStore?.updateStatus(input.conversationId, 'done'));
                  if (ef.busyDebounce !== null) { clearTimeout(ef.busyDebounce); ef.busyDebounce = null; }
                  ef.busy = false;
                  this._emitMessages(ef, [], false);
                  this.close(input.conversationId);
                }, PENDING_TIMEOUT_MS);
              }

              const retryDelay = INITIAL_PROMPT_RETRY_DELAYS_MS[attemptIndex];
              if (retryDelay !== undefined) {
                schedulePromptSend(attemptIndex + 1, retryDelay, true);
              }
            }, enterDelay);
            const eForPush = this._convs.get(input.conversationId);
            if (eForPush) eForPush.injectTimers.push(tEnter);
          }, delayMs);
          entry.injectTimers.push(tPrompt);
        };

        schedulePromptSend(0, LAUNCH_DELAY_MS + PROMPT_DELAY_MS, false);
      }

      // spawn 看門狗：FIRST_BYTE_TIMEOUT_MS 內零輸出 = ConPTY 殭屍 → respawn / 放棄。
      entry.spawnWatchdog = setTimeout(() => {
        const e = this._convs.get(input.conversationId);
        if (!e || e !== entry || e.gotData || e.done) return;
        e.spawnWatchdog = null;
        if (attempt < MAX_SPAWN_ATTEMPTS) {
          console.warn(
            `[agentConv:spawn-retry] id=${input.conversationId.slice(0, 8)} attempt=${attempt} 零輸出（ConPTY 殭屍）→ respawn${attempt + 1 >= MAX_SPAWN_ATTEMPTS ? '（winpty）' : ''}`,
          );
          spawnAndWire(attempt + 1);
        } else {
          console.error(
            `[agentConv:spawn-fail] id=${input.conversationId.slice(0, 8)} ${MAX_SPAWN_ATTEMPTS} 次 spawn 皆零輸出，放棄`,
          );
          e.done = true;
          this._safeStore(() => this._sessionStore?.updateStatus(input.conversationId, 'done'));
          this._emitMessages(e, e.lastMessages, false);
          this.close(input.conversationId);
        }
      }, FIRST_BYTE_TIMEOUT_MS);
    };

    spawnAndWire(1);

    // 首次先推 pending:true（JSONL 尚未出現）。
    this._emitMessages(entry, [], true);

    // 啟動 tail 輪詢（容忍 JSONL 暫不存在）。
    entry.tailTimer = setInterval(() => {
      const e = this._convs.get(input.conversationId);
      if (!e) return;
      this._tailOnce(e);
    }, TAIL_INTERVAL_MS);

    // 啟動逾時守護：若 PENDING_TIMEOUT_MS 後 JSONL 仍未出現，強制結束以清除 pending。
    // 場景：cmd.exe 在 claude 找不到時停在 shell prompt，PTY 永不退出 → pending 永 true。
    // ⚠ 注意：有 initialPrompt 時，pendingTimeoutTimer 改由 t3（換行送出後）啟動，
    //   確保計時從「prompt 確實送出」後才開始，避免長文注入期間被誤判超時。
    //   無 initialPrompt 時照舊立即啟動（無注入延遲）。
    //   resume 模式跳過第二段注入 → 無 t3 啟動點，須在此立即啟動逾時守護（同無 prompt 路徑）。
    if (!input.initialPrompt || resume) {
      entry.pendingTimeoutTimer = setTimeout(() => {
        const e = this._convs.get(input.conversationId);
        if (!e || e.jsonlFile !== null || e.done) return;
        e.done = true;
        this._safeStore(() => this._sessionStore?.updateStatus(input.conversationId, 'done'));
        if (e.busyDebounce !== null) { clearTimeout(e.busyDebounce); e.busyDebounce = null; }
        e.busy = false;
        this._emitMessages(e, [], false);
        this.close(input.conversationId);
      }, PENDING_TIMEOUT_MS);
    }

    return input.conversationId;
  }

  getBuffer(conversationId: string): string {
    return this._convs.get(conversationId)?.rawBuffer
      ?? this._closedConvs.get(conversationId)?.rawBuffer
      ?? '';
  }

  getConversationWindow(conversationId: string): ConversationWindowResult {
    const FAIL: ConversationWindowResult = {
      ok: false,
      messages: [],
      startSeq: 0,
      totalCount: 0,
    };
    const r = this._resolveConversationFileForQuery(conversationId);
    if (!r) return FAIL;
    const result = this._convStore.getWindow(r.file, r.cliId);
    return {
      ok: true,
      messages: result.messages,
      startSeq: result.startSeq,
      totalCount: result.totalCount,
    };
  }

  getSegments(conversationId: string): SegmentListResult {
    const FAIL: SegmentListResult = { ok: false, segments: [], totalCount: 0 };
    const r = this._resolveConversationFileForQuery(conversationId);
    if (!r) return FAIL;
    const result = this._convStore.getSegments(r.file);
    const segments: SegmentInfo[] = result.segments.map(
      ({
        seg_no, start_seq, end_seq, start_ts, end_ts, label, is_command, msg_count,
        head_kind,
      }) => ({
        seg_no, start_seq, end_seq, start_ts, end_ts, label, is_command, msg_count,
        head_kind: (['typed', 'command', 'notify', 'other'].includes(head_kind)
          ? head_kind
          : 'other') as SegmentInfo['head_kind'],
      }),
    );
    return { ok: true, segments, totalCount: result.totalCount };
  }

  getSegmentMessages(
    conversationId: string,
    startSeq: number,
    endSeq: number,
  ): { ok: boolean; messages: ConversationMessage[] } {
    const FAIL = { ok: false, messages: [] as ConversationMessage[] };
    const r = this._resolveConversationFileForQuery(conversationId);
    if (!r) return FAIL;
    return {
      ok: true,
      messages: this._convStore.getMessagesRange(r.file, startSeq, endSeq, r.cliId),
    };
  }

  listSessions(limit = 20): AgentConvSessionRecord[] {
    try {
      return this._sessionStore?.listRecent(limit) ?? [];
    } catch {
      return [];
    }
  }

  /**
   * 永久從清單移除一條對話（sidebar「×」鈕）：DB 標 status='closed'，listSessions 不再回傳。
   * 與 close 不同：close 自然結束時標 'done'（仍會列出）；hide 是使用者明確「以後別再顯示」。
   * 防呆：若該條仍活著（理論上 × 只在 done 出現）→ 先 close PTY，再覆寫成 'closed'。
   * 對已結束、早已不在 live map 的對話也有效（直接寫 DB）。
   */
  hide(conversationId: string): void {
    if (this._convs.has(conversationId)) {
      this.close(conversationId);
    }
    this._safeStore(() => this._sessionStore?.updateStatus(conversationId, 'closed'));
  }

  sendInput(conversationId: string, text: string): void {
    const entry = this._convs.get(conversationId);
    if (!entry) return;
    try {
      entry.pty.write(text);
    } catch {
      // PTY 已死 → 忽略。
    }
  }

  resize(conversationId: string, cols: number, rows: number): void {
    const entry = this._convs.get(conversationId);
    if (!entry) return;
    try {
      entry.pty.resize(cols, rows);
    } catch {
      // PTY 已死 → 忽略。
    }
  }

  close(conversationId: string): void {
    const entry = this._convs.get(conversationId);
    if (!entry) return;
    console.log(`[agentConv:close] id=${conversationId.slice(0, 8)}`);
    const file = this._resolveJsonlFile(entry);
    if (file && (entry.cliId === 'claude' || entry.cliId === 'codex')) {
      this._closedConvs.set(conversationId, {
        file,
        cliId: entry.cliId,
        rawBuffer: entry.rawBuffer,
      });
    }
    this._safeStore(() => this._sessionStore?.updateStatus(conversationId, entry.done ? 'done' : 'closed'));
    // 先從 map 移除，避免 onExit / timer 回呼遞迴重入。
    this._convs.delete(conversationId);

    if (entry.tailTimer) {
      clearInterval(entry.tailTimer);
      entry.tailTimer = null;
    }
    if (entry.busyDebounce !== null) {
      clearTimeout(entry.busyDebounce);
      entry.busyDebounce = null;
    }
    if (entry.pendingTimeoutTimer !== null) {
      clearTimeout(entry.pendingTimeoutTimer);
      entry.pendingTimeoutTimer = null;
    }
    if (entry.spawnWatchdog !== null) {
      clearTimeout(entry.spawnWatchdog);
      entry.spawnWatchdog = null;
    }
    for (const t of entry.injectTimers) {
      clearTimeout(t);
    }
    entry.injectTimers = [];
    for (const d of entry.disposables) {
      try {
        d.dispose();
      } catch {
        // ignore
      }
    }
    entry.disposables = [];
    // 釋放互動提問偵測器（清 idle timer，防 timer 洩漏）。
    entry.promptWatcher.dispose();
    try {
      entry.pty.kill();
    } catch {
      // already dead
    }
  }

  disposeAll(): void {
    for (const id of [...this._convs.keys()]) {
      this.close(id);
    }
  }

  /**
   * tail 一次：定檔（容忍暫不存在）→ 簽名去重 → 全量 readJsonl + 解析 → emit。
   * 單 conversation JSONL 小，全量重解析足夠（MVP 不做 byte 增量）。
   */
  private _tailOnce(entry: ConvEntry): void {
    const file = this._resolveJsonlFile(entry);
    if (!file) {
      // 檔案尚未出現 → 維持 pending（除非 PTY 已結束，done 由 onExit 設）。
      this._emitMessages(entry, [], !entry.done);
      return;
    }

    const sig = statSig(file);
    if (sig === null) {
      // 剛才存在、現在 stat 失敗（race）→ 視為暫缺，下輪再試。
      return;
    }

    // 簽名未變且非結束 → 不重推（省 IPC）。done 變化時強制推一次。
    if (
      entry.lastSig !== null &&
      entry.lastSig.mtimeMs === sig.mtimeMs &&
      entry.lastSig.size === sig.size &&
      !entry.done
    ) {
      return;
    }
    entry.lastSig = sig;

    const items = readJsonl(file);
    const messages: ConversationMessage[] = [];
    // 依 cliId 選擇解析器：codex 用 codexRecordToConversationMessage，其餘用 recordToConversationMessage。
    const parseRecord = entry.cliId === 'codex'
      ? codexRecordToConversationMessage
      : recordToConversationMessage;
    for (const item of items) {
      const msg = parseRecord(item.record);
      if (msg) messages.push(msg);
    }
    // 更新快取，供 busy change 即時 emit 使用。
    entry.lastMessages = messages;
    this._emitMessages(entry, messages, false);
  }

  /**
   * 定位本條 conversation 的 JSONL 檔；尚未出現 / 未命中時回 null（維持 pending、下輪續 poll）。
   * codex：findCodexRollout(cwd, openedAtMs)；claude：findProjectFolder + conversationId.jsonl。
   * ⚠ claude 不用 listSessionFilesLight（SKIP_MATCHES 含 'parent-direct'，CJK cwd 斜線轉換後誤判）。
   */
  private _resolveJsonlFile(entry: ConvEntry): string | null {
    if (entry.jsonlFile && fileExists(entry.jsonlFile)) return entry.jsonlFile;

    // codex 分支：以 cwd + openedAtMs 定位 ~/.codex/sessions rollout 檔。
    if (entry.cliId === 'codex') {
      const found = findCodexRolloutInWindow(
        entry.cwd,
        entry.openedAtMs,
        this._nextCodexOpenedAtMs(entry),
        this._claimedCodexFiles(entry.conversationId),
      );
      if (found) {
        entry.jsonlFile = found;
        this._safeStore(() => this._sessionStore?.updateJsonlFile(entry.conversationId, found));
        return found;
      }
      return null;
    }

    // 其餘（claude / antigravity）走既有邏輯：findProjectFolder + conversationId.jsonl。
    const match = findProjectFolder(entry.cwd);
    if (match.match === 'not-found') return null; // 不採信合成路徑（M1 精神）
    const candidate = path.join(match.folder_path, entry.conversationId + '.jsonl');
    if (fileExists(candidate)) {
      entry.jsonlFile = candidate;
      this._safeStore(() => this._sessionStore?.updateJsonlFile(entry.conversationId, candidate, entry.conversationId));
      return candidate;
    }
    return null;
  }

  private _resolveConversationFileForQuery(
    conversationId: string,
  ): { file: string; cliId: 'claude' | 'codex' } | null {
    const entry = this._convs.get(conversationId);
    if (!entry) {
      const closed = this._closedConvs.get(conversationId);
      if (closed) return closed;
      const persisted = this._safeGetSession(conversationId);
      if (
        persisted?.jsonlFile &&
        fileExists(persisted.jsonlFile) &&
        (persisted.cliId === 'claude' || persisted.cliId === 'codex')
      ) {
        return { file: persisted.jsonlFile, cliId: persisted.cliId };
      }
      return null;
    }
    if (entry.cliId !== 'claude' && entry.cliId !== 'codex') return null;
    const file = this._resolveJsonlFile(entry);
    if (!file) return null;
    return { file, cliId: entry.cliId };
  }

  private _emitMessages(
    entry: ConvEntry,
    messages: ConversationMessage[],
    pending: boolean,
  ): void {
    this._emit(AGENT_CONV_CHANNELS.MESSAGES, {
      conversationId: entry.conversationId,
      messages,
      pending,
      done: entry.done,
      busy: entry.busy,
    });
  }

  /**
   * busy 狀態變化時立即推一次（帶當前 lastMessages/pending/done/busy）。
   * 目的：讓 renderer 不需等到下個 tail 600ms poll 才知道 busy 改變。
   * 注意：此方法只在 busy 邊緣觸發（false→true / true→false），不影響 tail 頻率。
   * lastMessages 由 _tailOnce 每次解析後更新，無需重讀 JSONL（避免 IO race）。
   */
  private _emitBusyChange(entry: ConvEntry): void {
    const pending = entry.jsonlFile === null && !entry.done;
    this._emit(AGENT_CONV_CHANNELS.MESSAGES, {
      conversationId: entry.conversationId,
      messages: entry.lastMessages,
      pending,
      done: entry.done,
      busy: entry.busy,
    });
  }

  private _nextCodexOpenedAtMs(entry: ConvEntry): number | null {
    let next: number | null = null;
    for (const other of this._convs.values()) {
      if (other === entry) continue;
      if (other.cliId !== 'codex') continue;
      if (path.resolve(other.cwd).toLowerCase() !== path.resolve(entry.cwd).toLowerCase()) continue;
      if (other.openedAtMs <= entry.openedAtMs) continue;
      if (next === null || other.openedAtMs < next) next = other.openedAtMs;
    }
    return next;
  }

  private _claimedCodexFiles(exceptConversationId: string): Set<string> {
    const files = new Set<string>();
    for (const other of this._convs.values()) {
      if (other.conversationId === exceptConversationId) continue;
      if (other.cliId === 'codex' && other.jsonlFile) files.add(other.jsonlFile);
    }
    return files;
  }

  private _safeStore(fn: () => void): void {
    try {
      fn();
    } catch {
      // DB metadata persistence is non-fatal; JSONL remains the source of truth.
    }
  }

  private _safeGetSession(conversationId: string): AgentConvSessionRecord | null {
    try {
      return this._sessionStore?.get(conversationId) ?? null;
    } catch {
      return null;
    }
  }
}
