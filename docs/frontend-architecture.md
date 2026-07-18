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
  metrics/            cluster/pool 共用的 scope-aware 指标投影与业务图表
  cluster/            whole-deployment 指标与 conservation
  pool/               pool resource、wall-clock aggregate/average batch 与 kernel composition
  worker/             worker resource、CostTree、batch/time-share；batch 按 total/prefill/decode requests 分三图
  kernel/             kernel/parallel drill、roofline、input distribution
  trace/              Perfetto resource 与嵌入控制器
```

每个 feature 通过 `index.ts` 暴露最小公共 API。外部代码不得 import 其内部
`components/`、`model.ts` 或 `options.ts`。测试与被测实现共置；跨 transport 的
contract tests 仍留在 `contracts/` 或 `repositories/`。

Section 02 的 Cluster、Pool 与 Worker aggregate 视图都必须将 Request state/backpressure 放在
Kernel breakdown 之前，并由 Kernel breakdown 作为该 section 的最后一张图。

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

### 4.3 时间游标与 operation 选择

一个 `OperationSummary` 精确对应一条 raw `worker_cost` 行，并由
`(iter_id, batch_id, operation_id)` 唯一标识。UI 不建立可选择的 execution envelope，也不把
同一 iteration 内不同 batch、layer 或 section 的 compute 合并。operation selector 按全局
`ordinal` 把当前 viewport 绘制为等宽 cell 中窄间隔排列的独立竖条；每条竖条只表示一条
operation，其高度按当前 viewport 内的 `end_ms - start_ms` 归一化，宽度不编码 duration。
hover 必须同时突出 cell 和竖条，并展示真实 interval。真实 `[start_ms, end_ms)` 也继续用于
cursor、seek、readout 和 CostTree identity，不能因 ordinal 投影而从数据中丢失。FFN slot
或 attention batch 只用稳定颜色区分，不拆成多条 lane/sub-band。

bar 高度的目标 y-scale 由当前 resident buffer 的 duration P95 确定，使单个长 operation
不会压扁其他竖条；resident buffer 改变时允许目标 scale 跟随新的 workload regime，但 bar
高度与 y-axis 刻度必须在短 easing 动画中同步过渡，不能瞬间重缩放。普通 operation 最多
使用绘图区高度的 80%，resident buffer 的最大 operation 独占 100% 高度，使最大值至少比
其余 bar 多出 20% 绘图区高度。左侧 duration y-axis 必须明确标出 `max`、位于 80% 高度处
的 `P95` 和 `0`；hover/readout 仍显示真实 interval。系统要求 reduced motion 时直接采用
新 scale。

点击 operation 竖条时，一个 store action 同时写入完整 `OperationRef` 并把全局 cursor
定位到其 `start_ms`，随后仅请求这一条 operation 的 CostTree。用户直接拖动全局 cursor 时，
当前 operation buffer、selection 和 CostTree 作为非破坏性的 pending 内容继续显示；融合
seek 响应到达后再原子替换。零候选不伪造选择；有候选时按服务端稳定 `anchor` 自动选择。
Canvas 是唯一 exact-operation 选择区域，不额外生成 candidate Chip 或第二套 selector；用户
可直接点击当前 ordinal viewport 内的其他彩色竖条改选。晚返回只有在 `at_ms` 仍等于当前 cursor 时
才能改变状态。

可见 viewport 固定为最多 64 条 operation，内存只保留 previous/current/next 共最多 192
条。跨过一个 64 条边界时仅请求新暴露方向的一块，成功后才淘汰反方向的一块；pending
期间不能闪空。seek 直接返回以 anchor 为中心的 192 条 buffer，不能再串行请求可见 range。

共享轨道支持水平 pointer drag：超过显式阈值后，按拖动距离相对可见宽度换算 operation
offset，并 clamp 在当前 resident buffer；触及边界时启动上述单向 refill。pointer capture
保证出界释放仍完成手势，drag 后的 click 必须被抑制；未超过阈值仍是普通 operation click。
Previous/Next 与键盘逐 operation 导航继续可用。

## 5. 交互、图表与性能

- 可点击 UI 使用原生 `button`、`a`、`input` 或 MUI 对应语义控件；不以
  `Box + onClick + 手写 keydown` 模拟控件。
- ECharts 只能经共享平台入口按需注册，tooltip 的 Analyzer 文本必须 escape。默认使用
  SVG renderer，使坐标轴、图例和 annotation 保持为可缩放矢量文字；只有实测证明某张
  有界高密度图需要 canvas 时，才在共享封装中增加显式例外。
- 页面一级 card 必须使用共享 `SurfaceCard`，由它统一 warm-white surface、普通边框、圆角、
  shadow 和覆盖在 feature 内容上方的 2px semantic left edge；canvas 或不透明 viewport 不得遮住
  该 edge。feature 不得重新手写这套 shell。页面 section 通过 `SurfaceAccentProvider` 统一 edge：
  Overview 使用 teal、System map（包括 Timeline 与 whole-run trace）使用 Sea Nymph `#6F9F9C`、
  scope stage 使用 Smalt Blue `#577E89`；section 内 feature-local `accent` 不得覆盖 section edge。Architecture
  overview 也使用该共享单元，作为实现基准而不是例外。
