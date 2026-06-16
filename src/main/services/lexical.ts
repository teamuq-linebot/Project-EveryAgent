/**
 * lexical.ts — 純文字 → Lexical 富文本編輯器 JSON 字串（純函式，零 I/O）。
 *
 * 1:1 移植自 Python teamuq/util/lexical.py。
 *
 * 後端 subtask 的 `description` 欄存的是 Lexical 編輯器序列化 JSON（非純文字）。
 * 打卡 punch-out 要寫 description 時，先用本模組把純文字轉成後端能吃的 Lexical
 * JSON 字串。
 *
 * 格式依使用者實測擷取的 payload：
 * - root 含 children=段落清單，每個「行」一個 paragraph。
 * - 空行 / 空字串 → 空 paragraph（children=[]，direction=null）。
 * - 有文字的行 → paragraph 含單一 text node，direction="ltr"。
 * - root 有任一非空段落時 direction="ltr"，全空時 direction=null。
 *
 * 全程容錯：text 非 string 先 String()；任何例外回「安全的單一空段落」JSON（永不拋）。
 */

// 使用者實測的空 description（單一空段落，root.direction=null）——當作容錯保底值。
const _SAFE_EMPTY =
  '{"root":{"children":[{"children":[],"direction":null,"format":"",' +
  '"indent":0,"type":"paragraph","version":1,"textFormat":0,' +
  '"textStyle":""}],"direction":null,"format":"","indent":0,' +
  '"type":"root","version":1}}';

function _emptyParagraph(): Record<string, unknown> {
  return {
    children: [],
    direction: null,
    format: '',
    indent: 0,
    type: 'paragraph',
    version: 1,
    textFormat: 0,
    textStyle: '',
  };
}

function _textParagraph(line: string): Record<string, unknown> {
  return {
    children: [
      {
        detail: 0,
        format: 0,
        mode: 'normal',
        style: '',
        text: line,
        type: 'text',
        version: 1,
      },
    ],
    direction: 'ltr',
    format: '',
    indent: 0,
    type: 'paragraph',
    version: 1,
    textFormat: 0,
    textStyle: '',
  };
}

/**
 * 把純文字轉成 Lexical 編輯器 JSON 字串（`JSON.stringify`）。
 *
 * - 多行（含 `\n`）→ 每行一個 paragraph。
 * - 空字串 → 單一空 paragraph。
 * - 有任一非空行 → root.direction="ltr"，否則 null。
 * - text 非 string 先 String()；任何例外回安全的單一空段落 JSON（不拋）。
 */
export function textToLexical(text: unknown): string {
  try {
    const s = typeof text === 'string' ? text : String(text ?? '');

    let paragraphs: Record<string, unknown>[];
    let rootDirection: 'ltr' | null;

    if (s === '') {
      paragraphs = [_emptyParagraph()];
      rootDirection = null;
    } else {
      paragraphs = [];
      let hasText = false;
      for (const line of s.split('\n')) {
        if (line === '') {
          paragraphs.push(_emptyParagraph());
        } else {
          paragraphs.push(_textParagraph(line));
          hasText = true;
        }
      }
      rootDirection = hasText ? 'ltr' : null;
    }

    const doc = {
      root: {
        children: paragraphs,
        direction: rootDirection,
        format: '',
        indent: 0,
        type: 'root',
        version: 1,
      },
    };
    return JSON.stringify(doc);
  } catch {
    // 永不拋：回安全空 description
    return _SAFE_EMPTY;
  }
}

// ===========================================================================
// Markdown → Lexical（上傳用）
//
// 打卡描述是代理回覆，內容為 Markdown 原文。textToLexical 只是「逐行塞純文字
// paragraph」，雲端 Lexical 編輯器渲染出來是純文字、看不到 Markdown 效果。
// 故上傳前用本區把 Markdown 解析成對應的 Lexical 富文本節點（標題 / 清單 / 引用 /
// 程式碼 / 行內粗體斜體刪除線行內碼），雲端就能正常呈現。
//
// 不依賴 marked（marked v18 為 ESM-only，main 以 CJS externalize 打包會 require 失敗）。
// 純函式、全程容錯：任何解析錯誤 → 退回 textToLexical（保證可上傳、永不拋）。
// ===========================================================================

const _FMT_BOLD = 1;
const _FMT_ITALIC = 2;
const _FMT_STRIKE = 4;
const _FMT_CODE = 16;

function _text(text: string, format = 0): Record<string, unknown> {
  return { detail: 0, format, mode: 'normal', style: '', text, type: 'text', version: 1 };
}
function _lineBreak(): Record<string, unknown> {
  return { type: 'linebreak', version: 1 };
}

/** 字元是否為「非詞」邊界（undefined / 非字母數字）。供底線強調 intraword 防呆（避免 snake_case 被當斜體）。 */
function _notWord(ch: string | undefined): boolean {
  return ch === undefined || /[^\p{L}\p{N}]/u.test(ch);
}

