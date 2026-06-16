/**
 * buildApplyPrompt.ts — FieldDiff[] → /tuq-agent 自然語言套用 prompt
 * 設計來源：docs/design/agentteams-edit-flow.md §4.6、§6.4
 *
 * 產出的 prompt 只進 /tuq-agent 的 PTY context，**不在 UI 顯示**
 * （Persona Gate M2：/tuq-agent 指令名不可見於任何 UI 元素）。
 */
import type { FieldDiff } from './introDiff'
import { inferSourceFiles } from './inferSourceFiles'

// ---------------------------------------------------------------------------
// 主函式
// ---------------------------------------------------------------------------

/**
 * buildApplyPrompt — 將欄位差異組成自然語言修改需求。
 * 開頭指定目標 agent，逐條列「目前：…／改為：…」並附原始檔提示（§8.2 對應表），
 * 結尾要求依規範同步 introduction.json 並刷新 last_updated。
 */
export function buildApplyPrompt(teamId: string, agentName: string, diffs: FieldDiff[]): string {
  const lines: string[] = []
  lines.push(`/tuq-agent 請依照以下修改需求更新 ${teamId}/${agentName}：`)
  lines.push('')
  diffs.forEach((diff, i) => {
    lines.push(`${i + 1}. ${describeDiff(diff)}`)
  })
  lines.push('')
  lines.push(
    '完成原始檔修改後，請依 agent-introduction.md §5 規範同步該 agent 的 introduction.json（單向回流），並刷新 last_updated 為今天日期。'
  )
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// 單筆差異描述
// ---------------------------------------------------------------------------

function describeDiff(diff: FieldDiff): string {
  const { fieldLabel, fileHint } = inferSourceFiles(diff.field)
  const hint = `（原始檔提示：${fileHint}）`

  switch (diff.kind) {
    case 'string_changed':
      return `「${fieldLabel}」 目前：「${fmt(diff.before)}」／改為：「${fmt(diff.after)}」${hint}`
    case 'array_item_changed':
      return `「${fieldLabel}」第 ${itemNo(diff.index)} 項 目前：「${fmt(diff.before)}」／改為：「${fmt(diff.after)}」${hint}`
    case 'array_item_added':
      return `「${fieldLabel}」新增一項 目前：（無）／改為：「${fmt(diff.after)}」${hint}`
    case 'array_item_removed':
      return `「${fieldLabel}」第 ${itemNo(diff.index)} 項 目前：「${fmt(diff.before)}」／改為：（移除此項）${hint}`
    case 'workflow_scenario_changed':
      return describeWorkflowDiff(diff, fieldLabel, hint)
  }
}

function describeWorkflowDiff(diff: FieldDiff, fieldLabel: string, hint: string): string {
  const scenario = diff.scenario ?? ''
  if (diff.before === undefined) {
    return `「${fieldLabel}」新增情境「${scenario}」 目前：（無此情境）／改為：步驟「${fmt(diff.after)}」${hint}`
  }
  if (diff.after === undefined) {
    return `「${fieldLabel}」情境「${scenario}」 目前：步驟「${fmt(diff.before)}」／改為：（移除此情境）${hint}`
  }
  return `「${fieldLabel}」情境「${scenario}」 目前：步驟「${fmt(diff.before)}」／改為：步驟「${fmt(diff.after)}」${hint}`
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

/** 字串原樣輸出；陣列（workflow steps）以「 → 」串接。 */
function fmt(v: string | string[] | undefined): string {
  if (v === undefined) return ''
  return Array.isArray(v) ? v.join(' → ') : v
}

/** index（0-based）轉「第 N 項」的 N；缺 index 時退回 '?'（不拋錯）。 */
function itemNo(index: number | undefined): string {
  return index === undefined ? '?' : String(index + 1)
}