- 页面主体按 `00 Overview`、`01 System map`、`02 scope stage` 建立一级 section；model、simulation
  和 trace overview card 是 `00 Overview` 的子级，使用 `h3` card heading，不与 section `h2` 并列。
  System map 下的 topology card 同样以 `Deployment` `h3` 标识其内容层级。
- 选择 Zustand 时订阅最小 primitive/tuple，不制造完整 store snapshot。
- kernel detail 的 config 与 exact input 必须解码为带字段名的可读列表，不直接展示 Python
  repr 或 JSON；FLOP、byte、throughput 与 bandwidth 使用紧凑工程单位。detail 网格中的 value
  使用一致的字体层级，不能因字段来源不同随机切换 serif/mono 或粗细。字段按 Overview、
  Execution、Performance 三张语义 card 在宽屏组成等宽三列，窄屏降为单列；card 内使用
  紧凑的纵向 label → value 行，不为每个字段生成独立 card。字段 label 使用清晰可辨的
  medium/semibold mono 层级；value 保持统一字号，不因字段类别任意放大。
- operation selection 与 exact CostTree primary 工作面由 worker feature 的 viewport shell 共同布局。
  `lg` 及以上 shell 高度为 `calc(100dvh - 12px)`，第一轨按 operation timeline 的 max-content
  高度展开，第二轨在 480px 到 723px 之间吃掉剩余空间；超高 viewport 不继续拉长工作面，矮屏则
  保留 480px 最小工作面并允许 shell 内容自然 overflow。所有 awaiting/loading/error/ready 状态、
  左侧 CostTree、右侧 placeholder 与 selected inspector 都继承同一个 CSS workbench height，切换时
  不得闪动；CostTree header 固定 45px，canvas 填满剩余 frame。
- Worker 的 Iteration 模式只呈现一张 operation-relative kernel breakdown card：同一卡片内同时给出
  `by kernel family` 与 `by kernel position`，两者都按 critical path / CostTree root wall-clock
  计算。Worker aggregate 模式使用 aggregate `kernel-time-share` worker row 展示跨全部 operation
  的 kernel family 与 position composition；position mix 必须明确标出 exact 或 sampled，不能冒充
  exact operation CostTree。所有 kernel-time breakdown、CostTree family legend、leaf
  与 operation selection lane 必须复用 `domain/cost-tree` 的同一套 Mineral family palette。Worker
  breakdown 另提供一条六 family 等宽的 visual-only palette bar；它不得伪装成真实时间比例。
- exact CostTree ready 工作面在 `lg` 及以上保持左右两列：左列是完整 CostTree frame，右列是约
  `clamp(300px, 26vw, 340px)` 的 kernel inspector。未选择 kernel 时右列保留轻量 placeholder，
  避免选择造成 CostTree 宽度跳变；窄屏使用自然高度上下布局，每块保持 723px 且不得产生页面级
  横向滚动。inspector 只拥有 header 与 Overview、Execution、Performance 三张纵向语义 card；
  aggregate kernel evidence 保留为 shell 下方的全宽区域。
- exact operation ready 后按 operation identity 去重滚动整个 worker viewport shell；shell 的 rendered
  height/scrollHeight 不超过 viewport 时居中，否则顶部对齐。kernel 选择 ready 后也按 leaf identity
  去重定位同一个 viewport shell；shell 已完整可见时不得产生二次滚动，否则使用相同 center/start
  规则。不能单独滚动 workbench 或 inspector；CostTree canvas 的内部 pan/zoom transform 不参与页面滚动。
  CostTree 的 sequential 容器使用按 node depth 增强且有 alpha 上限的 muted steel blue-gray
  实线与 tint 建立嵌套层级；Max 保留 violet pattern、Scale 保留 gold dashed border，容器底色
  不得压过 leaf selection boundary，root 也不得形成大面积不透明白底。
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
