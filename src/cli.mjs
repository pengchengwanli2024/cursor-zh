#!/usr/bin/env node
/**
 * cursor-zh —— 让 Cursor 全界面说中文。
 *
 *   npx cursor-zh              安装 / Cursor 升级后重打
 *   npx cursor-zh status       查看状态
 *   npx cursor-zh restore      还原英文
 *   npx cursor-zh doctor       环境自检
 *
 * 三层叠加：
 *   1. 语言包   VS Code 继承的界面（菜单、设置项、命令面板）
 *   2. 静态补丁 Cursor 私有界面里硬编码在 bundle 的文案
 *   3. 运行时   DOM 层的动态文案（提示条、Toast、按需渲染组件）
 */
import fs from 'node:fs';
import path from 'node:path';

import * as P from './platform.mjs';
import * as D from './dictionary.mjs';
import * as B from './backup.mjs';
import * as I from './integrity.mjs';
import * as INJ from './injector.mjs';
import * as L from './langpack.mjs';
import * as M from './molten.mjs';
import * as N from './nls.mjs';
import * as PATHX from './paths.mjs';
import { patchFile, rewrite } from './patcher.mjs';

/** 代码根目录（只读也可用：词典、运行时模板、package.json）。 */
const PKG_ROOT = PATHX.packageRoot(import.meta.url);

/** 运行期数据目录（备份、缓存、状态）。 */
const DATA = PATHX.dataDir();

/** 静态补丁会修改的 bundle（相对 appRoot/out）。 */
export const BUNDLES = [
  'vs/workbench/workbench.desktop.main.js',
  'vs/workbench/workbench.glass.main.js',
  'vs/workbench/workbench.anysphere-ui-automations.js',
  'vs/workbench/workbench.xai-commerce-prepaid.js',
];

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = {
  ok: (m) => console.log(paint(32, '+') + ' ' + m),
  info: (m) => console.log('  ' + m),
  warn: (m) => console.log(paint(33, '!') + ' ' + m),
  err: (m) => console.error(paint(31, 'x') + ' ' + m),
  dim: (m) => console.log(paint(2, '  ' + m)),
};

function parseArgs(argv) {
  const args = { command: 'install', dir: null, dryRun: false, yes: false, skipLangpack: false, force: false };
  const rest = argv.slice();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--dir') { args.dir = rest[++i]; continue; }
    if (a.startsWith('--dir=')) { args.dir = a.slice(6); continue; }
    if (a === '--dry-run') { args.dryRun = true; continue; }
    if (a === '--yes' || a === '-y') { args.yes = true; continue; }
    if (a === '--force') { args.force = true; continue; }
    if (a === '--skip-language-pack') { args.skipLangpack = true; continue; }
    if (a === '--help' || a === '-h') { args.command = 'help'; continue; }
    if (a === '--version' || a === '-v') { args.command = 'version'; continue; }
    if (['install', 'status', 'restore', 'doctor', 'help', 'version'].includes(a)) { args.command = a; continue; }
    if (a.startsWith('-')) throw new Error('未知选项：' + a);
  }
  return args;
}

function resolveInstall(args) {
  if (args.dir) {
    const dir = path.resolve(args.dir);
    if (!P.isInstall(dir)) {
      throw new Error(
        '--dir 指向的不是 Cursor 安装目录：' + dir + '\n' +
        '  应该是包含 ' + (P.IS_MAC ? 'Contents/Resources/app' : 'resources/app') + ' 的那一层。',
      );
    }
    return { installRoot: dir, appRoot: P.appRoot(dir) };
  }
  const found = P.findInstalls();
  if (!found.length) {
    throw new Error(
      '没有找到 Cursor 安装目录，请用 --dir 指定：\n  ' +
      (P.IS_MAC ? '--dir /Applications/Cursor.app'
        : P.IS_WIN ? '--dir "%LOCALAPPDATA%\\Programs\\cursor"'
        : '--dir /usr/share/cursor'),
    );
  }
  if (found.length > 1) {
    c.warn('检测到多个 Cursor 安装：');
    for (const f of found) c.info(f.installRoot);
    throw new Error('请用 --dir 指定要处理哪一个。');
  }
  return found[0];
}

