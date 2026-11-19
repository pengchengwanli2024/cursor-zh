#!/usr/bin/env node
/**
 * 轻量自检（不引入 eslint，保持零依赖）：
 *   - 所有源文件能被 Node 解析
 *   - 词典源文件是合法 JSON，且译文都含中文
 *   - README 里引用的文件真实存在
 *   - CLI 的 --help / --version 能跑通
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const warn = [];

function check(cond, msg) {
  if (!cond) errors.push(msg);
}

function parseOk(file) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  return r.status === 0 ? null : (r.stderr || '').split('\n').slice(0, 4).join(' ');
}

// 1. 语法
for (const dir of ['src', 'scripts', 'test']) {
  const d = path.join(ROOT, dir);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) {
    if (!/\.(mjs|js)$/.test(f)) continue;
    const err = parseOk(path.join(d, f));
    check(!err, `${dir}/${f} 语法错误：${err}`);
  }
}

// 2. 词典源
const sourcesDir = path.join(ROOT, 'sources');
if (fs.existsSync(sourcesDir)) {
  for (const f of fs.readdirSync(sourcesDir)) {
    if (!f.endsWith('.json')) continue;
    const p = path.join(sourcesDir, f);
    let data;
    try { data = JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (e) { errors.push(`sources/${f} 不是合法 JSON：${e.message}`); continue; }
    let bad = 0;
    for (const [k, v] of Object.entries(data)) {
      if (k.startsWith('$')) continue;
      if (typeof v !== 'string') { bad++; continue; }
      if (!/[\u4e00-\u9fff]/.test(v)) bad++;
    }
    check(bad === 0, `sources/${f} 有 ${bad} 条译文不含中文或类型不对`);
  }
}

// 3. README 引用的本地文件存在
const readme = path.join(ROOT, 'README.md');
if (fs.existsSync(readme)) {
  const text = fs.readFileSync(readme, 'utf8');
  for (const m of text.matchAll(/\]\(([^)#]+\.(?:mjs|js|json|md))\)/g)) {
    const target = m[1];
    if (/^https?:/.test(target)) continue;
    check(fs.existsSync(path.join(ROOT, target)), `README 引用了不存在的文件：${target}`);
  }
}

// 4. CLI 基本可用
for (const arg of ['--version', '--help']) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'src', 'cli.mjs'), arg], { encoding: 'utf8' });
  check(r.status === 0, `cli.mjs ${arg} 退出码 ${r.status}：${(r.stderr || '').slice(0, 200)}`);
}

// 5. 包元数据
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
check(pkg.license === 'MIT', 'package.json 应有 license 字段');
check(Array.isArray(pkg.os) && pkg.os.length === 3, 'package.json 的 os 应含 darwin/win32/linux');
check(!!pkg.bin && !!pkg.bin['cursor-zh'], 'package.json 应有 bin.cursor-zh');

if (errors.length) {
  console.error('自检失败：');
  for (const e of errors) console.error('  x ' + e);
  process.exit(1);
}
console.log('自检通过。' + (warn.length ? ` （${warn.length} 条警告）` : ''));
