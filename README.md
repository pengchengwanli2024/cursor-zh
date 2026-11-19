# cursor-zh

让 **Cursor 全界面说中文**，支持 macOS / Windows / Linux，可一键还原，不影响 Cursor 升级。

[![powered by dsh](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

```bash
npx cursor-zh
```

---

## 为什么装了语言包还是英文

Cursor 是 Code OSS 的分支，但它的界面分成两半：

| 界面部分 | 走 VS Code 的 NLS 国际化？ | 语言包能翻吗 |
|---|---|---|
| 菜单栏、命令面板、原生设置项、编辑器 | ✅ 是 | ✅ 能 |
| **Cursor 设置页、Agent 窗口、插件市场、空态提示** | ❌ 否，硬编码在 bundle 里 | ❌ **不能** |

微软官方语言包只能翻译 `nls.messages.json` 里登记过的字符串。
Cursor 自己的界面（日常使用里占一半以上）完全不经过这套机制，
所以「装个语言包」永远只能得到半个中文界面。

这个工具在语言包之外又加了两层，合计三层：

| 层 | 机制 | 覆盖什么 |
|---|---|---|
| 1. 语言包 | 装 `polang233.cursor-language-pack`（含 Cursor 写进 NLS 的自有词条），并补全缺口 | VS Code 继承的原生界面 |
| 2. 静态补丁 | 替换 workbench / molten bundle 里 UI 字段的英文字面量 | Cursor 私有界面：设置页、Agent 窗口、原生菜单 |
| 3. 运行时翻译 | 注入渲染进程的 DOM 翻译层 | 动态文案：轮换提示、Toast、按需渲染的组件 |

## 安装

### 前置条件

- 已安装 [Cursor](https://cursor.com)
- Node.js ≥ 18.17（`node -v` 检查）
- **Cursor 必须完全退出**（安装时会改写应用内文件）

### 一条命令

```bash
npx cursor-zh
```

脚本会自动找 Cursor 安装位置。找不到或有多个时手动指定：

```bash
# macOS
npx cursor-zh --dir /Applications/Cursor.app

# Windows（默认用户级安装）
npx cursor-zh --dir "%LOCALAPPDATA%\Programs\cursor"

# Linux
npx cursor-zh --dir /usr/share/cursor
```

安装完成后重新打开 Cursor 即可。

### Windows 注意事项

- **默认是用户级安装**（`%LOCALAPPDATA%\Programs\cursor`），不需要管理员权限。
- 如果 Cursor 装在 `C:\Program Files` 下，需要**以管理员身份运行 PowerShell**：
  右键「终端」→「以管理员身份运行」，再执行命令。脚本会检测到权限不足并提示。
- 退出 Cursor：右键任务栏图标 → 退出；或任务管理器结束 `Cursor.exe`。

### Linux 注意事项

- 系统级安装（`/usr/share/cursor`）需要 `sudo`。
- AppImage 版本请用 `--dir` 指向解包后的目录。

## 命令

| 命令 | 作用 |
|---|---|
| `cursor-zh` 或 `cursor-zh install` | 应用汉化（默认命令） |
| `cursor-zh status` | 查看当前状态（是否注入、词典大小、校验值是否一致） |
| `cursor-zh restore` | 还原成英文 |
| `cursor-zh doctor` | 环境自检（平台、路径、权限、进程、完整性） |

选项：

| 选项 | 说明 |
|---|---|
| `--dir <路径>` | 指定 Cursor 安装目录 |
| `--dry-run` | 只报告会改什么，不写盘 |
| `--skip-language-pack` | 跳过语言包下载（只做静态补丁 + 运行时） |
| `--force` | Cursor 在运行时代为请求退出 |

## 关于「不影响 Cursor 升级」

这是本工具最核心的设计目标，实现方式不是「绕过升级检测」，而是利用升级机制本身：

1. **升级是整包替换。** Cursor 用 Squirrel.Mac（macOS）/ NSIS（Windows）把整个应用目录换成新包，
   不是增量打补丁。所以被改过的文件会被干净地覆盖掉，**不会导致升级失败、也不会残留**。
   实测从 3.30.14 自动升级到 3.31.11：应用正常升级，补丁被清除，重启后无任何告警。
2. **只改应用内的 JS / HTML。** 代价是应用代码签名失效（`codesign --verify` 会报 sealed resource invalid），
   但 Cursor 启动前不做签名校验，实测正常启动。
3. **同步完整性校验值。** Cursor 启动时会用 `product.json` 的 `checksums` 校验 6 个核心文件，
   内容对不上就弹「安装已损坏」。工具每次改完都会用与 Cursor 相同的算法
   （`base64(sha256(file))` 去掉尾部 `=`）重算并写回，所以不会触发告警。
4. **升级后重跑一次即可。** 因为整包被替换，汉化会失效——这是安全性的代价，也是它能安全的原因。

```bash
# 升级 Cursor 之后
npx cursor-zh
```

## 还原

```bash
npx cursor-zh restore
```

会按安装时记录的备份把每个被改的文件写回原始内容，并重算校验值，然后删除注入的运行时脚本。
语言包扩展需要的话在 Cursor 扩展面板里手动卸载。

## 工作原理

```
Cursor 启动
  └─ main.js 解析 NLS
       ├─ 读 <userData>/languagepacks.json       ← 层 1：语言包在这里注册
       ├─ 合并 out/nls.keys.json + messages.json + 语言包译文
       └─ 生成 <userData>/clp/<hash>.<locale>/<commit>/nls.messages.json
  └─ 打开窗口
       ├─ workbench.html  → 注入 cursor-zh.js    ← 层 3：DOM 翻译运行时
       └─ workbench.*.main.js                     ← 层 2：静态补丁改这里
```

### 静态补丁改什么

只替换「整个值就是一句界面文案」的位置，避免误伤代码、ID、搜索关键词：

```js
label:"Cancel"                          →  label:"取消"
title:"New Terminal"                    →  title:"新建终端"
{command:`terminal.new`,title:`Open IDE`} →  {command:`terminal.new`,title:`打开 IDE`}
"aria-label":"Settings"                 →  "aria-label":"设置"
```

明确跳过：

- 产品名与协议名（Cursor、MCP、GitHub、Claude、GPT、API、IDE、JSON…）
- camelCase 标识符、常量名、文件名、URL、`$(icon)` 占位符
- 含模板插值 `${}` 的动态字符串

### 运行时翻译不碰什么

代码编辑器、终端、diff 视图、输入框内容、对话与模型输出、文件树里的项目文件名。
这些翻了只会让代码和日志变得难以使用。

## 维护词典

界面某处还是英文时：

1. 把英文原文与中文译文加进 [`sources/ui.json`](sources/ui.json)（高频短词）
   或 [`sources/curated.json`](sources/curated.json)（长句、专有文案）。
2. 重新生成词典并应用：

```bash
npm run build     # 生成 build/dict.json
npx cursor-zh     # 重新应用
```

词典来源与优先级见 [src/dictionary.mjs](src/dictionary.mjs)。
所有译文都有质量闸门：必须含中文、不能是模型自述、长度不能异常膨胀。

## 目录结构

```
src/
  cli.mjs         命令行入口（install / status / restore / doctor）
  platform.mjs    跨平台探测：安装位置、资源目录、进程、权限
  patcher.mjs     静态补丁：识别 UI 字段并替换字面量
  dictionary.mjs  词典构建：合并多个来源 + 质量闸门
  integrity.mjs   完整性校验值同步（与 Cursor 同算法）
  injector.mjs    运行时注入（主窗口 + Agent 窗口）
  backup.mjs      备份与还原
  langpack.mjs    语言包：按 vscodeVersion 选兼容版本并安装
  nls.mjs         补全语言包缺口（Cursor 自带 NLS 表里语言包没覆盖的条目）
  molten.mjs      Agent 窗口（Cursor 3.31 起的独立渲染进程）补丁
  runtime.js      DOM 翻译运行时（注入到渲染进程）
sources/          词典源文件
build/dict.json   生成物（构建时产生，随包发布）
test/             单元测试 + 假安装端到端测试
```

## 开发

```bash
npm test        # 单元测试 + 假安装端到端测试（不需要真装 Cursor）
npm run build   # 重建词典
```

端到端测试会在临时目录里按当前平台的真实布局造一个假 Cursor，
跑完整的 install → 校验 → restore 流程，所以三个平台的 CI 都能验证核心逻辑。

## 已知限制

- **Cursor 服务端新增的提示文案**首次出现时可能仍是英文，需要补词典后重跑。
- **Agent 窗口的原生菜单**在部分账号/版本组合下由 Cursor 内置窗口渲染，
  这部分的最终文案取决于 Cursor 自己是否走 NLS（已尽可能补全）。
- 图片 / Canvas 渲染的文字无法翻译。
- 每次 Cursor 升级后需要重跑一次。
- 修改了应用文件，代码签名会失效（Cursor 不校验，但第三方安全检查工具会报）。

## 安全边界

- 不联网上传任何数据；译文在本地生成，语言包从 Open VSX 公开下载。
- 不改系统语言、不改 Cursor 账号、不碰任何业务数据。
- 所有改动都有备份，`restore` 可完整还原。

## 许可

MIT。第三方组件与词典来源见 [NOTICE.md](NOTICE.md)。

Cursor 是 Anysphere, Inc. 的产品。本项目为非官方第三方工具，与其无关联、未获其背书。
