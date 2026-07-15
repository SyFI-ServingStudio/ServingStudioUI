# VibeSim UI 工作计划

本文件是 UI 独立仓库的持续工作清单。每个阶段都应保持可构建、可验证；状态变化和影响架构的决定应同步记录在这里。

状态约定：`[x]` 已完成，`[ ]` 待完成，`[~]` 正在进行。

## P0 · 仓库基线

- [x] 审查现有 UI、analyzer 代码及真实运行输出
- [x] 在 `viz-ui/` 初始化独立 Git 仓库
- [x] 排除依赖、构建输出和浏览器测试产物
- [x] 建立项目说明、数据协议和首个可回退基线提交

验收标准：`git status` 不包含 `node_modules/`、`dist/`、`.artifacts/`；当前 UI 的 typecheck 和 production build 通过。

## P1 · 数据边界

- [x] 定义 analyzer v1 的运行、拓扑、subject、worker、iteration 合同
- [~] 为当前 analyzer JSON 增加运行时校验和兼容适配（descriptor、kernel-time-share 已完成，其他 subject adapters 待实现）
- [x] 建立 `AnalyzerRepository` 接口
- [x] 用真实输出裁剪出小型、可提交的 fixtures（25 个真实 artifact + provenance，确定性生成）
- [x] 实现 `FixtureAnalyzerRepository`
- [x] 顶层选择器改为 repository 提供的 simulation folder；当前只展示真实重分析目录，不展示 demo 模型
- [x] 让页面从 repository/query 加载，删除 `fakeData`；application assembler 保留 subject 状态并构建当前兼容 `Run` 视图
- [~] 对 unavailable、not generated、failed 和 incompatible 提供明确 UI 状态（当前真实缺失项已显式空态，通用状态组件待实现）

验收标准：页面可完全由 fixture repository 驱动；畸形或版本不兼容的数据会产生可读错误，而非静默显示错误图表。

## P2 · 工程质量护栏

- [x] 配置 ESLint、Prettier 和显式 UI 文件范围的格式检查
- [x] 配置 Vitest + Testing Library（descriptor、subject adapter、active-run assembler、Provider lifecycle、fixture loader 共 29 个测试）
- [x] 配置官方 Playwright，并增加核心导航和响应式 smoke tests
- [x] 增加 axe 可访问性检查
- [x] 增加 GitHub Actions：format、typecheck、lint、unit、build、size、browser smoke
- [x] 按需注册 ECharts 图表能力，避免默认入口引入完整运行时
- [x] 用 Size Limit 同时约束初始入口和全部 JavaScript chunks 的 gzip 体积

验收标准：本地和 CI 有同一套可重复命令；核心用户路径、移动端布局和基础无障碍均受自动测试保护。

## P3 · 可维护性重构

- [ ] 按 feature 拆分 overview、system-map、worker、kernel 和 trace 模块
- [ ] 将 domain、transport DTO 和 view-model 分离
- [x] 将 Zustand 限定为 UI/选择状态；active run、catalog、descriptor 和 subject 数据由 query cache 管理
- [ ] 将 cost tree 改为可判别联合类型，消除不安全断言
- [ ] 收紧 store selector，避免整库订阅导致的无关重渲染
- [ ] 统一图表主题、tooltip escaping、空态和交互语义
- [x] 修复实时 resize、键盘导航、canvas 标签和 icon button 名称

验收标准：功能目录具有清晰公共 API；数据加载与 UI 状态职责分离；性能和 a11y 回归有测试覆盖。

## P4 · Rust analyzer 接线

- [ ] 明确 analyzer artifact index / HTTP API 的所有权
- [ ] 实现 `HttpAnalyzerRepository`
- [ ] 聚合 subject 使用静态 JSON；worker/iteration 明细按需加载
- [ ] 支持分析生命周期和 subject 状态轮询
- [ ] 支持 Perfetto trace URL，不在浏览器读取 raw parquet
- [ ] 与 Rust 端共享或生成协议 schema，并加入兼容性测试

验收标准：一个真实 run 可从索引发现并完整浏览；大 run 的首屏与钻取请求均有明确性能预算。

## P5 · 缺失数据源

- [ ] 在 run artifact 中固化模型配置快照
- [ ] 固化 offered workload / trace overview 所需摘要
- [ ] 增加 worker、pool、cluster pending queue / backpressure subject
- [ ] 增加 worker iteration index 和 iteration detail subject 或查询端点
- [x] 修复 analyzer utilization 对跨 pool 重复 worker id 的聚合问题

这些项目需要 analyzer 侧补充；UI 在此之前必须显示“数据源尚未生成”，不得伪造为零值。

## 架构决定

1. `viz-ui/` 是独立 Git 根；可交付应用暂保留在 `app/`，旧 HTML 原型只作视觉参考。
2. 浏览器只消费 `reports/`、`payloads/`、`traces/` 和运行描述，不直接读取 raw parquet。
3. worker 标识是 `(pool_tag, worker_id)`，序列化键采用 `pool_tag/worker_id`；`worker_id` 不能被视为全局唯一。
4. 当前 analyzer `schema_version: 1` 由 subject-specific adapter 接入，不能假设所有 payload envelope 完全一致。
5. 缺失、未生成、生成失败、协议不兼容是不同状态；不能一律折叠为空数组。
6. aggregate 首屏使用有界静态 artifact；高基数 iteration 数据按 worker/iteration 懒加载。
7. Zustand 负责本地交互状态；异步 analyzer 数据不写入无界的全局 map。
8. TanStack Query 负责 repository 异步状态与缓存；repository 通过 React context 注入。
9. 顶层运行标识是 simulation folder 名；浏览器通过 repository 的 run catalog 发现目录，不直接扫描服务器文件系统。
10. Repository 只提供 descriptor、typed summary/topology、subject 和 worker detail 读取；整页兼容 `Run` 在 application 层组装，不能作为 repository DTO。

## 已验证的已知问题

- Worker/Motion 和真实 fixture 已分别在 drill 与 repository 边界按需导入；
  production 入口约 1.08 MB / 352 KB gzip，fixture chunk 约 227 KB / 67 KB gzip，
  worker chunk 约 160 KB / 52 KB gzip，所有 chunks 合计约 470 KB gzip。当前默认
  run 会在 catalog bootstrap 后立即加载 fixture；真正的 per-run 数据按需加载属于 P4。
  Size Limit 当前约束入口 ≤500 kB、全部 JS chunks ≤590 kB（gzip）。
- desktop 冷启动、390 px 冷启动及 desktop→390 px 实时缩放均已由 Playwright
  overflow 回归保护；检查会等待 ResizeObserver/ECharts 重排稳定后再判定。
- npm 当前报告 2 个 moderate、1 个 high 依赖漏洞；P2 先审计依赖链，禁止直接运行破坏性 `npm audit fix --force`。
- 当前兼容 assembler 为 cluster kernel breakdown eager 读取全部 worker aggregate tree；接入 HTTP 前应改为直接消费 kernel-time-share aggregate，再让 worker tree 按选择懒加载。

## 运行记录

- `20260715_0_afd_ui_refresh`：dry-run 为 1 个正确 AFD run；正式 cache build 因没有 idle GPU 在 simulation 前退出，未产生新模拟数据。
- `20260715_1_afd_ui_reanalysis`：复制 20260703 的事实数据，使用修复后的 analyzer 重算。utilization 为 10 workers（attn 8、ffn 2），FFN avg 0.653；kernel time share ready，kernel input distribution 因旧日志缺列而 unavailable。
