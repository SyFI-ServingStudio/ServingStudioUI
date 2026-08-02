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
  prediction/         timing-predict catalog、case/iteration picker 与 prediction page composition
  trace/              Perfetto resource 与嵌入控制器
```

每个 feature 通过 `index.ts` 暴露最小公共 API。外部代码不得 import 其内部
`components/`、`model.ts` 或 `options.ts`。测试与被测实现共置；跨 transport 的
contract tests 仍留在 `contracts/` 或 `repositories/`。

Run iteration 与 timing prediction 只在 exact CostTree evidence 层共享。
`worker/` 继续拥有真实 worker operation timeline 与 worker selection；`prediction/`
拥有 case/iteration selection。CostTree canvas、kernel inspector、kernel throughput、
input distribution、critical-path breakdown 与 exact optimality 必须提取为接受 typed
evidence props 的公共 feature view，再由两种页面各自的 application provider 装配。
共享 view 不得读取 `ActiveRunProvider`、推断 synthetic worker，或接收本地 artifact path。

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
  不得闪动；CostTree header 固定 45px，canvas 填满剩余 frame。CostTree 的 browser-expanded 模式
  是该高度合同的显式例外：frame 使用 fixed viewport 填满 `100dvh`，保留浏览器 chrome，锁定页面
  滚动，并允许按钮或 `Escape` 恢复原工作台布局；进入和退出时各重新 fit 一次 canvas。
- Worker 的 Iteration 模式只呈现一张 operation-relative kernel breakdown card：同一卡片内同时给出
  `by kernel family` 与 `by kernel position`，两者都按 critical path / CostTree root wall-clock
  计算。Worker aggregate 模式使用 aggregate `kernel-time-share` worker row 展示跨全部 operation
  的 kernel family 与 position composition；position mix 必须明确标出 exact 或 sampled，不能冒充
  exact operation CostTree。所有 kernel-time breakdown、CostTree family legend、leaf
  与 operation selection lane 必须复用 `domain/cost-tree` 的同一套 Mineral family palette。Worker
  CostTree leaf hover 只显示 kind、backend、time、time share、compute rate 与 bandwidth；caption
  和 value 使用清楚分离的视觉层级，rate 与 kernel inspector 复用同一工程单位缩放和舍入规则。
  hover card 优先锚定在 leaf 侧边并与目标留出间距，空间不足时向另一侧或下方 flip，不得覆盖被
  hover 的 kernel card。
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
- Sweep aggregate 直接从全部 metric panels 开始，不另建一套重复的 coordinate card
  matrix。单击任意 panel 的数据点只改变页面本地的 member selection，并在所有 panels
  标出同一坐标；鼠标双击才进入 opaque `run_id` 对应的单 run 页面。没有 `run_id` 的
  member 可被选择但不能 drill-down。
- Sweep metric panels 按 `Throughput`、`Utilization`、`Request SLO` 语义 section
  组织。同一指标的 `mean` / `p99` 共用一张 panel，由 panel header 内的 segmented knob
  切换 statistic，不能复制成两张并列 panel。Statistic selection 由对应 panel 本地持有，
  切换时不能使 sibling panels 重新生成 ECharts option 或重绘。切换 experiment 时各 panel
  恢复其默认 statistic。Heatmap 的跨 panel member selection 必须由
  独立于数据 series 的高层 overlay 绘制，避免同层相邻 cell 覆盖选中边框。
  Aggregate chart hover 只使用 series emphasis 与右侧 visual scale 反馈，不显示重复数值的
  黑色 tooltip 浮层；精确 member selection 仍由单击完成。
  Heatmap 统一使用“更好结果更深”的 sequential color 语义。前端必须读取 metric descriptor
  的 `objective`：`maximize` 将高值映射到深色，`minimize` 将低值映射到深色；不能从
  `ttft`、`tpot` 等 key/name 猜测方向。右侧 visual scale 显示 `better` / `worse`，不再只写
  与优化目标无关的 `high` / `low`。Aggregate 图表必须优先保留可读的 axis name / tick
  字号，同时对 axis `nameGap`、ECharts `grid` gutter、visual scale 和 chart height
  设置紧凑的有界留白；单轴 line plot 也必须为 x-axis name 和旋转后的 y-axis unit
  预留完整 gutter，所有 axis text 都必须落在 chart viewport 内。大数值 tick 使用紧凑工程
  记法，不能靠溢出 card 或缩小文字换取 plot area。共享 `EChart` wrapper 必须监听
  容器尺寸，且只能在容器首次获得非零 width/height 后初始化 renderer；不能先以 `0×0`
  建图再期待后续 resize 修复。在 workspace 折叠、展开和拖拽过程中按 animation frame resize，使 panel
  图面随 shell 连续变化，不能只在 CSS transition 终点突然伸缩。二维 categorical
  sweep 使用原生 CSS Grid heatmap，使 cells、axis ticks、selection boundary 与 legend
  随 panel 布局直接伸缩；不能为这类小矩阵启动多个需要逐帧 resize 的 ECharts renderer。

## 6. Agent-first Analyzer evidence

已有 Analyzer selection 的 turn 由浏览器构造初始 citation dictionary。没有 selection 的
Agent-first turn 仍允许在执行过程中生成实验：managed Analyzer MCP 读取 exact workspace
sweep payload 后，将 payload 连同 capability 交给 conversation backend。backend 必须验证
该 experiment 属于 capability 的 workspace、conversation 和 turn，并以 registry 身份覆盖
workspace-local Analyzer payload 中不可导航的 workspace id。生成的 dictionary 作为有序
`citation.dictionary` turn event 持久化；finalization 使用最后一条动态 dictionary，若不存在
才回退到浏览器初始 dictionary。

MCP 返回值保留全部 Analyzer 原字段，并只增加 reserved `_vibesim_citations` metadata，向
Agent 提供自然 symbolic token 的组成规则。Agent 在最终 Markdown 中决定哪个 token 支持
哪个 claim；backend 只冻结 allowlist 中实际出现的 single-backtick token。renderer 不解析
数字或 artifact URL，也不会在用户点击前自动导航。

- Workspace 默认入口是 Page 0。它提供 `Explore results`、`New conversation` 与
  `Resume conversation` 三个互斥起点，默认展示 existing results。三个入口共用稳定的
  page header 与 tab 位置，切换内容不能按表体高度重新居中。Result catalog 合并 Analyzer
  的 simulation sweep、timing prediction、kernel profile 与 kernel measurement catalog，
  再以 conversation backend 的 typed job 作为 ownership/lifecycle overlay。typed job 只保存
  `resourceId`、`analyzerResourceId` 与 conversation identity；它不读取或代理 result artifact，
  也不是 simulation experiment。固定列 table 展示日期、result name、type、workspace 与
  type-specific details；Type 列提供四类结果的多选 label filter，同组 OR，并与 workspace、
  deployment、trace、axes 等适用过滤跨组 AND。不存在于某类结果的字段保持为空，不能伪造
  deployment、trace 或 sweep axis。Catalog 按日期倒序，表体最多显示
  六行，超出后只滚动表体，Page 0 顶部与列头不能随筛选结果重新居中或跳动。显式选择
  simulation 后进入 integrated Aggregate；显式选择 offline resource 后按 Analyzer identity
  进入对应的一等 Result surface。五类稳定 Analyzer route 为 `#/aggregate`、`#/run`、
  `#/prediction`、`#/kernel-profile` 与 `#/kernel-measurement`。尚未被 Analyzer discovery 找到的 owned job
  可以显示 pending lifecycle，但不能伪造 descriptor、curve、summary 或 plot。
  `timing_predict` Result 只用 `analyzerResourceId` 装配一等 Prediction surface，
  也允许用 `#/prediction?prediction=p_…` 直接深链；它不能由 conversation backend
  重解析 predictor artifact；同理 kernel profile/measurement 只从 Analyzer repository 读取。
  integrated Aggregate 不再重复渲染完整 Experiment selector，返回 Page 0 才能
  更换 result。直接访问 `#/aggregate` 时仍保留完整 selector 作为独立 Analyzer 的
  discovery 入口。
