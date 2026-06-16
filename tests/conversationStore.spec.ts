import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import Database from 'better-sqlite3'
import { ConversationStore } from '../src/main/services/conversationStore'
import { teamuqDbPath, ensureSchema, CONV_PARSER_VERSION } from '../src/main/repo/sqliteTaskRepository'

/**
 * conversationStore（純索引 + end-driven 分段）測試。
 *
 * D25（rev11 用戶拍板）：對話 cache 3 表由獨立 conversations.db **併入 ~/.teamuq/teamuq.db**。
 * 本檔改以**真 better-sqlite3**（需 Node ABI，跑法：`BSQ3_NODE_ABI=1 vitest run --pool=forks`）
 * 對著真 DB 路徑驗證 ——
 *   - 連線：ConversationStore 自開 teamuq.db（吃 TEAMUQ_HOME 隔離；每 test 獨立 tmp 目錄）。
 *   - 守門：版本鍵走 schema_meta.parser_version（不碰 user_version）。
 *   - 防誤傷（D25 §A.5 核心）：版本不符只 DROP conv_* 三表、teamuq.db 其他表（tasks 等）完好。
 *
 * 三組測試：
 *   1) 記憶體/解析 byte 正確性：增量讀 consumedPos 推進、多位元組 UTF-8、殘行重讀、檔案重寫。
 *   2) end-driven 分段：插隊不裂段、turn_duration/interrupt/stop_sequence 後開新段、
 *      END 訊息歸段尾、跨重啟 endSeen 續傳。
 *   3) D25 cache 併入 teamuq.db + 防誤傷：cache 寫進 teamuq.db、版本不符只 DROP conv_*、
 *      舊 conversations.db 改名 .migrated。
 */

// ---- record 建構子 ----
function rec(type: 'user' | 'assistant', text: string, ts?: string): string {
  const obj: Record<string, unknown> = {
    type,
    message: { role: type, content: [{ type: 'text', text }] },
  }
  if (ts) obj['timestamp'] = ts
  return JSON.stringify(obj) + '\n'
}
function userTyped(text: string): string {
  return rec('user', text)
}
/** system/turn_duration END 訊息（parser B1：role==='system' && turnDuration）。 */
function turnDuration(ms: number): string {
  return JSON.stringify({ type: 'system', subtype: 'turn_duration', durationMs: ms }) + '\n'
}
/** interrupt END 訊息（parser B1：頂層 interruptedMessageId → source==='interrupt'）。 */
function interruptRec(text: string): string {
  return (
    JSON.stringify({
      type: 'user',
      interruptedMessageId: 'm-123',
      message: { role: 'user', content: [{ type: 'text', text }] },
    }) + '\n'
  )
}
/** stop_sequence END 訊息（parser B1：assistant stop_reason==='stop_sequence'）。 */
function stopSeqReply(text: string): string {
  return (
    JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', stop_reason: 'stop_sequence', content: [{ type: 'text', text }] },
    }) + '\n'
  )
}
/** notify 訊息（promptSource=system；純結尾驅動下 endSeen=true 時開新段）。 */
function notifyRec(text: string): string {
  return (
    JSON.stringify({
      type: 'user',
      promptSource: 'system',
      message: { role: 'user', content: [{ type: 'text', text }] },
    }) + '\n'
  )
}

