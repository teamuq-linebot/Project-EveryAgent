/**
 * IntroductionEditor.tsx — 白話介紹草稿編輯器（Phase 2：陣列欄位 Pill 編輯）
 *
 * P1 實作字串欄位 textarea 編輯（summary/when_to_use/not_for/inputs/outputs）。
 * P2 實作：陣列欄位 pill 標籤可增刪。
 * 唯讀欄位（id/display_name/team/role）置底，附「由系統管理」說明。
 * Persona Gate：所有 label 為白話，無欄位 key/檔名/指令名。
 */
import React, { useCallback, useState } from 'react'
import type { AgentIntroduction } from '../../../shared/ipcContracts'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  draft: AgentIntroduction
  onChange: (updated: AgentIntroduction) => void
  onCancel: () => void
  onSaveDraft: () => void
  saving: boolean
}

// ---------------------------------------------------------------------------
// 白話欄位標籤（不可顯示技術鍵名）
// ---------------------------------------------------------------------------

const FIELD_LABELS: Record<string, string> = {
  summary: '一句話介紹',
  when_to_use: '適合找他的情境',
  not_for: '不適合的情境',
  inputs: '接收什麼',
  outputs: '交付什麼',
}

// ---------------------------------------------------------------------------
// StringField — 單個字串欄位 textarea
// ---------------------------------------------------------------------------

