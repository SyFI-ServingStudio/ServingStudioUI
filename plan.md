# 改版计划

更新：2026-09-08。当前阶段：主要界面改版与桌面目视检查已完成，等待用户反馈。

## 目标与边界

以 vibesim-intro 为视觉参考，统一 viz-ui 的品牌、字体、颜色、表面层次和交互状态。保留分析工作台的数据密度、图表语义、证据引用及现有技术栈。目标和约束见 goal.md；实际完成情况见 progress.md；依据见 notes.md 与 docs/style-match-plan.md。

## 工作顺序

- [x] 阅读两个项目的代码、工作记录和相关技能。
- [x] 创建 wt-viz-ui-style-match，分支 design/intro-style-match。
- [x] 从 viz-ui 0c8283b 继承 5 个未提交文件的完整 diff，验证原目录未改变。
- [x] 对照介绍站首页/成本树与 viz-ui 目录/aggregate/Agent 新建入口，补看移动端目录。
- [x] 完成差异审计、实现位置和改版范围建议。
- [x] 讨论基础方向：建议统一深色中性灰、Geist、蓝色品牌强调；明确第一批样板范围。
- [x] 实现基础主题与“结果目录＋aggregate 详情”两个完整样板，包含公共控件和图表主题。
- [x] 推广到 workspace shell、run、prediction、alignment、kernel profile/measurement 与成本树。
- [x] 统一 Agent 设置、输入、消息、工具结果及证据选择的视觉状态。
- [x] 按最新要求仅完成生产构建和桌面目视检查；暂不运行测试矩阵或多屏宽验收。

## 待讨论的独立交互改动

- 是否将导航简化为 Results / New study / Conversations。
- Agent 入口是否从三步设置改为先输入问题、再以紧凑设置选择模式和工作区。
- 是否需要额外浅色主题；当前建议第一批集中于介绍站一致的深色主题。

这些选项尚未定稿。首屏背景照片、大标题和滚动入场不直接搬入分析工作台。列筛选保留在对应列标题，图表颜色保留数据区分能力。

## 记录维护

后续范围或决定变化时更新 goal.md 与本文件；每次实际完成或验证后更新 progress.md；调查证据和限制写入 notes.md。不得将继承的源码改动记为本次改版成果。

## 2026-09-08 用户确认与快速预览

用户确认方向，优先视觉改动和开发速度，不投入测试矩阵或不同屏宽兼容性。第一版已实现深色基础主题、品牌字体、结果目录、aggregate 与公共表面/图表样式。仅做生产构建及桌面浏览器检查，下一步按用户目视反馈迭代。

## 扩展覆盖范围

用户要求覆盖大部分界面，并在改动后实际目视检查。继续扩展 run/cluster/pool/worker、成本树与 kernel drilldown、prediction、alignment、kernel profile/measurement、Agent 设置/会话及文件预览。优先桌面视觉，不运行多屏宽测试矩阵。

## 2026-09-08 主要界面改版完成

已覆盖目录、aggregate、run/cluster/pool/worker、prediction、alignment、kernel profile/measurement、成本树与 kernel 下钻，以及 Agent 设置、会话、历史和文件预览。统一 Geist、深色表面、浅蓝强调、页面标题和图表样式。

截图已实际打开进行目视检查。复查后修复 Agent 停靠区残留米色、模型选项表头重叠、成本树初始缩放过小，以及 kernel 参数逐字折行。Prediction iteration 列表改为限高滚动。

最终生产构建通过（7.58s），git diff --check 通过；浏览器检查未记录 pageerror。按用户要求未运行单元测试、多屏宽或完整无障碍矩阵。具体证据和限制见 docs/style-visual-review.md。

主预览 http://127.0.0.1:5188/，fixture 预览 http://127.0.0.1:5189/。未提交、推送代码或启动实验。本轮主要界面实现与目视检查已完成，后续按用户反馈调整。

## 2026-09-09 加载延迟调查

用户反馈 Resume conversation 和 simulation 都加载慢。服务器本机只读测量：会话目录 GET 约 8ms，现有会话详情 GET 约 5ms/9.3KB；浏览器首开到 Resume 标签可点击约 0.89s，资源请求 237 个、transferSize 合计约 10.4MB。Prediction 目录请求约 1.38s；预加载后的代表 aggregate payload 约 109ms，导航到主要标题可见约 0.4s。此次没有复现本机接口普遍缓慢，不能据此否定用户端延迟。

