/**
 * IntroductionDiffViewer — 欄位級差異並列顯示
 * Persona Gate M3：用「修改前/修改後」並列（Word 修訂模式），不用 git 紅綠
 * 參照 introDiff.ts FieldDiff 型別和 inferSourceFiles.ts 白話標籤
 */
import React from 'react'
import type { FieldDiff } from './introDiff'
import { inferSourceFiles } from './inferSourceFiles'

interface Props {
  diffs: FieldDiff[]
}

export function IntroductionDiffViewer({ diffs }: Props): React.JSX.Element {
  if (diffs.length === 0) {
    return (
      <div className="at-intro-diff at-intro-diff--empty">
        <p>這次沒有任何修改。</p>
      </div>
    )
  }

  return (
    <div className="at-intro-diff">
      {diffs.map((diff, idx) => {
        const { fieldLabel } = inferSourceFiles(diff.field)
        return (
          <DiffRow key={idx} diff={diff} fieldLabel={fieldLabel} />
        )
      })}
    </div>
  )
}

function DiffRow({ diff, fieldLabel }: { diff: FieldDiff; fieldLabel: string }): React.JSX.Element {
  const beforeText = formatValue(diff.before)
  const afterText = formatValue(diff.after)

  const kindLabel = diffKindLabel(diff)

  return (
    <div className="at-intro-diff__row">
      <div className="at-intro-diff__field-label">{fieldLabel}{kindLabel ? <span className="at-intro-diff__kind-tag">{kindLabel}</span> : null}</div>
      <div className="at-intro-diff__columns">
        <div className="at-intro-diff__col at-intro-diff__col--before">
          <div className="at-intro-diff__col-label">修改前</div>
          <div className="at-intro-diff__col-content">{beforeText ?? <span className="at-intro-diff__empty">（無）</span>}</div>
        </div>
        <div className="at-intro-diff__arrow" aria-hidden="true">→</div>
        <div className="at-intro-diff__col at-intro-diff__col--after">
          <div className="at-intro-diff__col-label">修改後</div>
          <div className="at-intro-diff__col-content">{afterText ?? <span className="at-intro-diff__empty">（移除）</span>}</div>
        </div>
      </div>
    </div>
  )
}

function formatValue(v: string | string[] | undefined): string | undefined {
  if (v === undefined) return undefined
  if (Array.isArray(v)) return v.join('\n')
  return v || undefined
}

function diffKindLabel(diff: FieldDiff): string | null {
  if (diff.kind === 'array_item_added') return '（新增）'
  if (diff.kind === 'array_item_removed') return '（移除）'
  if (diff.kind === 'workflow_scenario_changed' && diff.before === undefined) return '（新增情境）'
  if (diff.kind === 'workflow_scenario_changed' && diff.after === undefined) return '（移除情境）'
  return null
}
