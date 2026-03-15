# 个人信息系统 (PIM)

> AI 驱动的个人信息管理——用户正常聊天，AI 自动提取人、事、物、地、时间、信息、组织、账目，并在后续对话中主动利用。

## 功能概述

PIM 是 YanClaw 的结构化记忆层，建立在现有 Memory 系统之上。Memory 存储自由文本，PIM 存储结构化实体和关系。

```
┌──────────────────────────────────────┐
│       PIM — 结构化实体 + 关系         │ ← 人、事、物、地、时、信息、组织、账
├──────────────────────────────────────┤
│       Memory — 自由文本 + 语义检索    │ ← FTS5 + embedding
└──────────────────────────────────────┘
```

### 核心能力

1. **自动抽取** — Agent 回复后异步提取实体，不阻塞对话
2. **上下文注入** — Agent 回复前自动拉取相关实体注入系统提示
3. **Agent 工具** — 4 个工具让 Agent 可手动查询/管理个人信息
4. **管理页面** — 8 个标签页视图（联系人/组织/日程/待办/收支/时间线/物品/参考）
5. **主动提醒** — 待办到期、日程即将开始、客户久未联系时自动提醒

## 八元本体模型

| 类型 | 英文 | 用途 | 示例 |
|------|------|------|------|
| 人 | person | 联系人 | 客户张总、同事李工 |
| 事 | event | 事件/待办 | 会议、互动、待办、出差 |
| 物 | thing | 产品/项目 | 企业版产品、某本书 |
| 地 | place | 地点 | 北京办公室、华强北 |
| 时 | time | 时间锚点 | Q2 目标、项目第一阶段 |
| 信息 | info | 知识片段 | 论文、文章链接、参考 |
| 组织 | org | 公司/团队 | ABC 公司、技术部 |
| 账 | ledger | 收支记录 | 采购 3 万、差旅报销 |

## 使用场景

### 场景 1：客户管理

```
用户: 今天见了张总，他是 ABC 公司的 CEO，对企业版感兴趣
AI 自动提取: person(张总) + org(ABC公司) + event(会面) + thing(企业版)

一周后——
用户: 张总那边怎么样了？
AI 回复时自动带上: 张总的上次互动、待跟进事项、所属公司信息
```

### 场景 2：日程与待办

```
用户: 下周二下午跟技术团队开 sprint review，周四飞上海见客户
AI 自动提取: event(sprint review, 下周二) + event(飞上海, 周四)

用户: 这周有什么安排？
AI: 综合所有 event 按时间排列回答
```

### 场景 3：记账

```
用户: 下午去了趟华强北，采购了 10 台显示器，花了 3 万
AI 自动提取: ledger(支出3万, 采购) + place(华强北) + thing(显示器)

用户: 这个月花了多少钱？
AI: 查询 ledger 汇总回答
```

### 场景 4：主动提醒

系统每 30 分钟检查一次：
- 待办截止前 24h → 发送提醒
- 日程开始前 1h → 发送提醒
- 客户 7 天未联系 → 建议跟进

提醒通过已连接的聊天频道发送给 owner。

## 启用配置

在 `config.json5` 中启用：

```json5
{
  pim: {
    enabled: true,          // 总开关
    autoExtract: true,      // 对话自动抽取（关闭后仅手动工具）
    confidenceThreshold: 0.7, // 自动写入的置信度阈值
    extractModel: "",       // 抽取用模型（空=用 Agent 默认模型）
    reminders: {
      enabled: true,        // 主动提醒开关
      taskDeadlineHours: 24,  // 待办到期前 N 小时提醒
      followUpDays: 7,       // 客户 N 天未互动提醒
      scheduleMinutes: 60,   // 日程前 N 分钟提醒
    },
  }
}
```

## Agent 工具

启用后，Agent 自动获得以下工具（受工具策略控制）：

| 工具 | 能力标签 | 用途 |
|------|---------|------|
| `pim_query` | pim:read | 查询实体（自然语言或按 category/subtype 筛选） |
| `pim_save` | pim:write | 创建/更新实体（自动去重） |
| `pim_update` | pim:write | 更新状态/属性（如标记待办完成） |
| `pim_inspect` | pim:write | 查看实体详情及所有关联 |

`pim:write` 工具默认仅 owner 可用。

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/pim/items` | 列表（?category=person&subtype=client&q=张） |
| GET | `/api/pim/items/:id` | 详情（含关联实体） |
| POST | `/api/pim/items` | 创建 |
| PATCH | `/api/pim/items/:id` | 更新 |
| DELETE | `/api/pim/items/:id` | 删除 |
| GET | `/api/pim/links?from=id` | 关联列表 |
| POST | `/api/pim/links` | 创建关联 |
| DELETE | `/api/pim/links/:id` | 删除关联 |
| GET | `/api/pim/stats` | 各类别计数 |
| GET | `/api/pim/timeline?days=7` | 时间线 |
| GET | `/api/pim/ledger/summary?month=2026-03` | 月度收支汇总 |
| GET | `/api/pim/graph` | 关系图数据 |

## 前端页面

侧边栏"个人信息"入口，路径 `/pim`，8 个标签页：

- **联系人** — 按关系分组（客户/同事/朋友），显示最近互动
- **组织** — 按关系分组（客户公司/我司），显示成员
- **日程** — 按日期分组的时间轴
- **待办** — 待完成/已完成分组，一键标记完成
- **收支** — 月度概览（支出/收入/结余）+ 分类饼图 + 明细
- **时间线** — 所有事件按时间混合排列
- **物品** — 产品/项目/书籍等列表
- **参考** — 文章/论文/收藏等列表

所有视图支持搜索、编辑、删除、新建。

## 代码结构

```
packages/server/src/
  pim/
    types.ts          — 八元类型定义、PimItem/PimLink 接口
    store.ts          — PimStore CRUD、查询、去重、关联、提醒查询
    extractor.ts      — LLM 抽取 pipeline（prompt、JSON 解析、去重写入）
    preheat.ts        — 上下文注入（关键词匹配、格式化系统提示片段）
    reminder.ts       — 主动提醒（30min 周期检查，3 类提醒）
  agents/tools/pim.ts — 4 个 Agent 工具
  routes/pim.ts       — API 路由
  db/schema.ts        — pim_items + pim_links 表定义

packages/web/src/
  pages/Pim.tsx       — 管理页面（8 标签页 + 编辑/新建对话框）
```

## 设计文档

- 需求分析与技术方案：`docs/plans/2026-03-15-personal-ontology.md`
