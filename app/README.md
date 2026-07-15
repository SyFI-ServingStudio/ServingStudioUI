# VibeSim Visualization App

React + TypeScript + Vite 主应用，使用 MUI、ECharts、Motion 和 Zustand。当前页面展示运行概览、系统拓扑、worker iteration/batch、kernel cost tree 和 analyzer 指标；数据仍来自开发 fixture。

## 命令

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 5177
npm run typecheck
npm run build
```

## 数据接入原则

组件不应直接拼接 analyzer 路径，也不应把 `fakeData.ts` 当作长期领域合同。迁移将通过 `AnalyzerRepository` 渐进进行：先使用可验证 fixture，再实现 artifact/HTTP repository。异步数据、加载/失败/不可用状态在 repository/query 层处理；Zustand 只保留本地交互与选择状态。

完整工作计划和 analyzer 协议分别见 [`../WORKPLAN.md`](../WORKPLAN.md) 与 [`../docs/data-protocol.md`](../docs/data-protocol.md)。
