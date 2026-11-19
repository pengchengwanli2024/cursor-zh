/**
 * 跨平台探测：定位 Cursor、解析资源目录、检测进程、检查写权限。
 *
 * Cursor 是 Code OSS 分支，三个平台的布局：
 *   macOS    /Applications/Cursor.app/Contents/Resources/app
 *   Windows  %LOCALAPPDATA%\Programs\cursor\resources\app
 *   Linux    /usr/share/cursor/resources/app
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const PLATFORM = process.platform;
export const IS_WIN = PLATFORM === 'win32';
export const IS_MAC = PLATFORM === 'darwin';
export const IS_LINUX = PLATFORM === 'linux';

/** 运行脚本的 Node 需要在 18.17 以上（用到了 fs/promises、crypto 的现代 API）。 */
export function assertNodeVersion() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major > 18 || (major === 18 && minor >= 17)) return;
  throw new Error(`需要 Node.js 18.17 或更高版本，当前是 ${process.versions.node}`);
}

/** 资源目录（resources/app）。 */
export function appRoot(installRoot) {
  return IS_MAC ? path.join(installRoot, 'Contents', 'Resources', 'app') : path.join(installRoot, 'resources', 'app');
}

/** 可执行文件。 */
export function executablePath(installRoot) {
  if (IS_MAC) return path.join(installRoot, 'Contents', 'MacOS', 'Cursor');
  if (IS_WIN) return path.join(installRoot, 'Cursor.exe');
  return path.join(installRoot, 'cursor');
}

/** 用户数据目录（Cursor Settings、日志等）。 */
export function userDataDir() {
  const env = process.env;
  if (env.CURSOR_USER_DATA_DIR) return path.resolve(env.CURSOR_USER_DATA_DIR);
  const home = os.homedir();
  if (IS_MAC) return path.join(home, 'Library', 'Application Support', 'Cursor');
  if (IS_WIN) return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Cursor');
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Cursor');
}

/** argv.json（VS Code 放在用户主目录的 .cursor 里，不在 userData 下）。 */
export function argvJsonPath(dataFolderName = '.cursor') {
  if (process.env.VSCODE_PORTABLE) return path.join(path.resolve(process.env.VSCODE_PORTABLE), 'argv.json');
  return path.join(os.homedir(), dataFolderName, 'argv.json');
}

/** 扩展目录。 */
export function extensionsDir(dataFolderName = '.cursor') {
  if (process.env.VSCODE_EXTENSIONS) return path.resolve(process.env.VSCODE_EXTENSIONS);
  if (process.env.VSCODE_PORTABLE) return path.join(path.resolve(process.env.VSCODE_PORTABLE), 'extensions');
  return path.join(os.homedir(), dataFolderName, 'extensions');
}

/** 判断目录是否为有效 Cursor 安装。 */
export function isInstall(dir) {
  if (!dir) return false;
  try {
    const res = appRoot(dir);
    return fs.existsSync(path.join(res, 'package.json'));
  } catch { return false; }
}

/** 各平台常见安装位置。 */
export function candidateRoots() {
  const env = process.env;
  const home = os.homedir();
  const out = [];
  if (env.CURSOR_INSTALL_DIR) out.push(env.CURSOR_INSTALL_DIR);

  if (IS_MAC) {
    out.push('/Applications/Cursor.app', path.join(home, 'Applications', 'Cursor.app'));
  } else if (IS_WIN) {
    // 用户安装（默认）优先，其次是系统安装
    const bases = [
      env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs'),
      path.join(home, 'AppData', 'Local', 'Programs'),
      env.ProgramFiles,
      env['ProgramFiles(x86)'],
      env.LOCALAPPDATA,
    ].filter(Boolean);
    for (const base of bases) {
      out.push(path.join(base, 'cursor'), path.join(base, 'Cursor'));
    }
  } else {
    out.push(
      '/usr/share/cursor', '/opt/Cursor', '/opt/cursor', '/usr/lib/cursor',
      path.join(home, '.local', 'share', 'cursor'),
    );
  }
  return out;
}

/** 自动发现有效安装，按平台规范化去重。 */
export function findInstalls() {
  const seen = new Set();
  const found = [];
  for (const root of candidateRoots()) {
    let resolved;
    try { resolved = fs.realpathSync.native(path.resolve(root)); }
    catch { resolved = path.resolve(root); }
    const key = IS_WIN ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) continue;
    if (!isInstall(resolved)) continue;
    seen.add(key);
    found.push({ installRoot: resolved, appRoot: appRoot(resolved) });
  }
  return found;
}

