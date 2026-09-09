# viz-ui 风格统一讨论稿

2026-09-08。参考 vibesim-intro main 347ac7d；目标基线为 viz-ui 0c8283b 加原目录 5 个未提交入口页改动。本文保留初始探索阶段的建议；当前主要界面已完成改版，详见 [视觉检查记录](style-visual-review.md)。

## 设计方向

让介绍站与分析工作台具有一致的品牌、字体、表面层次和交互语言。分析工具需要保留紧凑的数据展示、可比较的图表和明确的证据选择；介绍站的首屏照片、超大标题及整屏留白不适合直接搬到工作台。

主要视觉参考应是介绍站 Architecture 的成本树和层级图，以及 Features 的分析图表。首页用于确定品牌和总体气质。

## 已观察到的差异

| 维度 | 当前 viz-ui | 介绍站及迁移建议 |
| --- | --- | --- |
| 品牌 | 圆圈 V 字标，与介绍站不一致 | 复用蓝色几何 logo、Geist 字标，并统一 favicon |
| 背景 | 暖纸色、浅渐变、青绿与陶土色 | 中性深灰背景、逐层提亮的表面、克制的浅蓝强调 |
| 字体 | Fraunces 标题和部分结果名，Hanken 正文，大量 IBM Plex Mono 小字 | 以 Geist 统一标题、正文和控件；代码/技术 ID 才用等宽；数值用 tabular-nums |
| 可读性 | ChartCard 有 10px 辅助字，EvidenceSelectionBadge 8px；AgentWorkspace 多处 8–11.5px 文本 | 按职责建立字号阶梯，避免靠缩小文字容纳信息 |
| 表面 | SurfaceCard 默认描边、阴影、左侧彩边，选中再加光晕 | 主要依靠灰阶和间距分组；描边用于必要边界、焦点和明确选择状态 |
| 结果目录 | 类型、工作区、部署、trace、axes 同时使用多色胶囊 | 降低普通元数据色彩；类型保留少量标签，工作区/配置优先文字 |
| 详情页 | 大衬线标题、斜体强调、编号、介绍文字与分散统计占据首屏上部 | 紧凑的结果名称和配置摘要，关键指标就近呈现，图表更早进入视野 |
| Agent 入口 | 三阶段设置位于居中的嵌套卡片，选择卡内部文字较小 | 减少容器层次、放大主要选择文本、强化输入与当前设置的关系 |

桌面实看：结果目录、Agent 新建入口、真实 Llama sweep aggregate；介绍站首页及 Architecture 成本树。390px 结果入口没有横向溢出，但导航/筛选文字仍显偏小。运行中的 Agent transcript、所有图表类型及所有移动端页面尚未逐页目视验收；Agent 面板建议同时依据源代码审计。

## 第一版样式规格建议

- 页面背景 `#0c0d0f`，表面 `#141517`，浮层/次级表面 `#1b1d20`。
- 主文字 `#f0f1f3`，次文字 `#a0a3ab`，边界 `#2b2d32`，品牌强调 `#99baff`。这些值来自介绍站；组件状态需要在实际组合上验证对比度。
- 字体采用本地 Geist，减少对 Google Fonts 请求的依赖。复用字体文件前检查仓库随附许可。数字默认等宽数字，不把普通结果标题排成代码。
- 工作台页面标题建议 28–36px，区块标题 18–22px，正文/表格 14–16px，辅助文字和图表轴标签 12–13px；这些是待样板验证的起点。介绍站正文和标题规格更大，不逐项复制。
- 建立 4/8/12/16/24/32px 间距阶梯；输入控件和嵌套元素使用较小圆角，主要表面约 12px，避免 MUI 数字圆角乘以主题基数后出现不易察觉的漂移。
- 常规状态使用中性表面，选中使用浅蓝轮廓/局部填充；hover 与键盘 focus 要可区分。避免大面积光晕。
- 界面强调色与图表数据色分开。保留多条曲线、操作分组、测量/预测和状态的区分；同时用图例、线型或标记表达，不能把所有数据改成同一种蓝。
- Cost tree 可借用介绍站 Sum 绿色、Max 琥珀、Scale 紫色、Leaf 蓝色的语义映射；保留工作台完整树结构、数值、缩放、选中和证据引用。
- 交互过渡保持短促，并支持 reduced-motion。分析图表不加入介绍站式滚动入场。

