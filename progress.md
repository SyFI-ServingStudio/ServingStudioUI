# 2026-09-07

- 已检查 conversationRepository.ts、CodexRuntimePicker.tsx、codexRuntime.ts。
- 模型选择器按 API 返回的 family 动态分组，可扩展 Claude。
- 保留检查前已有的 alignment 等未提交修改；本次未修改应用代码。
- 再次核对 Claude 第一版接入：现有选择器会动态显示 Claude family，无需新增选择控件；仍需将用户可见的 Codex 专属文案改为 Agent，并补 Claude 选择/不可用/会话锁定的 UI 回归测试。

- 本轮提交范围：main：保留并提交原有 alignment 指标、全屏缩放、大数据处理和 Analyzer 契约兼容修改。
- 验证：336 项相关测试、类型检查、修改文件 ESLint 通过；修正 operationSplitModel.ts 的 Prettier 格式。