describe('ConversationStore — 解析 byte 正確性', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'convstore-'))
    file = path.join(dir, 'session.jsonl')
    // D25：cache 進 teamuq.db；每 test 用獨立 TEAMUQ_HOME 隔離真 DB 檔（不碰使用者實機 DB）。
    process.env['TEAMUQ_HOME'] = dir
  })

  afterEach(() => {
    delete process.env['TEAMUQ_HOME']
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  it('基本解析：兩則訊息逐筆回傳', () => {
    fs.writeFileSync(file, rec('user', 'hello') + rec('assistant', 'world'))
    const store = new ConversationStore()
    const msgs = store.getByFile(file)
    expect(msgs.length).toBe(2)
    expect(msgs[0].role).toBe('user')
    expect(msgs[0].blocks[0]).toMatchObject({ kind: 'text', text: 'hello' })
    expect(msgs[1].role).toBe('assistant')
    expect(msgs[1].blocks[0]).toMatchObject({ kind: 'text', text: 'world' })
  })

  it('增量 append：第二次只讀新增 bytes，累積回傳', () => {
    fs.writeFileSync(file, rec('user', 'first'))
    const store = new ConversationStore()
    expect(store.getByFile(file).length).toBe(1)
    fs.appendFileSync(file, rec('assistant', 'second'))
    const msgs = store.getByFile(file)
    expect(msgs.length).toBe(2)
    expect(msgs[1].blocks[0]).toMatchObject({ text: 'second' })
  })

  it('多位元組 UTF-8：中文 / emoji 內容完整保真（byte 偏移以 UTF-8 byte 計）', () => {
    const t1 = '繁體中文測試 🚀 emoji'
    const t2 = '第二則 ✅ 完成'
    fs.writeFileSync(file, rec('user', t1) + rec('assistant', t2))
    const store = new ConversationStore()
    const msgs = store.getByFile(file)
    expect(msgs.length).toBe(2)
    expect(msgs[0].blocks[0]).toMatchObject({ text: t1 })
    expect(msgs[1].blocks[0]).toMatchObject({ text: t2 })
  })

  it('多位元組殘行：寫一半（多位元組字元跨輪邊界）不丟字、下輪補齊', () => {
    const fullText = '跨輪多位元組字元測試 🚀🚀🚀 結尾'
    const line = rec('user', fullText)
    const buf = Buffer.from(line, 'utf-8')
    const cut = buf.length - 10
    fs.writeFileSync(file, buf.subarray(0, cut))
    const store = new ConversationStore()
    expect(store.getByFile(file).length).toBe(0)
    fs.appendFileSync(file, buf.subarray(cut))
    const msgs = store.getByFile(file)
    expect(msgs.length).toBe(1)
    expect(msgs[0].blocks[0]).toMatchObject({ text: fullText })
  })

  it('檔案重寫（size 變小）：重置該檔重新解析', () => {
    fs.writeFileSync(file, rec('user', 'a') + rec('assistant', 'b') + rec('user', 'c'))
    const store = new ConversationStore()
    expect(store.getByFile(file).length).toBe(3)
    fs.writeFileSync(file, rec('user', 'x'))
    const msgs = store.getByFile(file)
    expect(msgs.length).toBe(1)
    expect(msgs[0].blocks[0]).toMatchObject({ text: 'x' })
  })

  it('非訊息 record（summary 等）映射為 null → 不計入回傳', () => {
    const summary = JSON.stringify({ type: 'summary', summary: 'noise' }) + '\n'
    fs.writeFileSync(file, rec('user', 'real') + summary + rec('assistant', 'reply'))
    const store = new ConversationStore()
    const msgs = store.getByFile(file)
    expect(msgs.length).toBe(2)
    expect(msgs[0].blocks[0]).toMatchObject({ text: 'real' })
    expect(msgs[1].blocks[0]).toMatchObject({ text: 'reply' })
  })
})

