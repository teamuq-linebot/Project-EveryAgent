import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

// 當 Electron 開發實例正在執行、佔住 node_modules/better-sqlite3 的 .node 檔
// （無法 in-place `npm rebuild better-sqlite3` 切回 Node ABI）時，
// 設 BSQ3_NODE_ABI=1 → 把 better-sqlite3 別名到一份「為 Node ABI 預編譯」的暫拷貝
// （.abi-node-bsq3/better-sqlite3，prebuild-install 取得）。
// 不設此 env 時，行為與原 config 完全相同（user 正常 flow 不受影響）。
const aliases: Record<string, string> = {
  '@shared': resolve(__dirname, 'src/shared'),
};
if (process.env.BSQ3_NODE_ABI === '1') {
  aliases['better-sqlite3'] = resolve(__dirname, '.abi-node-bsq3/better-sqlite3');
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
  },
  resolve: {
    alias: aliases,
  },
});