/** 解析行內 Markdown → Lexical text 節點陣列（遞迴帶 format bitmask）。 */
function _parseInline(s: string, base = 0): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  let buf = '';
  const flush = (): void => {
    if (buf !== '') {
      nodes.push(_text(buf, base));
      buf = '';
    }
  };
  let i = 0;
  while (i < s.length) {
    // 行內碼 `code`（最高優先，內部不再解析）
    if (s[i] === '`') {
      const end = s.indexOf('`', i + 1);
      if (end > i) {
        flush();
        nodes.push(_text(s.slice(i + 1, end), base | _FMT_CODE));
        i = end + 1;
        continue;
      }
    }
    // 粗體 ** / __（底線版需詞邊界）
    if (s.startsWith('**', i) || s.startsWith('__', i)) {
      const d = s.substr(i, 2);
      const underscore = d === '__';
      if (!underscore || _notWord(s[i - 1])) {
        const end = s.indexOf(d, i + 2);
        if (end > i && (!underscore || _notWord(s[end + 2]))) {
          flush();
          nodes.push(..._parseInline(s.slice(i + 2, end), base | _FMT_BOLD));
          i = end + 2;
          continue;
        }
      }
    }
    // 刪除線 ~~
    if (s.startsWith('~~', i)) {
      const end = s.indexOf('~~', i + 2);
      if (end > i) {
        flush();
        nodes.push(..._parseInline(s.slice(i + 2, end), base | _FMT_STRIKE));
        i = end + 2;
        continue;
      }
    }
    // 斜體 * / _（底線版需詞邊界，避免 a_b_c 被誤判）
    if (s[i] === '*' || s[i] === '_') {
      const ch = s[i];
      const underscore = ch === '_';
      if (!underscore || _notWord(s[i - 1])) {
        const end = s.indexOf(ch, i + 1);
        if (end > i && (!underscore || _notWord(s[end + 1]))) {
          flush();
          nodes.push(..._parseInline(s.slice(i + 1, end), base | _FMT_ITALIC));
          i = end + 1;
          continue;
        }
      }
    }
    // 連結 [text](url) → 降級為文字（避免依賴後端 link node 支援）
    if (s[i] === '[') {
      const m = /^\[([^\]]*)\]\([^)]*\)/.exec(s.slice(i));
      if (m) {
        flush();
        nodes.push(..._parseInline(m[1], base));
        i += m[0].length;
        continue;
      }
    }
    buf += s[i];
    i++;
  }
  flush();
  return nodes;
}

/** 多行 → 行內節點，行間插 linebreak（段落 / 引用內的軟換行）。 */
function _inlineLines(lines: string[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  lines.forEach((ln, idx) => {
    if (idx > 0) out.push(_lineBreak());
    out.push(..._parseInline(ln));
  });
  return out;
}

function _paragraph(children: Record<string, unknown>[]): Record<string, unknown> {
  return {
    children,
    direction: children.length ? 'ltr' : null,
    format: '',
    indent: 0,
    type: 'paragraph',
    version: 1,
    textFormat: 0,
    textStyle: '',
  };
}
function _heading(children: Record<string, unknown>[], depth: number): Record<string, unknown> {
  return {
    children,
    direction: 'ltr',
    format: '',
    indent: 0,
    type: 'heading',
    version: 1,
    tag: `h${Math.min(Math.max(depth, 1), 6)}`,
  };
}
function _listItem(children: Record<string, unknown>[], value: number): Record<string, unknown> {
  return { children, direction: 'ltr', format: '', indent: 0, type: 'listitem', version: 1, value };
}
function _list(
  items: Record<string, unknown>[],
  ordered: boolean,
  start: number,
): Record<string, unknown> {
  return {
    children: items,
    direction: 'ltr',
    format: '',
    indent: 0,
    type: 'list',
    version: 1,
    listType: ordered ? 'number' : 'bullet',
    start: ordered ? start : 1,
    tag: ordered ? 'ol' : 'ul',
  };
}
function _quote(children: Record<string, unknown>[]): Record<string, unknown> {
  return { children, direction: 'ltr', format: '', indent: 0, type: 'quote', version: 1 };
}
function _code(text: string, language: string | null): Record<string, unknown> {
  const children: Record<string, unknown>[] = [];
  text.split('\n').forEach((ln, idx) => {
    if (idx > 0) children.push(_lineBreak());
    if (ln !== '') children.push(_text(ln, 0));
  });
  return { children, direction: null, format: '', indent: 0, type: 'code', version: 1, language };
}

/** Markdown 區塊解析 → Lexical 區塊節點陣列。 */
function _blocksFromMarkdown(s: string): Record<string, unknown>[] {
  const lines = s.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Record<string, unknown>[] = [];
  const reHeading = /^(#{1,6})\s+(.*)$/;
  const reUl = /^\s*[-*+]\s+(.*)$/;
  const reOl = /^\s*(\d+)[.)]\s+(.*)$/;
  const reFence = /^\s*```(.*)$/;
  const reHr = /^\s*([-*_])(\s*\1){2,}\s*$/;
  const reQuote = /^\s*>/;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    // 圍籬程式碼塊 ```lang ... ```
    const mf = reFence.exec(line);
    if (mf) {
      const lang = mf[1].trim() || null;
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // 跳過收尾 ```
      blocks.push(_code(code.join('\n'), lang));
      continue;
    }

    // 水平線 → 略過（避免依賴後端 horizontalrule node）
    if (reHr.test(line)) {
      i++;
      continue;
    }

    // 標題
    const mh = reHeading.exec(line);
    if (mh) {
      blocks.push(_heading(_parseInline(mh[2]), mh[1].length));
      i++;
      continue;
    }

    // 引用：連續 > 行
    if (reQuote.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && reQuote.test(lines[i])) {
        quoted.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      blocks.push(_quote(_inlineLines(quoted)));
      continue;
    }

    // 無序清單
    if (reUl.test(line)) {
      const items: Record<string, unknown>[] = [];
      while (i < lines.length && reUl.test(lines[i])) {
        const m = reUl.exec(lines[i])!;
        items.push(_listItem(_parseInline(m[1]), items.length + 1));
        i++;
      }
      blocks.push(_list(items, false, 1));
      continue;
    }

    // 有序清單
    if (reOl.test(line)) {
      const items: Record<string, unknown>[] = [];
      let start: number | null = null;
      while (i < lines.length && reOl.test(lines[i])) {
        const m = reOl.exec(lines[i])!;
        if (start === null) start = parseInt(m[1], 10) || 1;
        items.push(_listItem(_parseInline(m[2]), items.length + 1));
        i++;
      }
      blocks.push(_list(items, true, start ?? 1));
      continue;
    }

    // 段落：連續一般行（遇空行 / 特殊行為止），行間 linebreak
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !reHeading.test(lines[i]) &&
      !reUl.test(lines[i]) &&
      !reOl.test(lines[i]) &&
      !reFence.test(lines[i]) &&
      !reQuote.test(lines[i]) &&
      !reHr.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(_paragraph(_inlineLines(para)));
  }
  return blocks;
}

