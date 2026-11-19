# 参与贡献

## 报告问题

开 issue 时请附上：

```bash
npx cursor-zh doctor
```

的输出（包含平台、Cursor 版本、路径、权限、完整性状态，不含任何隐私数据）。

如果是「某处还是英文」，请说明**具体位置**（哪个窗口、哪个菜单、什么操作后出现），
最好附上截图。这个工具的三层机制覆盖范围不同，知道位置才能判断该补哪一层：

| 位置 | 该改哪 |
|---|---|
| 菜单栏、命令面板、设置项 | 语言包（`src/nls.mjs` 或上游语言包） |
| Cursor 设置页、Agent 窗口里的固定文案 | `sources/ui.json` 或 `curated.json` |
| 提示条、Toast、悬停提示 | 通常是运行时层，补词典即可 |

## 提交代码

```bash
git clone https://github.com/pengchengwanli2024/cursor-zh.git
cd cursor-zh
npm test
```

提交前请确保：

1. `npm test` 全绿（含假安装端到端测试，不需要真装 Cursor）。
2. 新增/修改的译文字面量有依据，不要凭感觉翻译产品术语。
3. 不要引入 npm 运行时依赖——这个项目的运行时只用 Node.js 标准库，
   这样 `npx` 冷启动快，也不会有供应链风险。

## 词典风格约定

- **产品名与协议名保留原文**：Cursor、MCP、GitHub、Claude、GPT、API、IDE、JSON、PR、CLI…
  翻译它们会让搜索结果和文档对不上。
- **命令与路径不译**：`/review`、`@file`、`~/.cursor` 保持原样。
- **动词用中文软件习惯说法**：Cancel → 取消，Dismiss → 忽略，Retry → 重试，
  Learn More → 了解更多，Settings → 设置。
- **不要翻译代码、日志、错误堆栈**。
- **术语全库一致**：同一个英文词只用一种译法。改之前先 `grep` 现有译法。

## 加新平台的适配点

主要集中在 [`src/platform.mjs`](src/platform.mjs)：

- `appRoot()` —— 资源目录布局
- `executablePath()` —— 可执行文件名
- `candidateRoots()` —— 默认安装位置
- `isRunning()` / `requestQuit()` —— 进程检测与退出
- `canWriteInstall()` / `isElevated()` —— 写权限与提权判断

新增平台时，请在 [`test/e2e-fake-install.test.mjs`](test/e2e-fake-install.test.mjs) 的
假安装布局里加上对应分支，让 CI 能覆盖到。

## 提交信息

用一句话说明改了什么、为什么。例如：

```
补全 Agent 窗口的 27 条命令面板文案
修复 Windows 下备份目录名含反斜杠导致创建失败
```

## 许可

提交的代码与译文按 MIT 许可发布。