function loadDict() {
  const file = path.join(PKG_ROOT, 'build', 'dict.json');
  if (!fs.existsSync(file)) {
    c.info('生成词典…');
    D.writeDict(PKG_ROOT);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function requireStopped(installRoot, force) {
  const running = P.isRunning(installRoot);
  if (!running.running) return true;
  // 测试用：假安装目录不会真被占用，允许跳过
  if (process.env.CURSOR_ZH_ALLOW_RUNNING === '1') return true;
  if (force) {
    c.warn('Cursor 仍在运行，尝试请它退出…');
    P.requestQuit();
    for (let i = 0; i < 40; i++) {
      if (!P.isRunning(installRoot).running) return true;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
  c.err('Cursor 正在运行。' + P.quitHint());
  c.dim('检测到的进程：' + running.pids.join(', '));
  return false;
}

// ---------- install ----------

async function cmdInstall(args, install) {
  const { installRoot, appRoot } = install;
  const info = P.readInfo(appRoot);
  c.info(info.productName + ' ' + info.cursorVersion + '（VS Code ' + info.vscodeVersion + '）');
  c.info('安装目录：' + installRoot);

  if (!requireStopped(installRoot, args.force)) return 1;

  if (!P.canWriteInstall(installRoot)) {
    if (P.IS_WIN && !P.isElevated()) {
      c.err('没有写入权限：Cursor 安装在需要管理员权限的位置。');
      c.dim('请右键「终端」→「以管理员身份运行」，然后重试同一条命令。');
    } else {
      c.err('无法写入安装目录：' + appRoot);
    }
    return 1;
  }

  const dictJson = loadDict();
  c.info('词典 ' + Object.keys(dictJson.dict).length + ' 条');

  // 1. 语言包
  if (!args.skipLangpack) {
    c.info('语言包：');
    try {
      const res = await L.ensureLanguagePack({
        installRoot,
        appRoot,
        info,
        cacheDir: PATHX.cacheDir(DATA),
        extDir: P.extensionsDir(info.dataFolderName),
        argvFile: P.argvJsonPath(info.dataFolderName),
        dryRun: args.dryRun,
      });
      for (const line of res.log) c.dim(line);
      if (!res.ok) c.warn('语言包未安装，VS Code 原生界面可能仍是英文。');
    } catch (e) {
      c.warn('语言包安装出错：' + e.message);
    }
  }

  // 1b. 语言包缺口：把 Cursor 自带 NLS 表里语言包没覆盖的条目补进去
  let nlsFilled = 0;
  if (!args.dryRun) {
    try {
      const res = N.fillPackGaps(appRoot, P.extensionsDir(info.dataFolderName), dictJson.dict);
      if (res.changed) {
        nlsFilled = res.filled;
        c.dim('语言包补全 ' + res.filled + ' 条缺失译文');
      }
    } catch (e) {
      c.dim('语言包补全跳过：' + e.message);
    }
  }

  // 2. 静态补丁
  let totalPatches = 0;
  const changed = [];
  c.info('静态补丁：');
  for (const rel of BUNDLES) {
    const file = path.join(appRoot, 'out', rel);
    if (!fs.existsSync(file)) { c.dim('跳过（不存在）' + rel); continue; }
    if (args.dryRun) {
      const src = fs.readFileSync(file, 'utf8');
      const { text, hits } = rewrite(src, dictJson.dict);
      if (text !== src) {
        const n = [...hits.values()].reduce((a, b) => a + b, 0);
        totalPatches += n;
        c.dim(rel + ' → ' + n + ' 处');
      }
      continue;
    }
    B.backupFile(DATA, info.cursorVersion, appRoot, rel);
    const r = patchFile(file, dictJson.dict);
    if (r.changed) {
      totalPatches += r.count;
      changed.push(rel);
      c.dim(rel + ' → ' + r.count + ' 处');
    }
  }

  // 2b. 智能体窗口（Cursor 3.31 起的 molten 渲染进程）
  let moltenPatches = 0;
  if (M.listTargets(appRoot).length) {
    c.info('智能体窗口：');
    if (args.dryRun) {
      const m = M.measure(appRoot, dictJson.dict);
      moltenPatches = m.total;
      for (const f of m.perFile) c.dim(f.rel + ' → ' + f.count + ' 处');
    } else {
      const res = M.apply(appRoot, dictJson.dict, {
        backup: (rel) => {
          const norm = rel.split(path.sep).join('/');
          return B.backupFrom(DATA, info.cursorVersion, path.join(appRoot, 'molten', rel), 'molten/' + norm);
        },
      });
      moltenPatches = res.total;
      for (const f of res.changed) {
        c.dim(f.rel + ' → ' + f.count + ' 处');
        changed.push(path.posix.join('molten', f.rel.split(path.sep).join('/')));
      }
      for (const f of res.rolledBack) c.warn('已回滚（语法校验失败）：' + f.rel);
    }
  }

  // 3. 运行时注入
  const tpl = fs.readFileSync(path.join(PKG_ROOT, 'src', 'runtime.js'), 'utf8');
  const runtimeSource = INJ.buildRuntimeSource(tpl, dictJson);

  if (args.dryRun) {
    c.info('[dry-run] 会注入运行时翻译层并重算完整性校验值');
    c.info('共 ' + totalPatches + ' 处静态替换');
    return 0;
  }

  c.info('运行时翻译层：');
  // 注入前先备份 workbench.html，否则备份下来的就是注入后的版本，还原会还原不掉
  const htmlBackup = B.backupFile(DATA, info.cursorVersion, appRoot, INJ.WORKBENCH_HTML_REL);
  const inj = INJ.inject(appRoot, runtimeSource);
  if (!inj.injected) {
    c.warn(inj.reason || '运行时注入失败');
    c.warn('静态汉化已生效，但动态文案可能仍是英文。');
  } else {
    c.dim('已注入（词典 ' + Object.keys(dictJson.dict).length + ' 条）');
  }

  // 3b. 智能体窗口运行时
  const moltenInj = INJ.injectMolten(appRoot, runtimeSource);
  if (moltenInj.injected) c.dim('智能体窗口已注入');
  else if (moltenInj.reason) c.dim(moltenInj.reason);

  // 3c. 清掉 NLS 合并缓存，让补全后的语言包在下次启动生效
  if (nlsFilled) {
    const removed = N.clearNlsCache(P.userDataDir());
    if (removed) c.dim('已清理 ' + removed + ' 个 NLS 缓存，启动时自动重建');
  }

  // 4. 完整性校验值
  const sums = I.syncChecksums(appRoot);
  if (sums.changed) c.dim('已重算 ' + sums.changed + ' 个完整性校验值');

  // 5. 记录状态
  const state = B.loadState(DATA);
  state.files = state.files || {};
  for (const rel of changed) {
    state.files[rel] = {
      backup: path.join(PATHX.backupDir(DATA, info.cursorVersion), B.backupName(rel)),
    };
  }
  state.files[INJ.WORKBENCH_HTML_REL] = { backup: htmlBackup };
  state.cursorVersion = info.cursorVersion;
  state.commit = info.commit;
  state.vscodeVersion = info.vscodeVersion;
  state.updatedAt = new Date().toISOString();
  B.saveState(DATA, state);

  c.ok('完成：' + totalPatches + ' 处静态替换' + (moltenPatches ? ' + ' + moltenPatches + ' 处智能体窗口' : '') + ' + 运行时翻译层。');
  c.info('重新打开 Cursor 生效。Cursor 升级后重跑同一条命令即可。');
  return 0;
}

// ---------- status ----------

function cmdStatus(args, install) {
  const { appRoot } = install;
  const info = P.readInfo(appRoot);
  const state = B.loadState(DATA);
  let dictCount = 0;
  try { dictCount = Object.keys(loadDict().dict).length; } catch { /* 词典缺失不算致命 */ }

  console.log(info.productName + ' ' + info.cursorVersion + '（VS Code ' + info.vscodeVersion + '）');
  console.log('安装目录：' + appRoot);
  console.log('运行时注入：' + (INJ.isInjected(appRoot) ? '已启用' : '未启用'));
  console.log('智能体窗口注入：' + (INJ.isMoltenInjected(appRoot) ? '已启用' : '未启用'));
  console.log('词典：' + dictCount + ' 条');
  console.log('记录版本：' + (state.cursorVersion || '无'));
  if (state.cursorVersion && state.cursorVersion !== info.cursorVersion) {
    c.warn('Cursor 已升级（' + state.cursorVersion + ' → ' + info.cursorVersion + '），需要重跑 install。');
  }
  const integ = I.verifyIntegrity(appRoot);
  console.log('完整性校验：' + (integ.ok ? '通过' : '不一致（' + integ.mismatched.join(', ') + '）'));
  const ext = L.installedExtensions(P.extensionsDir(info.dataFolderName));
  const pack = L.CANDIDATES.map((x) => (x.namespace + '.' + x.name).toLowerCase()).find((id) => ext[id]);
  console.log('语言包：' + (pack ? pack + '@' + ext[pack] : '未安装'));
  return 0;
}

// ---------- restore ----------

function cmdRestore(args, install) {
  const { appRoot, installRoot } = install;
  const info = P.readInfo(appRoot);
  if (!requireStopped(installRoot, args.force)) return 1;

  const state = B.loadState(DATA);
  const hasFiles = state.files && Object.keys(state.files).length;
  if (!hasFiles && !INJ.isInjected(appRoot)) {
    c.warn('没有可还原的记录。');
    return 0;
  }
  INJ.uninject(appRoot);
  INJ.uninjectMolten(appRoot);
  const { restored, missing } = B.restoreAll(state, appRoot);
  if (missing.length) c.warn('以下文件缺少备份：' + missing.join(', '));
  I.syncChecksums(appRoot);
  B.saveState(DATA, { version: 1, files: {} });
  c.ok('已还原 ' + restored + ' 个文件并重算校验值。重新打开 Cursor 即可。');
  c.dim('语言包保留在扩展目录；如需彻底移除，在 Cursor 扩展面板里卸载语言包。');
  return 0;
}

// ---------- doctor ----------

function cmdDoctor(args, install) {
  const { installRoot, appRoot } = install;
  const info = P.readInfo(appRoot);
  console.log('平台：' + P.PLATFORM + ' / ' + process.arch);
  console.log('Node：' + process.versions.node);
  console.log('Cursor：' + info.cursorVersion + '（VS Code ' + info.vscodeVersion + '）');
  console.log('安装目录：' + installRoot);
  console.log('资源目录：' + appRoot);
  console.log('数据目录：' + DATA);
  console.log('可写：' + (P.canWriteInstall(installRoot) ? '是' : '否'));
  if (P.IS_WIN) console.log('管理员：' + (P.isElevated() ? '是' : '否'));
  const running = P.isRunning(installRoot);
  console.log('运行中：' + (running.running ? '是（pid ' + running.pids.join(', ') + '）' : '否'));
  console.log('argv.json：' + P.argvJsonPath(info.dataFolderName));
  console.log('扩展目录：' + P.extensionsDir(info.dataFolderName));
  console.log('注入：' + (INJ.isInjected(appRoot) ? '已启用' : '未启用'));
  const integ = I.verifyIntegrity(appRoot);
  console.log('完整性：' + (integ.ok ? '通过' : '不一致：' + integ.mismatched.join(', ')));
  return 0;
}

function usage() {
  const dirHint = P.IS_MAC ? '/Applications/Cursor.app'
    : P.IS_WIN ? '"%LOCALAPPDATA%\\Programs\\cursor"'
    : '/usr/share/cursor';
  console.log(`cursor-zh —— Cursor 全界面中文

用法：
  cursor-zh [install]            应用汉化（默认）
  cursor-zh status               查看状态
  cursor-zh restore              还原英文
  cursor-zh doctor               环境自检

选项：
  --dir <路径>           指定 Cursor 安装目录
  --dry-run              预览，不写盘
  --force                运行中时尝试自动退出 Cursor
  --skip-language-pack   跳过语言包（只做静态补丁 + 运行时）
  --yes, -y              跳过确认

示例：
  npx cursor-zh --dir ${dirHint}`);
  return 0;
}

async function main(argv) {
  let args;
  try { args = parseArgs(argv); }
  catch (e) { c.err(e.message); return 2; }

  if (args.command === 'help') return usage();
  if (args.command === 'version') {
    const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'));
    console.log(pkg.version);
    return 0;
  }

  try { P.assertNodeVersion(); }
  catch (e) { c.err(e.message); return 2; }

  let install;
  try { install = resolveInstall(args); }
  catch (e) { c.err(e.message); return 2; }

  switch (args.command) {
    case 'install': return await cmdInstall(args, install);
    case 'status': return cmdStatus(args, install);
    case 'restore': return cmdRestore(args, install);
    case 'doctor': return cmdDoctor(args, install);
    default: return usage();
  }
}

main(process.argv.slice(2))
  .then((code) => { process.exitCode = code; })
  .catch((e) => { c.err(e && e.stack ? e.stack : String(e)); process.exitCode = 1; });
