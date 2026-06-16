/**
 * introDiff.ts — introduction 草稿欄位級比對純函式
 * 設計來源：docs/design/agentteams-edit-flow.md §4.5、§6.4
 *
 * 純 TS，無 React/DOM 依賴，不引入外部 diff 函式庫。
 * 唯讀欄位（id/display_name/team/role/reports_to/last_updated）不參與比對。
 */
import type { AgentIntroduction } from '../../../shared/ipcContracts'

// ---------------------------------------------------------------------------
// 型別定義
// ---------------------------------------------------------------------------

/** 差異種類聯合字串。 */
export type FieldDiffKind =
  | 'string_changed'
  | 'array_item_added'
  | 'array_item_removed'
  | 'array_item_changed'
  | 'workflow_scenario_changed'

/** 可編輯的字串欄位（§4.2 textarea 控件）。 */
export type DiffableStringField = 'summary' | 'when_to_use' | 'not_for' | 'inputs' | 'outputs'

/** 可編輯的陣列欄位（§4.2 pill 標籤控件）。 */
export type DiffableArrayField = 'capabilities' | 'manages' | 'callable_by' | 'flags'

/** 所有參與比對的欄位。 */
export type DiffableField = DiffableStringField | DiffableArrayField | 'workflows'

/**
 * 單筆欄位差異。
 * field 為 introduction.json 欄位鍵名——內部識別用，**不可直接顯示於 UI**
 * （白話標籤請經 inferSourceFiles(field).fieldLabel 轉換，見 Persona Gate §5）。
 */
export interface FieldDiff {
  kind: FieldDiffKind
  field: DiffableField
  /** 陣列欄位元素位置（added → draft 內 index；removed/changed → base 內 index）。 */
  index?: number
  /** workflows 專用：情境文字（以 scenario 為鍵比對）。 */
  scenario?: string
  /** 修改前內容（新增項無此欄）。 */
  before?: string | string[]
  /** 修改後內容（刪除項無此欄）。 */
  after?: string | string[]
}

// ---------------------------------------------------------------------------
// 欄位清單
// ---------------------------------------------------------------------------

const STRING_FIELDS: DiffableStringField[] = ['summary', 'when_to_use', 'not_for', 'inputs', 'outputs']
const ARRAY_FIELDS: DiffableArrayField[] = ['capabilities', 'manages', 'callable_by', 'flags']

// ---------------------------------------------------------------------------
// 主函式
// ---------------------------------------------------------------------------

/**
 * diffIntroduction — base（原 introduction.json）vs draft（草稿）欄位級比對。
 * 缺欄一律視為空值（字串 ''、陣列 []），容忍 AgentIntroduction 全欄位 optional。
 */
export function diffIntroduction(base: AgentIntroduction, draft: AgentIntroduction): FieldDiff[] {
  const diffs: FieldDiff[] = []

  for (const field of STRING_FIELDS) {
    const before = base[field] ?? ''
    const after = draft[field] ?? ''
    if (before !== after) diffs.push({ kind: 'string_changed', field, before, after })
  }

  for (const field of ARRAY_FIELDS) {
    diffs.push(...diffArrayField(field, base[field] ?? [], draft[field] ?? []))
  }

  diffs.push(...diffWorkflows(base.workflows ?? [], draft.workflows ?? []))

  return diffs
}

// ---------------------------------------------------------------------------
// 陣列欄位比對
// ---------------------------------------------------------------------------

/**
 * 逐元素比對（§4.5）：
 * 1. 先以值做多重集合配對，雙方都有的值視為未變動（純排序變動不產生差異）
 * 2. 配對剩餘的 base 項（消失值）與 draft 項（新出現值）依序兩兩配成 array_item_changed
 * 3. 落單者分別為 array_item_removed / array_item_added
 */
function diffArrayField(field: DiffableArrayField, baseArr: string[], draftArr: string[]): FieldDiff[] {
  const draftUsed: boolean[] = new Array(draftArr.length).fill(false)

  const removed: { index: number; value: string }[] = []
  for (let i = 0; i < baseArr.length; i++) {
    const j = draftArr.findIndex((v, k) => !draftUsed[k] && v === baseArr[i])
    if (j >= 0) draftUsed[j] = true
    else removed.push({ index: i, value: baseArr[i] })
  }

  const added: { index: number; value: string }[] = []
  for (let j = 0; j < draftArr.length; j++) {
    if (!draftUsed[j]) added.push({ index: j, value: draftArr[j] })
  }

  const diffs: FieldDiff[] = []
  const pairCount = Math.min(removed.length, added.length)
  for (let k = 0; k < pairCount; k++) {
    diffs.push({
      kind: 'array_item_changed',
      field,
      index: removed[k].index,
      before: removed[k].value,
      after: added[k].value,
    })
  }
  for (let k = pairCount; k < removed.length; k++) {
    diffs.push({ kind: 'array_item_removed', field, index: removed[k].index, before: removed[k].value })
  }
  for (let k = pairCount; k < added.length; k++) {
    diffs.push({ kind: 'array_item_added', field, index: added[k].index, after: added[k].value })
  }
  return diffs
}

// ---------------------------------------------------------------------------
// workflows 比對（以 scenario 為鍵，§4.5）
// ---------------------------------------------------------------------------

type Workflow = { scenario: string; steps: string[] }

/**
 * 情境新增（before 缺）、情境刪除（after 缺）、steps 變動（before/after 皆有）
 * 三者統一回報 workflow_scenario_changed，以 before/after 是否存在區分。
 */
function diffWorkflows(baseWf: Workflow[], draftWf: Workflow[]): FieldDiff[] {
  const diffs: FieldDiff[] = []
  const draftByScenario = new Map(draftWf.map((w) => [w.scenario, w]))
  const baseScenarios = new Set(baseWf.map((w) => w.scenario))

  for (const bw of baseWf) {
    const dw = draftByScenario.get(bw.scenario)
    if (!dw) {
      diffs.push({ kind: 'workflow_scenario_changed', field: 'workflows', scenario: bw.scenario, before: bw.steps })
    } else if (!sameStringArray(bw.steps ?? [], dw.steps ?? [])) {
      diffs.push({
        kind: 'workflow_scenario_changed',
        field: 'workflows',
        scenario: bw.scenario,
        before: bw.steps,
        after: dw.steps,
      })
    }
  }

  for (const dw of draftWf) {
    if (!baseScenarios.has(dw.scenario)) {
      diffs.push({ kind: 'workflow_scenario_changed', field: 'workflows', scenario: dw.scenario, after: dw.steps })
    }
  }
  return diffs
}

function sameStringArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}
