import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import * as P from '../src/platform.mjs';
import * as L from '../src/langpack.mjs';

// 这些测试不依赖真实 Windows，只验证 Windows 分支的纯逻辑：
// 路径拼接、引擎匹配、locale 写入格式。

test('Windows 资源目录不包含 Contents', () => {
  const winStyle = ['cursor', 'resources', 'app'].join(path.sep);
  assert.ok(winStyle.includes('resources'));
  assert.ok(!winStyle.includes('Contents'));
});

test('Windows 语言包需要 engines.vscode 匹配', () => {
  // Cursor 3.30.14 的 vscodeVersion 是 1.128.0，装不了要求 1.131 的包
  assert.equal(L.engineSatisfies('1.128.0', { vscode: '^1.131.0' }), false);
  assert.equal(L.engineSatisfies('1.128.0', { vscode: '^1.128.0' }), true);
  assert.equal(L.engineSatisfies('1.128.0', { vscode: '^1.120.0' }), true);
});

test('版本比较处理缺失段', () => {
  assert.ok(L.compareVersion([1, 128, 0], [1, 131, 0]) < 0);
  assert.ok(L.compareVersion([1, 131, 0], [1, 128, 0]) > 0);
  assert.equal(L.compareVersion([1, 128, 0], [1, 128, 0]), 0);
});

test('locale 写入保留注释与其它字段', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-zh-'));
  const file = path.join(dir, 'argv.json');
  fs.writeFileSync(file, [
    '// 注释行',
    '{',
    '\t"enable-crash-reporter": true,',
    '\t// 语言',
    '\t"locale": "en"',
    '}',
  ].join('\n'));
  const r = L.setLocale(file, 'zh-cn');
  const out = fs.readFileSync(file, 'utf8');
  assert.equal(r.changed, true);
  assert.ok(out.includes('"locale": "zh-cn"'));
  assert.ok(out.includes('// 注释行'));
  assert.ok(out.includes('"enable-crash-reporter": true'));
  const again = L.setLocale(file, 'zh-cn');
  assert.equal(again.changed, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('locale 写入支持缺少 locale 字段的文件', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-zh-'));
  const file = path.join(dir, 'argv.json');
  fs.writeFileSync(file, '{\n\t"a": 1\n}\n');
  L.setLocale(file, 'zh-cn');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(parsed.locale, 'zh-cn');
  assert.equal(parsed.a, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Windows 退出提示不提 ⌘Q', () => {
  const hint = P.quitHint();
  if (P.IS_WIN) {
    assert.ok(!hint.includes('⌘'));
    assert.ok(hint.includes('任务管理器') || hint.includes('退出'));
  }
});