/** 读取安装信息。 */
export function readInfo(appDir) {
  const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; } };
  const product = readJson(path.join(appDir, 'product.json'));
  const pkg = readJson(path.join(appDir, 'package.json'));
  return {
    appRoot: appDir,
    cursorVersion: product.version ?? pkg.version ?? null,
    vscodeVersion: product.vscodeVersion ?? product.vsCodeVersion ?? null,
    commit: product.commit ?? null,
    productName: product.nameLong ?? product.nameShort ?? pkg.name ?? 'Cursor',
    dataFolderName: product.dataFolderName ?? '.cursor',
  };
}

/**
 * Cursor 是否在运行。
 * Windows 用 tasklist（系统自带），macOS/Linux 用 pgrep。
 */
export function isRunning(installRoot) {
  if (IS_WIN) {
    const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq Cursor.exe', '/FO', 'CSV', '/NH'], {
      encoding: 'utf8', windowsHide: true,
    });
    if (r.status !== 0 || !r.stdout) return { running: false, pids: [] };
    const pids = [...r.stdout.matchAll(/"Cursor\.exe","(\d+)"/gi)].map((m) => Number(m[1]));
    return { running: pids.length > 0, pids };
  }
  const exe = executablePath(installRoot);
  const byPath = spawnSync('pgrep', ['-f', exe], { encoding: 'utf8' });
  if (byPath.status === 0) {
    const pids = byPath.stdout.split(/\s+/).filter(Boolean).map(Number);
    if (pids.length) return { running: true, pids };
  }
  const byName = spawnSync('pgrep', ['-x', IS_MAC ? 'Cursor' : 'cursor'], { encoding: 'utf8' });
  const pids = byName.status === 0 ? byName.stdout.split(/\s+/).filter(Boolean).map(Number) : [];
  return { running: pids.length > 0, pids };
}

/** 请求 Cursor 退出（优雅退出，失败时由调用方决定是否强杀）。 */
export function requestQuit() {
  if (IS_MAC) {
    return spawnSync('osascript', ['-e', 'tell application "Cursor" to quit'], { encoding: 'utf8' }).status === 0;
  }
  if (IS_WIN) {
    // 不带 /F：先请求正常关闭，保留用户未保存的会话
    const r = spawnSync('taskkill', ['/IM', 'Cursor.exe'], { encoding: 'utf8', windowsHide: true });
    return r.status === 0;
  }
  return spawnSync('pkill', ['-TERM', '-x', 'cursor'], { encoding: 'utf8' }).status === 0;
}

/** 打开 Cursor。 */
export function launch(installRoot) {
  if (IS_MAC) return spawnSync('open', ['-a', installRoot], { encoding: 'utf8' }).status === 0;
  if (IS_WIN) {
    const exe = executablePath(installRoot);
    const child = spawnSync('cmd', ['/c', 'start', '""', exe], { encoding: 'utf8', windowsHide: true });
    return child.status === 0;
  }
  const child = spawnSync(executablePath(installRoot), [], { encoding: 'utf8', detached: true });
  return child.status === 0;
}

/** 安装目录是否可写。Program Files 下的系统级安装需要管理员权限。 */
export function canWriteInstall(installRoot) {
  const probeDir = appRoot(installRoot);
  const probe = path.join(probeDir, '.cursor-zh-write-probe');
  try {
    fs.writeFileSync(probe, '');
    fs.rmSync(probe, { force: true });
    return true;
  } catch { return false; }
}

/** Windows 下是否以管理员身份运行。 */
export function isElevated() {
  if (!IS_WIN) return true;
  const r = spawnSync('net', ['session'], { encoding: 'utf8', windowsHide: true });
  return r.status === 0;
}

/** 面向用户的退出提示（按平台不同）。 */
export function quitHint() {
  if (IS_MAC) return '请先完全退出 Cursor（⌘Q）后重试。';
  if (IS_WIN) return '请先完全退出 Cursor（右键任务栏图标 → 退出，或在任务管理器中结束 Cursor 进程）后重试。';
  return '请先完全退出 Cursor 后重试。';
}
