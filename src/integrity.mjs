/**
 * 完整性校验值同步。
 *
 * Cursor 启动时会用 product.json 的 checksums 校验几个核心文件，
 * 内容对不上就弹「安装已损坏」。改完 bundle 必须把哈希重算写回。
 *
 * 算法：sha256(文件内容) → base64 → 去掉尾部 '='
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function checksumOf(buf) {
  return crypto.createHash('sha256').update(buf).digest('base64').replace(/=+$/, '');
}

/** 计算 product.json 里所有 checksums 条目的当前实际值。 */
export function computeChecksums(appRoot) {
  const productFile = path.join(appRoot, 'product.json');
  const product = JSON.parse(fs.readFileSync(productFile, 'utf8'));
  const out = {};
  for (const key of Object.keys(product.checksums || {})) {
    const file = path.join(appRoot, 'out', key);
    if (!fs.existsSync(file)) continue;
    out[key] = checksumOf(fs.readFileSync(file));
  }
  return out;
}

/**
 * 把磁盘上的实际哈希写回 product.json。
 * @returns {{ changed: number, keys: string[] }}
 */
export function syncChecksums(appRoot) {
  const productFile = path.join(appRoot, 'product.json');
  const raw = fs.readFileSync(productFile, 'utf8');
  const product = JSON.parse(raw);
  const keys = [];
  for (const key of Object.keys(product.checksums || {})) {
    const file = path.join(appRoot, 'out', key);
    if (!fs.existsSync(file)) continue;
    const actual = checksumOf(fs.readFileSync(file));
    if (product.checksums[key] !== actual) {
      product.checksums[key] = actual;
      keys.push(key);
    }
  }
  if (!keys.length) return { changed: 0, keys: [] };
  const tmp = `${productFile}.${process.pid}.cursor-zh.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(product, null, '\t'), 'utf8');
  fs.renameSync(tmp, productFile);
  return { changed: keys.length, keys };
}

/**
 * 校验磁盘内容是否与 product.json 一致。
 * 用于 status 命令与安装后的自检。
 */
export function verifyIntegrity(appRoot) {
  const product = JSON.parse(fs.readFileSync(path.join(appRoot, 'product.json'), 'utf8'));
  const mismatched = [];
  let checked = 0;
  for (const [key, expected] of Object.entries(product.checksums || {})) {
    const file = path.join(appRoot, 'out', key);
    if (!fs.existsSync(file)) continue;
    checked++;
    if (checksumOf(fs.readFileSync(file)) !== expected) mismatched.push(key);
  }
  return { ok: mismatched.length === 0, checked, mismatched };
}