- `New conversation` 把 compact workspace picker 放在 composer 上方。picker 必须发现全部
  active workspaces，按 last-accessed 倒序，支持 name/id 搜索并限制表体高度；它是 table-like
  单选 surface，不能退化为 dropdown。第一行固定为 create-new-workspace，选择已有 workspace
  后提交会在其中创建 conversation，选择第一行才创建新 workspace。Page 0 尚无 Analyzer
  selection，因此 composer 不显示无语义的 `Context` action。
- `Resume conversation` 使用独立的全局 conversation catalog，而不先要求用户选择 workspace。
  catalog 合并全部 active workspace 的 conversations，按 updated-at 倒序，以日期作为首列分组，
  同时显示 conversation title、所属 workspace label 和具体时间；支持按 conversation/workspace
  搜索和 workspace label 多选过滤，并使用固定高度滚动表体。workspace filter 与 Experiment
  catalog 共用 column-filter 组件和同组 OR 语义，过滤后仍保持全局 updated-at 排序。只有点击
  具体 conversation 才进入 Agent，workspace identity 从该 conversation 的记录中解析，不能依赖
  当前选中的 workspace。
- Root router 必须以完整 hash（含 query）作为 render state。`#/agent`、
  `#/aggregate`、`#/run` 或 `#/prediction` view 不变但 `workspace` / evidence identity 改变时，也必须
  立即重算 workspace context；不能出现 address bar 已切换而 Agent/Analyzer 仍读上一个
  workspace 的 split-brain。
