/**
 * 端到端：在临时目录里造一个假的 Cursor 安装，跑完整的 install / status / restore 流程。
 *
 * 这么做的价值：
 *   - 不需要真装 Cursor，CI 上（包括 Windows 与 Linux）也能验证全部逻辑
 *   - 覆盖平台相关的路径拼装、备份、校验值重算、运行时注入、还原
 *   - 假安装按当前平台的真实布局创建（macOS 用 Contents/Resources，Windows/Linux 用 resources）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'src', 'cli.mjs');

/** 6 个受 checksums 保护的文件（相对 appRoot/out），内容随意但必须真实存在。 */
const CHECKSUMMED = [
  'vs/base/parts/sandbox/electron-sandbox/preload.js',
  'vs/workbench/workbench.desktop.main.js',
  'vs/workbench/workbench.desktop.main.css',
  'vs/workbench/api/node/extensionHostProcess.js',
  'vs/code/electron-sandbox/workbench/workbench.html',
  'vs/code/electron-sandbox/workbench/workbench.js',
];

const b64 = (buf) => crypto.createHash('sha256').update(buf).digest('base64').replace(/=+$/, '');

/** 造一个假安装。返回 { root, appRoot, cleanup }。 */
function makeFakeInstall() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-zh-e2e-'));
  // 平台布局：macOS 是 Cursor.app/Contents/Resources/app，其它平台是 cursor/resources/app
  const root = process.platform === 'darwin'
    ? path.join(tmp, 'Cursor.app')
    : path.join(tmp, 'cursor');
  const appRoot = process.platform === 'darwin'
    ? path.join(root, 'Contents', 'Resources', 'app')
    : path.join(root, 'resources', 'app');

  fs.mkdirSync(path.join(appRoot, 'out'), { recursive: true });
  fs.writeFileSync(path.join(appRoot, 'package.json'), JSON.stringify({ name: 'cursor', version: '3.31.11' }));

  // workbench.html：需要能被注入脚本
  const htmlPath = path.join(appRoot, 'out', 'vs/code/electron-sandbox/workbench/workbench.html');
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.writeFileSync(htmlPath, '<html><body>\n\t\t<script src="./workbench.js"></script>\n</body></html>\n');

  // bundle：放几个 UI 字面量，验证静态补丁真的替换
  const bundlePath = path.join(appRoot, 'out', 'vs/workbench/workbench.desktop.main.js');
  fs.mkdirSync(path.dirname(bundlePath), { recursive: true });
  fs.writeFileSync(bundlePath, [
    'const menu = [{ id: "a", title: "New Agent" }, { id: "b", label: "Cancel" }];',
    'const cmd = { command: "terminal.new", title: "New Terminal" };',
    'export default menu;',
  ].join('\n'));

  // 其余被校验的文件
  for (const rel of CHECKSUMMED) {
    const p = path.join(appRoot, 'out', rel);
    if (fs.existsSync(p)) continue;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '// ' + rel + '\n');
  }

  // product.json：checksums 按真实算法预填
  const checksums = {};
  for (const rel of CHECKSUMMED) {
    checksums[rel] = b64(fs.readFileSync(path.join(appRoot, 'out', rel)));
  }
  fs.writeFileSync(path.join(appRoot, 'product.json'), JSON.stringify({
    nameShort: 'Cursor',
    nameLong: 'Cursor',
    version: '3.31.11',
    vscodeVersion: '1.128.0',
    commit: 'fakesha0000000000000000000000000000000',
    dataFolderName: '.cursor',
    checksums,
  }, null, 2));

  return { tmp, root, appRoot, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

function runCli(args, env) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      // 数据目录放进临时目录，别污染真实 ~/.cursor-zh
      CURSOR_ZH_HOME: env.CURSOR_ZH_HOME,
      // 测试环境允许「Cursor 在运行」，否则本机真有 Cursor 开着就会失败
      CURSOR_ZH_ALLOW_RUNNING: '1',
      NO_COLOR: '1',
    },
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

