/**
 * AgentOrg 路徑工具
 *
 * 共用 util：去掉路徑尾段的 /agents（或 \agents），回傳 AgentOrg 根目錄。
 * 等價於 App.tsx:244 的行內 replace，抽出後統一維護避免兩處不同步。
 */
export function stripAgentsSuffix(path: string): string {
  return path.replace(/[\\/]agents[\\/]?$/, '')
}
