/**
 * punchExecutor.spec.ts — PunchExecutor 單元測試（vitest）。
 *
 * 純本地版本：移除雲端 appsync / qwen / LLM 相關測試。
 * 保留：
 *   (e) tidyQuestionTitle 純函式測試（無外部依賴）
 *   (f) callWithRetry 退避序列測試（使用 monitor/errors 錯誤型別）
 */

import { describe, it, expect, vi } from 'vitest';
import {
  callWithRetry,
  tidyQuestionTitle,
} from '../src/main/monitor/punchExecutor';
import type { SleepFn } from '../src/main/monitor/punchExecutor';
import { AppSyncError, NotLoggedInError } from '../src/main/monitor/errors';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function noSleep(): SleepFn {
  return vi.fn().mockResolvedValue(undefined);
}

// ---------------------------------------------------------------------------
// tidyQuestionTitle（整理使用者問題為打卡標題）
// ---------------------------------------------------------------------------

describe('tidyQuestionTitle（整理使用者問題為打卡標題）', () => {
  it('收斂換行 / tab / 連續空白為單一空白並 trim', () => {
    expect(tidyQuestionTitle('  幫我\n\t整理   一下  ')).toBe('幫我 整理 一下');
  });

  it('去除 code fence / inline code 標記', () => {
    expect(tidyQuestionTitle('修這個 ```const x=1``` bug')).toBe('修這個 bug');
    expect(tidyQuestionTitle('用 `npm run dev` 跑')).toBe('用 npm run dev 跑');
  });

  it('去行首引用 / 清單符號與包夾引號書名號', () => {
    expect(tidyQuestionTitle('- 「做一個登入頁」')).toBe('做一個登入頁');
    expect(tidyQuestionTitle('> 請幫我串接 LINE')).toBe('請幫我串接 LINE');
  });

  it('超長 → 硬截斷加省略號（預設 40）', () => {
    const long = '幫'.repeat(50);
    const out = tidyQuestionTitle(long)!;
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBe(41); // 40 + 省略號
  });

  it('空 / null / 純空白 → null（讓呼叫端續走 fallback）', () => {
    expect(tidyQuestionTitle('')).toBeNull();
    expect(tidyQuestionTitle(null)).toBeNull();
    expect(tidyQuestionTitle('   \n\t ')).toBeNull();
    expect(tidyQuestionTitle('```only code```')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (f) callWithRetry 退避序列（獨立測試純函式）
// ---------------------------------------------------------------------------

describe('(f) callWithRetry 退避序列', () => {
  it('fn 成功 → 直接回，sleep 不呼叫', async () => {
    const sleep = noSleep();
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await callWithRetry(fn, { sleep, retries: 3, baseDelayMs: 100 });
    expect(result).toBe('ok');
    expect(sleep).not.toHaveBeenCalled();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('isRetryable 錯誤 2 次 → retry，第 3 次成功', async () => {
    const sleep = noSleep();
    let count = 0;
    const fn = vi.fn().mockImplementation(() => {
      count++;
      if (count < 3) return Promise.reject(new AppSyncError('暫時'));
      return Promise.resolve('done');
    });
    const result = await callWithRetry(fn, { sleep, retries: 3, baseDelayMs: 100 });
    expect(result).toBe('done');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('非 retryable 錯誤（NotLoggedInError）→ 不 retry，直接 throw', async () => {
    const sleep = noSleep();
    const fn = vi.fn().mockRejectedValue(new NotLoggedInError());
    await expect(callWithRetry(fn, { sleep, retries: 3, baseDelayMs: 100 })).rejects.toBeInstanceOf(NotLoggedInError);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries=3，全部失敗 → 拋出，sleep 呼叫 2 次（不多 sleep）', async () => {
    const sleep = noSleep();
    const fn = vi.fn().mockRejectedValue(new AppSyncError('持續'));
    await expect(callWithRetry(fn, { sleep, retries: 3, baseDelayMs: 200 })).rejects.toBeInstanceOf(AppSyncError);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    // 退避序列：200, 400
    expect((sleep as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(200);
    expect((sleep as ReturnType<typeof vi.fn>).mock.calls[1][0]).toBe(400);
  });
});
