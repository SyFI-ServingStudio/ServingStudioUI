# 主题配置

首页右上角的 Dark / Light / Paper 三段按钮提供三套主题，色样展示对应主题的背景层次。选择保存在 `vibesim.ui.theme`；URL 的 `?theme=vscode`、`?theme=light` 或 `?theme=warm` 优先。默认使用 vscode，旧 intro ID 不再有效，回退到默认主题。

| ID | 名称 | 来源 |
| --- | --- | --- |
| vscode | VS Code Dark | 用户截图中的深色表面和强调色，并非本机主题导出 |
| light | VS Code Light | Microsoft Light / Light+ 和浅色 workbench 默认值 |
| warm | Warm Paper | viz-ui 0c8283b 原始米黄配色，保留当前字体和布局 |

浅色来源：[light_vs.json](https://raw.githubusercontent.com/microsoft/vscode/main/extensions/theme-defaults/themes/light_vs.json)、[light_plus.json](https://raw.githubusercontent.com/microsoft/vscode/main/extensions/theme-defaults/themes/light_plus.json)、[workbench 默认值](https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/workbench/common/theme.ts)。这是面向分析界面的语义映射，不是完整复制编辑器主题。

## 集中配置

| 文件 | 职责 |
| --- | --- |
| app/src/theme/palettes.ts | 主题注册表、dark/light 模式、基础色和可选语法色 |
| app/src/theme/colors.ts | 图表、热图、成本树、终端及语法派生色；透明度、混色和终端对比调整 |
| app/src/theme/selection.ts | URL、持久化、默认主题及切换 |
| app/src/theme.ts | 对外提供 tokens、palette、colors 和 MUI 主题 |
| app/src/components/ThemePicker.tsx | 首页菜单 |

颜色常量集中在主题目录。普通控件使用 tokens，图表使用 colors 的具名字段，透明变体使用 withAlpha。历史 teal 等名称保留为兼容别名。ANSI 真彩色来自日志输入，并按主题调整可读性；图像和第三方嵌入内容不重新着色。

新增主题时扩展注册表的 ID 类型，提供 label、mode、完整 palette 和可选 syntax。菜单与 ID 校验使用注册表。MUI 与页面 color-scheme 跟随 mode。切换会完整重新加载页面，使模块初始化时保存的 Canvas/ECharts 颜色同步；菜单只在首页结果与恢复会话目录显示。

Kernel optimality ladder 使用同一主色的六档明暗，kernel 身份保持稳定映射；imbalance 使用柔和琥珀色，idle 使用灰色，globally fused 使用柔和绿色。悬停突出对应序列。TimeShareBlocks 已删除无数据含义的等宽 kernel family 展示色带。

## 验证

生产构建通过，40 个定向检查通过。浏览器验证三套主题切换、持久化和真实 run 页面；三套 ladder 截图已目视检查。浅色 Agent、代码预览和成本树也已检查。证据位于 .artifacts/style-audit/ 下的 theme-*.png、ladder-*.png、light-agent.png、light-file.png 和 light-cost-tree-readable.png。未运行多屏宽测试矩阵。