function StringField({
  label,
  value,
  onChange,
  rows = 3,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  rows?: number
}): React.JSX.Element {
  return (
    <div className="at-intro-editor__field">
      <label className="at-intro-editor__label">{label}</label>
      <textarea
        className="at-intro-editor__textarea"
        value={value}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// ArrayFieldEditor — 陣列欄位 Pill 編輯器（P2）
// ---------------------------------------------------------------------------

interface ArrayFieldEditorProps {
  label: string
  items: string[]
  onChange: (items: string[]) => void
}

function ArrayFieldEditor({
  label,
  items,
  onChange,
}: ArrayFieldEditorProps): React.JSX.Element {
  const [inputValue, setInputValue] = useState('')

  const handleRemove = (index: number) => {
    onChange(items.filter((_, i) => i !== index))
  }

  const handleAdd = () => {
    const trimmed = inputValue.trim()
    if (trimmed.length === 0) return
    onChange([...items, trimmed])
    setInputValue('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAdd()
    }
  }

  return (
    <div className="at-intro-editor__field">
      <label className="at-intro-editor__label">{label}</label>
      <ul className="at-intro-editor__pill-list">
        {items.map((item, i) => (
          <li key={i} className="at-intro-editor__pill at-intro-editor__pill--removable">
            {item}
            <button
              type="button"
              className="at-intro-editor__pill-rm"
              onClick={() => handleRemove(i)}
              aria-label={`移除 ${item}`}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="at-intro-editor__pill-add-row">
        <input
          type="text"
          className="at-intro-editor__pill-add-input"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="輸入後按 Enter 或點「新增」"
        />
        <button
          type="button"
          className="at-intro-editor__pill-add-btn"
          onClick={handleAdd}
        >
          新增
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// WorkflowCardEditor — 情境卡片編輯器（P2-B）
// ---------------------------------------------------------------------------

interface WorkflowCardEditorProps {
  workflows: { scenario: string; steps: string[] }[]
  onChange: (workflows: { scenario: string; steps: string[] }[]) => void
}

function WorkflowCardEditor({
  workflows,
  onChange,
}: WorkflowCardEditorProps): React.JSX.Element {
  const updateCard = (
    index: number,
    patch: Partial<{ scenario: string; steps: string[] }>,
  ) => {
    const updated = workflows.map((wf, i) =>
      i === index ? { ...wf, ...patch } : wf,
    )
    onChange(updated)
  }

  const removeCard = (index: number) => {
    onChange(workflows.filter((_, i) => i !== index))
  }

  const addCard = () => {
    onChange([...workflows, { scenario: '', steps: [''] }])
  }

  const updateStep = (cardIndex: number, stepIndex: number, value: string) => {
    const steps = workflows[cardIndex].steps.map((s, i) =>
      i === stepIndex ? value : s,
    )
    updateCard(cardIndex, { steps })
  }

  const removeStep = (cardIndex: number, stepIndex: number) => {
    const steps = workflows[cardIndex].steps.filter((_, i) => i !== stepIndex)
    updateCard(cardIndex, { steps })
  }

  const addStep = (cardIndex: number) => {
    const steps = [...workflows[cardIndex].steps, '']
    updateCard(cardIndex, { steps })
  }

  return (
    <div className="at-intro-editor__workflow-list">
      {workflows.map((wf, ci) => (
        <div key={ci} className="at-intro-editor__workflow-card">
          {/* 情境描述 */}
          <div className="at-intro-editor__workflow-scenario">
            <label className="at-intro-editor__label">情境描述</label>
            <textarea
              rows={2}
              value={wf.scenario}
              onChange={(e) => updateCard(ci, { scenario: e.target.value })}
              placeholder="說明此工作流程的使用情境"
            />
          </div>

          {/* 步驟列表 */}
          <div className="at-intro-editor__workflow-steps">
            <label className="at-intro-editor__label">步驟</label>
            {wf.steps.map((step, si) => (
              <div key={si} className="at-intro-editor__workflow-step-row">
                <input
                  type="text"
                  className="at-intro-editor__workflow-step-input"
                  value={step}
                  onChange={(e) => updateStep(ci, si, e.target.value)}
                  placeholder="輸入步驟說明"
                />
                <button
                  type="button"
                  className="at-intro-editor__pill-rm"
                  onClick={() => removeStep(ci, si)}
                  aria-label={`移除步驟 ${si + 1}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          {/* 卡片操作列 */}
          <div className="at-intro-editor__workflow-card-actions">
            <button
              type="button"
              className="at-intro-editor__workflow-add-step-btn"
              onClick={() => addStep(ci)}
            >
              新增步驟
            </button>
            <button
              type="button"
              className="at-intro-editor__workflow-delete-btn"
              onClick={() => removeCard(ci)}
            >
              刪除此工作流程
            </button>
          </div>
        </div>
      ))}

      <button
        type="button"
        className="at-intro-editor__workflow-add-card-btn"
        onClick={addCard}
      >
        新增工作流程
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// IntroductionEditor
// ---------------------------------------------------------------------------

export function IntroductionEditor({
  draft,
  onChange,
  onCancel,
  onSaveDraft,
  saving,
}: Props): React.JSX.Element {
  const setField = useCallback(
    (field: keyof AgentIntroduction, value: string) => {
      onChange({ ...draft, [field]: value })
    },
    [draft, onChange],
  )

  const setArrayField = useCallback(
    (field: keyof AgentIntroduction, value: string[]) => {
      onChange({ ...draft, [field]: value })
    },
    [draft, onChange],
  )

  return (
    <div className="at-intro-editor">
      <div className="at-intro-editor__body">
        {/* 字串欄位 — P1 可編輯 */}
        <StringField
          label={FIELD_LABELS.summary}
          value={draft.summary ?? ''}
          onChange={(v) => setField('summary', v)}
          rows={2}
        />
        <StringField
          label={FIELD_LABELS.when_to_use}
          value={draft.when_to_use ?? ''}
          onChange={(v) => setField('when_to_use', v)}
        />
        <StringField
          label={FIELD_LABELS.not_for}
          value={draft.not_for ?? ''}
          onChange={(v) => setField('not_for', v)}
        />
        <StringField
          label={FIELD_LABELS.inputs}
          value={draft.inputs ?? ''}
          onChange={(v) => setField('inputs', v)}
        />
        <StringField
          label={FIELD_LABELS.outputs}
          value={draft.outputs ?? ''}
          onChange={(v) => setField('outputs', v)}
        />

        {/* Workflows 情境卡片 — P2 可編輯 */}
        <div className="at-intro-editor__field">
          <label className="at-intro-editor__label">工作流程</label>
          <WorkflowCardEditor
            workflows={draft.workflows ?? []}
            onChange={(wfs) => onChange({ ...draft, workflows: wfs })}
          />
        </div>

        {/* 陣列欄位 — P2 Pill 可編輯 */}
        <ArrayFieldEditor
          label="能力描述"
          items={draft.capabilities ?? []}
          onChange={(v) => setArrayField('capabilities', v)}
        />
        <ArrayFieldEditor
          label="帶領的成員"
          items={draft.manages ?? []}
          onChange={(v) => setArrayField('manages', v)}
        />
        <ArrayFieldEditor
          label="可以找他的人"
          items={draft.callable_by ?? []}
          onChange={(v) => setArrayField('callable_by', v)}
        />
        <ArrayFieldEditor
          label="特殊標記"
          items={draft.flags ?? []}
          onChange={(v) => setArrayField('flags', v)}
        />

        {/* 唯讀欄位（id/display_name/team/role）— 置底說明 */}
        {(draft.id || draft.display_name || draft.team || draft.role) && (
          <div className="at-intro-editor__readonly-section">
            <p className="at-intro-editor__readonly-note">以下欄位由系統管理，不開放修改。</p>
            {draft.display_name && (
              <div className="at-intro-editor__readonly-row">
                <span className="at-intro-editor__readonly-label">助手名稱</span>
                <span className="at-intro-editor__readonly-value">{draft.display_name}</span>
              </div>
            )}
            {draft.team && (
              <div className="at-intro-editor__readonly-row">
                <span className="at-intro-editor__readonly-label">所屬組別</span>
                <span className="at-intro-editor__readonly-value">{draft.team}</span>
              </div>
            )}
            {draft.role && (
              <div className="at-intro-editor__readonly-row">
                <span className="at-intro-editor__readonly-label">角色</span>
                <span className="at-intro-editor__readonly-value">{draft.role}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 操作列 */}
      <div className="at-intro-editor__actions">
        <button
          type="button"
          className="at-intro-editor__btn at-intro-editor__btn--save"
          onClick={onSaveDraft}
          disabled={saving}
        >
          {saving ? '儲存中…' : '儲存草稿'}
        </button>
        <button
          type="button"
          className="at-intro-editor__btn at-intro-editor__btn--cancel"
          onClick={onCancel}
          disabled={saving}
        >
          取消
        </button>
      </div>
    </div>
  )
}
