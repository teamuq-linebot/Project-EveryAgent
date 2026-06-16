/**
 * punchService.ts — 打卡決策 Application Service。
 *
 * 1:1 移植自 Python:
 *   teamuq/app/punch_service.py
 *
 * 移植原則：只做語言翻譯，忠實移植；禁止重新發明判定邏輯。
 * Oracle 對拍：tests/punchService.spec.ts 對應 Python tests/test_punch_service.py。
 */

import { MAIN_PUNCH_KEY, MAIN_PUNCH_NAME, utcNowIso } from './punchBuilder';
import type { NameBuilder } from './punchBuilder';
import type { PunchArtifact } from '../worktime/punchCore';

// ---------------------------------------------------------------------------
// ceil 進位：工時無條件進位到小數第 2 位（最小 0.01h），0.0 仍保持 0.0。
// 與 Python 完全一致：用字串繞過浮點誤差（0.02*100=2.0000...4 不多進一位）。
// ---------------------------------------------------------------------------

export function ceilHours2dp(rawHours: unknown): number {
  const raw = parseFloat(String(rawHours || 0.0)) || 0.0;
  if (raw === 0.0) return 0.0;
  // Math.ceil(h*100)/100 在 JS 有浮點誤差（如 0.02*100=2.0000000000000004 → ceil=3）。
  // 對策：先轉字串再解析小數，手動 ROUND_CEILING 到 2 位。
  // 等價 Python: Decimal(str(raw)).quantize(Decimal("0.01"), ROUND_CEILING)
  const s = raw.toString();
  const dotPos = s.indexOf('.');
  if (dotPos === -1) {
    // 整數，無需進位
    return raw;
  }
  const fracPart = s.slice(dotPos + 1); // 小數部分字串
  if (fracPart.length <= 2) {
    // 最多 2 位小數，無需進位（已是精確值）
    return raw;
  }
  // 有 3+ 位小數 → 判斷第 3 位以後是否非零
  const beyond = fracPart.slice(2);
  const hasRemainder = /[1-9]/.test(beyond);
  if (!hasRemainder) {
    // 第 3 位起全是 0（或無）→ 直接取前 2 位
    return parseFloat(s.slice(0, dotPos + 3));
  }
  // 有非零 → 無條件進位到第 2 位
  const intPart = parseInt(s.slice(0, dotPos), 10);
  const firstTwo = parseInt(fracPart.slice(0, 2), 10);
  // 進位：把 intPart.firstTwo + 1（以百分之一為單位）
  const hundredths = intPart * 100 + firstTwo + 1;
  return hundredths / 100;
}

// ---------------------------------------------------------------------------
// PunchAction dataclass（1:1 對應 Python PunchAction）
// ---------------------------------------------------------------------------

/**
 * 補償配對用的 open 錨點，由 preload 第三參數灌入。
 * 代表一個已 punch-in 但 uid 可能漂移的 open 紀錄。
 */
export interface OpenAnchor {
  subtask_id: string;
  name: string;
  started_at: string | null;
  type: string;
}

export interface PunchAction {
  punch_key: string;
  kind: string;               // "subagent" | "main"
  event_key: string | null;
  punch_name: string;
  subtask_name: string;
  description: string;
  task_id: unknown;
  assignee_id: unknown;
  category_name: string;
  start_time: unknown;
  end_time: unknown;
  duration: number;
  // 兩段式欄位（帶預設值）
  phase: string;              // "oneshot" | "start" | "end"
  punch_uid: string;
  session_id: unknown;
  subtask_id: string | null;
  input_prompt: string;
  description_is_fallback: boolean;
  llm_source_text: string;
  /**
   * §2.14d D31：本 event 涵蓋的 Edit/Write 操作（hunk 級，精確行數）。打卡成功後由
   * PunchExecutor 落 punch_artifacts（純本地不上傳）。end / oneshot phase 才帶（工作已完成）；
   * start phase 不帶（工作未結，artifacts 隨 end 一次落表）。
   */
  artifacts: PunchArtifact[];
  /**
   * 補償配對：此 end action 吸收了哪個「新 uid」（漂移後的完成事件 uid）。
   * 純記憶體，不落 DB；只在補償配對時填入，其他情況為 null/undefined。
   */
  absorbed_uid?: string | null;
}

