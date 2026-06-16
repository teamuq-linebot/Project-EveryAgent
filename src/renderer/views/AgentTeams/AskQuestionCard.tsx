/**
 * AskQuestionCard.tsx — AgentTeams 對話面板「結構化選擇題卡片」受控元件
 *
 * 把 askQuestionHelpers 萃取出的 ActiveAskQuestion 渲染成白話、非工程師友善的
 * 選擇題卡片：單選（點即送）/ 多選（勾選 + 送出）/「其他（自行輸入）」三態。
 *
 * 純展示受控元件：所有送出走 onSubmit(AskSubmitResult)，不碰 IPC / PTY / hook。
 * disabled 為真時整卡鎖定（已送出或父層判定不可再答）。
 *
 * 樣式沿用 .at-conv-prompt* 語彙（見 global.css）；視覺對齊既有 AskCard。
 * agentteams-ask-card（批 2）。
 */
import React, { useState } from "react";
import type { ActiveAskQuestion } from "./askQuestionHelpers";

/** 卡片送出結果（批 3/4 由父層 import 後轉成實際 PTY 回應）。 */
export interface AskSubmitResult {
  /** 是否為多選題（回放 question.multiSelect，方便父層分支）。 */
  multiSelect: boolean;
  /** 勾選的結構化 option index（0-based，不含「其他」）。 */
  selectedIndices: number[];
  /** 是否選了「其他（自行輸入）」。 */
  otherSelected: boolean;
  /** 「其他」的自由文字（otherSelected 為 false 時為空字串）。 */
  otherText: string;
}

/** 卡片本身的鎖定／已送出狀態（內部用）。 */
type CardState =
  | { phase: "active" }
  | { phase: "submitted" };

export function AskQuestionCard(props: {
  /** 待回答的結構化問題（從 ./askQuestionHelpers 萃取）。 */
  question: ActiveAskQuestion;
  /** 送出回呼；index 為 0-based 結構化選項序，「其他」走 otherSelected/otherText。 */
  onSubmit: (result: AskSubmitResult) => void;
  /** 父層鎖定（例如非當前待答 / 已切換）；為真時整卡不可互動。 */
  disabled?: boolean;
}): React.JSX.Element {
  const { question, onSubmit, disabled = false } = props;

  // 共用：本卡是否已送出（送出後整卡 disabled）。
  const [card, setCard] = useState<CardState>({ phase: "active" });
  // 單選：是否展開「其他」輸入；多選：「其他」checkbox 是否勾選。
  const [otherActive, setOtherActive] = useState(false);
  // 「其他」自由文字（單選展開後 / 多選勾選後共用）。
  const [otherText, setOtherText] = useState("");
  // 多選：勾選的結構化 option index 暫存。
  const [checked, setChecked] = useState<Set<number>>(() => new Set<number>());

  const locked = disabled || card.phase === "submitted";

  function submit(result: AskSubmitResult): void {
    if (locked) return;
    setCard({ phase: "submitted" });
    onSubmit(result);
  }

  return (
    <div
      className={`at-conv-prompt at-ask-card${locked ? " at-ask-card--locked" : ""}`}
      role="group"
      aria-label="請回答問題"
    >
      {question.header && <p className="at-conv-prompt__label">{question.header}</p>}
      <p className="at-ask-card__question">{question.question}</p>

      {question.multiSelect
        ? renderMultiSelect()
        : renderSingleSelect()}

      {card.phase === "submitted" && (
        <p className="at-ask-card__sent">已送出</p>
      )}
    </div>
  );

  // ── 單選：每個 option 一顆按鈕，點即送；另有「其他」展開輸入 ───────────────
  function renderSingleSelect(): React.JSX.Element {
    return (
      <div className="at-conv-prompt__options at-ask-card__options--single">
        {question.options.map((opt, i) => (
          <button
            key={i}
            type="button"
            className="at-conv-prompt__option at-ask-card__option-btn"
            disabled={locked}
            onClick={() =>
              submit({
                multiSelect: false,
                selectedIndices: [i],
                otherSelected: false,
                otherText: "",
              })
            }
          >
            <span className="at-ask-card__option-label">{opt.label}</span>
            {opt.description && (
              <span className="at-ask-card__option-desc">{opt.description}</span>
            )}
          </button>
        ))}

        {otherActive ? (
          <div className="at-ask-card__other">
            <input
              type="text"
              className="at-ask-card__other-input"
              placeholder="請輸入您的答案…"
              value={otherText}
              disabled={locked}
              autoFocus
              onChange={(e) => setOtherText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && otherText.trim() !== "") {
                  e.preventDefault();
                  submitOther();
                }
              }}
            />
            <button
              type="button"
              className="at-conv-prompt__submit"
              disabled={locked || otherText.trim() === ""}
              onClick={submitOther}
            >
              送出
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="at-conv-prompt__option at-ask-card__other-toggle"
            disabled={locked}
            onClick={() => setOtherActive(true)}
          >
            ✏️ 其他（自行輸入）
          </button>
        )}
      </div>
    );

    function submitOther(): void {
      submit({
        multiSelect: false,
        selectedIndices: [],
        otherSelected: true,
        otherText: otherText.trim(),
      });
    }
  }

  // ── 多選：checkbox 暫存 + 「其他」checkbox + 底部送出 ─────────────────────
  function renderMultiSelect(): React.JSX.Element {
    const nothingPicked = checked.size === 0 && !otherActive;

    return (
      <div className="at-ask-card__checks">
        {question.options.map((opt, i) => (
          <label key={i} className="at-ask-card__check-row">
            <input
              type="checkbox"
              className="at-ask-card__checkbox"
              checked={checked.has(i)}
              disabled={locked}
              onChange={(e) => {
                setChecked((prev) => {
                  const next = new Set(prev);
                  if (e.target.checked) next.add(i);
                  else next.delete(i);
                  return next;
                });
              }}
            />
            <span className="at-ask-card__check-text">
              <span className="at-ask-card__option-label">{opt.label}</span>
              {opt.description && (
                <span className="at-ask-card__option-desc">{opt.description}</span>
              )}
            </span>
          </label>
        ))}

        <label className="at-ask-card__check-row">
          <input
            type="checkbox"
            className="at-ask-card__checkbox"
            checked={otherActive}
            disabled={locked}
            onChange={(e) => setOtherActive(e.target.checked)}
          />
          <span className="at-ask-card__check-text">✏️ 其他（自行輸入）</span>
        </label>

        {otherActive && (
          <input
            type="text"
            className="at-ask-card__other-input"
            placeholder="請輸入您的答案…"
            value={otherText}
            disabled={locked}
            onChange={(e) => setOtherText(e.target.value)}
          />
        )}

        <button
          type="button"
          className="at-conv-prompt__submit"
          disabled={locked || nothingPicked}
          onClick={() =>
            submit({
              multiSelect: true,
              selectedIndices: [...checked].sort((a, b) => a - b),
              otherSelected: otherActive,
              otherText: otherActive ? otherText.trim() : "",
            })
          }
        >
          送出
        </button>
      </div>
    );
  }
}
