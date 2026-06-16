/**
 * lexical.spec.ts — Markdown → Lexical 富文本轉換（打卡描述上傳用）。
 *
 * 背景：打卡描述是代理回覆（Markdown 原文）。本地以 textToLexical 逐行存純文字 paragraph，
 *   雲端 Lexical 渲染看不到 Markdown 效果。上傳前以 markdownToLexical 解析成富文本節點
 *   （標題/清單/引用/程式碼/行內粗體斜體刪除線行內碼）；enrichLexicalDescription 串接
 *   「還原原文 → markdownToLexical」供 flush 前升級。
 */

import { describe, it, expect } from 'vitest'
import {
  textToLexical,
  markdownToLexical,
  lexicalLinesToText,
  enrichLexicalDescription,
} from '../src/main/services/lexical'

interface LexNode {
  type: string
  tag?: string
  listType?: string
  start?: number
  format?: number
  text?: string
  value?: number
  language?: string | null
  children?: LexNode[]
}
function parseRoot(json: string): LexNode {
  return (JSON.parse(json) as { root: LexNode }).root
}
/** 收集樹中所有 text 節點（含 format）。 */
function allText(node: LexNode, out: { text: string; format: number }[] = []): {
  text: string
  format: number
}[] {
  if (node.type === 'text') out.push({ text: node.text ?? '', format: node.format ?? 0 })
  for (const c of node.children ?? []) allText(c, out)
  return out
}

describe('markdownToLexical — 區塊', () => {
  it('標題 → heading node 帶 tag', () => {
    const root = parseRoot(markdownToLexical('## 標題文字'))
    const h = root.children![0]
    expect(h.type).toBe('heading')
    expect(h.tag).toBe('h2')
    expect(allText(h)[0].text).toBe('標題文字')
  })

  it('無序清單 → bullet list + listitem', () => {
    const root = parseRoot(markdownToLexical('- 第一\n- 第二'))
    const list = root.children![0]
    expect(list.type).toBe('list')
    expect(list.listType).toBe('bullet')
    expect(list.children).toHaveLength(2)
    expect(list.children![0].type).toBe('listitem')
    expect(list.children![1].value).toBe(2)
    expect(allText(list.children![0])[0].text).toBe('第一')
  })

  it('有序清單 → number list，start 取首項編號', () => {
    const root = parseRoot(markdownToLexical('3. 甲\n4. 乙'))
    const list = root.children![0]
    expect(list.type).toBe('list')
    expect(list.listType).toBe('number')
    expect(list.start).toBe(3)
  })

  it('圍籬程式碼塊 → code node 帶 language', () => {
    const root = parseRoot(markdownToLexical('```ts\nconst a = 1\n```'))
    const code = root.children![0]
    expect(code.type).toBe('code')
    expect(code.language).toBe('ts')
    expect(allText(code)[0].text).toBe('const a = 1')
  })

  it('引用 → quote node', () => {
    const root = parseRoot(markdownToLexical('> 引用一句'))
    expect(root.children![0].type).toBe('quote')
  })

  it('多段純文字 → 多個 paragraph（空行分段）', () => {
    const root = parseRoot(markdownToLexical('第一段\n\n第二段'))
    const paras = root.children!.filter((c) => c.type === 'paragraph')
    expect(paras).toHaveLength(2)
  })
})

describe('markdownToLexical — 行內格式（text format bitmask）', () => {
  it('粗體 **x** → format 含 1', () => {
    const root = parseRoot(markdownToLexical('前 **粗** 後'))
    const bold = allText(root).find((t) => t.text === '粗')
    expect(bold?.format).toBe(1)
  })

  it('行內碼 `x` → format 含 16', () => {
    const root = parseRoot(markdownToLexical('呼叫 `foo()` 函式'))
    const code = allText(root).find((t) => t.text === 'foo()')
    expect(code?.format).toBe(16)
  })

  it('巢狀 **粗 *斜***  → 內層 format = 粗(1)|斜(2)=3', () => {
    const root = parseRoot(markdownToLexical('**粗 *斜* 體**'))
    const inner = allText(root).find((t) => t.text === '斜')
    expect(inner?.format).toBe(3)
  })

  it('snake_case 的底線不被當斜體（intraword 防呆）', () => {
    const root = parseRoot(markdownToLexical('變數 assignee_user_id 名'))
    const joined = allText(root)
      .map((t) => t.text)
      .join('')
    expect(joined).toContain('assignee_user_id')
    // 無任何斜體 format
    expect(allText(root).every((t) => (t.format ?? 0) === 0)).toBe(true)
  })

  it('連結 [text](url) 降級為純文字', () => {
    const root = parseRoot(markdownToLexical('看 [官網](https://x.com) 連結'))
    const joined = allText(root)
      .map((t) => t.text)
      .join('')
    expect(joined).toContain('官網')
    expect(joined).not.toContain('https://x.com')
  })
})

describe('lexicalLinesToText / enrichLexicalDescription — 忠實還原 + 升級', () => {
  it('lexicalLinesToText 還原 textToLexical 的逐行原文', () => {
    const md = '## 標題\n\n- 項目一\n- 項目二'
    expect(lexicalLinesToText(textToLexical(md))).toBe(md)
  })

  it('enrichLexicalDescription 把逐行純文字描述升級為富文本', () => {
    const stored = textToLexical('## 報告\n\n- 完成 A\n- 完成 B')
    const enriched = enrichLexicalDescription(stored)!
    const root = parseRoot(enriched)
    expect(root.children!.some((c) => c.type === 'heading')).toBe(true)
    expect(root.children!.some((c) => c.type === 'list')).toBe(true)
  })

  it('enrichLexicalDescription 對 null / 空字串安全', () => {
    expect(enrichLexicalDescription(null)).toBeNull()
    expect(enrichLexicalDescription('')).toBe('')
  })

  it('markdownToLexical 空字串 → 安全空段落（不拋）', () => {
    const root = parseRoot(markdownToLexical(''))
    expect(root.children![0].type).toBe('paragraph')
  })
})
