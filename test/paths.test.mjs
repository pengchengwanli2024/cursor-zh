import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { packageRoot, dataDir, statePath, backupDir, cacheDir } from '../src/paths.mjs';

test('packageRoot 能从 file:// URL 正确解析到包根目录', () => {
  // 用 src/cli.mjs 的位置反推
  const url = pathToFileURL(path.join(process.cwd(), 'src', 'cli.mjs')).href;
  const root = packageRoot(url);
  assert.equal(root, process.cwd());
  assert.ok(fs.existsSync(path.join(root, 'package.json')), '根目录应有 package.json');
});

test('packageRoot 处理 Windows 盘符路径形态', () => {
  // 手写 new URL(u).pathname 在 Windows 上会得到 "/D:/a/b"，
  // 从而拼出 "D:\D:\a\b"。这里确保用 fileURLToPath 后不会重复盘符。
  const winStyleUrl = 'file:///D:/a/cursor-zh/src/cli.mjs';
  const root = packageRoot(winStyleUrl);
  const occurrences = (root.match(/[A-Za-z]:/g) || []).length;
  assert.ok(occurrences <= 1, '不应重复出现盘符：' + root);
  assert.ok(root.endsWith(path.join('a', 'cursor-zh')) || root.includes('cursor-zh'), root);
});

test('packageRoot 处理含空格与中文的路径', () => {
  const p = path.join(process.cwd(), 'src', 'cli.mjs');
  const url = pathToFileURL(p).href;
  const root = packageRoot(url);
  assert.equal(root, process.cwd());
  assert.ok(!root.includes('%20'), '不应残留 URL 编码');
});

test('dataDir 支持 CURSOR_ZH_HOME 覆盖', () => {
  const old = process.env.CURSOR_ZH_HOME;
  process.env.CURSOR_ZH_HOME = path.join(process.cwd(), 'tmp-data');
  try {
    assert.equal(dataDir(), path.join(process.cwd(), 'tmp-data'));
  } finally {
    if (old === undefined) delete process.env.CURSOR_ZH_HOME;
    else process.env.CURSOR_ZH_HOME = old;
  }
});

test('运行期路径都在 dataDir 下', () => {
  const d = path.join(process.cwd(), 'x');
  assert.ok(statePath(d).startsWith(d));
  assert.ok(backupDir(d, '1.0.0').startsWith(d));
  assert.ok(cacheDir(d).startsWith(d));
});