- Agent conversation adapter 必须兼容迁移前已持久化的 assistant shape：没有
  `activity` 时把 `intermediate_outputs` 投影为 role timeline，并剥离旧版
  `<details class="role-output orchestrator">` / `### Message` 包装后再渲染 answer。
  Markdown 中的本地图片必须通过当前 `workspaceId` 重写到 `/api/file`，不能依赖旧的
  conversation-owned `cid` 路由，也不能把 `/workspace/...` 当成浏览器 URL。开发服务器的
  same-origin proxy 必须把 `/api/file` 与其他 conversation API 一起转发到 shared backend；
  SPA fallback 返回的 `text/html` 不能被误当成成功图片响应。Conversation
  首屏只取最新一页，但必须保留 backend 的 `message_page` cursor，并在消息列顶部提供
  earlier-page 加载；prepend 后必须保持当前阅读位置和已有 message node identity，
  不能触发整列跳到底部。迁移后的长历史不能因为固定 `limit` 在 UI 中静默截断。
- Conversation stream 必须区分两类非终态事件：`tool_call` 仅表示命令、容器准备和工具活动，
  作为 transient activity line 渲染；`intermediate_output` 是 Agent 主动面向用户的语义消息，
  并携带 `level: progress | milestone`。`progress` 是小步更新，`milestone` 是已完成的重要
  checkpoint；二者都不能伪装成 final answer，也不能与 `tool_call` 共用 event kind。
- Agent composer 必须拥有独立的 local draft state；键盘输入不能重新执行 conversation
  message map、Markdown parser 或 role-card render。Transcript 是 memoized subtree，只在
  messages、live turn events、pagination 或 error 真正变化时更新；`send`、`cancel` 与
  `loadEarlier` callback 必须保持稳定，避免 SSE activity 把 composer 带入刷新路径。
- Page 0 创建的 workspace 与 UI/Agent API 创建的新 conversation 使用
  `naming_state: pending`。首个成功 answer 的 `done.naming_scheduled` 只触发旁路轮询；
  conversation timeline 不能因命名刷新而重新安装或重渲染。轮询按 1/2/4/8 秒读取
  workspace descriptor 与 conversation title，只更新 workspace header、history row 和
  active title。Workspace 名称只生成一次，后续 conversation 不得再次改变；显式 rename
  进入 `manual` 并永久优先。旧对象缺少字段时按 `manual` 解释。
- Browser 断开只中止本地 SSE reader，不能隐式取消 backend turn。运行中的 composer
  必须把 Send 替换为明确的 Interrupt control；用户 activation 调用 workspace-scoped
  `/cancel` endpoint，等待 backend 完成取消与持久化后再刷新 conversation。禁止把
  `AbortController.abort()` 当作 backend cancellation。
- Backend restart 不能让已经持久化的 role output 从 conversation 消失。Turn event log
  是增量事实来源；backend 启动时将遗留的 `running` turn 原子标记为 `interrupted`，把已完成的
  `intermediate_output`、handoff、implementer、usage 与 managed-job events 投影为一条
  reloadable assistant timeline，并追加明确的 restart interruption card。不得伪造 Agent final
  answer，也不得在重复启动时重复追加恢复消息。
- Managed run 的 `requested → running → analysis_running → ready/failed` 是同一
  experiment lifecycle 的状态迁移，不是四个独立 timeline item。Conversation 中按
  `experimentId` 只渲染一张 job card，以最后一个状态更新该卡；同一 experiment
  因追加 sweep 再次启动 Launcher 时也不得生成第二张 ready card。
- Full Agent surface 返回 Page 0 的 header control 使用 back-arrow 与
  `Return to workspace home` accessible name，不能使用 close/X icon；后者会错误暗示
  turn 被取消。返回导航不改变 backend turn 状态。
