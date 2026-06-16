/**
 * backend/constants.ts — Backend 層的設定鍵常數與空 emitter。
 *
 * 自 backend.ts 機械抽離（行為保留 move-only）：
 *   NO_OP_EMIT / ACTIVE_CONNECTION_KEY。
 * backend.ts 改 import 使用，數值與語意不變。
 */

import type { EmitFn } from "./types";

/** 空 emitter（初始化前 / 無視窗時用）。*/
export const NO_OP_EMIT: EmitFn = () => {};

/**
 * active_connection 設定鍵（多帳戶方案 B / B2 寫入、B3 擴讀）：
 *   app_settings(key='active_connection') = { platformLocalId }（目前選定的帳號實例 platform local_id，
 *   持久化跨重啟）。B2 在 loginToTemplate / 既有 token 遷移成功後寫入；B3 接 _buildAuthContext 讀取解析。
 */
export const ACTIVE_CONNECTION_KEY = "active_connection";