test('假安装：install → 补丁生效 → 校验值同步 → restore 还原', () => {
  const fake = makeFakeInstall();
  const dataDir = path.join(fake.tmp, 'data');
  const env = { CURSOR_ZH_HOME: dataDir };
  try {
    // 1) 安装（跳过语言包，避免联网与真实 Cursor CLI）
    const inst = runCli(['install', '--dir', fake.root, '--skip-language-pack'], env);
    assert.equal(inst.code, 0, 'install 应该成功：\n' + inst.out);

    // 2) 静态补丁生效
    const bundle = fs.readFileSync(path.join(fake.appRoot, 'out', 'vs/workbench/workbench.desktop.main.js'), 'utf8');
    assert.match(bundle, /title:\s*"新建智能体"/, 'title 应被翻译：' + bundle);
    assert.match(bundle, /label:\s*"取消"/, 'label 应被翻译：' + bundle);
    assert.ok(!bundle.includes('"New Agent"'), '英文原文应消失');

    // 3) workbench.html 注入了运行时脚本
    const html = fs.readFileSync(path.join(fake.appRoot, 'out', 'vs/code/electron-sandbox/workbench/workbench.html'), 'utf8');
    assert.ok(html.includes('cursor-zh.js'), '应注入运行时脚本');

    // 4) 运行时代码写出来了，且内联了词典
    const runtime = fs.readFileSync(path.join(fake.appRoot, 'out', 'vs/code/electron-sandbox/workbench/cursor-zh.js'), 'utf8');
    assert.ok(runtime.includes('window.__CURSOR_ZH_DICT='), '运行时应有词典');
    assert.ok(runtime.length > 1000, '运行时不应为空');

    // 5) 校验值重算后与磁盘一致（否则 Cursor 会报「安装已损坏」）
    const product = JSON.parse(fs.readFileSync(path.join(fake.appRoot, 'product.json'), 'utf8'));
    for (const rel of CHECKSUMMED) {
      const actual = b64(fs.readFileSync(path.join(fake.appRoot, 'out', rel)));
      assert.equal(product.checksums[rel], actual, '校验值应与磁盘一致：' + rel);
    }

    // 6) status 报告已启用
    const status = runCli(['status', '--dir', fake.root], env);
    assert.equal(status.code, 0, status.out);
    assert.ok(status.out.includes('运行时注入：已启用'), status.out);
    assert.ok(status.out.includes('完整性校验：通过'), status.out);

    // 7) 第二次 install 幂等（不重复翻译、不破坏文件）
    const again = runCli(['install', '--dir', fake.root, '--skip-language-pack'], env);
    assert.equal(again.code, 0, again.out);
    const bundle2 = fs.readFileSync(path.join(fake.appRoot, 'out', 'vs/workbench/workbench.desktop.main.js'), 'utf8');
    assert.match(bundle2, /title:\s*"新建智能体"/);
    assert.equal((bundle2.match(/新建智能体/g) || []).length, 1, '不应重复替换');

    // 8) restore 回到英文
    const restore = runCli(['restore', '--dir', fake.root], env);
    assert.equal(restore.code, 0, restore.out);
    const bundle3 = fs.readFileSync(path.join(fake.appRoot, 'out', 'vs/workbench/workbench.desktop.main.js'), 'utf8');
    assert.ok(bundle3.includes('"New Agent"'), '还原后应恢复英文：' + bundle3);
    assert.ok(!bundle3.includes('新建智能体'), '还原后不应残留中文');
    const html3 = fs.readFileSync(path.join(fake.appRoot, 'out', 'vs/code/electron-sandbox/workbench/workbench.html'), 'utf8');
    assert.ok(!html3.includes('cursor-zh.js'), '还原后应移除注入');
    assert.ok(!fs.existsSync(path.join(fake.appRoot, 'out', 'vs/code/electron-sandbox/workbench/cursor-zh.js')), '还原后应删除运行时文件');

    // 9) 还原后校验值仍然自洽
    const product3 = JSON.parse(fs.readFileSync(path.join(fake.appRoot, 'product.json'), 'utf8'));
    for (const rel of CHECKSUMMED) {
      assert.equal(product3.checksums[rel], b64(fs.readFileSync(path.join(fake.appRoot, 'out', rel))), '还原后校验值应自洽：' + rel);
    }
  } finally {
    fake.cleanup();
  }
});

test('doctor 能识别假安装并提供平台信息', () => {
  const fake = makeFakeInstall();
  try {
    const r = runCli(['doctor', '--dir', fake.root], { CURSOR_ZH_HOME: path.join(fake.tmp, 'data') });
    assert.equal(r.code, 0, r.out);
    assert.ok(r.out.includes('平台：'), r.out);
    assert.ok(r.out.includes('Cursor：3.31.11'), r.out);
    assert.ok(r.out.includes('可写：是'), r.out);
  } finally {
    fake.cleanup();
  }
});

test('指向非 Cursor 目录时给出明确错误而不是乱改文件', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-zh-bad-'));
  try {
    const r = runCli(['install', '--dir', tmp, '--skip-language-pack'], { CURSOR_ZH_HOME: path.join(tmp, 'data') });
    assert.notEqual(r.code, 0, '应失败');
    assert.ok(/不是 Cursor 安装目录/.test(r.out), r.out);
    assert.deepEqual(fs.readdirSync(tmp), [], '不应写入任何文件');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('--dry-run 不修改任何文件', () => {
  const fake = makeFakeInstall();
  try {
    const before = fs.readFileSync(path.join(fake.appRoot, 'out', 'vs/workbench/workbench.desktop.main.js'), 'utf8');
    const r = runCli(['install', '--dir', fake.root, '--dry-run', '--skip-language-pack'], { CURSOR_ZH_HOME: path.join(fake.tmp, 'data') });
    assert.equal(r.code, 0, r.out);
    const after = fs.readFileSync(path.join(fake.appRoot, 'out', 'vs/workbench/workbench.desktop.main.js'), 'utf8');
    assert.equal(after, before, 'dry-run 不应改文件');
  } finally {
    fake.cleanup();
  }
});
