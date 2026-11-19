/**
 * 词典构建：把 sources/ 下的多个 JSON 合并成一份运行时词典。
 *
 * 优先级（高 → 低）：
 *   ui.json             人工校订的高频界面词（菜单、按钮、设置项）
 *   curated.json        人工校订的长句与 Cursor 专有文案
 *   server-tips.json    从 Cursor 服务端下发数据整理的空态提示
 *   retranslated.json   早先社区词条经重新翻译清洗后的结果
 *   translated.json     本地模型批量翻译的补充词条
 *
 * 输出 build/dict.json：
 *   { dict: { 英文: 中文 }, patterns: [{ s, z }], meta: {...} }
 */
import fs from 'node:fs';
import path from 'node:path';

const CJK = /[\u4e00-\u9fff]/;

/** 译文质量闸门：拦掉模型自述、未翻译、长度异常的输出。 */
export function isSane(english, chinese) {
  if (typeof english !== 'string' || typeof chinese !== 'string') return false;
  if (!english || !chinese) return false;
  if (!CJK.test(chinese)) return false;
  if (english.length <= 2) return false;
  if (chinese.length > Math.max(80, english.length * 5)) return false;
  if (/^(Sure|I |Here|Please provide|The translation|Translate|This is)/i.test(chinese)) return false;
  if (/translat(e|ion)|原文|待翻译|说明：/i.test(chinese)) return false;
  return true;
}

/** 产品名与协议名保持原文，避免 "Cursor" → "光标" 这类污染。 */
const KEEP_VERBATIM = new Set([
  'Cursor', 'MCP', 'MCPs', 'GitHub', 'Git', 'PR', 'PRs', 'AI', 'API', 'CLI', 'IDE', 'UI',
  'URL', 'URLs', 'JSON', 'HTTP', 'HTTPS', 'OK', 'VS Code', 'Slack', 'AWS', 'Azure',
  'OpenAI', 'GPT', 'Claude', 'Composer', 'OAuth', 'SSO', 'SDK', 'CSS', 'HTML', 'SQL', 'SSH',
]);

export function loadSources(root) {
  const dir = path.join(root, 'sources');
  const read = (name) => {
    const file = path.join(dir, name);
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
  };
  return {
    ui: read('ui.json'),
    curated: read('curated.json'),
    tips: read('server-tips.json'),
    retranslated: read('retranslated.json'),
    translated: read('translated.json'),
    nls: read('nls.json'),
  };
}

/** 合并词典，先到先得（优先级由参数顺序决定）。 */
export function buildDict(sources) {
  const dict = {};
  const stats = {};
  for (const [name, src] of Object.entries(sources)) {
    let added = 0;
    for (const [en, zh] of Object.entries(src)) {
      if (en.startsWith('$')) continue;
      if (KEEP_VERBATIM.has(en)) continue;
      if (!isSane(en, zh)) continue;
      if (en in dict) continue;
      dict[en] = zh;
      added++;
    }
    stats[name] = { provided: Object.keys(src).length, used: added };
  }
  return { dict, stats };
}

/** 动态文本：带数字/复数的句子，无法整句查表。 */
export const PATTERNS = [
  { s: '^Tab Stats: (.+)$', z: 'Tab 统计：$1' },
  { s: '^Agent Stats: (.+)$', z: '智能体统计：$1' },
  { s: '^(.+) Terminals?$', z: '$1 个终端' },
  { s: '^Show (\\d+) more$', z: '再显示 $1 个' },
  { s: '^Show (\\d+) more tools$', z: '再显示 $1 个工具' },
  { s: '^Worked for (.+)$', z: '耗时 $1' },
  { s: '^(\\d+) Files? Changed$', z: '$1 个文件已更改' },
  { s: '^Set up Environment for (.+)$', z: '为 $1 配置环境' },
  { s: '^(\\d+) of (\\d+)$', z: '$1 / $2' },
  { s: '^(\\d+) results?$', z: '$1 个结果' },
  { s: '^(\\d+) files?$', z: '$1 个文件' },
  { s: '^(\\d+) problems?$', z: '$1 个问题' },
  { s: '^(\\d+) errors?$', z: '$1 个错误' },
  { s: '^(\\d+) warnings?$', z: '$1 个警告' },
  { s: '^(\\d+) (second|minute|hour|day)s? ago$', z: '$1 秒前' },
  { s: '^Just now$', z: '刚刚' },
];

/** 生成 build/dict.json。 */
export function writeDict(root) {
  const sources = loadSources(root);
  const { dict, stats } = buildDict(sources);
  const out = {
    dict,
    patterns: PATTERNS,
    meta: {
      version: 1,
      generatedAt: new Date().toISOString(),
      counts: {
        ...Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, v.used])),
        merged: Object.keys(dict).length,
      },
    },
  };
  const buildDir = path.join(root, 'build');
  fs.mkdirSync(buildDir, { recursive: true });
  fs.writeFileSync(path.join(buildDir, 'dict.json'), JSON.stringify(out));
  return out.meta.counts;
}