- Agent 与五类 Analyzer result 是同一个 workspace-owned surface 的布局状态，不是多套独立
  page shell。所有 result route 都必须挂在同一个
  `WorkspaceShell` 下；跨这些 route 切换时 `AgentPane` 不能卸载，active conversation、
  SSE、scroll、draft 与 history 必须保持。`#/agent` 初始进入 Agent full 且允许没有
  Analyzer context 的首条 prompt；从 Agent evidence 导航到 Aggregate/Run 时，full 自动
  转为 docked split。Analyze 内的 full/fold 只改变 grid layout，不能卸载 Analyzer child。
- Prediction 必须拥有独立的 `prediction` selection surface。case、operation、CostTree leaf/parallel、
  optimality mode 与 panel selection 统一投影成 Agent context；进入 Prediction 后禁止沿用之前的
  Aggregate/Run selection。共享 ChartCard 必须按当前 Analyzer surface 选择证据，不能把 Prediction
  card 点击硬编码成 Run panel selection。
- Agent 输入区显示的 selection strip 与实际随 turn 发送的 context 必须来自同一个 route-scoped
  projection。Kernel profile 与 measurement 分别拥有独立的 `kernel_profile`、
  `kernel_measurement` selection；独立 Agent 和 file 页面不得携带 retained Analyzer selection，
  避免不可见的 ghost context。
- Managed job 是 conversation backend 的 lifecycle/ownership overlay，不是 Analyzer result identity，
  因而没有 `#/job` route 或通用 job result renderer。Ready job card 必须使用其
  `analyzerResourceId` 直接生成对应一等 route；pending job 只展示状态，不伪造可打开的结果。
- 独立 Aggregate 的 Experiment selector 采用 TraceLab session picker
  的高密度模式：固定高度的可滚动 listbox 按实验日期倒序分组，每个日期下排列紧凑的
  option cards；toolbar 提供名称搜索，以及类似 issue labels 的 trace 与 deployment
  多选标签，并显示 visible/total 计数。同一标签组内按 OR 匹配，两组之间按 AND 匹配；
  标签必须支持再次点击取消、清空全部筛选和 `aria-pressed` 状态，不能使用 dropdown。
  日期来自 catalog 的 `experiment_date`，缺失时以 `updated_at` 的日期作为
  `Undated` fallback 排序依据；不能把 discovery 收缩成只有当前值可见的 dropdown，
  也不能再依赖难以扫描的横向 card rail。option 必须保留原生 listbox/option 语义与清晰
  的键盘 focus/selected 状态。若 display name 以 `YYYYMMDD_<index>_` 开头，card title
  隐藏已由左侧 date group 表达的 `YYYYMMDD_`，但保留 `<index>_` 以区分同日实验；
  搜索仍匹配完整原始名称。用户显式点击一个 experiment option 后，页面自动定位到
  metric panels；filter 引发的隐式 fallback selection 不能抢走当前滚动位置。自动定位
  必须遵循 `prefers-reduced-motion`。
  单 run 是从 Aggregate evidence drill-down 得到的详情页，不再重复展示全量 Simulation runs
  catalog；masthead 提供唯一的 Aggregate overview 返回入口，并保留当前 run identity。
  Run view 不复用 `Aggregate / Run` segmented navigation，也不把返回入口包装成
  `SurfaceCard`；返回入口是右上角紧凑的全圆角 button，run identity 作为普通 masthead
  文字呈现，避免两个同义导航与可点击 card shell。
- Aggregate catalog 同时展示 manifest-defined sweep 与未被任何 manifest 收录的 singleton
  run；singleton 是零 axis、单 member 的独立 envelope，不能与 sibling 自动合并。它复用
  相同的 Throughput、Utilization、Request SLO sections，但每张 panel 直接显示 scalar
  value，不伪造只有一个 cell 的 heatmap，并在 section header 提供一次 `Inspect run` drill。

### Agent → Analyzer navigation

- Agent prose 中的 evidence link 遵循 [`citation-dsl.md`](citation-dsl.md)。Agent 只写
  citation dictionary 公布的 symbolic inline-code token，例如
  `` `exp.tp2.rate20.throughput` ``；Conversation host 在 ingestion 时将 token 冻结为
  `EvidenceRefV1`。渲染、hover 和流式完成禁止导航，只有用户 activation 才能把 frozen
  target 转成下述 navigation command。
- `domain/analyzerNavigation.ts` 拥有 browser-side `vibesim.analyzer/v1` 合同。Agent 和
  Analyzer 之间传递稳定的 `EvidenceRefV1`（experiment、panel、metric/statistic、
  run/coordinates），禁止传 CSS selector、DOM id、显示文字或颜色。
