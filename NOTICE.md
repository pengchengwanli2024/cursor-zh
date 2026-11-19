# 第三方组件与内容说明

本仓库包含或依赖以下第三方作品，其权利归原作者所有。

## 1. Code OSS / VS Code 本地化字符串

`src/langpack.mjs` 会从 Open VSX 下载并安装语言包扩展。默认候选之一
`polang233.cursor-language-pack` 的简体中文译文派生自：

- [microsoft/vscode-loc](https://github.com/microsoft/vscode-loc) —— MIT License

本仓库**不分发**该语言包的译文文件，只在运行时按需从 Open VSX 下载安装，
其许可与归属以该扩展自身附带的 `LICENSE.txt` / `NOTICE` 为准。

## 2. 词典内容

`sources/` 下的词典为本仓库自行生成，来源如下：

| 文件 | 来源 | 说明 |
|---|---|---|
| `ui.json` | 人工整理 | 高频界面词（按钮、菜单、设置项） |
| `curated.json` | 人工整理 | 长句与 Cursor 专有文案 |
| `server-tips.json` | 从 Cursor 客户端本地数据整理 | 空态轮换提示的英文原文 |
| `translated.json` | 本地模型翻译后筛选 | Ollama + qwen2.5 批量翻译，经质量闸门过滤 |
| `nls.json` | 从公开语言包 NLS 反查 | 少量术语对齐 |
| `retranslated.json` | 本地模型重新翻译 | 早期社区词条的重新翻译清洗版本 |

译文本身由本仓库生成；英文原文的著作权属于 Cursor（Anysphere）。
本仓库仅将这些原文用于界面本地化，不复制其源码。

## 3. 无第三方代码依赖

运行时与构建期均不引入 npm 依赖，只使用 Node.js 标准库，
因此不存在第三方代码许可传染问题。

## 4. 商标

Cursor 是 Anysphere, Inc. 的产品。本项目为第三方非官方工具，
与 Anysphere 无关联、未获其背书。所有产品名称与商标归其各自所有者。