/** 建一個完整 PunchAction，所有帶預設值的欄位可省略。 */
export function makePunchAction(fields: {
  punch_key: string;
  kind: string;
  event_key: string | null;
  punch_name: string;
  subtask_name: string;
  description: string;
  task_id: unknown;
  assignee_id: unknown;
  category_name: string;
  start_time: unknown;
  end_time: unknown;
  duration: number;
  phase?: string;
  punch_uid?: string;
  session_id?: unknown;
  subtask_id?: string | null;
  input_prompt?: string;
  description_is_fallback?: boolean;
  llm_source_text?: string;
  artifacts?: PunchArtifact[];
  absorbed_uid?: string | null;
}): PunchAction {
  return {
    phase: 'oneshot',
    punch_uid: '',
    session_id: null,
    subtask_id: null,
    input_prompt: '',
    description_is_fallback: false,
    llm_source_text: '',
    artifacts: [],
    ...fields,
  };
}

/** 轉成 worker 期望的 action dict（保持既有 worker 介面不變）。 */
export function actionAsDict(a: PunchAction): Record<string, unknown> {
  return {
    punch_key: a.punch_key,
    kind: a.kind,
    event_key: a.event_key,
    punch_name: a.punch_name,
    subtask_name: a.subtask_name,
    description: a.description,
    task_id: a.task_id,
    assignee_id: a.assignee_id,
    category_name: a.category_name,
    start_time: a.start_time,
    end_time: a.end_time,
    duration: a.duration,
  };
}

// ---------------------------------------------------------------------------
// PunchService class
// ---------------------------------------------------------------------------

export class PunchService {
  punched_keys: Set<string> = new Set();
  in_flight_keys: Set<string> = new Set();
  errors: Map<string, boolean> = new Map();
  main_punched = false;

  // 兩段式狀態
  open_keys: Map<string, string> = new Map();   // uid → subtask_id
  oneshot_keys: Set<string> = new Set();

  // 補償配對狀態（由 preload 灌入）
  open_anchors: Map<string, OpenAnchor> = new Map();  // 舊uid → anchor
  consumed_open_uids: Set<string> = new Set();         // 已被補償配對消耗的舊uid
  /** F-Z1 回滾：key=新uid，value={old_uid, anchor}；settle 成功/失敗後清除。*/
  pending_absorptions: Map<string, { old_uid: string; anchor: OpenAnchor }> = new Map();

  // 退避閘狀態
  token_defer: Map<string, number> = new Map(); // uid → 到期 monotonic 時刻
  retrying: Set<string> = new Set();

  // ---- sub-agent 決策 -------------------------------------------------------

  static event_dedup_key(ev: Record<string, unknown>): string {
    return (ev['punch_uid'] as string) || (ev['event_key'] as string) || '';
  }

  decide_subagents(
    subagent_events: Record<string, unknown>[],
    builder: NameBuilder,
    opts: { task_id: unknown; assignee_id: unknown }
  ): PunchAction[] {
    const { task_id, assignee_id } = opts;
    const actions: PunchAction[] = [];
    const seen_this_round = new Set<string>();

    for (const ev of subagent_events) {
      const ekey = PunchService.event_dedup_key(ev);
      if (!ekey || this.punched_keys.has(ekey) || this.in_flight_keys.has(ekey) || seen_this_round.has(ekey)) {
        continue;
      }
      if (!ev['is_complete']) continue; // 未完成 → 只顯示、不打卡
      seen_this_round.add(ekey);
      // 樂觀鎖：決定打卡的當下立即（同步）標記 in-flight
      this.in_flight_keys.add(ekey);
      const punch_name = String(ev['punch_name'] || '');
      const description = String(ev['description'] || '').trim();
      const out_title = String(ev['output_json_title'] || '').trim();
      const out_desc = String(ev['output_json_description'] || '').trim();
      const model = String(ev['model'] || '').trim();
      const tokens = ev['tokens'] || 0;
      const hours = ceilHours2dp(ev['duration_hours'] || 0.0);
      const start_time = ev['started_at'] ?? null;
      const end_time = ev['ended_at'] ?? null;
      actions.push(makePunchAction({
        punch_key: ekey,
        kind: 'subagent',
        event_key: ekey,
        punch_name,
        subtask_name: out_title || builder._subagent_subtask_name(punch_name, description),
        description: out_desc || builder._build_subagent_description(description, model, tokens, hours),
        task_id,
        assignee_id,
        category_name: punch_name,
        start_time,
        end_time,
        duration: hours,
      }));
    }
    return actions;
  }

  // ---- main 決策 -----------------------------------------------------------