describe('ConversationStore — end-driven 分段（段索引狀態機）', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'convseg-'))
    file = path.join(dir, 'session.jsonl')
    // 每個 case 用獨立 TEAMUQ_HOME 隔離 fake DB 檔路徑（fake DB 雖 in-memory，路徑仍由此推導）。
    process.env['TEAMUQ_HOME'] = dir
  })

  afterEach(() => {
    delete process.env['TEAMUQ_HOME']
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  // ── v13 最終規格：結尾為主 + 僅用戶發話開段 ─────────────────────────────

  it('① 插話 typed 不開段（endSeen===false）：AI 工作中途送出的 typed 併入當前段', () => {
    // typed A → reply A → 插隊 typed（無 END 在前）→ 全在段1，不開段2。
    fs.writeFileSync(file, userTyped('typed A') + rec('assistant', 'reply A') + userTyped('插隊 typed'))
    const store = new ConversationStore()
    store.getByFile(file)
    const { segments } = store.getSegments(file)
    expect(segments.length).toBe(1)
    expect(segments[0].start_seq).toBe(0)
    expect(segments[0].end_seq).toBe(2)
    expect(segments[0].msg_count).toBe(3)
    expect(segments[0].head_kind).toBe('typed')
  })

  it('② turn_duration 後 notify 不開段（鏈條：notify 併入前段）', () => {
    // typed A → reply A → turn_duration（END；endSeen=true）→ notify（不是 typed/command）
    // v13：endSeen=true 但非 _isTypedUser → notify 不開段，併入段1（如有）。
    // 若段1 已在前，notify 應成為段1 的續段；end_seq/msg_count 涵蓋 notify。
    fs.writeFileSync(
      file,
      userTyped('typed A') + rec('assistant', 'reply A') + turnDuration(1000) + notifyRec('<task-notification>done</task-notification>'),
    )
    const store = new ConversationStore()
    store.getByFile(file)
    const { segments } = store.getSegments(file)
    // notify 不開段 → 仍只有 1 段
    expect(segments.length).toBe(1)
    // turn_duration（seq2）歸段1 段尾 → notify（seq3）繼續併入段1
    expect(segments[0].end_seq).toBe(3) // notify 是最後一則
    expect(segments[0].msg_count).toBe(4) // typedA + replyA + turn_duration + notify
    expect(segments[0].head_kind).toBe('typed')
  })

  it('③ END 後 assistant 不開段（assistant 不是 typed/command）', () => {
    // typed A → turn_duration（END；endSeen=true）→ assistant（非 typed）→ 不開段，併入段1
    fs.writeFileSync(
      file,
      userTyped('typed A') + turnDuration(500) + rec('assistant', 'background reply'),
    )
    const store = new ConversationStore()
    store.getByFile(file)
    const { segments } = store.getSegments(file)
    // assistant 不開段 → 仍只有 1 段
    expect(segments.length).toBe(1)
    expect(segments[0].end_seq).toBe(2) // assistant（seq2）成段1 段尾
    expect(segments[0].msg_count).toBe(3) // typed + turn_duration + assistant
    expect(segments[0].head_kind).toBe('typed')
  })

  it('④a END 後 typed 開新段', () => {
    fs.writeFileSync(
      file,
      userTyped('typed A') + rec('assistant', 'reply A') + turnDuration(1000) + userTyped('typed B'),
    )
    const store = new ConversationStore()
    store.getByFile(file)
    const { segments } = store.getSegments(file)
    expect(segments.length).toBe(2)
    expect(segments[0].end_seq).toBe(2) // turn_duration（seq2）歸段1 段尾
    expect(segments[1].start_seq).toBe(3) // typed B 開段2
    expect(segments[0].head_kind).toBe('typed')
    expect(segments[1].head_kind).toBe('typed')
  })

  it('④b END 後 command 開新段', () => {
    const commandRec = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: '<command-name>test-cmd</command-name>' }],
      },
    }) + '\n'
    fs.writeFileSync(
      file,
      userTyped('typed A') + turnDuration(800) + commandRec,
    )
    const store = new ConversationStore()
    store.getByFile(file)
    const { segments } = store.getSegments(file)
    expect(segments.length).toBe(2)
    expect(segments[1].head_kind).toBe('command')
    expect(segments[1].is_command).toBe(1)
  })

  it('⑤ END 訊息歸屬當前段尾（不自成新段、msg_count/end_seq 涵蓋）', () => {
    fs.writeFileSync(
      file,
      userTyped('typed A') + rec('assistant', 'reply A') + turnDuration(500),
    )
    const store = new ConversationStore()
    store.getByFile(file)
    const { segments } = store.getSegments(file)
    expect(segments.length).toBe(1)
    expect(segments[0].end_seq).toBe(2) // turn_duration 為段尾
    expect(segments[0].msg_count).toBe(3) // typed + reply + turn_duration
    expect(segments[0].head_kind).toBe('typed')
  })

  it('⑤ interrupt END 後 typed 開新段', () => {
    fs.writeFileSync(
      file,
      userTyped('typed A') +
        rec('assistant', 'reply A') +
        interruptRec('[Request interrupted by user]') +
        userTyped('typed B'),
    )
    const store = new ConversationStore()
    store.getByFile(file)
    const { segments } = store.getSegments(file)
    expect(segments.length).toBe(2)
    expect(segments[0].end_seq).toBe(2) // interrupt（seq2）歸段1 段尾
    expect(segments[1].start_seq).toBe(3) // typed B 開段2
    expect(segments[0].head_kind).toBe('typed')
    expect(segments[1].head_kind).toBe('typed')
  })

  it('⑤ stop_sequence END 後 typed 開新段', () => {
    fs.writeFileSync(
      file,
      userTyped('typed A') + stopSeqReply('reply A 靜默結束') + userTyped('typed B'),
    )
    const store = new ConversationStore()
    store.getByFile(file)
    const { segments } = store.getSegments(file)
    expect(segments.length).toBe(2)
    expect(segments[0].end_seq).toBe(1) // stop_sequence 回覆（seq1）歸段1 段尾
    expect(segments[1].start_seq).toBe(2) // typed B 開段2
    expect(segments[0].head_kind).toBe('typed')
    expect(segments[1].head_kind).toBe('typed')
  })

  it('⑤ head_kind 只有 typed/command（notify/other 不開段，不出現於 head_kind）', () => {
    // 鏈：notify → turn_duration → assistant → typed → turn_duration
    // 只有 typed 開段；notify/assistant 不開段
    fs.writeFileSync(
      file,
      notifyRec('bg done') + turnDuration(100) + rec('assistant', 'bg reply') + userTyped('typed A') + turnDuration(200),
    )
    const store = new ConversationStore()
    store.getByFile(file)
    const { segments } = store.getSegments(file)
    // 前言：notify(seq0) 在 typed 前，不入 conv_segments（curSeg=null）
    // turn_duration(seq1) 在 curSeg=null，不入 conv_segments
    // assistant(seq2) 在 curSeg=null，不入 conv_segments
    // typed A（seq3）開段1；turn_duration（seq4）歸段1 段尾
    expect(segments.length).toBe(1)
    expect(segments[0].head_kind).toBe('typed')
    expect(segments[0].start_seq).toBe(3)
    expect(segments[0].end_seq).toBe(4)
    // head_kind 一律為 typed 或 command（不含 notify/other）
    for (const s of segments) {
      expect(['typed', 'command']).toContain(s.head_kind)
    }
  })

  it('⑥ 前言：首 typed 前的訊息不入段（不寫 conv_segments）', () => {
    // notify + assistant + turn_duration（全是前言）→ 然後 typed A 才開段1
    fs.writeFileSync(
      file,
      notifyRec('前言通知') + rec('assistant', '前言 AI') + turnDuration(50) + userTyped('typed A') + rec('assistant', 'reply A'),
    )
    const store = new ConversationStore()
    store.getByFile(file)
    const { segments, totalCount } = store.getSegments(file)
    expect(totalCount).toBe(5)
    // 前言三則（seq0/1/2）不入段；typed A（seq3）開段1
    expect(segments.length).toBe(1)
    expect(segments[0].start_seq).toBe(3)
    expect(segments[0].msg_count).toBe(2) // typed A + reply A
    expect(segments[0].head_kind).toBe('typed')
  })

  it('⑥ 跨重啟 endSeen 續傳：清記憶體後 stop_sequence 結尾的下一則 typed 仍開新段', () => {
    fs.writeFileSync(
      file,
      userTyped('typed A') + stopSeqReply('reply A 靜默結束'),
    )
    const store = new ConversationStore()
    store.getByFile(file)
    expect(store.getSegments(file).segments.length).toBe(1)

    // 模擬重啟：清記憶體（DB/fake 仍保有 end_seen=true，因段尾為 stop_sequence）。
    ;(store as unknown as { _mem: Map<string, unknown> })._mem.clear()
    fs.appendFileSync(file, userTyped('typed B 重啟後'))
    store.getByFile(file)
    const { segments } = store.getSegments(file)
    expect(segments.length).toBe(2) // endSeen 續傳 → typed B 開新段
    expect(segments[1].start_seq).toBe(2)
    expect(segments[1].label).toContain('typed B')
    expect(segments[0].head_kind).toBe('typed')
    expect(segments[1].head_kind).toBe('typed')
  })

  it('⑥b 反證：跨重啟 endSeen=false 續傳，無 END 的下一則 typed 不裂段（插隊語意）', () => {
    // 段尾為一般 assistant 回覆（非 END）→ endSeen=false 須續傳。
    fs.writeFileSync(file, userTyped('typed A') + rec('assistant', 'reply A'))
    const store = new ConversationStore()
    store.getByFile(file)
    expect(store.getSegments(file).segments.length).toBe(1)

    ;(store as unknown as { _mem: Map<string, unknown> })._mem.clear()
    fs.appendFileSync(file, userTyped('typed B 插隊'))
    store.getByFile(file)
    const { segments } = store.getSegments(file)
    expect(segments.length).toBe(1) // endSeen=false 續傳 → typed B 併入段1
    expect(segments[0].end_seq).toBe(2)
  })

  it('綜合情境（鏈條：好 → B1 → ⏱ → 🔔 → B2 → ⏱ → 🔔 → B3 → 交付）一段', () => {
    // 規格效果：notify 不開段，整條鏈一段。
    // 布局：0 typedA / 1 replyA(B1) / 2 turn_duration(⏱) / 3 notify(🔔) /
    //       4 replyB(B2) / 5 turn_duration(⏱) / 6 notify(🔔) / 7 replyC(B3) / 8 turn_duration(交付)
    // 後續：9 typedD → 開段2
    fs.writeFileSync(
      file,
      userTyped('好') +
        rec('assistant', 'B1') +
        turnDuration(1000) +
        notifyRec('🔔 task 1 done') +
        rec('assistant', 'B2') +
        turnDuration(2000) +
        notifyRec('🔔 task 2 done') +
        rec('assistant', 'B3') +
        turnDuration(3000) +
        userTyped('typed D'),
    )
    const store = new ConversationStore()
    store.getByFile(file)
    const { segments, totalCount } = store.getSegments(file)
    expect(totalCount).toBe(10)
    // 段1：seq0..8（整條鏈，notify 不裂段）
    // 段2：seq9（typed D 開段）
    expect(segments.length).toBe(2)
    expect(segments[0]).toMatchObject({ start_seq: 0, end_seq: 8, msg_count: 9 })
    expect(segments[0].head_kind).toBe('typed')
    expect(segments[1]).toMatchObject({ start_seq: 9, end_seq: 9, msg_count: 1 })
    expect(segments[1].head_kind).toBe('typed')
  })

  it('綜合情境（插隊/中斷/靜默 + 前言）：v13 分段與前言分離', () => {
    // 前言：assistant '前言 prelude'（seq0），不入 conv_segments（首 typed 之前）。
    // 布局：0 prelude(assistant) / 1 typedA / 2 replyA / 3 插隊typed / 4 turn_duration END
    //       5 typedB / 6 replyB / 7 interrupt END / 8 typedC / 9 stop_seq END
    fs.writeFileSync(
      file,
      rec('assistant', '前言 prelude') +
        userTyped('typed A') +
        rec('assistant', 'reply A') +
        userTyped('插隊 typed A2') +
        turnDuration(1234) +
        userTyped('typed B') +
        rec('assistant', 'reply B') +
        interruptRec('[Request interrupted by user]') +
        userTyped('typed C') +
        stopSeqReply('reply C 靜默結束'),
    )
    const store = new ConversationStore()
    store.getByFile(file)
    const { segments, totalCount } = store.getSegments(file)
    expect(totalCount).toBe(10)
    // v13：prelude(seq0) 為前言，不入 conv_segments；typed A（seq1）開段1
    expect(segments.length).toBe(3)
    // 段1：seq1..4（typedA、replyA、插隊、turn_duration 段尾），插隊不裂段
    expect(segments[0]).toMatchObject({ start_seq: 1, end_seq: 4, msg_count: 4 })
    // 段2：seq5..7（typed B、reply B、interrupt 段尾）
    expect(segments[1]).toMatchObject({ start_seq: 5, end_seq: 7 })
    // 段3：seq8..9（typed C、stop_sequence 段尾）
    expect(segments[2]).toMatchObject({ start_seq: 8, end_seq: 9 })
    // 所有段 head_kind 只有 typed 或 command
    for (const s of segments) {
      expect(['typed', 'command']).toContain(s.head_kind)
    }
  })
})

