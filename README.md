# VibeSim Visualization UI

VibeSim 运行结果、部署拓扑和 worker/kernel 明细的交互式可视化界面。本目录是独立 Git 仓库；当前主应用位于 `app/`，根目录下的 `design-*.html` 与 `shared/` 是早期视觉原型，仅作为设计参考。

目前界面仍由 fixture/fake data 驱动。接下来的目标不是让组件直接读取日志文件，而是建立经过运行时校验的 analyzer 协议和 repository 边界，再接入 Rust analyzer。

## 开发

```bash
cd app
npm install
npm run dev -- --host 0.0.0.0 --port 5177
```

验证当前应用：

```bash
cd app
npm run typecheck
npm run build
```

## 目录

```text
viz-ui/
├── app/                    React + TypeScript + Vite 主应用
├── docs/
│   └── data-protocol.md    analyzer → UI 数据边界与版本策略
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
- 缺失、未生成、失败和版本不兼容均为显式状态，不伪装成零值。

具体任务见 [WORKPLAN.md](WORKPLAN.md)，协议依据见 [docs/data-protocol.md](docs/data-protocol.md)。