  decide_main(
    main_state: Record<string, unknown>,
    builder: NameBuilder,
    opts: { task_id: unknown; assignee_id: unknown }
  ): PunchAction | null {
    const { task_id, assignee_id } = opts;
    if (this.main_punched) return null;
    const raw = parseFloat(String(main_state['duration_hours'] || 0.0)) || 0.0;
    const hours = Math.round(raw * 10000) / 10000; // round(..., 4)
    if (hours <= 0) return null;
    this.main_punched = true;
    const start_time = main_state['started_at'] || utcNowIso();
    const end_time = main_state['ended_at'] || utcNowIso();
    const out_title = String(main_state['output_json_title'] || '').trim();
    const out_desc = String(main_state['output_json_description'] || '').trim();
    return makePunchAction({
      punch_key: MAIN_PUNCH_KEY,
      kind: 'main',
      event_key: null,
      punch_name: MAIN_PUNCH_NAME,
      subtask_name: out_title || MAIN_PUNCH_NAME,
      description: out_desc || builder._build_main_description(hours),
      task_id,
      assignee_id,
      category_name: MAIN_PUNCH_NAME,
      start_time,
      end_time,
      duration: hours,
    });
  }

  // ---- decide_main_rounds --------------------------------------------------

  decide_main_rounds(
    main_events: Record<string, unknown>[],
    builder: NameBuilder,
    opts: { task_id: unknown; assignee_id: unknown }
  ): PunchAction[] {
    const { task_id, assignee_id } = opts;
    const actions: PunchAction[] = [];
    const seen = new Set<string>();

    for (const ev of main_events || []) {
      const ekey = String(ev['punch_uid'] || '');
      if (!ekey || this.punched_keys.has(ekey) || this.in_flight_keys.has(ekey) || seen.has(ekey)) {
        continue;
      }
      if (!ev['is_complete']) continue; // 進行中最新輪 → 只顯示
      seen.add(ekey);
      this.in_flight_keys.add(ekey);
      const hours = ceilHours2dp(ev['duration_hours'] || 0.0);
      const round_punch_name = String(ev['punch_name'] || '') || MAIN_PUNCH_NAME;
      const out_title = String(ev['output_json_title'] || '').trim();
      const out_desc = String(ev['output_json_description'] || '').trim();
      actions.push(makePunchAction({
        punch_key: ekey,
        kind: 'main',
        event_key: ekey,
        punch_name: round_punch_name,
        subtask_name: out_title || MAIN_PUNCH_NAME,
        description: out_desc || builder._build_main_description(hours),
        task_id,
        assignee_id,
        category_name: round_punch_name,
        start_time: ev['started_at'] ?? null,
        end_time: ev['ended_at'] ?? null,
        duration: hours,
      }));
    }
    return actions;
  }

  // ---- create 結果回填 -------------------------------------------------------

  mark_done(key: string | null, ok: boolean): void {
    if (key === null || key === undefined) return;
    if (ok) {
      this.punched_keys.add(key);
      this.in_flight_keys.delete(key);
      this.errors.delete(key);
      // 兩段式：oneshot / end 成功 → 清掉中間態
      this.open_keys.delete(key);
      this.oneshot_keys.delete(key);
      // 退避閘：成功後清退避/重試標記
      this.token_defer.delete(key);
      this.retrying.delete(key);
      // F-Z1：若 key 是補償配對的新 uid，清除 pending 記錄（settle 成功路徑）
      this.pending_absorptions.delete(key);
    } else {
      this.in_flight_keys.delete(key);
      this.errors.set(key, true);
    }
  }

  /**
   * F-Z1：補償配對 settle 失敗時，回滾 decide 階段對 old_uid 的不可逆狀態變更，
   * 使下一輪掃描可重試補償。
   * 由 MonitorController._onPunchDone 的 !ok 分支、在 r.absorbed_uid 非空時呼叫。
   */
  mark_absorption_failed(new_uid: string | null): void {
    if (!new_uid) return;
    const entry = this.pending_absorptions.get(new_uid);
    if (!entry) return;
    const { old_uid, anchor } = entry;
    // 還原 open_anchors（old_uid 回到候選池）
    this.open_anchors.set(old_uid, anchor);
    // 還原 consumed（下輪 decide 可再命中此 anchor）
    this.consumed_open_uids.delete(old_uid);
    // 清除新 uid 的 in_flight（L572 加入，必須在 !ok 路徑中清除）
    this.in_flight_keys.delete(new_uid);
    // 清除 pending 記錄
    this.pending_absorptions.delete(new_uid);
  }

