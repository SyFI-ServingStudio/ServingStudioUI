# VibeSim Visualization App

React + TypeScript + Vite 主应用，使用 MUI、ECharts、Motion、TanStack Query 和 Zustand。当前页面展示运行概览、系统拓扑、worker kernel time-share 和 analyzer 指标；默认数据来自真实 analyzer 输出的确定性 fixture，缺失的 iteration/backpressure/trace subject 不使用假数据补齐。

## 命令

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 5177
npm run typecheck
npm run build
```

## 数据接入原则

组件不直接拼接 analyzer 路径；旧 `fakeData.ts` 已删除。当前由 application active-run assembler 通过 `AnalyzerRepository` 读取可验证的真实 fixture，下一步实现 artifact/HTTP repository。异步数据、加载/失败/不可用状态由 repository/query 层处理；Zustand 只保留目录 ID 和本地交互选择。

完整工作计划和 analyzer 协议分别见 [`../WORKPLAN.md`](../WORKPLAN.md) 与 [`../docs/data-protocol.md`](../docs/data-protocol.md)。
