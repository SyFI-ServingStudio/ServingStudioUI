# 2026-09-07

- 工作树 wt-ui-claude，分支 feat/claude-picker，基线 7c6f2cb。
- 原 viz-ui 未提交的 alignment 修改保留，新工作树从已提交基线创建。
- 已完成通用 Agent 文案、Claude 不可用提示和 transcript 标签，以及单角色/混合角色/切换参数/会话锁定测试。
- 51 项相关单元测试通过；typecheck、build、修改文件 ESLint/Prettier 和 diff 检查通过。
- 独立镜像构建与仓库 build smoke 验收通过；Claude 2.1.250、Codex 0.144.0；8 张 B200 可见，torch.cuda.is_available=True。
- 第二套服务运行中：UI 0.0.0.0:60035、Agent 172.17.0.1:8767、Analyzer 172.17.0.1:8789。
- 独立状态目录 agent-workspaces-claude，tmux socket /tmp/vibesim-claude-1003.sock；原服务 PID 和端口保持运行。
- 桌面/手机真实浏览器检查通过，无 pageerror；7 个本机 UI/API 端点返回 200；容器到两个新服务均返回 200。
- Claude 未配置凭据，因此目前选项禁用，尚未发送真实 Claude 对话。
- 包体积检查仍有基线已有的超限；本次比基线增加约 0.05 KB gzip。详情见 notes.md。

- 真实镜像测试修复了 Claude schema 声明兼容问题，三个角色无凭据启动测试通过；新后端已重启，UI 代理模型目录 HTTP 200。

- 新实例 backend.sh 支持读取独立状态根下的 claude.env，用户在服务器终端输入凭据并重启生效；本次没有创建或读取凭据文件。shell 语法检查通过。

- 后端启动已接入 Agent 的 with_claude_env.py，自动读取现有环境或简单 Claude shell wrapper，原 claude.env 为可选。新实例已重启，Claude available=true，容器真实 READY 请求成功；无需手动复制 token。此前无凭据记录已被此验证更新。

- 模型发现：当前代理 /v1/models 返回 HTTP 403，未取得完整可用模型清单。使用真实最小请求核实 opus -> claude-opus-5、sonnet -> claude-sonnet-5。
- 四组固定 ID 验证全部成功：Opus 5 / Sonnet 5 × xhigh / max，返回正确 READY 结构化结果、退出码 0；证据位于 Agent .artifacts/claude-image-smoke/assistant-claude-*-live-report.json。
- 后端目录显示 Claude Sonnet 5、Claude Opus 5，提供 low/medium/high/xhigh/max。旧 opus/sonnet 会话选择兼容映射到固定 ID；默认 Claude 模型固定 Sonnet 5。UI transcript 显示可读版本名称，选择器继续使用后端目录。
- 174 项后端 unittest、52 项相关 UI tests、UI typecheck、修改文件 Ruff/ESLint 与 diff 检查通过；第二套实例后端已重启。

- 真实 Chromium 桌面 1440px / 手机 390px 验证通过：目录返回两款明确版本及五档 effort，Opus 5 max 可选并保持，无 pageerror。截图 UI .artifacts/claude-preview/claude-models-{1440,390}.png。初次脚本忘记关闭弹层便读取底层按钮而超时，修正脚本后通过，非产品错误。

- 本轮提交范围：feat/claude-picker：Claude 选择器、版本与 effort 展示、不可用提示及测试。
- 验证：52 项 UI 测试、类型检查、修改文件 lint、桌面/手机浏览器验证通过。