## 页面改动顺序

1. **基础主题和两个样板页面。** 统一 logo、Geist、颜色、表面、字号、按钮和焦点；同步结果目录与一个完整 aggregate 页面。两页必须同时成立，避免入口漂亮而分析页仍保留旧风格。
2. **目录与工作台结构。** 保留搜索和列标题筛选；重排元数据层级、长名称和移动端折行。Shell 统一品牌、返回/当前位置和 Agent 开关。评估缩短导航文案为 Results / New study / Conversations，但这属于信息架构讨论项。
3. **分析组件。** 统一 ChartCard、EvidenceSurfaceCard、ECharts 主题、tooltip、图例、轴标签、全屏视图和指标摘要。再推广到 run、prediction、alignment、kernel profile/measurement 和 cost tree。
4. **Agent 流程。** 先统一现有三步设置和面板视觉；“先输入问题，把模式/工作区作为紧凑设置”的 composer-first 方案作为独立交互选项讨论。保留模型选择、工作模式组合所需的实际状态、会话锁定、流式输出和证据引用语义。
5. **状态与响应式验收。** 检查 loading、空目录、搜索无结果、后端不可用、错误提示、焦点、长名称、窄屏和 Agent 面板展开/收起。

## 实现位置与风险

| 位置 | 变更职责 |
| --- | --- |
| `app/src/theme.ts`、`app/index.html`、`app/public/` | 语义 tokens、MUI dark palette/控件 overrides、本地字体、品牌素材 |
| `app/src/features/workspace/EntryPage.tsx`、`ExperimentCatalog.tsx`、`ConversationCatalog.tsx`、`CatalogTag.tsx` | 入口与目录的层级、密度、表头筛选和标签 |
| `app/src/features/workspace/WorkspaceShell.tsx` | 工作台导航、Agent 边缘开关与硬编码暖色 |
| `app/src/components/SurfaceCard.tsx`、`ChartCard.tsx`、`EvidenceSurfaceCard.tsx` | 容器边界、选择反馈、字号和展开入口 |
| `app/src/charts/platform.ts` 与 feature option builders | 图表轴线、网格、tooltip、数据色和局部覆盖 |
| `app/src/features/workspace/AgentWorkspace.tsx`、设置与运行时选择器 | transcript/工具结果/输入区/状态/设置的视觉一致性 |

保留 React 18、TypeScript、MUI/Emotion、ECharts，不迁移介绍站的 React 19 或整套 CSS Modules。先把实际使用的颜色和文字角色接到公共 tokens，再逐步消除局部字面量；只修改 theme.ts 无法覆盖现有暖色 hover、边缘开关、选中光晕和图表轴线。

本轮未运行应用测试，因为没有新增应用代码改动。实施后按修改范围运行目录/选择/图表相关现有单元测试、typecheck/build，以及 Playwright 桌面/移动端/无障碍检查。至少覆盖 1440、1024、390px，并检查面板改变宽度后的图表 resize。测试 SurfaceCard/EvidenceSurfaceCard 时保留证据选择行为，合理更新旧装饰样式断言。

## 供讨论的取舍

建议默认采用介绍站一致的深色工作台，首批实现结果目录与 aggregate 样板。额外浅色主题、导航重命名和 composer-first Agent 入口分别讨论，避免它们扩大基础风格统一的第一批范围。

截图位于本地 `.artifacts/style-audit/`：`intro.png`、`intro-architecture.png`、`viz-entry.png`、`viz-result.png`、`viz-agent-start.png`、`viz-entry-mobile.png`。截图来自正在运行的本地服务，是观察时刻的页面，不是改版效果图。
