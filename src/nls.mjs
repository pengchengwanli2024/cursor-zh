/**
 * NLS 补全：把语言包没覆盖到的 VS Code / Cursor 原生界面文案补上。
 *
 * Cursor 启动时会做一次合并：
 *   out/nls.keys.json      { 模块: [键, 键, ...] }
 *   out/nls.messages.json  [英文, 英文, ...]           —— 按全局下标平铺
 *   语言包 main.i18n.json  { contents: { 模块: { 键: 译文 } } }
 * 合并规则是 contents[模块][键] 优先，缺失就回退英文。
 *
 * 所以「语言包某些文案仍是英文」等价于「contents 里缺这个键」。
 * 我们可以在安装时按 (模块, 键) → 英文 → 中文 把缺口补进语言包，
 * 然后删掉 Cursor 的合并缓存让它重建。
 */
import fs from 'node:fs';
import path from 'node:path';
import { checksumOf } from './integrity.mjs';

/** 读取 Cursor 自带的英文基准表，返回 [{ module, key, index, english }]。 */
export function readNlsIndex(appRoot) {
  const keysFile = path.join(appRoot, 'out', 'nls.keys.json');
  const msgFile = path.join(appRoot, 'out', 'nls.messages.json');
  if (!fs.existsSync(keysFile) || !fs.existsSync(msgFile)) return [];
  const keys = JSON.parse(fs.readFileSync(keysFile, 'utf8'));
  const messages = JSON.parse(fs.readFileSync(msgFile, 'utf8'));

  // 两种形态都兼容：
  //   [ [模块, [键...]], ... ]   （Cursor / VS Code 实际产物）
  //   { 模块: [键...] }          （某些版本）
  const pairs = Array.isArray(keys)
    ? keys.map((entry) => (Array.isArray(entry) ? entry : [entry.module, entry.keys]))
    : Object.entries(keys);

  const out = [];
  let index = 0;
  for (const [module, list] of pairs) {
    if (!Array.isArray(list)) continue;
    for (const key of list) {
      out.push({ module, key, index, english: messages[index] });
      index++;
    }
  }
  return out;
}

/** 找到已安装语言包的简体中文译文文件。 */
export function findPackTranslation(extDir) {
  let entries;
  try { entries = fs.readdirSync(extDir); }
  catch { return null; }
  // 优先 Cursor 专用包，其次微软官方包
  const ordered = entries
    .filter((d) => d.includes('language-pack') || d.includes('languagepack'))
    .sort((a, b) => (b.startsWith('polang233') ? 1 : 0) - (a.startsWith('polang233') ? 1 : 0));
  for (const dir of ordered) {
    const file = path.join(extDir, dir, 'translations', 'zh-cn', 'main.i18n.json');
    if (fs.existsSync(file)) return { dir: path.join(extDir, dir), file };
  }
  return null;
}

/**
 * 补齐语言包缺口。
 * @returns {{ filled: number, total: number, file: string|null, changed: boolean }}
 */
export function fillPackGaps(appRoot, extDir, dict, { dryRun } = {}) {
  const pack = findPackTranslation(extDir);
  if (!pack) return { filled: 0, total: 0, file: null, changed: false };

  const index = readNlsIndex(appRoot);
  if (!index.length) return { filled: 0, total: 0, file: pack.file, changed: false };

  const raw = fs.readFileSync(pack.file, 'utf8');
  const packJson = JSON.parse(raw);
  const contents = packJson.contents || (packJson.contents = {});

  let filled = 0;
  for (const { module, key, english } of index) {
    if (typeof english !== 'string' || !english) continue;
    const bucket = contents[module] || (contents[module] = {});
    const current = bucket[key];
    // 已经有中文译文就跳过
    if (typeof current === 'string' && /[\u4e00-\u9fff]/.test(current)) continue;
    const zh = dict[english];
    if (typeof zh !== 'string' || !zh || zh === english) continue;
    bucket[key] = zh;
    filled++;
  }

  if (!filled) return { filled: 0, total: index.length, file: pack.file, changed: false };
  if (!dryRun) fs.writeFileSync(pack.file, JSON.stringify(packJson), 'utf8');
  return { filled, total: index.length, file: pack.file, changed: true };
}

/**
 * 删除 Cursor 的 NLS 合并缓存，下次启动会按新的语言包重建。
 * 缓存位置：<userData>/clp/<hash>.<locale>/<commit>/
 */
export function clearNlsCache(userDataPath) {
  const clp = path.join(userDataPath, 'clp');
  let removed = 0;
  try {
    for (const name of fs.readdirSync(clp)) {
      const target = path.join(clp, name);
      try { fs.rmSync(target, { recursive: true, force: true }); removed++; } catch { /* 被占用就下次再说 */ }
    }
  } catch { /* 目录不存在 */ }
  return removed;
}

/** 语言包译文文件的哈希，写进 state 便于还原判断。 */
export function packHash(file) {
  try { return checksumOf(fs.readFileSync(file)).slice(0, 16); }
  catch { return null; }
}
