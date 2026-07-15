# 前端架构与 feature 边界

本文定义 `viz-ui/app/src` 为后续扩展必须遵守的依赖方向和 feature
所有权。它补充 `data-protocol.md`：后者规定 Analyzer → UI 合同，本文规定
合同进入浏览器后由谁读取、适配和渲染。

## 1. 目标与不变量

- 生产页面只展示 repository 提供的 Analyzer 事实；缺失能力显示显式状态，不生成
  synthetic 数值补洞。
- Zustand 只保存本地导航与选择状态。catalog、descriptor、subject、worker detail、
  iteration detail 和 trace 都由 TanStack Query 按资源身份缓存。
- core run 只由 descriptor、summary 和 topology 组成。optional subject 不复制进
  `Run`，也不经一个包含所有 subject 的 React context 广播。
- 每个 feature 只通过公开入口被其他 feature 使用；内部组件、options、view-model
  和测试共置。
- wire identity 不从展示文本推导。run 使用 opaque id，worker 使用
  `(pool_tag, worker_id)`，query key 还必须包含 schema/revision 和资源 id。

## 2. 依赖方向

```text
App ──▶ features/* ──▶ application ──▶ repositories ──▶ contracts/analyzer/v1
          │                 │                 │                    │
          ├──▶ shared UI    └────────┬────────┴────────────────────┤
          ├──▶ charts platform       └──────────▶ domain ◀─────────┘
          └─────────────────────────────────────▶ domain
```

依赖只能沿箭头方向：

1. `domain/` 是 transport-agnostic 的领域类型和纯 invariant，不依赖 React、Query、
   repository 或 feature。
2. `contracts/analyzer/v1/` 拥有 wire DTO、Zod 校验和 v1 → domain adapter。它不包含
   fetch、React hook 或展示 fallback。
3. `repositories/` 只负责 I/O、href 安全和 transport error；它返回 typed artifact，
   不返回整页 view-model。
4. `application/` 拥有 Query key、core active-run 生命周期、subject/detail hooks 和跨
   feature 的选择投影。它不绘制卡片或图表。
5. `features/` 拥有一个用户可识别功能的组件、view-model 和 feature-specific chart
   options。feature 不直接拼 URL、读取 wire JSON 或保存服务端结果到 Zustand。
6. `components/` 最终只保留真正跨 feature 的展示原语，例如通用图表卡、状态面板和
   focus dialog；业务命名组件必须归属 feature。
7. `charts/` 只保留 ECharts 注册、主题、tooltip escaping、resize/export 等平台层。
   某张业务图的 option builder 跟随其 feature。

若两个 feature 需要共享领域计算，先判断它是否属于 `domain/` 的纯 invariant 或
`application/` 的跨页面投影；不要通过反向 import 共享另一个 feature 的内部文件。

## 3. Feature 目录

目标结构如下；迁移应按小提交逐个完成，每一步保持 build 和测试可运行。

```text
features/
  run-overview/       model/simulation/trace overview 与 masthead KPI
  system-map/         cluster → pool → worker 拓扑导航
  timeline/           run cursor 与真实 worker iteration index
  cluster/            whole-deployment 指标与 conservation
  pool/               pool resource、batch、kernel composition 与 worker list
  worker/             worker evidence、CostTree、batch/time-share
  kernel/             kernel/parallel drill、roofline、input distribution
  trace/              Perfetto resource 与嵌入控制器
```

每个 feature 通过 `index.ts` 暴露最小公共 API。外部代码不得 import 其内部
`components/`、`model.ts` 或 `options.ts`。测试与被测实现共置；跨 transport 的
contract tests 仍留在 `contracts/` 或 `repositories/`。

当前 `data/` 是迁移目录，不是长期层。真实纯计算移到对应 feature/domain；只服务旧
demo 的 generator 应删除或移到 test-only fixture，不能被 production component import。

## 4. 数据读取与状态

### 4.1 Core 与 optional subject

`ActiveRunProvider` 只提供 catalog 选择后的 descriptor 和 bounded core `Run`。组件用
`useActiveRunSubject(name)` 订阅自己渲染的一个 subject；不能恢复 `subjects` 大对象
context，也不能把 payload 再复制到 `Run.payloads`。

descriptor 为 ready 并不代表所有 subject ready。每张卡独立处理：

- `pending`
- `ready`（包括合法空集合）
- `unavailable`
- `not_generated`
- `failed`
- `incompatible`（UI adapter 产生）

只有 core summary/topology 不可读时整页失败；optional subject 和 worker detail 的失败
被限制在其 feature boundary。

### 4.2 高基数资源

worker CostTree、iteration index/detail 和未来按窗口 Perfetto trace 只在选择后请求。
Query key 至少包含：

```text
run id + analysis revision + resource schema + worker ref + detail identity/window
```

列表必须分页或有明确上限；浏览器不扫描 parquet，也不把无界 detail map 放入全局
store/context。

## 5. 交互、图表与性能

- 可点击 UI 使用原生 `button`、`a`、`input` 或 MUI 对应语义控件；不以
  `Box + onClick + 手写 keydown` 模拟控件。
- ECharts 只能经共享平台入口按需注册，tooltip 的 Analyzer 文本必须 escape。
- 选择 Zustand 时订阅最小 primitive/tuple，不制造完整 store snapshot。
- 大 feature 在 drill boundary lazy-load；不要为躲避入口预算把同一 eagerly-needed
  代码机械拆成 chunk。
- 新图表必须有显式 loading/empty/error 文案、单位合同、窄屏行为和 accessible name。

## 6. 变更完成标准

每次 feature 迁移或数据接线至少验证：

1. scoped format、TypeScript、ESLint 和 `git diff --check`；
2. adapter/view-model 单测，以及状态和键盘交互回归；
3. 全量 unit、production build 和双 bundle size budget；
4. 涉及页面结构时运行 desktop + 390px Playwright 和 axe；
5. 涉及 HTTP 时用真实 Analyzer 服务检查请求数量、ETag/304、console/page errors，
   并确认没有 raw parquet 或未声明 artifact 请求。