5188 当前是 Vite 开发服务器。大量开发模块传输是远程首次加载的可疑瓶颈，尚未测量用户网络。代码还显示 AppRoot eager import App、workspace barrel 同时导出入口与 Agent shell；ActiveRunProvider 在入口发起 run 数据读取，EntryPage 在会话模式仍请求结果目录。需要区分首次模块加载、后台目录扫描与实际分析数据读取。

未修改应用代码或服务配置；已询问用户访问地址与首次/每次加载区别。建议下一步先提供带 live API 代理的生产构建预览对照，再收窄非当前页面的数据与模块加载。测量脚本为 .artifacts/style-audit/measure-loading.cjs，不包含写入后端的请求。

## 2026-09-09 预览监听地址

用户明确要求监听 0.0.0.0，已将 tmux viz-style-5188 中的 live 预览重启为 `npm run dev:live -- --host 0.0.0.0 --port 5188`，保留原 API 代理。此次授权取代此前仅本机监听的范围限制。

## 2026-09-09 Alignment 文案修正

移除 Whole run 延迟卡片的 “one modelled series” 标签及附带高亮。原判断只比较模拟样本数与 p50/p90/p99，不能证明底层序列相同；相关注释与页脚改为明确说明分位数相同。保留图表和计算数据。

用户要求直接删除：已同时移除新增的“模拟分位数相同”页脚说明，不添加替代文案。

## 2026-09-09 修复 Trace overview 读取失败

用户指定 run r_973a46caea73ec8634401b54d2d553077eaad8890cc49438e96394174a7f1229 的 workload 接口返回 500。日志确认 `trace file must be a relative path inside a trace directory`；实际配置为 `logs/20260907_0_llama3_h200_throughput/trace.csv`，文件存在且是标准 CSV。

修复位于 main/analyzer/rust/src/ui_service/workload.rs（Analyzer 独立于 viz-ui 仓库）：允许 logs 下 CSV，保留相对路径与 canonical root 检查。不修改实验 params 或源 trace。新增仓库根/logs 根两种配置的回归用例；验证后重建并重启现有只读 Analyzer，再检查原接口与 UI。

## 2026-09-09 修复验证完成

Trace overview 的后端路径校验及前端 schema 已同步修复：支持 logs 下实验 CSV，并兼容 effective_trace_timed（保留旧 effective_open_loop）。Analyzer 4 个相关回归用例、UI 6 个契约用例通过；UI 生产构建通过。Analyzer release 已重建并重启，原 workload 接口返回 200。目视确认指定 run 显示输入 1,024、输出 256、trace.csv 和两张分布图；截图 .artifacts/style-audit/workload-fixed.png。没有修改实验数据或重跑模拟。

按最新反馈将 Agent single/auto 标签改为 10px、普通大小写、中性灰边框与文字；tool call 活动行和动画点从蓝色改为灰色，移除标签加粗/大写字距。会话样例截图已目视复查，未向后端发消息。四份工作记录同步维护。

## 2026-09-09 截图配色提取

已从用户 VS Code 截图按文本区域提取颜色：蓝 #8db9e2、绿 #73c991、琥珀 #e2c08d、红 #f88070、正文 #cccccc、弱化文字 #8c8c8c、背景 #252526。完整映射和来源说明见 docs/screenshot-color-palette.md。本轮按请求提取配色，不修改主题；截图没有明确紫色样本，不推测其值。

## 2026-09-09 应用截图配色与集中管理

已按用户授权应用截图蓝/绿/琥珀/红、正文、弱化文字和背景色。theme.ts 新增 palette 作为基础颜色来源，tokens 保留兼容别名，withAlpha 统一透明度变体。卡片/浮层/边框和紫色采用明确标注的衍生色；不是从截图采样的额外颜色。

已迁移主要组件中旧主色、背景、文字及其 rgba 写法，包括 Agent、系统图、目录与公共控件。专用图表分类色、热图色阶、代码语法色仍有各自的调色板，并非所有数据类别都映射成一种强调色。后续全局品牌和基础表面调整应修改 theme.ts；组件不要再复制 RGB 字面量。

实际打开 Run 与 Agent 样例截图检查，确认背景与文字对比已降低，图表仍可区分。截图位于 .artifacts/style-audit/workload-fixed.png 与 agent-conversation.png。未更改业务数据或交互流程。

## 2026-09-09 VS Code 背景层次

