/**
 * 语言包：给 VS Code 继承来的那部分界面装上中文。
 *
 * 为什么要单独处理：
 *   Cursor 自带的扩展市场只保留最新版语言包（要求 engines.vscode >= 1.131），
 *   而 Cursor 往往落后几个 VS Code 版本，直接装会因引擎不兼容失败。
 *   这里从 Open VSX 按 Cursor 实际的 vscodeVersion 取匹配版本。
 *
 * 候选顺序：
 *   1. polang233.cursor-language-pack —— 含 Cursor 写进 NLS 的自有词条，覆盖最全
 *   2. MS-CEINTL.vscode-language-pack-zh-hans —— 微软官方，只覆盖 VS Code 部分
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as P from './platform.mjs';

const OPEN_VSX = 'https://open-vsx.org/api';

export const CANDIDATES = [
  { namespace: 'polang233', name: 'cursor-language-pack', label: 'Cursor Language Pack' },
  { namespace: 'MS-CEINTL', name: 'vscode-language-pack-zh-hans', label: 'VS Code 简体中文语言包' },
];

/** "^1.128.0" → [1,128,0] */
export function parseEngineMin(engines) {
  const raw = engines && engines.vscode;
  if (typeof raw !== 'string') return null;
  const m = raw.match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function versionParts(v) {
  const m = String(v || '').match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function compareVersion(a, b) {
  for (let i = 0; i < 3; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

export function engineSatisfies(vscodeVersion, engines) {
  const min = parseEngineMin(engines);
  const cur = versionParts(vscodeVersion);
  if (!min || !cur) return false;
  return compareVersion(cur, min) >= 0;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error('请求失败 ' + res.status + '：' + url);
  return res.json();
}

export async function pickCompatibleVersion(candidate, vscodeVersion) {
  const meta = await fetchJson(OPEN_VSX + '/' + candidate.namespace + '/' + candidate.name);
  const all = meta.allVersions || {};
  const versions = Object.keys(all).filter((v) => v !== 'latest');
  versions.sort((a, b) => compareVersion(versionParts(b) || [0, 0, 0], versionParts(a) || [0, 0, 0]));
  for (const v of versions.slice(0, 12)) {
    try {
      const info = await fetchJson(OPEN_VSX + '/' + candidate.namespace + '/' + candidate.name + '/' + v);
      if (engineSatisfies(vscodeVersion, info.engines)) {
        return {
          version: info.version || v,
          download: (info.files && info.files.download) || null,
          engines: info.engines || {},
          label: candidate.label,
          id: (candidate.namespace + '.' + candidate.name).toLowerCase(),
        };
      }
    } catch { /* 试下一个 */ }
  }
  if (meta.version && engineSatisfies(vscodeVersion, meta.engines)) {
    return {
      version: meta.version,
      download: (meta.files && meta.files.download) || null,
      engines: meta.engines || {},
      label: candidate.label,
      id: (candidate.namespace + '.' + candidate.name).toLowerCase(),
    };
  }
  return null;
}

export async function downloadVsix(picked, cacheDir) {
  if (!picked.download) throw new Error('该版本没有可下载的 vsix');
  fs.mkdirSync(cacheDir, { recursive: true });
  // 用 path.posix 取文件名：下载 URL 永远是 '/' 分隔，Windows 上 path.basename 处理不了
  const fileName = path.posix.basename(new URL(picked.download).pathname);
  const file = path.join(cacheDir, fileName);
  if (fs.existsSync(file) && fs.statSync(file).size > 1024) return file;
  const res = await fetch(picked.download);
  if (!res.ok) throw new Error('下载失败 ' + res.status);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

/** 调用 Cursor 自带 CLI 安装扩展（Windows 用 Electron 的 Node 模式）。 */
export function installVsix(installRoot, appRoot, vsix) {
  const cliScript = path.join(appRoot, 'out', 'cli.js');
  const env = { ...process.env };
  const bin = path.join(installRoot, 'bin', P.IS_WIN ? 'cursor.cmd' : 'cursor');
  let cmd;
  let args;
  if (!P.IS_WIN && fs.existsSync(bin)) {
    cmd = bin;
    args = ['--install-extension', vsix, '--force'];
  } else {
    cmd = P.executablePath(installRoot);
    args = [cliScript, '--install-extension', vsix, '--force'];
    env.ELECTRON_RUN_AS_NODE = '1';
  }
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, env });
  return { ok: r.status === 0, output: ((r.stdout || '') + (r.stderr || '')).trim(), status: r.status };
}

export function installedExtensions(extDir) {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(extDir, 'extensions.json'), 'utf8'));
    const out = {};
    for (const e of list) out[e.identifier.id.toLowerCase()] = e.version;
    return out;
  } catch { return {}; }
}

/** 精准写入 argv.json 的 locale，保留注释与格式。 */
export function setLocale(argvFile, locale) {
  const line = new RegExp('^(\\s*)"locale"(\\s*):(\\s*)"[^"]*"', 'm');
  let text;
  try { text = fs.readFileSync(argvFile, 'utf8'); }
  catch { text = '{\n}\n'; }
  if (line.test(text)) {
    const next = text.replace(line, '$1"locale"$2:$3"' + locale + '"');
    if (next === text) return { changed: false, file: argvFile };
    fs.writeFileSync(argvFile, next, 'utf8');
    return { changed: true, file: argvFile };
  }
  const idx = text.lastIndexOf('}');
  if (idx < 0) return { changed: false, file: argvFile };
  const head = text.slice(0, idx).replace(/\s*$/, '');
  const needsComma = /[^{\s]$/.test(head);
  const next = head + (needsComma ? ',' : '') + '\n\t"locale": "' + locale + '"\n' + text.slice(idx);
  fs.writeFileSync(argvFile, next, 'utf8');
  return { changed: true, file: argvFile };
}

/** 挑选 → 下载 → 安装 → 设显示语言。 */
export async function ensureLanguagePack(opts) {
  const { installRoot, appRoot, info, cacheDir, extDir, argvFile, dryRun } = opts;
  const log = [];
  const picked = [];
  for (const cand of CANDIDATES) {
    try {
      const v = await pickCompatibleVersion(cand, info.vscodeVersion);
      if (v) picked.push(v);
    } catch (e) {
      log.push('  ' + cand.label + '：查询失败（' + e.message + '）');
    }
  }
  if (!picked.length) {
    log.push('  没有找到与当前 VS Code 版本兼容的中文语言包');
    return { ok: false, log };
  }
  const best = picked[0];
  log.push('  选择 ' + best.label + ' ' + best.version + '（要求 ' + (best.engines.vscode || '未知') + '）');

  if (dryRun) {
    log.push('[dry-run] 会下载并安装语言包，并把 argv.json 的 locale 设为 zh-cn');
    return { ok: true, pack: best, log };
  }

  const vsix = await downloadVsix(best, cacheDir);
  log.push('  已下载 ' + path.basename(vsix));
  const r = installVsix(installRoot, appRoot, vsix);
  if (!r.ok) {
    log.push('  安装失败：' + (r.output.split('\n').slice(-3).join(' ') || '未知原因'));
    return { ok: false, pack: best, log };
  }
  const installed = installedExtensions(extDir);
  if (!installed[best.id]) {
    log.push('  安装命令已执行，但未在扩展目录看到 ' + best.id);
    return { ok: false, pack: best, log };
  }
  log.push('  已安装 ' + best.id + '@' + installed[best.id]);
  const loc = setLocale(argvFile, 'zh-cn');
  if (loc.changed) log.push('  已把显示语言设为 zh-cn');
  return { ok: true, pack: best, log };
}
