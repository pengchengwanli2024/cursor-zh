/**
 * 路径约定。
 *
 * 代码与词典跟着包走（可能位于 npx 缓存或 node_modules 里，通常是只读的），
 * 运行期状态（备份、缓存、state.json）放在用户目录，保证：
 *   - npx 运行时不会往只读位置写
 *   - 卸载/重装包后仍能还原
 *   - 测试可以用 CURSOR_ZH_HOME 指到临时目录
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 代码根目录（package.json 所在处）。
 *
 * 必须用 fileURLToPath 而不是手写 new URL().pathname：
 * 后者在 Windows 上会得到 "/D:/a/repo/src"，拼出 "D:\D:\a\repo" 这种非法路径。
 */
export function packageRoot(moduleUrl) {
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), '..');
}

/** 运行期数据目录；可用 CURSOR_ZH_HOME 覆盖（测试与便携安装用）。 */
export function dataDir() {
  if (process.env.CURSOR_ZH_HOME) return path.resolve(process.env.CURSOR_ZH_HOME);
  return path.join(os.homedir(), '.cursor-zh');
}

export function statePath(dir) {
  return path.join(dir, 'state.json');
}

export function backupDir(dir, version) {
  return path.join(dir, 'backup', version || 'unknown');
}

export function cacheDir(dir) {
  return path.join(dir, 'cache');
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
