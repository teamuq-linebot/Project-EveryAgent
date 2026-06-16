// ---------------------------------------------------------------------------
// 版本常數
// ---------------------------------------------------------------------------

/**
 * 主 schema 結構版（PRAGMA user_version）。schema 有結構性變更時 +1。
 * ⚠ 主 DB 絕不 DROP 重建（含帳本/機密/origin='local'）；不符時只 migrate（§2.2）。
 */
export const SCHEMA_VERSION = 1

/**
 * 對話 cache 解析器版本（存 schema_meta.parser_version，與 user_version 正交）。
 * conv 解析邏輯或 conv_* 三表 schema 破壞性變更時 +1 → 只 DROP 重建 cache 3 表。
 * 與 conversationStore.PARSER_VERSION 對齊（後續批次接 conv cache 時統一來源）。
 */
export const CONV_PARSER_VERSION = 14