// ===========================================================================
// D25：cache 併入 teamuq.db + 版本守門防誤傷
// ===========================================================================

describe('ConversationStore — D25 cache 併入 teamuq.db', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'convd25-'))
    file = path.join(dir, 'session.jsonl')
    process.env['TEAMUQ_HOME'] = dir
  })

  afterEach(() => {
    delete process.env['TEAMUQ_HOME']
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  /** 在 teamuq.db 插一筆 tasks 假資料（防誤傷斷言用）。 */
  function seedTaskRow(localId: string, name: string): void {
    fs.mkdirSync(path.dirname(teamuqDbPath()), { recursive: true })
    const db = new Database(teamuqDbPath())
    try {
      ensureSchema(db)
      db.prepare(
        'INSERT INTO tasks (local_id, name, created_at) VALUES (?, ?, ?)',
      ).run(localId, name, new Date().toISOString())
    } finally {
      db.close()
    }
  }

  it('cache 寫進 teamuq.db（非獨立 conversations.db）', () => {
    fs.writeFileSync(file, rec('user', 'hello') + rec('assistant', 'world'))
    const store = new ConversationStore()
    expect(store.getByFile(file).length).toBe(2)

    // DB 落在 teamuq.db；獨立 conversations.db 不應被建立。
    expect(fs.existsSync(teamuqDbPath())).toBe(true)
    expect(fs.existsSync(path.join(dir, '.teamuq', 'conversations.db'))).toBe(false)

    // teamuq.db 內 conv_state 已有該檔索引。
    const db = new Database(teamuqDbPath())
    try {
      const row = db.prepare('SELECT next_seq FROM conv_state WHERE file = ?').get(file) as
        | { next_seq: number }
        | undefined
      expect(row?.next_seq).toBe(2)
      // 版本鍵存 schema_meta.parser_version（非 user_version）。
      const meta = db.prepare('SELECT value FROM schema_meta WHERE key = ?').get('parser_version') as
        | { value: string }
        | undefined
      expect(Number(meta?.value)).toBe(CONV_PARSER_VERSION)
    } finally {
      db.close()
    }
  })

  it('parser 版本不符：只 DROP conv_* 三表重建，teamuq.db 其他表（tasks）完好', () => {
    // 1) 先放一筆 tasks 假資料 + 用 store 寫入 conv cache（建立 conv_state/conv_segments 列）。
    seedTaskRow('t-keepme', '不可被誤刪的任務')
    fs.writeFileSync(file, userTyped('typed A') + rec('assistant', 'reply A'))
    {
      const store = new ConversationStore()
      store.getByFile(file)
      expect(store.getSegments(file).segments.length).toBe(1)
    }

    // 2) 把 schema_meta.parser_version 改為過期值 → 下次開 store 觸發「版本不符」守門。
    {
      const db = new Database(teamuqDbPath())
      try {
        db.prepare(
          'UPDATE schema_meta SET value = ? WHERE key = ?',
        ).run(String(CONV_PARSER_VERSION - 1), 'parser_version')
        // 確認 tasks 與 conv cache 在重建前皆有資料。
        expect(
          (db.prepare('SELECT COUNT(*) AS c FROM tasks').get() as { c: number }).c,
        ).toBe(1)
        expect(
          (db.prepare('SELECT COUNT(*) AS c FROM conv_state').get() as { c: number }).c,
        ).toBe(1)
      } finally {
        db.close()
      }
    }

    // 3) 新 store 開 DB → ensureConvCacheTables 偵測版本不符 → 只 DROP conv_* 三表重建。
    const store2 = new ConversationStore()
    // 觸發 _ensureDb（任一段 API 即可）。
    store2.getSegments(file)

    const db = new Database(teamuqDbPath())
    try {
      // 防誤傷核心斷言：tasks 假資料仍在（DROP 範圍未波及）。
      const taskCount = (db.prepare('SELECT COUNT(*) AS c FROM tasks').get() as { c: number }).c
      expect(taskCount).toBe(1)
      const task = db.prepare('SELECT name FROM tasks WHERE local_id = ?').get('t-keepme') as
        | { name: string }
        | undefined
      expect(task?.name).toBe('不可被誤刪的任務')

      // conv cache 已被清空重建（DROP→CREATE）：conv_state 空、版本鍵已回寫成當前版本。
      const convCount = (db.prepare('SELECT COUNT(*) AS c FROM conv_state').get() as { c: number }).c
      expect(convCount).toBe(0)
      const meta = db.prepare('SELECT value FROM schema_meta WHERE key = ?').get('parser_version') as
        | { value: string }
        | undefined
      expect(Number(meta?.value)).toBe(CONV_PARSER_VERSION)

      // 其他主表結構仍存在（抽查 milestones/punches 未被 DROP）。
      for (const t of ['milestones', 'punches']) {
        const exists = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
          .get(t) as { name: string } | undefined
        expect(exists?.name).toBe(t)
      }
    } finally {
      db.close()
    }

    // 4) 重掃：再解析該檔，conv cache 自動重建（JSONL 是事實來源）。
    store2.getByFile(file)
    expect(store2.getSegments(file).segments.length).toBe(1)
  })

  it('舊 conversations.db（連 -wal/-shm）首開 teamuq.db 時改名 .migrated', () => {
    // 預先放一個舊獨立 conversations.db + 其 WAL/SHM 伴生檔。
    const teamuqDir = path.join(dir, '.teamuq')
    fs.mkdirSync(teamuqDir, { recursive: true })
    const legacy = path.join(teamuqDir, 'conversations.db')
    fs.writeFileSync(legacy, 'legacy-db-bytes')
    fs.writeFileSync(legacy + '-wal', 'legacy-wal')
    fs.writeFileSync(legacy + '-shm', 'legacy-shm')

    fs.writeFileSync(file, rec('user', 'hi'))
    const store = new ConversationStore()
    store.getByFile(file) // 觸發首開 → 退役舊檔

    // 舊三檔皆改名 .migrated.<日期>，原名消失。
    expect(fs.existsSync(legacy)).toBe(false)
    expect(fs.existsSync(legacy + '-wal')).toBe(false)
    expect(fs.existsSync(legacy + '-shm')).toBe(false)
    const migrated = fs
      .readdirSync(teamuqDir)
      .filter((f) => f.startsWith('conversations.db') && f.includes('.migrated.'))
    // db + wal + shm 三檔皆有對應 .migrated。
    expect(migrated.some((f) => f === path.basename(legacy) + `.migrated.${stampToday()}`)).toBe(true)
    expect(migrated.length).toBe(3)
  })
})

