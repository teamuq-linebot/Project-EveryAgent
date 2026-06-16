/**
 * monitor/errors.ts — 打卡執行層錯誤型別（自 sync/errors.ts 抽出）。
 *
 * 純本地後 appsync 路徑已移除，callWithRetry / authDefer 實際上不再觸發，
 * 但保留型別與分類函式以最小改動，避免牽動 IAppSyncClient 型別參考。
 *
 * 來源：sync/errors.ts 逐字複製（語意一行不改）。
 */

// ---------------------------------------------------------------------------
// Exception 階層
// ---------------------------------------------------------------------------

export class AppSyncError extends Error {
  constructor(message = 'AppSync error') {
    super(message);
    this.name = 'AppSyncError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NotLoggedInError extends AppSyncError {
  constructor(message = '未登入 / 無有效 token') {
    super(message);
    this.name = 'NotLoggedInError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class TokenExpiredError extends NotLoggedInError {
  constructor(message = 'token 已過期（屬於未登入的一種）') {
    super(message);
    this.name = 'TokenExpiredError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AppSyncTimeout extends AppSyncError {
  constructor(message = '呼叫 appsync 逾時') {
    super(message);
    this.name = 'AppSyncTimeout';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AppSyncParseError extends AppSyncError {
  constructor(message = '回應無法解析為 JSON') {
    super(message);
    this.name = 'AppSyncParseError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class GraphQLError extends AppSyncError {
  readonly graphqlMessage: string;
  constructor(message: string) {
    super(message);
    this.name = 'GraphQLError';
    this.graphqlMessage = message;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// 例外分類 helper（純函式，供打卡 retry 決策使用）
// ---------------------------------------------------------------------------

/**
 * token 過期 / 未登入類（不可背景自動 retry，須 defer）。
 * TokenExpiredError 是 NotLoggedInError 的子類，一併涵蓋。
 */
export function isAuthError(exc: unknown): boolean {
  return exc instanceof NotLoggedInError;
}

/**
 * 暫時性錯誤（網路 / timeout / 後端暫時性）→ 可退避重試。
 * auth 類（NotLoggedInError / TokenExpiredError）一律不可重試。
 * AppSyncTimeout / AppSyncParseError / GraphQLError 均繼承 AppSyncError，自動涵蓋。
 */
export function isRetryable(exc: unknown): boolean {
  if (exc instanceof NotLoggedInError) {  // 含 TokenExpiredError
    return false;
  }
  return exc instanceof AppSyncError;
}
