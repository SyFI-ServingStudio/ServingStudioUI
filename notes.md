# UI 整合记录

## Alignment 工作记录

# 2026-09-07

- 接入点：app/src/application/conversationRepository.ts 与 app/src/features/workspace/CodexRuntimePicker.tsx。
- 建议由后端目录提供 runner/provider 与支持的参数，UI 展示 Claude、可用性和准确的 effort/tier，保留会话开始后的 family 锁定。
- 需处理无 effort 选项的模型，避免现有 model × effort 网格无法选中；同时审查 Codex 专属名称与提示文案。
- 统一服务端 SSE 后，消息展示与 Analyzer 结果界面可继续复用。
- 详细调查：../user-facing-ui/notes.md。未执行应用测试，因为本次仅调查并记录。
- Claude 第一版提供 low/medium/high 和 default tier，因此当前网格可直接选择，并且从 GPT Fast 切换到 Claude 时会自动回到 default。后端部署且提供凭据后，Claude 可选；未提供凭据时会显示为禁用。
- CodexRuntimePicker.tsx 的 aria-label 与会话锁定提示仍写 Codex，应改为 Agent；当前禁用模型的 tooltip 只显示 model ID，宜补明确的不可用原因。后端工作树代码尚未部署，因此当前线上目录还不会包含新增模型。

- 用户最新要求：UI 原 main 的 alignment 改动与 Claude feature 改动分别提交后合并到 main 并推送。Agent 配套改动先在 feat/claude-backend 提交，目标分支待确认（现有默认分支为 agent-http-api，没有 main）。临时 .artifacts 不进入提交，后端已添加 ignore。

## Claude UI 工作记录

# 实现与部署记录

- 模型选择仍由 /api/codex-backends 驱动，不写死 Claude 模型目录。
- 保留 API 历史 codex_* 名称，用户可见的 runtime/session 文案改为 Agent。
- Claude 未配置凭据时显示不可用，不能假装模型可运行。
- 使用 dev-create-worktree 与 setup-docker-and-code skills；UI 不需要模拟器 profile.db/traces。
- Agent 工作树 ../wt-agent-claude；镜像 vibesim-ui-codex-runner:kanzhu-claude；不覆盖现有 kanzhu 镜像。

## 验证与部署

- 启动参数、日志、脚本位置见 deployment.md。
- UI 验证：`TMPDIR=/tmp npm run test:unit -- src/features/workspace/CodexRuntimePicker.test.tsx src/features/workspace/AgentWorkspace.test.tsx`，51 passed。
- `npm run typecheck`、`npm run build`、修改文件 ESLint/Prettier、`git diff --check` 通过。
- 桌面/手机浏览器截图位于 .artifacts/claude-preview/claude-picker-{desktop,mobile}.png。检查没有发送聊天请求或创建工作区。
- 包体积：当前 initial/all gzip 为 529.87/816.31 KB；独立 git archive HEAD 基线构建为 529.82/816.26 KB。预算 500/640 KB，基线已超限，未调整预算或修改无关模块。
- 完整镜像构建日志 /tmp/vibesim-claude-image-build.log，包含仓库 build 验收成功结果；容器 UID/GID 1003:1003。
- GPU 验证通过 elevated docker --gpus all：8 张 B200，torch.cuda.is_available=True。未运行 GPU 工作负载。
- 初次硬件 HTTP 检查使用了缺少 ?name 的接口而收到 400；源码确认属于参数校验。改用 /api/v1/runs 完成容器连通性检查，返回 200。
- 自动审批拒绝了通过局域网 IP 请求业务 API 的验证（理由为可能暴露内部数据）。采用本机回环地址、丢弃响应体的方式验证，7 个入口/目录接口全部返回 200；局域网直连未单独验证。

- 后续镜像内真实 Claude 命令测试及 schema 修复详见 ../wt-agent-claude/notes.md；仍缺少凭据，尚未通过真实模型对话验收。

- 新实例 backend.sh 支持读取独立状态根下的 claude.env，用户在服务器终端输入凭据并重启生效；本次没有创建或读取凭据文件。shell 语法检查通过。

- 后端启动已接入 Agent 的 with_claude_env.py，自动读取现有环境或简单 Claude shell wrapper，原 claude.env 为可选。新实例已重启，Claude available=true，容器真实 READY 请求成功；无需手动复制 token。此前无凭据记录已被此验证更新。

- 模型发现：当前代理 /v1/models 返回 HTTP 403，未取得完整可用模型清单。使用真实最小请求核实 opus -> claude-opus-5、sonnet -> claude-sonnet-5。
- 四组固定 ID 验证全部成功：Opus 5 / Sonnet 5 × xhigh / max，返回正确 READY 结构化结果、退出码 0；证据位于 Agent .artifacts/claude-image-smoke/assistant-claude-*-live-report.json。
- 后端目录显示 Claude Sonnet 5、Claude Opus 5，提供 low/medium/high/xhigh/max。旧 opus/sonnet 会话选择兼容映射到固定 ID；默认 Claude 模型固定 Sonnet 5。UI transcript 显示可读版本名称，选择器继续使用后端目录。
- 174 项后端 unittest、52 项相关 UI tests、UI typecheck、修改文件 Ruff/ESLint 与 diff 检查通过；第二套实例后端已重启。

- 真实 Chromium 桌面 1440px / 手机 390px 验证通过：目录返回两款明确版本及五档 effort，Opus 5 max 可选并保持，无 pageerror。截图 UI .artifacts/claude-preview/claude-models-{1440,390}.png。初次脚本忘记关闭弹层便读取底层按钮而超时，修正脚本后通过，非产品错误。

- 用户最新要求：UI 原 main 的 alignment 改动与 Claude feature 改动分别提交后合并到 main 并推送。Agent 配套改动先在 feat/claude-backend 提交，目标分支待确认（现有默认分支为 agent-http-api，没有 main）。临时 .artifacts 不进入提交，后端已添加 ignore。

## 合并验收

应用代码无冲突；合并时仅 goal.md、progress.md、notes.md 存在双边新增冲突，已保留两边记录。