/**
 * 把 Markdown 原文轉成 Lexical 富文本 JSON 字串（上傳用）。
 * 支援：標題、有序/無序清單、引用、圍籬程式碼塊、行內粗體/斜體/刪除線/行內碼；連結降級為文字。
 * 空字串 / 解析錯誤 → 退回 textToLexical（逐行純文字，保證可上傳、永不拋）。
 */
export function markdownToLexical(md: unknown): string {
  try {
    const s = typeof md === 'string' ? md : String(md ?? '');
    if (s.trim() === '') return _SAFE_EMPTY;
    const blocks = _blocksFromMarkdown(s);
    if (blocks.length === 0) return _SAFE_EMPTY;
    return JSON.stringify({
      root: { children: blocks, direction: 'ltr', format: '', indent: 0, type: 'root', version: 1 },
    });
  } catch {
    return textToLexical(md);
  }
}

/**
 * lexicalLinesToText — 還原 textToLexical 產生的「逐行 paragraph」Lexical JSON 回原始文字。
 * 每個頂層 paragraph 收其 text 節點串成一行，再以 \n join（忠實反轉 textToLexical 的 split('\n')）。
 * 非 JSON / 解析失敗 → 原樣回傳。供 enrichLexicalDescription 在上傳前取回 Markdown 原文。
 */
export function lexicalLinesToText(rawJson: unknown): string {
  const raw = typeof rawJson === 'string' ? rawJson : String(rawJson ?? '');
  const s = raw.trim();
  if (s === '' || !s.startsWith('{')) return raw;
  try {
    const doc = JSON.parse(s) as Record<string, unknown>;
    const root = (doc['root'] ?? doc) as Record<string, unknown>;
    const children = root['children'];
    if (!Array.isArray(children)) return raw;
    const collect = (node: unknown, out: string[]): void => {
      if (node == null || typeof node !== 'object') return;
      const n = node as Record<string, unknown>;
      if (n['type'] === 'text' && typeof n['text'] === 'string') {
        out.push(n['text']);
        return;
      }
      const kids = n['children'];
      if (Array.isArray(kids)) for (const k of kids) collect(k, out);
    };
    return children
      .map((para) => {
        const parts: string[] = [];
        collect(para, parts);
        return parts.join('');
      })
      .join('\n');
  } catch {
    return raw;
  }
}

/**
 * enrichLexicalDescription — 上傳前把「逐行純文字」Lexical 描述升級為富文本 Lexical。
 * 流程：stored Lexical（textToLexical 產物）→ lexicalLinesToText 取回 Markdown 原文 →
 *   markdownToLexical 解析成富文本節點。空 / null / 任何錯誤 → 原樣回傳（不影響上傳）。
 */
export function enrichLexicalDescription(storedJson: string | null | undefined): string | null {
  if (storedJson == null || storedJson === '') return storedJson ?? null;
  try {
    const md = lexicalLinesToText(storedJson);
    if (md.trim() === '') return storedJson;
    return markdownToLexical(md);
  } catch {
    return storedJson;
  }
}
