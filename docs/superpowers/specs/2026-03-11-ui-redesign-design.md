# UI 改进设计文档

> 方案：渐进迁移至 shadcn/ui，暖色风格，保留 prompt-kit 聊天组件

## 1. 视觉设计系统

### 配色方案

基于 shadcn/ui CSS 变量体系，暖色主色调。参考色值（oklch，实现时微调）：

| 角色 | 亮色模式 | 暗色模式 | 用途 |
|------|---------|---------|------|
| Primary | `oklch(0.65 0.18 30)` 珊瑚橙 | `oklch(0.70 0.16 30)` | 主按钮、活跃状态 |
| Secondary | `oklch(0.75 0.12 75)` 琥珀金 | `oklch(0.65 0.10 75)` | 辅助按钮、badge |
| Accent | `oklch(0.55 0.08 55)` 暖棕 | `oklch(0.45 0.06 55)` | 侧边栏选中、hover |
| Background | `oklch(0.97 0.01 80)` 米白 | `oklch(0.18 0.02 60)` 暖深灰 | 页面底色 |
| Card | `oklch(0.99 0.005 80)` | `oklch(0.22 0.015 60)` | 卡片、对话框 |
| Muted | `oklch(0.55 0.03 60)` 灰棕 | `oklch(0.45 0.03 60)` | 次要文字 |
| Destructive | `oklch(0.55 0.2 27)` 红 | `oklch(0.55 0.2 27)` | 删除、错误 |
| Border | `oklch(0.85 0.02 70)` | `oklch(0.30 0.02 60)` | 边框 |

### 圆角与阴影

- 圆角：一般组件 `rounded-xl`（12px），卡片 `rounded-2xl`（16px）
- 阴影：柔和暖色调，如 `shadow-[0_2px_8px_rgba(180,120,80,0.08)]`

### 字体

保持系统字体栈，不引入额外字体。

## 2. 侧边栏与导航

### 可折叠侧边栏（新功能）

当前侧边栏为固定 w-56，不可折叠。本次新增折叠能力，需要：新增折叠状态管理、为每个导航项配置图标、集成 shadcn/ui Tooltip。

| 状态 | 宽度 | 内容 |
|------|------|------|
| 展开 | w-56 | 图标 + 文字标签，底部主题切换 + 折叠按钮 |
| 收起 | w-14 | 仅图标，hover 显示 tooltip |

导航项图标映射（Lucide）：

| 路由 | 图标 | 标签 |
|------|------|------|
| `/` | `MessageSquare` | 聊天 |
| `/sessions` | `History` | 会话 |
| `/agents` | `Bot` | Agent |
| `/channels` | `Radio` | 频道 |
| `/cron` | `Clock` | 定时任务 |
| `/settings` | `Settings` | 设置 |

- 动效：CSS transition `width 200ms ease-out`（不依赖 Motion 库）
- 状态持久化：localStorage key `yanclaw_sidebar_collapsed`
- 响应式：`< md` 断点使用现有抽屉模式；`>= md` 显示可折叠侧边栏

### 导航项样式

- 选中态：暖色 accent 背景 + 左侧 3px 圆角指示条
- Hover：轻微背景色变化

## 3. Onboarding 流程

当前为 3 步（Model → Channels → Ready）。扩展为 4 步，新增欢迎页。

### 进度指示

顶部圆点步骤条，已完成步骤显示勾号，当前步骤高亮主色，步骤间连线填充。

### 步骤

| 步骤 | 内容 | 必填 | 变化 |
|------|------|------|------|
| 0: 欢迎 | Logo + 一句话介绍 + "开始配置" | — | **新增** |
| 1: 模型配置 | 选 Provider → API Key → 选模型 | 是 | 视觉重做 |
| 2: 频道配置 | Telegram / Slack 令牌 | 可跳过 | 加"跳过"按钮 |
| 3: 完成 | 庆祝动画 + "进入应用" | — | 视觉重做 |