  // ---- 兩段式狀態轉移 -------------------------------------------------------

  mark_punched_in(uid: string | null, subtask_id: unknown): void {
    if (!uid) return;
    this.open_keys.set(uid, String(subtask_id));
    this.in_flight_keys.delete(uid);
  }

  mark_oneshot_pending(uid: string | null): void {
    if (!uid) return;
    this.oneshot_keys.add(uid);
    this.in_flight_keys.delete(uid);
  }

  preload(
    done_keys: Set<string>,
    open_map?: Map<string, string> | null,
    open_anchors?: Map<string, OpenAnchor> | null,
  ): void {
    for (const k of done_keys || new Set()) this.punched_keys.add(k);
    if (open_map) {
      for (const [k, v] of open_map) this.open_keys.set(k, v);
    }
    if (open_anchors) {
      for (const [k, v] of open_anchors) this.open_anchors.set(k, v);
    }
  }

  // ---- 退避閘純方法（零 I/O）-----------------------------------------------

  mark_token_defer(uid: string, now: number, delay: number): void {
    this.token_defer.set(uid, now + delay);
    this.in_flight_keys.delete(uid);
  }

  should_skip_for_backoff(uid: string, now: number): boolean {
    const exp = this.token_defer.get(uid);
    return exp !== undefined && now < exp;
  }

  clear_token_defer(uid: string): void {
    this.token_defer.delete(uid);
  }

  // ---- 兩段式決策（純排 action，零 I/O）------------------------------------

