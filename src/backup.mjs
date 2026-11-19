/**
 * 备份与还原。
 *
 * 每次改文件前先把它存到 <dataDir>/backup/<version>/<扁平名>，
 * 还原时按 state.json 的记录逐个写回，再重算完整性校验值。
 *
 * 备份放在用户目录而不是包里：npx 安装的包可能只读，
 * 而且包升级/重装后仍要能还原。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { backupDir, statePath } from './paths.mjs';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** 相对路径 → 扁平文件名（Windows 上避免长路径与目录创建问题）。 */
export function backupName(rel) {
  return rel.split(/[\\/]+/).join('__');
}

/**
 * 备份一个文件（只备份一次，保留被修改前的原件）。
 * rel 是相对 appRoot/out 的路径。
 */
export function backupFile(dataDirPath, version, appRoot, rel) {
  return backupFrom(dataDirPath, version, path.join(appRoot, 'out', rel), rel);
}

/**
 * 从任意绝对路径备份，rel 只用来生成备份名。
 * 用于 molten 这类不在 appRoot/out 下的目录。
 */
export function backupFrom(dataDirPath, version, srcPath, rel) {
  const dir = backupDir(dataDirPath, version);
  fs.mkdirSync(dir, { recursive: true });
  const dst = path.join(dir, backupName(rel));
  if (fs.existsSync(dst)) return dst;
  fs.copyFileSync(srcPath, dst);
  return dst;
}

export function loadState(dataDirPath) {
  try { return JSON.parse(fs.readFileSync(statePath(dataDirPath), 'utf8')); }
  catch { return { version: 1, files: {} }; }
}

export function saveState(dataDirPath, state) {
  fs.mkdirSync(dataDirPath, { recursive: true });
  fs.writeFileSync(statePath(dataDirPath), JSON.stringify(state, null, 2));
}

/**
 * 按 state 还原所有被改过的文件。
 * rel 以 molten/ 开头的是智能体窗口文件，其余都在 appRoot/out 下。
 */
export function restoreAll(state, appRoot) {
  let restored = 0;
  const missing = [];
  for (const [rel, info] of Object.entries(state.files || {})) {
    if (!info || !info.backup) continue;
    if (!fs.existsSync(info.backup)) { missing.push(rel); continue; }
    const dst = resolveTarget(appRoot, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(info.backup, dst);
    restored++;
  }
  return { restored, missing };
}

/** 由记录的相对路径还原出真实目标路径。 */
export function resolveTarget(appRoot, rel) {
  const normalized = rel.split('\\').join('/');
  if (normalized.startsWith('molten/')) {
    return path.join(appRoot, normalized);
  }
  return path.join(appRoot, 'out', normalized);
}

/** 校验备份与记录的哈希是否一致（防止备份本身损坏）。 */
export function verifyBackups(state) {
  const bad = [];
  for (const [rel, info] of Object.entries(state.files || {})) {
    if (!info || !info.backup || !info.hash) continue;
    try {
      if (sha256(fs.readFileSync(info.backup)) !== info.hash) bad.push(rel);
    } catch { bad.push(rel); }
  }
  return bad;
}
