/**
 * Agents Window（molten）补丁。
 *
 * Cursor 3.31 起，智能体窗口改为独立的 molten 渲染进程：
 *   app/molten/dist/electron-main/host.cjs   原生菜单（新建智能体 / 打开文件夹 / 新建终端 …）
 *   app/molten/dist/renderer/assets/*.js     React 界面文案
 *
 * 这部分没有 i18n 机制，只能替换字面量。产物是 ESM/CJS，
 * 每个文件改完都用 node --check 验证，坏了立刻回滚，避免 Cursor 打不开。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { rewrite } from './patcher.mjs';

export function moltenDir(appRoot) {
  return path.join(appRoot, 'molten');
}

/** 第三方库与数据表不补丁。 */
const EXCLUDE = [
  /emoji\.cjs$/,
  /katex/,
  /engine\.cjs$/,   // 语法高亮引擎
  /\.gen-/,          // 集成生成的数据表
  /node_modules/,
  /trace-worker\.cjs$/,
  /search-worker\.cjs$/,
];

function shouldPatch(file) {
  if (!/\.(js|cjs|mjs)$/.test(file)) return false;
  return !EXCLUDE.some((re) => re.test(file));
}

/** 列出所有待补丁文件（相对 molten 目录）。 */
export function listTargets(appRoot) {
  const root = moltenDir(appRoot);
  if (!fs.existsSync(root)) return [];
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(full);
      } else if (shouldPatch(full)) {
        out.push(path.relative(root, full));
      }
    }
  };
  walk(root);
  return out;
}

/** 语法校验：文件能否被 Node 解析。 */
function syntaxOk(file) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    return true;
  } catch { return false; }
}

/** dry-run：只统计不写盘。 */
export function measure(appRoot, dict) {
  let total = 0;
  const perFile = [];
  for (const rel of listTargets(appRoot)) {
    const file = path.join(moltenDir(appRoot), rel);
    let src;
    try { src = fs.readFileSync(file, 'utf8'); }
    catch { continue; }
    try {
      const { text, hits } = rewrite(src, dict);
      if (text === src) continue;
      const n = [...hits.values()].reduce((a, b) => a + b, 0);
      total += n;
      perFile.push({ rel, count: n });
    } catch { /* 跳过单个文件 */ }
  }
  return { total, perFile };
}

/**
 * 应用补丁。写盘后用 node --check 复验，失败就回滚该文件。
 * @param {(rel: string) => void} [backup] 备份回调
 */
export function apply(appRoot, dict, { backup } = {}) {
  const root = moltenDir(appRoot);
  let total = 0;
  const changed = [];
  const rolledBack = [];
  for (const rel of listTargets(appRoot)) {
    const file = path.join(root, rel);
    let src;
    try { src = fs.readFileSync(file, 'utf8'); }
    catch { continue; }
    const { text, hits } = rewrite(src, dict);
    if (text === src) continue;

    if (backup) backup(rel);
    try {
      // 用二进制安全的写法避免 Windows 换行转换（包内文件是 LF）
      fs.writeFileSync(file, text, { encoding: 'utf8' });
      if (!syntaxOk(file)) throw new Error('语法校验失败');
      const n = [...hits.values()].reduce((a, b) => a + b, 0);
      total += n;
      changed.push({ rel, count: n });
    } catch (e) {
      fs.writeFileSync(file, src, 'utf8');
      rolledBack.push({ rel, error: e.message });
    }
  }
  return { total, changed, rolledBack };
}

/** 还原：按备份写回。 */
export function restore(appRoot, backups) {
  const root = moltenDir(appRoot);
  let restored = 0;
  for (const [rel, file] of Object.entries(backups || {})) {
    if (!fs.existsSync(file)) continue;
    const dst = path.join(root, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(file, dst);
    restored++;
  }
  return restored;
}