  decide_two_phase(
    subagent_events: Record<string, unknown>[],
    main_events: Record<string, unknown>[],
    opts: {
      task_id: unknown;
      assignee_id: unknown;
      session_id: unknown;
      builder: NameBuilder;
      now?: number;
    }
  ): PunchAction[] {
    const { task_id, assignee_id, session_id, builder, now = 0.0 } = opts;
    const actions: PunchAction[] = [];
    const seen = new Set<string>();

    const all_events = [...(subagent_events || []), ...(main_events || [])];
    for (const ev of all_events) {
      const uid = String(ev['punch_uid'] || '');
      if (!uid || seen.has(uid)) continue;
      seen.add(uid);
      if (this.punched_keys.has(uid) || this.in_flight_keys.has(uid)) continue; // 已打 / 在途
      if (this.should_skip_for_backoff(uid, now)) continue; // token 退避窗內

      const complete = Boolean(ev['is_complete']);
      const hours = ceilHours2dp(ev['duration_hours'] || 0.0);
      const name_fallback = (String(ev['output_json_title'] || '').trim() || String(ev['punch_name'] || '') || MAIN_PUNCH_NAME);
      // 描述 fallback
      const out_desc = String(ev['output_json_description'] || '').trim();
      const src_text = String(ev['last_output'] || '').trim();
      let desc_text: string;
      let is_fallback: boolean;
      if (out_desc) {
        desc_text = out_desc;
        is_fallback = false;
      } else if (src_text) {
        desc_text = src_text; // 無 JSON desc 但有原文 → 先用原文，worker 可丟 LLM 補
        is_fallback = true;
      } else {
        desc_text = builder._build_main_description(hours);
        is_fallback = true;
      }
      const base_name = String(ev['punch_name'] || '') || MAIN_PUNCH_NAME;
      const input_prompt = String(ev['input_prompt'] || '');
      // §2.14d D31：本 event 的 Edit/Write 操作（end/oneshot 時隨打卡落 punch_artifacts）。
      const evArtifacts: PunchArtifact[] = Array.isArray(ev['artifacts'])
        ? (ev['artifacts'] as PunchArtifact[])
        : [];

      if (this.open_keys.has(uid)) {
        // 已 punch-in，等該 uid 完成才 punch-out
        if (complete) {
          actions.push(makePunchAction({
            punch_key: uid,
            kind: String(ev['kind'] || ''),
            event_key: uid,
            punch_name: base_name,
            subtask_name: name_fallback,
            description: desc_text,
            task_id,
            assignee_id,
            category_name: base_name,
            start_time: ev['started_at'] ?? null,
            end_time: ev['ended_at'] ?? null,
            duration: hours,
            phase: 'end',
            punch_uid: uid,
            session_id,
            subtask_id: this.open_keys.get(uid) ?? null,
            input_prompt,
            description_is_fallback: is_fallback,
            llm_source_text: src_text,
            artifacts: evArtifacts,
          }));
          this.in_flight_keys.add(uid);
        }
        // 未完成 → 略過（還在跑）
      } else if (this.oneshot_keys.has(uid)) {
        // start 回後端 id=null → 待完成時一次寫齊（oneshot）
        if (complete) {
          actions.push(makePunchAction({
            punch_key: uid,
            kind: String(ev['kind'] || ''),
            event_key: uid,
            punch_name: base_name,
            subtask_name: name_fallback,
            description: desc_text,
            task_id,
            assignee_id,
            category_name: base_name,
            start_time: ev['started_at'] ?? null,
            end_time: ev['ended_at'] ?? null,
            duration: hours,
            phase: 'oneshot',
            punch_uid: uid,
            session_id,
            subtask_id: null,
            input_prompt,
            description_is_fallback: is_fallback,
            llm_source_text: src_text,
            artifacts: evArtifacts,
          }));
          this.in_flight_keys.add(uid);
        }
      } else {
        // 第一次見此 uid
        if (complete) {
          // 補償配對：嘗試將此完成事件配對到已有 open_anchors 中的殭屍 open 列
          const ev_started_at = (ev['started_at'] as string | null | undefined) ?? null;
          const candidates = Array.from(this.open_anchors.entries()).filter(
            ([oldUid, anchor]) =>
              anchor.type === base_name &&
              anchor.started_at === ev_started_at &&
              !this.consumed_open_uids.has(oldUid)
          );

          let matchedOldUid: string | null = null;
          let matchedAnchor: OpenAnchor | null = null;

          if (candidates.length === 1) {
            [matchedOldUid, matchedAnchor] = candidates[0];
          } else if (candidates.length >= 2) {
            // tie-break：name 全等
            const exact = candidates.filter(([, anchor]) => anchor.name === name_fallback);
            if (exact.length === 1) {
              [matchedOldUid, matchedAnchor] = exact[0];
            }
            // 仍歧義（0 或 >=2）→ 放棄配對，走原 oneshot
          }

          if (matchedOldUid !== null && matchedAnchor !== null) {
            // 補償配對成功：排 end action，punch_uid 用舊 uid
            this.consumed_open_uids.add(matchedOldUid);
            this.open_anchors.delete(matchedOldUid);
            // F-Z1：記錄待結算的補償，供 settle 失敗時回滾
            this.pending_absorptions.set(uid, { old_uid: matchedOldUid, anchor: matchedAnchor });
            actions.push(makePunchAction({
              punch_key: matchedOldUid,
              kind: String(ev['kind'] || ''),
              event_key: uid,
              punch_name: base_name,
              subtask_name: name_fallback,
              description: desc_text,
              task_id,
              assignee_id,
              category_name: base_name,
              start_time: ev['started_at'] ?? null,
              end_time: ev['ended_at'] ?? null,
              duration: hours,
              phase: 'end',
              punch_uid: matchedOldUid,
              session_id,
              subtask_id: matchedAnchor.subtask_id,
              input_prompt,
              description_is_fallback: is_fallback,
              llm_source_text: src_text,
              artifacts: evArtifacts,
              absorbed_uid: uid,
            }));
          } else {
            // 無候選或仍歧義 → 原 oneshot 不變
            actions.push(makePunchAction({
              punch_key: uid,
              kind: String(ev['kind'] || ''),
              event_key: uid,
              punch_name: base_name,
              subtask_name: name_fallback,
              description: desc_text,
              task_id,
              assignee_id,
              category_name: base_name,
              start_time: ev['started_at'] ?? null,
              end_time: ev['ended_at'] ?? null,
              duration: hours,
              phase: 'oneshot',
              punch_uid: uid,
              session_id,
              subtask_id: null,
              input_prompt,
              description_is_fallback: is_fallback,
              llm_source_text: src_text,
              artifacts: evArtifacts,
            }));
          }
        } else {
          // 進行中 → punch-in（start，end/duration 待 punch-out 補）
          actions.push(makePunchAction({
            punch_key: uid,
            kind: String(ev['kind'] || ''),
            event_key: uid,
            punch_name: base_name,
            subtask_name: name_fallback,
            description: '',
            task_id,
            assignee_id,
            category_name: base_name,
            start_time: ev['started_at'] ?? null,
            end_time: null,
            duration: 0.0,
            phase: 'start',
            punch_uid: uid,
            session_id,
            subtask_id: null,
            input_prompt,
          }));
        }
        this.in_flight_keys.add(uid);
      }
    }
    return actions;
  }
}