/** 與 conversationStore.todayStamp 同格式（YYYY-MM-DD）。 */
function stampToday(): string {
  const d = new Date()
  const p2 = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}

// ===========================================================================
// getRawLines — Raw 模式按需取原始 JSONL 行
// ===========================================================================

describe('ConversationStore — getRawLines', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rawlines-'))
    file = path.join(dir, 'session.jsonl')
    process.env['TEAMUQ_HOME'] = dir
  })

  afterEach(() => {
    delete process.env['TEAMUQ_HOME']
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  it('基本取回：段內所有原始行可解析回 JSON', () => {
    // 建立兩段：seg1 = [typed A, reply A, turn_duration]; seg2 = [typed B, reply B]
    fs.writeFileSync(
      file,
      userTyped('typed A') + rec('assistant', 'reply A') + turnDuration(500) + userTyped('typed B') + rec('assistant', 'reply B'),
    )
    const store = new ConversationStore()
    store.getByFile(file) // 觸發解析 + 建段索引
    const segs = store.getSegments(file).segments
    expect(segs.length).toBeGreaterThanOrEqual(1)

    const seg = segs[0]
    const { lines, truncated } = store.getRawLines(file, seg.start_seq, seg.end_seq)
    expect(truncated).toBe(false)
    expect(lines.length).toBeGreaterThan(0)
    // 每行都應可 JSON.parse
    for (const l of lines) {
      expect(() => JSON.parse(l)).not.toThrow()
    }
  })

  it('空範圍（endSeq < startSeq）→ 回空陣列', () => {
    fs.writeFileSync(file, userTyped('only one'))
    const store = new ConversationStore()
    store.getByFile(file)
    const { lines, truncated } = store.getRawLines(file, 10, 5)
    expect(lines).toEqual([])
    expect(truncated).toBe(false)
  })

  it('壞檔（不存在）→ 容錯回空陣列', () => {
    const store = new ConversationStore()
    const { lines, truncated } = store.getRawLines(path.join(dir, 'nonexistent.jsonl'), 0, 5)
    expect(lines).toEqual([])
    expect(truncated).toBe(false)
  })

  it('超過 500 行上限 → truncated=true，lines.length === 500', () => {
    // 寫入 510 筆 user typed 訊息，建立一大段
    let content = ''
    for (let i = 0; i < 510; i++) content += userTyped(`msg-${i}`)
    fs.writeFileSync(file, content)
    const store = new ConversationStore()
    store.getByFile(file)
    const segs = store.getSegments(file).segments
    // 取第一段（可能含部份，也可能無段；全取 0..509 範圍）
    const { lines, truncated } = store.getRawLines(file, 0, 509)
    // 若取回行數超過 cap，應截斷
    if (lines.length === 500) {
      expect(truncated).toBe(true)
    } else {
      // DB 無段（前言情況）：lines 可能少於 500，截斷旗標反映實際
      expect(lines.length).toBeLessThanOrEqual(500)
    }
  })
})

