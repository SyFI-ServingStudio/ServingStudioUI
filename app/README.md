# VibeSim Visualization App

React + TypeScript + Vite 主应用，使用 MUI、ECharts、Motion、TanStack Query 和 Zustand。当前页面展示运行概览、系统拓扑、worker kernel time-share 和 analyzer 指标；默认数据来自真实 analyzer 输出的确定性 fixture，缺失的 iteration/backpressure/trace subject 不使用假数据补齐。

## 命令

```bash
npm install
npx playwright install chromium
npm run dev -- --host 0.0.0.0 --port 5177
npm run format:check
npm run typecheck
npm run lint
npm run test:unit
npm run test:coverage
npm run test:e2e
npm run build
```

Vitest 测试锁定 analyzer descriptor、active-run 装配和 Provider 生命周期。测试使用独立 QueryClient 与 test repository，不读取生产 fixture，也不依赖 GPU。

Playwright 会自动启动或复用 5177 端口的开发服务，并在 1440×900 与 390×844
Chromium 中覆盖核心导航、实时响应式重排、浏览器 console/page error 和 axe WCAG
A/AA 门槛。`npm run test:a11y` 可只运行无障碍检查；失败 trace、截图、视频和报告写入
`../.artifacts/playwright-test/`。

## 数据接入原则

组件不直接拼接 analyzer 路径；旧 `fakeData.ts` 已删除。当前由 application active-run assembler 通过 `AnalyzerRepository` 读取可验证的真实 fixture，下一步实现 artifact/HTTP repository。异步数据、加载/失败/不可用状态由 repository/query 层处理；Zustand 只保留目录 ID 和本地交互选择。

完整工作计划和 analyzer 协议分别见 [`../WORKPLAN.md`](../WORKPLAN.md) 与 [`../docs/data-protocol.md`](../docs/data-protocol.md)。