> 注：频道配置暂只支持 Telegram 和 Slack（与现有代码一致），Discord 待后续支持。

### 交互细节

- 每步卡片淡入过渡（CSS transition: opacity + translateY）
- Provider 选择：带图标的大卡片网格，hover 微妙上浮
- 可跳过步骤右上角"跳过"文字按钮
- "下一步"/"上一步"固定卡片底部
- API Key 粘贴后自动验证（保留现有逻辑）

## 4. 各页面改进

### Settings

- shadcn/ui Tabs 分区（Providers / Models / Default Agent / Gateway），4 个 tab 与现有 4 区段对应
- 表单控件：Input、Select、Switch
- 保存操作 Toast 反馈（Sonner）

### Agents

- 卡片网格布局（替代列表）
- 编辑弹窗用 Dialog
- 卡片显示名称、模型、工具数量

### Channels

- 每频道一张状态卡片
- 连接状态 Badge（绿/灰/红）
- 启用/禁用 Switch

### Sessions

- 搜索框：Input + 搜索图标
- 列表项 hover 高亮，选中 accent 背景
- shadcn/ui Pagination

### Cron

- Table 组件展示任务列表
- Dialog 新建/编辑
- Badge 状态（运行中/已暂停/失败）

### 通用组件替换

现有 `components/ui/` 已有 5 个组件（avatar、button、collapsible、textarea、tooltip），部分已是 shadcn/ui 风格。

| 现有组件 | 操作 |
|---------|------|
| `button.tsx` | 保留，更新样式变量为暖色 |
| `avatar.tsx` | 保留，更新样式 |
| `collapsible.tsx` | 保留 |
| `textarea.tsx` | 保留，更新样式 |
| `tooltip.tsx` | 保留 |
| 自建 Modal（各页面内联） | 替换为 shadcn/ui Dialog |
| 确认操作 | 新增 AlertDialog |
| 加载状态 | 新增 Skeleton |
| 操作反馈 | 新增 Sonner toast |
| 表单控件 | 新增 Input、Select、Switch、Tabs |
| 分页 | 新增 Pagination |
| 表格 | 新增 Table |
| 标签 | 新增 Badge |

## 5. 微交互与动效

所有动效使用 **CSS transition / animation**，不额外依赖 Motion 库（项目已有 `motion` 但聊天组件专用）。

### 页面级

- 路由切换：fade 150ms（CSS transition）
- 内容入场：子元素 stagger 淡入（CSS `@keyframes` + `animation-delay`），间隔 50ms

### 组件级

- 按钮 hover：scale(1.02) + 背景色（CSS transition 150ms）
- 卡片 hover：translateY(-2px) + 阴影加深（CSS transition 200ms）
- Dialog：fade + scale(0.95→1)（shadcn/ui 内置动效）
- 侧边栏折叠：width transition 200ms ease-out
- Toast：Sonner 内置动效

### 不加动效

- 聊天消息流（prompt-kit 自有逻辑）
- 表单输入
- 滚动行为

## 6. 技术约束

- **保留 prompt-kit**：`components/prompt-kit/` 目录下所有组件不动
- **shadcn/ui + Tailwind v4**：使用 `npx shadcn@latest init` 并选择 CSS variables 模式。shadcn/ui 自 v2.5+ 支持 Tailwind v4，通过 `@theme` 块定义 CSS 变量。现有 `index.css` 的 `@theme` 块需更新变量名以匹配 shadcn/ui 约定（`--color-primary`、`--color-secondary` 等）
- **渐进迁移顺序**：
  1. 初始化 shadcn/ui，更新 CSS 变量为暖色
  2. 新增所需组件（Dialog、Input、Select 等）
  3. 重构侧边栏（可折叠）
  4. 重做 Onboarding
  5. 逐页替换（Settings → Agents → Channels → Sessions → Cron）
- **暗色/亮色主题**：两套配色都调整为暖色调，保持现有主题切换机制