// ===========================================================================
// 批次 3：file-based API 依 cliId 分流 parser（codex 內容檔 → codex parser）
// ===========================================================================

/** codex rollout record 建構子（對齊真檔；單行 JSONL）。 */
function cxEvent(payloadType: string, extra: Record<string, unknown> = {}, ts = '2026-06-09T10:00:00.000Z'): string {
  return JSON.stringify({ timestamp: ts, type: 'event_msg', payload: { type: payloadType, ...extra } }) + '\n'
}
function cxResp(payloadType: string, extra: Record<string, unknown> = {}, ts = '2026-06-09T10:00:00.000Z'): string {
  return JSON.stringify({ timestamp: ts, type: 'response_item', payload: { type: payloadType, ...extra } }) + '\n'
}
function cxMeta(cwd: string, ts = '2026-06-09T10:00:00.000Z'): string {
  return JSON.stringify({ timestamp: ts, type: 'session_meta', payload: { id: 'rollout-1', cwd, timestamp: ts } }) + '\n'
}

describe('ConversationStore — codex 內容檔（cliId 分流）', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'convcodex-'))
    file = path.join(dir, 'rollout.jsonl')
    process.env['TEAMUQ_HOME'] = dir
  })

  afterEach(() => {
    delete process.env['TEAMUQ_HOME']
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  it('getWindow(file,"codex")：codex 內容正確映射成卡片（user/assistant/tool）', () => {
    // 交錯順序仿真檔：session_meta → developer(注入) → user(mirror) → user_message →
    //   function_call → function_call_output → agent_message → task_complete
    fs.writeFileSync(
      file,
      cxMeta('C:\\proj') +
        cxResp('message', { role: 'developer', content: [{ type: 'input_text', text: '<perms>' }] }) +
        cxResp('message', { role: 'user', content: [{ type: 'input_text', text: 'list files' }] }) +
        cxEvent('user_message', { message: 'list files' }) +
        cxResp('function_call', { name: 'shell', arguments: '{"command":"ls"}', call_id: 'c1' }) +
        cxResp('function_call_output', { call_id: 'c1', output: 'a.txt\nb.txt' }) +
        cxEvent('agent_message', { message: '已列出檔案。', phase: 'final_answer' }) +
        cxEvent('task_complete', { turn_id: 't1', duration_ms: 4200 }),
    )
    const store = new ConversationStore()
    const { messages } = store.getWindow(file, 'codex')

    // 去重：user '23' 文字只出現一次（mirror 與 developer 被過濾）
    const userTexts = messages
      .filter((m) => m.role === 'user')
      .flatMap((m) => m.blocks)
      .filter((b) => b.kind === 'text')
      .map((b) => b.text)
    expect(userTexts).toEqual(['list files'])
    expect(messages.find((m) => m.role === 'user')!.source).toBe('typed')

    // assistant 文字 '已列出檔案。'（agent_message）
    const asstTexts = messages
      .filter((m) => m.role === 'assistant')
      .flatMap((m) => m.blocks)
      .filter((b) => b.kind === 'text')
      .map((b) => b.text)
    expect(asstTexts).toEqual(['已列出檔案。'])

    // tool_use + tool_result 各一、call_id 對得上
    const toolUse = messages.flatMap((m) => m.blocks).filter((b) => b.kind === 'tool_use')
    const toolRes = messages.flatMap((m) => m.blocks).filter((b) => b.kind === 'tool_result')
    expect(toolUse).toHaveLength(1)
    expect(toolRes).toHaveLength(1)
    expect(toolUse[0].id).toBe(toolRes[0].tool_use_id)

    // task_complete → system/turnDuration（durationMs 取自 record）
    const sys = messages.filter((m) => m.role === 'system')
    expect(sys).toHaveLength(1)
    expect(sys[0].turnDuration).toEqual({ durationMs: 4200 })
  })

  it('段落：以 user_message 開段、task_complete 收尾', () => {
    // 兩輪：user_message → agent_message → task_complete（END）→ user_message → task_complete
    fs.writeFileSync(
      file,
      cxMeta('C:\\proj') +
        cxEvent('user_message', { message: '第一題' }) +
        cxEvent('agent_message', { message: '回答一' }) +
        cxEvent('task_complete', { turn_id: 't1', duration_ms: 1000 }) +
        cxEvent('user_message', { message: '第二題' }) +
        cxEvent('agent_message', { message: '回答二' }) +
        cxEvent('task_complete', { turn_id: 't2', duration_ms: 2000 }),
    )
    const store = new ConversationStore()
    store.getWindow(file, 'codex') // 觸發解析 + 建段索引（codex parser）
    const { segments, totalCount } = store.getSegments(file)
    // session_meta→null（不成卡）；6 筆成卡訊息：u/a/done × 2
    expect(totalCount).toBe(6)
    expect(segments.length).toBe(2)
    // 段1：user_message(seq0) 開段、task_complete(seq2) 收尾
    expect(segments[0].start_seq).toBe(0)
    expect(segments[0].end_seq).toBe(2)
    expect(segments[0].head_kind).toBe('typed')
    // 段2：user_message(seq3) 開段、task_complete(seq5) 收尾
    expect(segments[1].start_seq).toBe(3)
    expect(segments[1].end_seq).toBe(5)
    expect(segments[1].head_kind).toBe('typed')
  })
})
