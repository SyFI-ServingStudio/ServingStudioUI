# VibeSim Visualization UI

VibeSim 运行结果、部署拓扑和 worker/kernel 明细的交互式可视化界面。本目录是独立 Git 仓库；当前主应用位于 `app/`，根目录下的 `design-*.html` 与 `shared/` 是早期视觉原型，仅作为设计参考。

当前界面由真实 analyzer 输出裁剪出的 fixture 驱动，顶层按 simulation folder 选择；旧的 Llama/Qwen demo 数据不再进入运行时。接下来的目标不是让组件直接读取日志文件，而是让同一 repository 边界接入 Rust analyzer 的 run catalog 与按需 artifact API。

## 开发

```bash
cd app
# Node.js 22
npm ci
npx playwright install chromium
npm run dev -- --host 0.0.0.0 --port 5177
```

验证当前应用：

```bash
cd app
npm run format:check
npm run typecheck
npm run lint
npm run fixture:check
npm run test:unit
npm run test:e2e
npm run build
npm run size:check
```

`test:e2e` 会自动启动或复用 5177 端口的开发服务，并在 desktop 与 390 px
Chromium 中执行导航、响应式、console/page error 和 axe 检查；只重跑无障碍门槛可用
`npm run test:a11y`。失败产物写入 `.artifacts/playwright-test/`。

`fixture:check` 会从 checked-in analyzer JSON 重新计算 descriptor、catalog 和内容 revision，
确保重新裁剪 fixture 后不会留下陈旧 sidecar。`size:check` 检查已有 `dist/`；需要从干净源码构建并检查时运行 `npm run size`。
当前预算同时约束入口 JavaScript 与所有 chunks 的 gzip 总量，避免 code splitting 仅把体积移出入口。

`.github/workflows/ci.yml` 在 Node.js 22 上并行运行静态/单测/bundle 与 Chromium
质量门槛；Playwright 失败诊断保留 7 天。仓库接入 GitHub remote 后即可启用该 workflow。

## 目录

```text
viz-ui/
├── app/                    React + TypeScript + Vite 主应用
├── docs/
│   ├── data-protocol.md    analyzer → UI 数据边界与版本策略
│   └── fixture-policy.md   真实输出裁剪、状态覆盖与单位不变量
├── design-*.html           旧视觉原型
├── shared/                 旧原型共享脚本
├── WORKPLAN.md             分阶段工作清单和架构决定
└── README.md
```

## 当前方向

- 浏览器消费 analyzer 的有界 reports、payloads、trace URL 和运行描述，不扫描 raw parquet。
- transport DTO、领域模型和视图模型分离；现有 analyzer v1 由 subject-specific adapter 兼容。
- worker 用 `(pool_tag, worker_id)` 复合标识，避免跨 pool 冲突。
- fixture、静态 artifact 和 HTTP 使用同一个 `AnalyzerRepository` 接口。
- 运行选择器展示 simulation folder 名称、状态只保存 opaque run id；当前 fixture catalog 含 `20260715_1_afd_ui_reanalysis`。
- 缺失、未生成、失败和版本不兼容均为显式状态，不伪装成零值。

具体任务见 [WORKPLAN.md](WORKPLAN.md)，协议依据见 [docs/data-protocol.md](docs/data-protocol.md)。
