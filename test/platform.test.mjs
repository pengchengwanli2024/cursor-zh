import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as P from '../src/platform.mjs';

test('资源目录随平台变化', () => {
  const root = P.IS_MAC ? '/Applications/Cursor.app' : P.IS_WIN ? 'C:\\Cursor' : '/usr/share/cursor';
  const dir = P.appRoot(root);
  if (P.IS_MAC) assert.ok(dir.endsWith(path.join('Contents', 'Resources', 'app')));
  else assert.ok(dir.endsWith(path.join('resources', 'app')));
});

test('可执行文件名随平台变化', () => {
  const exe = P.executablePath('/x');
  if (P.IS_WIN) assert.ok(exe.endsWith('Cursor.exe'));
  else if (P.IS_MAC) assert.ok(exe.endsWith(path.join('MacOS', 'Cursor')));
  else assert.ok(exe.endsWith('cursor'));
});

test('非安装目录不会被误判', () => {
  assert.equal(P.isInstall('/definitely/not/cursor'), false);
  assert.equal(P.isInstall(''), false);
  assert.equal(P.isInstall(null), false);
});

test('退出提示包含平台正确的方式', () => {
  const hint = P.quitHint();
  assert.ok(typeof hint === 'string' && hint.length > 0);
  if (P.IS_WIN) assert.ok(hint.includes('任务管理器') || hint.includes('退出'));
});

test('argv.json 与扩展目录位置', () => {
  const argv = P.argvJsonPath('.cursor');
  assert.ok(argv.endsWith(path.join('.cursor', 'argv.json')));
  const ext = P.extensionsDir('.cursor');
  assert.ok(ext.endsWith(path.join('.cursor', 'extensions')));
});