- 可复制 URL 是 canonical navigation state：
  `#/aggregate?experiment=…&panel=…&metric=…&statistic=…&run=…&coordinates=…`。
  `AppRoot` 的 route parser 必须忽略 query string；刷新 URL 后仍按 experiment → panel →
  metric → run coordinate 的顺序恢复状态。
- live integration 接受同源 `window.postMessage` 的 `AnalyzerNavigateCommandV1`，并以相同
  `requestId` 返回 `AnalyzerNavigationResultV1`。结果只有 `ok`、`not-found`、
  `unavailable`；跨 origin message 必须忽略。该 transport 只是 URL navigation 的即时入口，
  不能维护第二份隐藏 navigation state。
- 成功导航到 panel 后，使用稳定 `panel.id` 找到注册的 panel boundary，滚动到 panel 并提供
  不改变布局尺寸的静态 teal 内描边、向外渐淡的柔和 halo 与 inner tint；header 显示紧凑的
  `Selected for agent` badge。选中反馈禁止使用持续 pulse。Metric knob 接受 URL 请求的
  metric/statistic，run/coordinates 则恢复现有跨 panel point selection。
- Aggregate metric panel 与 run-level `ChartCard` 必须复用
  `EvidenceSurfaceCard` 的完整 card pointer boundary、静态边框、渐淡 halo 和 badge，不得在
  feature 中复制 selection CSS。每张 panel 的整个 card surface 都允许 pointer 将 panel
  选为 evidence；可见 title
  同时保留原生 button 作为键盘入口，不能要求用户必须命中 title 或 chart point。选择 card
  保留现有 member coordinate，因而 `Total throughput` 这类没有 statistic knob 的 panel
  仍可独立进入 context。
- 纯 panel selection 只更新 card shell、URL 与 context，不得重新构造或更新任何 ECharts
  instance。Panel 内的 option 必须按 analysis、metric、facet、member identity memoize；
  glow/outline 变化不能进入 chart render path。
- 用户手动选择 experiment、statistic 或 coordinate 时同步 replace canonical URL，但不能
  因 URL 同步重新触发图表重绘。message navigation 才产生 result response；普通 URL
  navigation 没有隐式 agent acknowledgement。

### Analyzer → Agent selection context

- `domain/analyzerSelection.ts` 定义可序列化的 `AnalyzerSelectionV1`。它是
  discriminated union：aggregate variant 保存 experiment、panel、metric/statistic 与
  run/coordinates；run variant 必须逐字段投影 `VizState` 的 selection 字段，包括稳定
  `panelId`，保留显式 `null`，不能把“未选择”改成字段缺失。Panel identity 由 feature
  显式声明，禁止从显示 title、DOM selector 或颜色推导。
- Zustand 是同页 Inquiry rail 与 Analyzer 的唯一 selection source。`store.ts` 保存当前
  `selectionSurface`、aggregate selection 和 inquiry/phase identity；run selection 继续由
  既有字段与 action 拥有。不得再在 aggregate feature 内维护第二份 panel/member selected
  state。
- `application/analyzerSelection.ts` 只负责把 store 投影为
  `AnalyzerSelectionV1` / `InquiryContextV1`。同页 Inquiry rail 直接订阅 store；跨 iframe
  或外部 shell 才消费 versioned `selection-change` notification。Notification 不能被当作
  navigation command 回放，从而避免双向同步环。
- `InquiryContextV1` 只在 `inquiryId` 与 `phaseId` 都已知时出现，载荷为这两个 identity 加
  当前 selection。panel 的 hidden/spine/docked/full、宽度、composer draft 等纯 UI 状态禁止
  进入载荷。
- 普通 run 切换仍清空不适用于新 run 的 drill state；citation 明确要求“同一 selection，
  另一个 run”时使用 `setRun(runId, { keepSelection: true })`。目标 run 的 topology/subject
  无法解析所保留 identity 时，后续 resolver 必须显式降级到 cluster，而不是伪造 detail。

## 6. 变更完成标准

每次 feature 迁移或数据接线至少验证：

1. scoped format、TypeScript、ESLint 和 `git diff --check`；
2. adapter/view-model 单测，以及状态和键盘交互回归；
3. 全量 unit、production build 和双 bundle size budget；
4. 涉及页面结构时运行 desktop + 390px Playwright 和 axe；
5. 涉及 HTTP 时用真实 Analyzer 服务检查请求数量、ETag/304、console/page errors，
   并确认没有 raw parquet 或未声明 artifact 请求。
