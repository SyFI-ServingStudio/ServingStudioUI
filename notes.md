# 2026-09-07

- 接入点：app/src/application/conversationRepository.ts 与 app/src/features/workspace/CodexRuntimePicker.tsx。
- 建议由后端目录提供 runner/provider 与支持的参数，UI 展示 Claude、可用性和准确的 effort/tier，保留会话开始后的 family 锁定。
- 需处理无 effort 选项的模型，避免现有 model × effort 网格无法选中；同时审查 Codex 专属名称与提示文案。
- 统一服务端 SSE 后，消息展示与 Analyzer 结果界面可继续复用。
- 详细调查：../user-facing-ui/notes.md。未执行应用测试，因为本次仅调查并记录。
- Claude 第一版提供 low/medium/high 和 default tier，因此当前网格可直接选择，并且从 GPT Fast 切换到 Claude 时会自动回到 default。后端部署且提供凭据后，Claude 可选；未提供凭据时会显示为禁用。
- CodexRuntimePicker.tsx 的 aria-label 与会话锁定提示仍写 Codex，应改为 Agent；当前禁用模型的 tooltip 只显示 model ID，宜补明确的不可用原因。后端工作树代码尚未部署，因此当前线上目录还不会包含新增模型。

- 用户最新要求：UI 原 main 的 alignment 改动与 Claude feature 改动分别提交后合并到 main 并推送。Agent 配套改动先在 feat/claude-backend 提交，目标分支待确认（现有默认分支为 agent-http-api，没有 main）。临时 .artifacts 不进入提交，后端已添加 ignore。