根据第二张截图分别采样：编辑区 #1e1e1e、侧栏 #252526、活动栏 #333333、选中行 #37373d、边界 #3c3c3c。中央 palette 已将主内容、卡片/侧栏、浮层/工具栏、选中项分别映射到这些灰度；输入/悬停采用 #2a2d2e。Agent 消息改为中性卡片背景，角色仍通过图标和边框识别，避免大片红/绿色背景。历史与进度侧栏选中行改用中性选中灰。

保持配色集中于 theme.ts；本轮不改变强调色、数据或交互。检查 Run 与 Agent 代表页面的背景层次。

## 2026-09-09 直接提取 VS Code 当前主题

检查远端 Machine settings 与工作区，未找到 workbench.colorTheme 或颜色覆盖项；远端无法确认本机当前激活主题。截图与 Dark+ / Dark (Visual Studio) 系列一致，但这只是推断。已查阅 Microsoft 官方 dark_plus.json（继承 dark_vs.json）与 Color Theme 文档。直接提取应使用本机命令 Developer: Generate Color Theme from Current Settings，将生成内容保存至工作区 vscode-current-color-theme.json，再依据 colors、tokenColors 和 semanticTokenColors 建立语义映射，替换截图取色来源。当前等待用户提供主题名称或导出的主题；不把上游默认主题当作用户当前有效配置。

官方文档：https://code.visualstudio.com/api/extension-guides/color-theme

## 2026-09-09 主题系统整理完成

新增 theme/palettes.ts、colors.ts、selection.ts，将基础颜色、图表/终端派生配色与主题选择集中管理。theme.ts 作为兼容入口；组件和图表中的固定颜色字面量已迁移，业务层仅保留数据驱动颜色运算。支持 VS Code 和 VibeSim Intro 两套深色主题，首页 Theme 菜单自动从注册表生成；选择持久化并通过完整页面加载同步 Canvas 与 MUI。新会话设置不显示切换器。

构建通过；34 个主题/ANSI/operation palette/optimality 定向测试通过。浏览器已切换两套主题、验证持久化并导航到真实 run；代表截图已目视检查，未记录 pageerror。新增主题说明见 docs/themes.md。未新增第三方依赖，不改变分析数据或会话业务。

## 2026-09-09 三套主题与 kernel ladder 收敛

完成 VS Code Dark、VS Code Light、Warm Paper 三套主题。浅色根据 Microsoft 官方主题与 workbench 默认值映射；米黄色从 viz-ui 0c8283b 原始 palette 恢复。mode、语法色、终端对比和图表派生色统一管理；首页选择持久化。说明见 docs/themes.md。

删除 “all kernel families / equal-width · visual only” 展示色带。Kernel optimality ladder 改为主色明暗层次，idle 灰色、imbalance 柔和琥珀色、全局必要计算柔和绿色；悬停突出单一序列，增加分隔线和文字尺寸，并给长行标签增加左侧空间。计算与数据不变。

三套主题的真实 run 和 ladder 截图已目视检查，浅色 Agent、代码预览和成本树已检查。生产构建及40个定向检查通过；未做多屏宽矩阵。预览仍为 http://10.158.48.50:5188/，未提交或推送。

## 2026-09-09 主题选择器精简

将原生 Theme 下拉框换成紧凑的 Dark / Light / Paper 三段按钮，每项带对应主题的表面色样；当前项通过背景和字重标识，保留完整名称提示、键盘焦点与主题持久化。颜色从中央注册表读取。生产构建通过，浏览器点击三项验证主题与持久化，并目视检查首页截图；未新增单元测试。

## 2026-09-09 建议问题与提交

按用户要求更新三个建议问题：Llama3-8B 单 H200、4K 输入/1K 输出且 TPOT < 20ms 下的最大吞吐；GLM5.2 TP4+EP4 处理16K prefill tokens 的最耗时 kernel；Llama3-8B 在2K 输入/4K 输出请求下的最佳 prefill/decode 服务器比例。改用左对齐纵向排列容纳完整问题，点击仍仅填入输入框。用户已授权提交并推送当前 UI 分支。

最新建议问题修改的生产构建通过（5.50s），git diff --check 通过。提交范围为当前 VibeSimUI 工作树，包括主题、界面改版、前端 workload 契约修复和继承的入口页改动；main 仓库的 Analyzer Rust 修复不包含在本次 UI 提交中。
