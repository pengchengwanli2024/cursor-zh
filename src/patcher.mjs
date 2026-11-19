/**
 * 静态补丁：替换 workbench bundle 中 UI 字段的英文字面量。
 *
 * 只替换「整个值就是一句界面文案」的位置，避免误伤代码、ID、搜索关键词：
 *   label:"Cancel"                    → label:"取消"
 *   title:"New Terminal"              → title:"新建终端"
 *   children:"Learn more"             → children:"了解更多"
 *   aria-label:"Settings"             → aria-label:"设置"
 *
 * 此外处理 Cursor 常见的两种结构化写法：
 *   - 原生菜单项 Mr({id:"openIde",title:"Open IDE",...})
 *   - 模式名 agent:"Agent",chat:"Chat",background:"Cloud",plan:"Plan",...
 */
import fs from 'node:fs';
import path from 'node:path';

/** 会被当作界面文案展示的字段名。 */
export const UI_FIELDS = [
  'label', 'description', 'placeholder', 'accessibleLabel', 'ariaLabel', 'aria-label',
  'tooltip', 'subtitle', 'buttonLabel', 'emptyLabel', 'emptyText', 'heading',
  'confirmText', 'title', 'children', 'actionTitle', 'name',
];

// 同时匹配裸键名与带引号的键名：
//   label:"Cancel"        {"aria-label":"Settings"}
const FIELD_ALT = UI_FIELDS
  .slice()
  .sort((a, b) => b.length - a.length)          // 长名优先，避免 aria-label 被 label 抢先
  .map((f) => f.replace(/-/g, '\\-'))
  .join('|');
const FIELD_RE = new RegExp(
  '(?:"(' + FIELD_ALT + ')"|\\b(' + FIELD_ALT + '))\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"',
  'g',
);

// 反引号模板字面量。Cursor 的智能体窗口（molten）命令注册表用的是这种写法：
//   {command: `terminal.new`, title: `New Terminal`}
// 含 ${} 插值的是动态拼接，不能整句替换。
const TICK = String.fromCharCode(96);
const FIELD_RE_TICK = new RegExp(
  '(?:"(' + FIELD_ALT + ')"|\\b(' + FIELD_ALT + '))\\s*:\\s*' + TICK + '((?:[^' + TICK + '\\\\]|\\\\.)*)' + TICK,
  'g',
);

/** 这些字面量虽然形态像界面文案，但实际是逻辑值，不能翻译。 */
const PROTECTED = new Set([
  'Cursor', 'MCP', 'GitHub', 'Git', 'PR', 'PRs', 'AI', 'API', 'CLI', 'IDE', 'UI', 'URL', 'URLs',
  'JSON', 'HTTP', 'HTTPS', 'OK', 'VS Code', 'Slack', 'AWS', 'Azure', 'OpenAI', 'GPT', 'Claude',
  'Composer', 'Agent', 'Chat', 'Plan', 'Spec', 'Debug', 'Triage', 'Cloud', 'Ask', 'Terminal',
  'Browser', 'File', 'Files', 'Output', 'Context', 'Canvas', 'Gallery', 'Colors', 'Desktop',
  'main', 'true', 'false', 'none', 'default', 'auto', 'shell', 'bash', 'zsh', 'fish',
]);

/** 只在 JSON/CSS 之类上下文里出现的形态，跳过。 */
function looksLikeData(value) {
  if (value.length < 2) return true;
  if (value.includes('://')) return true;
  if (value.startsWith('$(')) return true;
  if (/^[a-z]+[A-Z][a-zA-Z]*$/.test(value)) return true;      // camelCase 标识符
  if (/^[A-Z_0-9]+$/.test(value)) return true;                 // 常量
  if (/^[\w.-]+\.[a-z0-9]{1,6}$/i.test(value)) return true;   // 文件名
  if (!/[A-Za-z]/.test(value)) return true;
  return false;
}

function unescapeJs(raw) {
  return raw.replace(/\\(u[0-9a-fA-F]{4}|["\\/bfnrt])/g, (_, t) => {
    if (t.startsWith('u')) return String.fromCharCode(parseInt(t.slice(1), 16));
    return { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }[t] ?? t;
  });
}

function escapeJs(text) {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
}

/**
 * 对一段 bundle 源码应用词典替换。
 * @returns {{ text: string, hits: Map<string, number> }}
 */
export function rewrite(source, dict) {
  const hits = new Map();

  const translate = (raw) => {
    if (raw.includes('\\')) return null;
    if (PROTECTED.has(raw)) return null;
    if (looksLikeData(raw)) return null;
    const zh = dict[raw];
    if (typeof zh !== 'string' || !zh || zh === raw) return null;
    hits.set(raw, (hits.get(raw) || 0) + 1);
    return escapeJs(zh);
  };

  let text = source.replace(FIELD_RE, (full, quotedField, bareField, raw) => {
    const zh = translate(raw);
    if (zh === null) return full;
    return quotedField ? `"${quotedField}":"${zh}"` : `${bareField}:"${zh}"`;
  });

  // 反引号写法（molten 命令注册表）
  const tickToZh = (full, quotedField, bareField, raw) => {
    if (raw.includes('$' + '{')) return full;   // 模板插值不是静态文案
    if (raw.includes('\\')) return full;
    if (PROTECTED.has(raw) || looksLikeData(raw)) return full;
    const zh = dict[raw];
    if (typeof zh !== 'string' || !zh || zh === raw) return full;
    hits.set(raw, (hits.get(raw) || 0) + 1);
    const key = quotedField ? '"' + quotedField + '"' : bareField;
    return key + ':' + TICK + zh + TICK;
  };
  text = text.replace(FIELD_RE_TICK, tickToZh);

  // 模式名：一组固定英文，同一个对象里出现
  const MODE_SRC = 'agent:"Agent",chat:"Chat",background:"Cloud",plan:"Plan",spec:"Spec",debug:"Debug",triage:"Triage"';
  if (text.includes(MODE_SRC)) {
    const map = [
      ['agent', 'Agent', '智能体'], ['chat', 'Chat', '聊天'], ['background', 'Cloud', '云端'],
      ['plan', 'Plan', '计划'], ['spec', 'Spec', '规格'], ['debug', 'Debug', '调试'], ['triage', 'Triage', '分诊'],
    ];
    const replaced = map.map(([k, en, zh]) => {
      const hit = dict[en];
      if (typeof hit === 'string' && hit && hit !== en) { hits.set(en, (hits.get(en) || 0) + 1); return `${k}:"${escapeJs(hit)}"`; }
      return `${k}:"${en}"`;
    }).join(',');
    const count = text.split(MODE_SRC).length - 1;
    text = text.split(MODE_SRC).join(replaced);
    if (count) hits.set('__modes__', count);
  }

  return { text, hits };
}

/** 读取 bundle 文件并就地应用补丁；返回是否改动。 */
export function patchFile(file, dict) {
  const before = fs.readFileSync(file, 'utf8');
  const { text, hits } = rewrite(before, dict);
  if (text === before) return { changed: false, count: 0, hits };
  const tmp = `${file}.${process.pid}.cursor-zh.tmp`;
  fs.writeFileSync(tmp, text, { encoding: 'utf8', mode: fs.statSync(file).mode & 0o777 });
  fs.renameSync(tmp, file);
  return { changed: true, count: [...hits.values()].reduce((a, b) => a + b, 0) - (hits.get('__modes__') || 0), hits };
}
