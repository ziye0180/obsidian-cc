# CLAUDE.md

## 项目概述

Claudian - 一个将 Claude Code 嵌入侧边栏聊天界面的 Obsidian 插件。Vault 目录成为 Claude 的工作目录，赋予它完整的代理能力：文件读写、bash 命令和多步骤工作流。

## 命令

```bash
bun run dev        # 开发模式（监听）
bun run build      # 生产构建
bun run typecheck  # 类型检查
bun run lint       # 代码检查
bun run lint:fix   # 代码检查并自动修复
bun run test       # 运行测试
bun run test:watch # 监听模式运行测试
```

## 架构

| 层级 | 用途 | 详情 |
|------|------|------|
| **core** | 基础设施（无 feature 依赖） | 参见 [`src/core/CLAUDE.md`](src/core/CLAUDE.md) |
| **features/chat** | 主侧边栏界面 | 参见 [`src/features/chat/CLAUDE.md`](src/features/chat/CLAUDE.md) |
| **features/inline-edit** | 内联编辑模态框 | `InlineEditService`，只读工具 |
| **features/settings** | 设置标签页 | 所有设置的 UI 组件 |
| **shared** | 可复用 UI | 下拉菜单、模态框、@-mention、图标 |
| **i18n** | 国际化 | 10 种语言 |
| **utils** | 工具函数 | date、path、env、editor、session、markdown、diff、context、sdkSession、frontmatter、slashCommand、mcp、claudeCli、externalContext、externalContextScanner、fileLink、imageEmbed、inlineEdit |
| **style** | 模块化 CSS | 参见 [`src/style/CLAUDE.md`](src/style/CLAUDE.md) |

## 测试

```bash
bun run test -- --selectProjects unit        # 运行单元测试
bun run test -- --selectProjects integration # 运行集成测试
bun run test:coverage -- --selectProjects unit # 单元测试覆盖率
```

测试文件在 `tests/unit/` 和 `tests/integration/` 中镜像 `src/` 结构。

## 存储

| 文件 | 内容 |
|------|------|
| `.claude/settings.json` | CC 兼容：权限、环境变量、enabledPlugins |
| `.claude/claudian-settings.json` | Claudian 特定设置（模型、UI 等） |
| `.claude/settings.local.json` | 本地覆盖（已 gitignore） |
| `.claude/mcp.json` | MCP 服务器配置 |
| `.claude/commands/*.md` | 斜杠命令（YAML frontmatter） |
| `.claude/agents/*.md` | 自定义代理（YAML frontmatter） |
| `.claude/skills/*/SKILL.md` | 技能定义 |
| `.claude/sessions/*.meta.json` | 会话元数据 |
| `~/.claude/projects/{vault}/*.jsonl` | SDK 原生会话消息 |

## 开发注意事项

- **SDK 优先**：优先使用 Claude SDK 原生功能，而非自定义实现。如果 SDK 提供了某个能力，直接使用——不要重复造轮子。这确保与 Claude Code 的兼容性。
- **SDK 探索**：开发 SDK 相关功能时，先写一个一次性测试脚本（如在 `dev/` 目录），调用真实 SDK 观察实际的响应结构、事件序列和边界情况。真实输出会落在 `~/.claude/` 或 `{vault}/.claude/`——检查这些文件来理解模式和格式。在写实现或测试之前先运行这个——真实输出胜过猜测类型和格式。这是任何 SDK 集成工作的默认第一步。
- **注释**：只注释 WHY，不注释 WHAT。不要写重复函数名的 JSDoc（如在 `getServers()` 上写 `/** Get servers. */`），不要写叙述性的内联注释（如在 `new Channel()` 前写 `// Create the channel`），不要在 barrel `index.ts` 文件上写模块级文档。仅在添加非显而易见的上下文时保留 JSDoc（边界情况、约束、意外行为）。
- **TDD 工作流**：对于新函数/模块和 bug 修复，遵循红-绿-重构：
  1. 首先在 `tests/unit/`（或 `tests/integration/`）的镜像路径下写一个失败的测试
  2. 用 `npm run test -- --selectProjects unit --testPathPattern <pattern>` 运行确认它失败
  3. 写最小实现使其通过
  4. 重构，保持测试绿色
  - 对于 bug 修复，在修复之前先写一个能复现 bug 的测试
  - 测试行为和公共 API，而非内部实现细节
  - 对于琐碎的改动（重命名、移动文件、配置调整）跳过 TDD——但仍然验证现有测试通过
- 编辑后运行 `bun run typecheck && bun run lint && bun run test && bun run build`
- 生产代码中不要有 `console.*`
  - 如果需要通知用户，使用 Obsidian 的通知系统
  - 使用 `console.log` 调试，但提交前删除
- 生成的文档/测试脚本放在 `dev/` 目录。
