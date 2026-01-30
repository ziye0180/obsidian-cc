# Claudian

![GitHub stars](https://img.shields.io/github/stars/YishenTu/claudian?style=social)
![GitHub release](https://img.shields.io/github/v/release/YishenTu/claudian)
![License](https://img.shields.io/github/license/YishenTu/claudian)

![预览](Preview.png)

一个将 Claude Code 作为 AI 协作者嵌入到你的 Vault 中的 Obsidian 插件。你的 Vault 成为 Claude 的工作目录，赋予它完整的代理能力：文件读写、搜索、bash 命令和多步骤工作流。

## 功能特性

- **完整代理能力**：利用 Claude Code 的强大功能在你的 Obsidian Vault 中读取、写入、编辑文件，搜索和执行 bash 命令。
- **上下文感知**：自动附加当前聚焦的笔记，用 `@` 提及文件，通过标签排除笔记，包含编辑器选区（高亮），以及访问外部目录获取额外上下文。
- **视觉支持**：通过拖放、粘贴或文件路径发送图片进行分析。
- **内联编辑**：直接在笔记中编辑选中的文本或在光标位置插入内容，带有词级 diff 预览和只读工具访问以获取上下文。
- **指令模式 (`#`)**：直接从聊天输入框向系统提示词添加精炼的自定义指令，可在模态框中审查/编辑。
- **斜杠命令**：创建可复用的提示模板，通过 `/command` 触发，支持参数占位符、`@file` 引用和可选的内联 bash 替换。
- **技能**：使用可复用的能力模块扩展 Claudian，根据上下文自动调用，兼容 Claude Code 的技能格式。
- **自定义代理**：定义 Claude 可以调用的自定义子代理，支持工具限制和模型覆盖。
- **Claude Code 插件**：启用通过 CLI 安装的 Claude Code 插件，自动从 `~/.claude/plugins` 发现，支持每个 Vault 单独配置。插件的技能、代理和斜杠命令无缝集成。
- **MCP 支持**：通过 Model Context Protocol 服务器（stdio、SSE、HTTP）连接外部工具和数据源，支持上下文保存模式和 `@`-mention 激活。
- **高级模型控制**：在 Haiku、Sonnet 和 Opus 之间选择，通过环境变量配置自定义模型，微调思考预算，并启用 1M 上下文窗口的 Sonnet（需要 Max 订阅）。
- **安全性**：权限模式（YOLO/Safe）、安全阻止列表和带有符号链接安全检查的 Vault 限制。
- **Claude in Chrome**：允许 Claude 通过 `claude-in-chrome` 扩展与 Chrome 交互。

> **注意**：`计划模式` 已暂时移除。SDK 原生不支持 `permissionMode: plan`，之前的实现有明显局限性。当有更好的方案时会重新添加。

## 要求

- 已安装 [Claude Code CLI](https://code.claude.com/docs/en/overview)（强烈建议通过原生安装方式安装 Claude Code）
- Obsidian v1.8.9+
- Claude 订阅/API 或支持 Anthropic API 格式的自定义模型提供商（[Openrouter](https://openrouter.ai/docs/guides/guides/claude-code-integration)、[Kimi](https://platform.moonshot.ai/docs/guide/agent-support)、[GLM](https://docs.z.ai/devpack/tool/claude)、[DeepSeek](https://api-docs.deepseek.com/guides/anthropic_api) 等）
- 仅桌面端（macOS、Linux、Windows）

## 安装

### 从 GitHub Release 安装（推荐）

1. 从 [最新发布](https://github.com/YishenTu/claudian/releases/latest) 下载 `main.js`、`manifest.json` 和 `styles.css`
2. 在你的 Vault 插件文件夹中创建一个名为 `claudian` 的文件夹：
   ```
   /path/to/vault/.obsidian/plugins/claudian/
   ```
3. 将下载的文件复制到 `claudian` 文件夹
4. 在 Obsidian 中启用插件：
   - 设置 → 社区插件 → 启用 "Claudian"

### 使用 BRAT 安装

[BRAT](https://github.com/TfTHacker/obsidian42-brat)（Beta Reviewers Auto-update Tester）允许你直接从 GitHub 安装和自动更新插件。

1. 从 Obsidian 社区插件安装 BRAT 插件
2. 在设置 → 社区插件中启用 BRAT
3. 打开 BRAT 设置并点击 "Add Beta plugin"
4. 输入仓库 URL：`https://github.com/YishenTu/claudian`
5. 点击 "Add Plugin"，BRAT 将自动安装 Claudian
6. 在设置 → 社区插件中启用 Claudian

> **提示**：BRAT 会自动检查更新并在有新版本时通知你。

### 从源码安装（开发）

1. 将此仓库克隆到你的 Vault 插件文件夹：
   ```bash
   cd /path/to/vault/.obsidian/plugins
   git clone https://github.com/YishenTu/claudian.git
   cd claudian
   ```

2. 安装依赖并构建：
   ```bash
   bun install
   bun run build
   ```

3. 在 Obsidian 中启用插件：
   - 设置 → 社区插件 → 启用 "Claudian"

### 开发

```bash
# 监听模式
bun run dev

# 生产构建
bun run build
```

> **提示**：复制 `.env.local.example` 为 `.env.local` 或运行 `bun install` 并设置你的 Vault 路径以在开发期间自动复制文件。

## 使用方法

**两种模式：**
1. 点击工具栏的机器人图标或使用命令面板打开聊天
2. 选中文本 + 快捷键进行内联编辑

像使用 Claude Code 一样使用它——在你的 Vault 中读取、写入、编辑、搜索文件。

### 上下文

- **文件**：自动附加当前聚焦的笔记；输入 `@` 附加其他文件
- **@-mention 下拉菜单**：输入 `@` 查看 MCP 服务器、代理、外部上下文和 Vault 文件
  - `@Agents/` 显示可选择的自定义代理
  - `@mcp-server` 启用上下文保存的 MCP 服务器
  - `@folder/` 过滤来自该外部上下文的文件（如 `@workspace/`）
  - 默认显示 Vault 文件
- **选区**：在编辑器中选择文本，然后聊天——选区自动包含
- **图片**：拖放、粘贴或输入路径；为 `![[image]]` 嵌入配置媒体文件夹
- **外部上下文**：点击工具栏的文件夹图标访问 Vault 外的目录

### 功能

- **内联编辑**：选中文本 + 快捷键直接在笔记中编辑，带词级 diff 预览
- **指令模式**：输入 `#` 向系统提示词添加精炼的指令
- **斜杠命令**：输入 `/` 使用自定义提示模板或技能
- **技能**：将 `skill/SKILL.md` 文件添加到 `~/.claude/skills/` 或 `{vault}/.claude/skills/`，建议使用 Claude Code 管理技能
- **自定义代理**：将 `agent.md` 文件添加到 `~/.claude/agents/`（全局）或 `{vault}/.claude/agents/`（Vault 特定）；在聊天中通过 `@Agents/` 选择，或提示 Claudian 调用代理
- **Claude Code 插件**：通过设置 → Claude Code 插件启用，建议使用 Claude Code 管理插件
- **MCP**：通过设置 → MCP 服务器添加外部工具；在聊天中使用 `@mcp-server` 激活

## 配置

### 设置

**自定义**
- **用户名**：你的名字，用于个性化问候
- **排除标签**：防止笔记自动加载的标签（如 `sensitive`、`private`）
- **媒体文件夹**：配置 Vault 存储附件的位置以支持嵌入图片（如 `attachments`）
- **自定义系统提示词**：附加到默认系统提示词的额外指令（指令模式 `#` 保存在这里）
- **启用自动滚动**：切换流式输出时自动滚动到底部（默认：开启）
- **自动生成对话标题**：在第一条用户消息发送后切换 AI 驱动的标题生成
- **标题生成模型**：用于自动生成对话标题的模型（默认：Auto/Haiku）
- **Vim 风格导航映射**：配置按键绑定，如 `map w scrollUp`、`map s scrollDown`、`map i focusInput`

**快捷键**
- **内联编辑快捷键**：触发选中文本内联编辑的快捷键
- **打开聊天快捷键**：打开聊天侧边栏的快捷键

**斜杠命令**
- 创建/编辑/导入/导出自定义 `/commands`（可选择覆盖模型和允许的工具）

**MCP 服务器**
- 添加/编辑/验证/删除 MCP 服务器配置，支持上下文保存模式

**Claude Code 插件**
- 启用/禁用从 `~/.claude/plugins` 发现的 Claude Code 插件
- 用户级插件在所有 Vault 中可用；项目级插件仅在匹配的 Vault 中可用

**安全**
- **加载用户 Claude 设置**：加载 `~/.claude/settings.json`（用户的 Claude Code 权限规则可能绕过 Safe 模式）
- **启用命令阻止列表**：阻止危险的 bash 命令（默认：开启）
- **阻止的命令**：要阻止的模式（支持正则表达式、平台特定）
- **允许的导出路径**：Vault 外可以导出文件的路径（默认：`~/Desktop`、`~/Downloads`）。支持 `~`、`$VAR`、`${VAR}` 和 `%VAR%`（Windows）。

**环境**
- **自定义变量**：Claude SDK 的环境变量（KEY=VALUE 格式，支持 `export ` 前缀）
- **环境片段**：保存和恢复环境变量配置

**高级**
- **Claude CLI 路径**：Claude Code CLI 的自定义路径（留空自动检测）

## 安全和权限

| 范围 | 访问权限 |
|------|----------|
| **Vault** | 完全读写（通过 `realpath` 确保符号链接安全） |
| **导出路径** | 仅写入（如 `~/Desktop`、`~/Downloads`） |
| **外部上下文** | 完全读写（仅限会话内，通过文件夹图标添加） |

- **YOLO 模式**：无审批提示；所有工具调用自动执行（默认）
- **Safe 模式**：每次工具调用弹出审批模态框；Bash 需要精确匹配，文件工具允许前缀匹配

## 隐私和数据使用

- **发送到 API**：你的输入、附加的文件、图片和工具调用输出。默认：Anthropic；可通过 `ANTHROPIC_BASE_URL` 自定义端点。
- **本地存储**：设置、会话元数据和命令存储在 `vault/.claude/`；会话消息在 `~/.claude/projects/`（SDK 原生）；旧版会话在 `vault/.claude/sessions/`。
- **无遥测**：除了你配置的 API 提供商外没有任何追踪。

## 故障排除

### Claude CLI 未找到

如果你遇到 `spawn claude ENOENT` 或 `Claude CLI not found`，说明插件无法自动检测你的 Claude 安装。这在使用 Node 版本管理器（nvm、fnm、volta）时很常见。

**解决方案**：找到你的 CLI 路径并在设置 → 高级 → Claude CLI 路径中设置。

| 平台 | 命令 | 示例路径 |
|------|------|----------|
| macOS/Linux | `which claude` | `/Users/you/.volta/bin/claude` |
| Windows（原生） | `where.exe claude` | `C:\Users\you\AppData\Local\Claude\claude.exe` |
| Windows（npm） | `npm root -g` | `{root}\@anthropic-ai\claude-code\cli.js` |

> **注意**：在 Windows 上，避免使用 `.cmd` 包装器。使用 `claude.exe` 或 `cli.js`。

**替代方案**：在设置 → 环境 → 自定义变量中将你的 Node.js bin 目录添加到 PATH。

### npm CLI 和 Node.js 不在同一目录

如果使用 npm 安装的 CLI，检查 `claude` 和 `node` 是否在同一目录：
```bash
dirname $(which claude)
dirname $(which node)
```

如果不同，像 Obsidian 这样的 GUI 应用可能找不到 Node.js。

**解决方案**：
1. 安装原生二进制文件（推荐）
2. 在设置 → 环境中添加 Node.js 路径：`PATH=/path/to/node/bin`

**仍有问题？** [提交 GitHub issue](https://github.com/YishenTu/claudian/issues)，附上你的平台、CLI 路径和错误信息。

## 架构

```
src/
├── main.ts                      # 插件入口点
├── core/                        # 核心基础设施
│   ├── agent/                   # Claude Agent SDK 封装（ClaudianService）
│   ├── agents/                  # 自定义代理管理（AgentManager）
│   ├── commands/                # 斜杠命令管理（SlashCommandManager）
│   ├── hooks/                   # PreToolUse/PostToolUse 钩子
│   ├── images/                  # 图片缓存和加载
│   ├── mcp/                     # MCP 服务器配置、服务和测试
│   ├── plugins/                 # Claude Code 插件发现和管理
│   ├── prompts/                 # 代理的系统提示词
│   ├── sdk/                     # SDK 消息转换
│   ├── security/                # 审批、阻止列表、路径验证
│   ├── storage/                 # 分布式存储系统
│   ├── tools/                   # 工具常量和实用函数
│   └── types/                   # 类型定义
├── features/                    # 功能模块
│   ├── chat/                    # 主聊天视图 + UI、渲染、控制器、标签
│   ├── inline-edit/             # 内联编辑服务 + UI
│   └── settings/                # 设置标签页 UI
├── shared/                      # 共享 UI 组件和模态框
│   ├── components/              # 输入工具栏组件、下拉菜单、选区高亮
│   ├── mention/                 # @-mention 下拉控制器
│   ├── modals/                  # 审批 + 指令模态框
│   └── icons.ts                 # 共享 SVG 图标
├── i18n/                        # 国际化（10 种语言）
├── utils/                       # 模块化工具函数
└── style/                       # 模块化 CSS（→ styles.css）
```

## 路线图

- [x] Claude Code 插件支持
- [x] 自定义代理（子代理）支持
- [x] Claude in Chrome 支持
- [x] `/compact` 命令
- [ ] 钩子和其他高级功能
- [ ] 更多功能即将推出！

## 许可证

基于 [MIT 许可证](LICENSE) 授权。

## Star 历史

[![Star History Chart](https://api.star-history.com/svg?repos=YishenTu/claudian&type=date&legend=top-left)](https://www.star-history.com/#YishenTu/claudian&type=date&legend=top-left)

## 致谢

- [Obsidian](https://obsidian.md) 提供的插件 API
- [Anthropic](https://anthropic.com) 提供的 Claude 和 [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview)
