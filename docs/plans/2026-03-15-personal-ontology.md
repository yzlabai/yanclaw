---
title: "个人信息系统（AI 驱动的结构化记忆）"
summary: "基于人事物地时信息组织账八元本体，用户正常对话，AI 自动提取结构化信息并积累利用"
read_when:
  - 构建 AI 驱动的个人信息管理功能
  - 实现对话中自动提取结构化信息
  - 设计本体模型和结构化存储
  - 让 AI 助手具备长期记忆和主动提醒能力
---

# 个人信息系统

> **一句话**：用户跟 YanClaw 聊天，AI 自动把对话中的人、事、物、地、时间、信息、组织、账目提取成结构化数据——然后在你需要的时候主动利用。
>
> 参考 Palantir Ontology 的结构化建模 + Tagtime.ai 的零摩擦交互。
>
> 前置文档：
> - `docs/plans/2026-03-13-web-knowledge-memory.md`（知识管理系统，已完成）
> - `packages/server/src/db/memories.ts`（现有 Memory 存储 + FTS5 + embedding 混合检索）

---

## 设计哲学：本体原语 vs 应用类别

上一版方案按用户场景硬编了 6 个类别（联系人、互动记录、日程、待办、日记、笔记）。问题是：
- **不够通用**：用户提到一本书、一个产品、一家公司，都无法归类
- **边界模糊**：日记和笔记与 Memory 重叠，互动记录和日程都是"事"
- **扩展困难**：每新增一个场景就要加一个类别

更好的方式：**定义底层本体原语，应用场景只是查询视图**。

```
底层本体原语（稳定、通用）          应用视图（查询组合，按需扩展）
──────────────────────            ──────────────────────────
人 (Person)                       联系人列表 = 人 WHERE relation=客户/同事
事 (Event)                        待办清单   = 事 WHERE status=pending
物 (Thing)                        日程表     = 事 WHERE datetime > now
地 (Place)                 →      客户跟进   = 事 WHERE type=互动, 关联→人
时 (Time)                         产品关注   = 物 WHERE type=产品, 关联→人
信息 (Info)                       参考资料   = 信息 WHERE tags∋参考
组织 (Org)                        公司/团队   = 组织（人→属于→组织, 组织→子级→组织）
账 (Ledger)                       收支记录   = 账 WHERE month=3, 按分类汇总
```

**本体原语是稳定的**——人事物地时信息覆盖了几乎所有可能的信息类型。**应用视图是灵活的**——只是不同的查询条件组合，可以随时新增而不改数据模型。

---

## 用户视角：它是什么？

用户不需要知道"本体原语"。用户只需要正常对话：

```
用户说的话                                AI 提取的结构化信息
──────────────────────────────────       ─────────────────────────────
"今天见了张总，他是 ABC 公司的 CEO，      人：张总（CEO, 客户）
 对我们的企业版很感兴趣，                  组织：ABC 公司（张总所属）
 想约下周三在他们公司看 demo"              物：企业版产品（张总感兴趣）
                                          事：会面（今天, 讨论企业版）
                                          事：demo 演示（下周三, 待安排）
                                          地：ABC 公司办公室（demo 地点）
                                          时：下周三（demo 时间锚点）

"看了一篇论文讲 RAG 优化的，              信息：RAG 优化论文（来源: arxiv链接）
 https://arxiv.org/xxx，                  事：阅读论文（今天）
 里面的 chunk 策略值得参考"                信息：chunk 策略（标记: 值得参考）

"下午去了趟华强北，给公司                  地：华强北
 采购了 10 台显示器，花了 3 万"            物：显示器（数量10）
                                          事：采购（下午, 华强北）
                                          账：支出 3 万（采购显示器, 付→华强北商家）

"这个月团队建设花了 2000，AA 制            账：支出 2000（团队建设, 付→餐厅, AA制）
 6 个人去吃了顿饭"                        事：团建聚餐（本月, 6人）
```

一周后：

```
用户："张总那边怎么样了？"

AI（综合了人+组织+事+物+地+时）：
"上周三你和张总（ABC 公司 CEO）在他们公司见面，他对企业版感兴趣。
 你当时约了本周三去做 demo，但还没有后续记录。
 另外，上周采购显示器花了 3 万，需要我记到项目支出里吗？"
```

---

## 八元本体模型

### 基本实体定义

| 原语 | 英文 | 是什么 | 举例 |
|------|------|--------|------|
| **人** | Person | 任何被提及的人 | 张总、李工、妈妈、面试候选人、快递小哥 |
| **事** | Event | 发生的或要发生的事情 | 会议、互动、待办、购买、旅行、阅读 |
| **物** | Thing | 具体或抽象的事物 | 产品、书、工具、项目、概念 |
| **地** | Place | 地理位置或场所 | 城市、办公室、餐厅、机场 |
| **时** | Time | 时间点或时间段 | 下周三、Q2、2026年目标、项目第一阶段 |
| **信息** | Info | 带来源的知识片段 | 论文、文章链接、引用、数据、规则说明 |
| **组织** | Org | 公司、部门、团队、机构 | ABC 公司、技术部、开源社区、行业协会 |
| **账** | Ledger | 一笔收支记录 | 采购支出 3 万、客户回款 10 万、报销差旅费 |

### 为什么是这 8 个？

前 6 个（人事物地时信息）对应新闻学"5W1H"的本体化表达。后 2 个是实践中独立出来的：

| 认知维度 | 本体原语 | 对应的用户问题 |
|---------|---------|--------------|
| Who | 人 | "谁说的？"、"跟谁有关？" |
| What | 事 + 物 | "发生了什么？"、"涉及什么东西？" |
| Where | 地 | "在哪里？" |
| When | 时 | "什么时候？"、"截止日期？" |
| Source | 信息 | "从哪知道的？"、"原文在哪？" |
| Affiliation | 组织 | "哪个公司？"、"哪个部门？" |
| Money | 账 | "花了多少？"、"这个月收支？" |

**组织独立于物的理由**：
- 组织有**层级结构**（公司→部门→团队），物没有
- 人**属于**组织，这是高频关系——"张总是 ABC 公司的"比"张总使用某产品"更基础
- 组织之间有**上下游/竞合**关系（供应商、客户公司、合作方）
- 混在"物"里会模糊这些结构，查询"ABC 公司有哪些人"会与"某产品有哪些用户"混淆

**账独立于事的理由**：
- 账有**专属字段**（金额、币种、付款方、收款方、类别），与事的通用字段差异大
- 账有**独特的查询需求**（按月汇总、分类统计、收支平衡），事没有
- 用户问"这个月花了多少钱"时需要精确数值聚合，不是模糊的事件检索

### 关系模型

实体之间通过**关系（Link）**连接。关系是通用的，不限定哪类实体能连哪类：

```
人 ←→ 人      同事、朋友、家人、上下级、客户
人 ←→ 组织    属于、创立、任职于
人 ←→ 事      参与、负责、发起、被提及
人 ←→ 物      拥有、感兴趣、购买、使用
人 ←→ 地      居住、工作于、去过
组织 ←→ 组织  子级、上游、合作方、竞争
组织 ←→ 地    总部位于、办公室在
组织 ←→ 物    生产、提供、使用
事 ←→ 物      涉及、使用、交付
事 ←→ 地      发生于
事 ←→ 时      计划于、截止于、发生于
事 ←→ 信息    参考、产出
账 ←→ 人      付款方、收款方
账 ←→ 组织    付款方、收款方
账 ←→ 事      关联（采购→采购事件）
物 ←→ 信息    描述、来源于
```

**一条对话可以同时产生多个实体和多条关系**：

```
"下周三和张总在 ABC 公司做企业版 demo，这次出差来回机票花了 3200"

→ 实体：
  人：张总
  组织：ABC 公司（张总任职）
  事：企业版 demo（type=meeting, status=planned）
  物：企业版（type=product）
  地：ABC 公司办公室
  时：下周三
  账：机票支出 3200（type=expense, category=差旅）

→ 关系：
  人(张总) → 组织(ABC公司)   任职于
  事(demo) → 人(张总)        参与
  事(demo) → 物(企业版)      涉及
  事(demo) → 地(ABC公司)     发生于
  事(demo) → 时(下周三)      计划于
  账(机票) → 事(demo)        关联
```

### 应用视图 = 查询组合

用户面对的不是"八元原语"，而是基于原语的**应用视图**：

| 用户看到的 | 实际查询 |
|-----------|---------|
| **联系人** | 人 WHERE relation IN (客户,同事,朋友,家人,...) |
| **公司/团队** | 组织（+ 关联的人和地） |
| **待办清单** | 事 WHERE subtype=task AND status=pending |
| **日程表** | 事 WHERE subtype IN (meeting,trip,...) AND datetime > now |
| **客户跟进** | 人 WHERE relation=客户 + 关联的事(互动记录) 按时间排序 |
| **产品/项目** | 物 WHERE subtype IN (product,project) |
| **参考资料** | 信息（全部或按标签筛选） |
| **收支明细** | 账 WHERE month=N, 按类别/付收款方分组 |
| **月度报表** | 账 WHERE month=N, SUM(amount) GROUP BY category |
| **本周时间线** | 事 WHERE datetime BETWEEN 本周一..本周日, 按时间排序 |

**关键**：新增一个应用视图只需要一条查询规则，不需要改数据模型或抽取逻辑。

---

## 需求总览

| # | 功能 | 核心价值 | 工作量 | 优先级 |
|---|------|---------|--------|--------|
| 1 | 八元本体存储 + Agent 工具 | 通用结构化存储，Agent 可读写任意实体和关系 | 3.5 天 | 🔴 关键 |
| 2 | 对话自动抽取 | 零摩擦——聊天即录入，AI 自动提取八类信息 | 3 天 | 🔴 关键 |
| 3 | 上下文注入 + 智能回复 | AI 回复前自动拉取相关实体，回复更精准 | 2 天 | 🔴 关键 |
| 4 | 信息管理页面 | 多视图浏览（联系人/组织/日程/待办/收支/时间线），可编辑修正 | 3.5 天 | 🔴 关键 |
| 5 | 主动提醒 | 事(待办)到期、客户跟进、日程即将开始 | 2 天 | 🟠 重要 |
| 6 | 关系图谱可视化 | 交互式图展示实体间的关联网络 | 2 天 | 🟡 增强 |

---

## 1. 八元本体存储 + Agent 工具

### 1.1 问题

当前 Memory 系统的所有记忆都是无类型文本块，无法区分人、事、物，也无法建立实体间的关系。

### 1.2 数据模型

两张表：实体 + 关系。统一存储所有类型，通过 `category` 和 `subtype` 区分。

```sql
-- 实体表（统一存储八类原语）
CREATE TABLE pim_items (
  id          TEXT PRIMARY KEY,
  category    TEXT NOT NULL,          -- person, event, thing, place, time, info, org, ledger
  subtype     TEXT,                   -- 类别内细分（见下表）
  title       TEXT NOT NULL,          -- 显示名称
  content     TEXT,                   -- 描述/正文/摘要
  properties  TEXT DEFAULT '{}',      -- JSON，类型专属字段
  tags        TEXT DEFAULT '[]',      -- JSON array，自由标签
  status      TEXT,                   -- pending/done/cancelled/...（事 专用）
  datetime    TEXT,                   -- 关联时间（日程时间/截止日/发生时间）
  confidence  REAL DEFAULT 1.0,       -- AI 抽取置信度
  sourceIds   TEXT DEFAULT '[]',      -- 溯源到原始 memory/对话
  agentId     TEXT,
  createdAt   TEXT DEFAULT (datetime('now')),
  updatedAt   TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_pim_category ON pim_items(category);
CREATE INDEX idx_pim_subtype ON pim_items(subtype);
CREATE INDEX idx_pim_status ON pim_items(status);
CREATE INDEX idx_pim_datetime ON pim_items(datetime);
CREATE INDEX idx_pim_title ON pim_items(title);

-- 关系表（任意实体之间）
CREATE TABLE pim_links (
  id          TEXT PRIMARY KEY,
  fromId      TEXT NOT NULL REFERENCES pim_items(id),
  toId        TEXT NOT NULL REFERENCES pim_items(id),
  type        TEXT NOT NULL,          -- 参与, 负责, 同事, 位于, 涉及, ...
  properties  TEXT DEFAULT '{}',      -- 附加属性
  confidence  REAL DEFAULT 1.0,
  createdAt   TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_pim_links_from ON pim_links(fromId);
CREATE INDEX idx_pim_links_to ON pim_links(toId);
CREATE INDEX idx_pim_links_type ON pim_links(type);
```

#### 各原语的 subtype 和 properties

```typescript
// pim/types.ts

export type PimCategory = "person" | "event" | "thing" | "place" | "time" | "info" | "org" | "ledger";

/** 各类别的 subtype 枚举（可扩展，不硬编码上限） */
export const PIM_SUBTYPES: Record<PimCategory, string[]> = {
  person:  ["contact", "colleague", "client", "family", "other"],
  event:   ["meeting", "interaction", "task", "trip", "purchase", "reading", "other"],
  thing:   ["product", "project", "book", "tool", "concept", "other"],
  place:   ["city", "office", "venue", "address", "other"],
  time:    ["deadline", "period", "milestone", "recurring", "other"],
  info:    ["article", "paper", "bookmark", "quote", "reference", "note", "other"],
  org:     ["company", "department", "team", "community", "institution", "other"],
  ledger:  ["expense", "income", "transfer", "reimbursement", "other"],
};

/** 人 */
interface PersonProps {
  orgRef?: string;      // 关联的组织实体 ID（也可通过 link→org 表达）
  role?: string;        // 职位/角色
  relation?: string;    // 与用户的关系
  aliases?: string[];   // 别名（小张、张总）
  contact?: {           // 联系方式
    phone?: string;
    email?: string;
    wechat?: string;
  };
}

/** 事 */
interface EventProps {
  location?: string;        // 快捷字段，也可通过 link→place 表达
  participants?: string[];  // 快捷字段，也可通过 link→person 表达
  duration?: string;        // "1h", "30min"
  priority?: "high" | "medium" | "low";
  followUp?: string;        // 后续动作
  outcome?: string;         // 结果/结论
}

/** 物 */
interface ThingProps {
  brand?: string;
  price?: string;
  quantity?: number;
  url?: string;             // 产品/项目链接
  version?: string;
}

/** 地 */
interface PlaceProps {
  address?: string;
  city?: string;
  coordinates?: string;     // "lat,lng"
  type?: string;            // office, restaurant, airport
}

/** 时 */
interface TimeProps {
  start?: string;           // ISO datetime
  end?: string;             // ISO datetime（时间段）
  recurring?: string;       // "weekly", "monthly", "yearly"
  timezone?: string;
}

/** 信息 */
interface InfoProps {
  sourceUrl?: string;       // 来源链接
  sourceTitle?: string;     // 来源标题
  author?: string;          // 作者
  publishedAt?: string;     // 发布时间
  format?: string;          // pdf, html, text
}

/** 组织 */
interface OrgProps {
  industry?: string;        // 行业
  size?: string;            // "startup", "mid", "enterprise"
  parentOrg?: string;       // 上级组织 ID（公司→集团）
  location?: string;        // 总部/办公地点
  website?: string;
  aliases?: string[];       // 别名（腾讯→鹅厂）
  relation?: string;        // 与用户的关系：我司、客户公司、供应商、合作方
}

/** 账 */
interface LedgerProps {
  amount: number;           // 金额（正数）
  currency?: string;        // 币种，默认 CNY
  direction: "income" | "expense" | "transfer";
  category?: string;        // 分类：餐饮、差旅、采购、工资、项目回款...
  payer?: string;           // 付款方（人/组织名或 ID）
  payee?: string;           // 收款方
  method?: string;          // 支付方式：微信、支付宝、银行卡、现金
  invoiced?: boolean;       // 是否已开票
  reimbursed?: boolean;     // 是否已报销
  note?: string;            // 备注
}
```

#### 关系类型

关系不限定方向或实体类型组合，但常见的有：

```typescript
export const COMMON_LINK_TYPES = [
  // 人 ↔ 人
  "同事", "朋友", "家人", "上下级", "客户", "合作伙伴",
  // 人 ↔ 组织
  "属于", "任职于", "创立",
  // 人 ↔ 事
  "参与", "负责", "发起", "被提及",
  // 人 ↔ 物
  "拥有", "感兴趣", "购买", "使用",
  // 组织 ↔ 组织
  "子级", "上游", "合作方", "竞争",
  // 组织 ↔ 地/物
  "总部位于", "生产", "提供",
  // 人/事 ↔ 地
  "位于", "发生于", "居住", "工作于",
  // 事 ↔ 物
  "涉及", "使用", "交付", "产出",
  // 事/物 ↔ 时
  "计划于", "截止于", "发生于",
  // 事/物 ↔ 信息
  "参考", "来源于", "描述",
  // 账 ↔ 人/组织/事
  "付款方", "收款方", "关联",
] as const;
```

### 1.3 Agent 工具

4 个工具，覆盖所有实体类型：

```typescript
// agents/tools/pim.ts

// 1. 查询——自然语言查任何类型的实体
const pim_query = tool({
  description: `查询个人信息系统中的实体和关系。
支持查询人、事、物、地、信息、组织、账目等。
示例：
- "我的客户有哪些" → 查 person WHERE relation=客户
- "下周的安排" → 查 event WHERE datetime 在下周
- "ABC公司有哪些人" → 查 org(ABC) 关联的 person
- "这个月花了多少钱" → 查 ledger WHERE month=当月, SUM(amount)`,
  parameters: z.object({
    query: z.string().describe("自然语言查询"),
    category: z.enum(["person", "event", "thing", "place", "time", "info", "org", "ledger"]).optional(),
    limit: z.number().default(20),
  }),
});

// 2. 保存——创建或更新任何类型的实体
const pim_save = tool({
  description: `保存实体到个人信息系统。识别到人、事、物、地、时间、信息时调用。
同名同类实体已存在时自动合并更新。`,
  parameters: z.object({
    category: z.enum(["person", "event", "thing", "place", "time", "info", "org", "ledger"]),
    subtype: z.string().optional(),
    title: z.string(),
    content: z.string().optional(),
    properties: z.record(z.unknown()).optional(),
    tags: z.array(z.string()).optional(),
    datetime: z.string().optional(),
    status: z.string().optional(),
    // 关联
    linkTo: z.string().optional().describe("关联到某个已有实体的 ID"),
    linkType: z.string().optional().describe("关系类型"),
  }),
});

// 3. 更新状态——待办完成、事件取消等
const pim_update = tool({
  description: "更新实体的状态或属性。如标记待办完成、更新联系人信息。",
  parameters: z.object({
    id: z.string(),
    status: z.string().optional(),
    properties: z.record(z.unknown()).optional(),
  }),
});

// 4. 查看详情——某个实体的完整信息及所有关联
const pim_inspect = tool({
  description: "查看某个实体的完整信息，包括所有关联的实体。如查看某客户的所有互动、相关项目。",
  parameters: z.object({ id: z.string() }),
});
```

### 1.4 API 路由

```typescript
// routes/pim.ts
// GET    /api/pim/items              — 列表（?category=person&subtype=client&q=张）
// GET    /api/pim/items/:id          — 详情（含关联实体）
// POST   /api/pim/items              — 创建
// PATCH  /api/pim/items/:id          — 更新
// DELETE /api/pim/items/:id          — 删除
// GET    /api/pim/links?from=xxx     — 某实体的关联列表
// POST   /api/pim/links              — 创建关联
// DELETE /api/pim/links/:id          — 删除关联
// GET    /api/pim/stats              — 统计（各类别/subtype 计数）
// GET    /api/pim/timeline?days=7    — 时间线视图（事 按时间排序）
// GET    /api/pim/graph              — 关系图数据（节点+边）
// GET    /api/pim/ledger/summary?month=2026-03  — 月度收支汇总（按分类分组）
// GET    /api/pim/org/:id/members    — 组织成员列表（关联的人）
```

### 1.5 配置

```json5
{
  pim: {
    enabled: false,
    autoExtract: true,
    confidenceThreshold: 0.7,
    extractModel: "",             // 空=用 Agent 默认模型
    reminders: {
      enabled: false,
      taskDeadlineHours: 24,      // 事(task) 到期前 N 小时提醒
      followUpDays: 7,            // 人(client) N 天未互动提醒
      scheduleMinutes: 60,        // 事(meeting) 前 N 分钟提醒
    },
  }
}
```

### 1.6 实施步骤

| 步骤 | 内容 | 工作量 |
|------|------|--------|
| 1 | `db/schema.ts` 新增 pim_items + pim_links 表 | 1h |
| 2 | `pim/types.ts` 八元类型定义 + subtype + properties 接口（含 OrgProps, LedgerProps） | 1.5h |
| 3 | `pim/store.ts` PimStore CRUD + 查询 + 去重 + 关联 + 账目聚合查询 | 5h |
| 4 | `agents/tools/pim.ts` 4 个 Agent 工具 | 3h |
| 5 | `routes/pim.ts` API 路由 + timeline + graph + 注册到 `app.ts` | 2h |
| 6 | `tools/index.ts` 注册工具 + 能力标签 + ownerOnly | 0.5h |
| 7 | `config/schema.ts` 新增 pim 配置块 | 0.5h |
| 8 | `gateway.ts` 初始化 PimStore + 注入 GatewayContext | 0.5h |
| 9 | 测试 + 联调 | 2h |

### 1.7 测试要点

- 创建人(client) + 组织(company) + 事(meeting) + 物(product) 并建立关系 → inspect 能看到完整关联
- 同名人/组织实体自动合并
- `pim_query("我的客户")` → 返回 person WHERE relation=客户
- `pim_query("ABC公司有哪些人")` → 返回关联到 org(ABC) 的 person
- `pim_query("这个月花了多少钱")` → 返回 ledger SUM(amount)
- `pim_query("下周的安排")` → 返回 event WHERE datetime 在下周
- timeline API 返回事按时间排序的混合列表
- 每笔 ledger 条目独立存储，不去重

---

## 2. 对话自动抽取

### 2.1 问题

如果用户要手动告诉 AI "记住这个人"、"创建个待办"，那和手动录入没区别。**核心价值在于零摩擦**。

### 2.2 方案：异步抽取 Pipeline

```
用户消息 → Agent 正常回复（不受影响）
                 ↓ 异步
         ┌────────────────────────────────┐
         │  1. 预过滤（跳过短消息/闲聊）     │
         │  2. LLM 结构化抽取              │
         │     输入：最近几轮对话 + 已有实体  │
         │     输出：实体[] + 关系[]         │
         │  3. 去重合并（人名别名匹配）       │
         │  4. 置信度过滤（>0.7 自动写入）    │
         │  5. 写入 pim_items + pim_links  │
         └────────────────────────────────┘
```

### 2.3 抽取 Prompt

```typescript
const EXTRACT_PROMPT = `你是一个信息抽取助手。从用户对话中识别结构化实体和关系。

## 八类实体

1. **人 (person)**：被提到的任何人。属性：role(职位), relation(与用户关系), aliases(别名)
2. **事 (event)**：发生的或将要发生的事。subtype：meeting(会议), interaction(互动), task(待办), trip(出行), purchase(购买), reading(阅读) 等。属性：priority, followUp, outcome
3. **物 (thing)**：具体或抽象的事物。subtype：product(产品), project(项目), book(书), tool(工具) 等。属性：brand, price, url
4. **地 (place)**：地点。属性：address, city
5. **时 (time)**：有语义意义的时间锚点（如"Q2目标"、"项目第一阶段"）。注意：简单日期(如"明天2点")直接放到其他实体的 datetime 字段，不需要单独创建
6. **信息 (info)**：有来源的知识片段。subtype：article, paper, bookmark, quote, reference。属性：sourceUrl, author
7. **组织 (org)**：公司、部门、团队、机构。subtype：company, department, team, community。属性：industry, location, relation(与用户关系:我司/客户公司/供应商)
8. **账 (ledger)**：一笔收支记录。属性：amount(金额,数字), direction(income/expense/transfer), category(餐饮/差旅/采购/...), payer(付款方), payee(收款方), method(支付方式)

## 已知实体（避免重复）
{existingEntities}

## 今天日期
{today}

## 对话内容
{recentMessages}

## 输出 JSON
{
  "items": [
    {
      "category": "person",
      "subtype": "client",
      "title": "张总",
      "properties": { "role": "CEO", "relation": "客户" },
      "confidence": 0.95
    },
    {
      "category": "org",
      "subtype": "company",
      "title": "ABC公司",
      "properties": { "relation": "客户公司" },
      "confidence": 0.9
    },
    {
      "category": "event",
      "subtype": "meeting",
      "title": "与张总讨论企业版",
      "datetime": "2026-03-15",
      "properties": { "followUp": "安排demo" },
      "confidence": 0.9
    },
    {
      "category": "thing",
      "subtype": "product",
      "title": "企业版",
      "confidence": 0.85
    },
    {
      "category": "ledger",
      "subtype": "expense",
      "title": "出差机票",
      "datetime": "2026-03-15",
      "properties": { "amount": 3200, "direction": "expense", "category": "差旅", "method": "公司卡" },
      "confidence": 0.9
    }
  ],
  "links": [
    { "from": "张总", "to": "ABC公司", "type": "任职于" },
    { "from": "与张总讨论企业版", "to": "张总", "type": "参与" },
    { "from": "与张总讨论企业版", "to": "企业版", "type": "涉及" },
    { "from": "出差机票", "to": "与张总讨论企业版", "type": "关联" }
  ]
}

## 规则
- 仅提取对话中**明确提及**的信息，不推测
- 相对日期转为绝对日期（"明天"→具体日期，"下周三"→具体日期）
- 简单时间引用（"明天2点"）放到实体的 datetime 字段，不要创建独立的时间实体
- 只在时间本身有语义意义时创建时间实体（如"Q2"、"项目第一阶段"）
- 不提取纯闲聊（"嗯"、"好的"、"天气不错"）
- confidence: 1.0=明确陈述 0.8=合理推断 <0.7=不确定
- 如果没有可提取的信息，返回空数组`;
```

### 2.4 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 时间实体的边界 | 简单日期 → datetime 字段；有语义的时间段 → 独立实体 | 避免为每个"明天下午"都创建实体，但保留"Q2目标"这类有意义的时间锚点 |
| 物的范围 | 具体或抽象事物，不含组织 | 产品、项目、书、工具、概念等；公司/部门归入组织(org) |
| 抽取粒度 | 一段对话可产出多个实体+多条关系 | 贴合真实场景——一句话可能同时提到人、事、物 |
| 去重范围 | 人和组织做三层去重，其他类型精确匹配 | 人名和公司名最容易重复（别名多：腾讯/鹅厂），其他类型重复概率低 |
| 账目不去重 | 每笔账目都是独立记录，不合并 | "花了3000"和"又花了3000"是两笔不同的支出 |
| 预过滤 | <20 字、纯 emoji、纯指令跳过 | 大部分短消息无抽取价值，节省 Token |

### 2.5 实施步骤

| 步骤 | 内容 | 工作量 |
|------|------|--------|
| 1 | `pim/extractor.ts` 抽取 prompt + JSON 解析 + 错误处理 | 3h |
| 2 | `pim/dedup.ts` 人名去重（精确+别名+同org同role） | 2h |
| 3 | `agents/runtime.ts` 回复后异步触发 pipeline | 2h |
| 4 | 预过滤 + 日期归一化 | 1.5h |
| 5 | 历史 Memory 批量回填（可选，冷启动用） | 2h |
| 6 | 测试（准确性 + 去重 + 异步不阻塞） | 3h |

### 2.6 测试要点

- "今天见了张总，他是 ABC 的 CEO"→ 创建 person(张总) + org(ABC公司) + event(会面) + link(张总→ABC任职于)
- "看了篇 RAG 论文 https://arxiv.org/xxx"→ 创建 info(论文) + event(阅读)
- "去华强北买了 10 台显示器，花了 3 万"→ 创建 place(华强北) + thing(显示器) + event(采购) + ledger(支出3万)
- 再次提到"张总"→ 合并到已有实体
- 再次提到"ABC"/"ABC公司"→ 合并到已有组织
- 每笔金额提及都创建独立 ledger 条目
- 短消息"好的"→ 不触发抽取
- 异步抽取不影响对话响应时间

---

## 3. 上下文注入 + 智能回复

### 3.1 问题

提取了信息但回复时不用，等于白提取。**AI 需要在回复前自动拉取相关信息。**

### 3.2 方案

#### 对话前：Preheat

用户消息 → 提取关键词 → 查匹配的实体 → 注入系统提示：

```typescript
// pim/preheat.ts
export async function preheatPim(message: string, store: PimStore): Promise<string> {
  const sections: string[] = [];

  // 1. 提到的人 → 联系人信息 + 最近互动 + 待办
  const people = await store.matchPeople(message);
  for (const p of people) {
    const events = await store.getLinkedItems(p.id, "event", 3);
    sections.push(formatPersonContext(p, events));
  }

  // 2. 提到的组织 → 关联的人和事
  const orgs = await store.matchOrgs(message);
  for (const o of orgs) {
    const members = await store.getLinkedItems(o.id, "person", 5);
    const events = await store.getLinkedItems(o.id, "event", 3);
    sections.push(formatOrgContext(o, members, events));
  }

  // 3. 提到的物（项目/产品）→ 关联的人和事
  const things = await store.matchThings(message);
  for (const t of things) {
    const related = await store.getLinkedItems(t.id, null, 5);
    sections.push(formatThingContext(t, related));
  }

  // 4. 时间引用 → 相关日程和待办
  if (hasTimeReference(message)) {
    const events = await store.queryEvents({ upcoming: true, limit: 5 });
    const tasks = await store.queryEvents({ subtype: "task", status: "pending", limit: 5 });
    if (events.length) sections.push(formatUpcoming(events));
    if (tasks.length) sections.push(formatPendingTasks(tasks));
  }

  return sections.length ? `## 你了解的相关信息\n\n${sections.join("\n\n")}` : "";
}
```

注入效果：

```
## 你了解的相关信息

### 张总（ABC公司 CEO，客户）
- 所属组织：ABC 公司（客户公司）
- 最近互动：3月15日 见面讨论企业版（态度积极）
- 关联待办：安排 demo（计划下周三）
- 关联物：企业版产品（感兴趣）
- 关联支出：出差机票 ¥3,200

### 本周日程
- 周三 张总 demo @ ABC公司
- 周四 飞上海
```

#### 引导 Agent 主动利用

system prompt 补充引导规则：

```
当用户询问某人/某事/某段时间时，你应该查询个人信息系统获取完整上下文。
如果你知道相关的待办或跟进事项，主动提醒用户，不要等用户问。
```

### 3.3 实施步骤

| 步骤 | 内容 | 工作量 |
|------|------|--------|
| 1 | `pim/preheat.ts` 关键词匹配 + 实体拉取 + 格式化 | 3h |
| 2 | `system-prompt-builder.ts` 集成 preheat | 1h |
| 3 | system prompt 引导规则 | 1h |
| 4 | 混合检索（pim 结构化 + Memory 语义融合） | 2h |
| 5 | 测试 + 联调 | 2h |

### 3.4 测试要点

- 提到"张总"→ 系统提示包含张总信息 + 最近互动 + 待办
- 问"下周安排"→ 回复包含日程 + 到期待办
- 问"企业版进展"→ 回复关联到企业版的所有人和事
- 没提到具体人/物的普通对话 → 不注入

---

## 4. 信息管理页面

### 4.1 问题

AI 抽取不完美，用户需要浏览和修正。同时"我的联系人"、"我的待办"本身就是有价值的视图。

### 4.2 前端设计

新增"个人信息"页面，**应用视图以标签页呈现**，底层都是同一个数据模型的不同查询：

```
┌─ 个人信息 ────────────────────────────────────────────────────────┐
│                                                                    │
│  [联系人] [组织] [日程] [待办] [收支] [时间线] [物品] [参考] 🔍 [+]│
│                                                                │
│  ═══ 联系人 ═══════════════════════════════════════════════  │
│                                                                │
│  ── 客户 (5) ──────────────────────────────────────────────  │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ 👤 张总    ABC公司 · CEO                           [✏️] │ │
│  │    最近：3/15 讨论企业版  待跟进：安排demo                │ │
│  ├──────────────────────────────────────────────────────────┤ │
│  │ 👤 王芳    XYZ公司 · 采购总监                      [✏️] │ │
│  │    最近：3/10 SaaS方案沟通  待跟进：发报价单              │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  ── 同事 (3) ──────────────────────────────────────────────  │
│  │ 👤 李工    前端工程师                               [✏️] │ │
└────────────────────────────────────────────────────────────────┘
```

组织视图：

```
│  [联系人] [●组织] [日程] [待办] [收支] [时间线] [物品] [参考] │
│                                                                │
│  ── 客户公司 (3) ──────────────────────────────────────────  │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ 🏢 ABC 公司      科技 · 深圳南山                   [✏️] │ │
│  │    成员：张总(CEO), 李经理(采购)                         │ │
│  │    最近互动：3/15 讨论企业版                              │ │
│  ├──────────────────────────────────────────────────────────┤ │
│  │ 🏢 XYZ 公司      制造 · 上海                       [✏️] │ │
│  │    成员：王芳(采购总监)                                   │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  ── 我司 (1) ──────────────────────────────────────────────  │
│  │ 🏢 本公司        3个部门, 6个同事                   [✏️] │ │
└────────────────────────────────────────────────────────────────┘
```

待办视图：

```
│  [联系人] [组织] [日程] [●待办] [收支] [时间线] [物品] [参考] │
│                                                                │
│  查询条件：event WHERE subtype=task AND status=pending         │
│                                                                │
│  ── 待完成 (5) ────────────────────────────────────────────  │
│  ☐ 🔴 给张总安排 demo              截止：3/19          [✏️] │
│  ☐ 🔴 发报价单给王芳              截止：3/18          [✏️] │
│  ☐ 🟡 准备 sprint review 材料     截止：3/16          [✏️] │
│                                                                │
│  ── 已完成 (8) ────────────────────────────────────────────  │
│  ☑ 通知李工参加评审会              完成于：3/14              │
```

收支视图：

```
│  [联系人] [组织] [日程] [待办] [●收支] [时间线] [物品] [参考] │
│                                                                │
│  ── 本月概览 ──────────────────────────────────────────────  │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐                │
│  │ 支出       │  │ 收入       │  │ 结余       │                │
│  │ ¥35,200   │  │ ¥100,000  │  │ ¥64,800   │                │
│  └───────────┘  └───────────┘  └───────────┘                │
│                                                                │
│  ── 支出明细 ──────────────────────────────────────────────  │
│  3/15  🔴 采购显示器         ¥30,000    采购    华强北商家    │
│  3/15  🟡 出差机票           ¥3,200     差旅    公司卡        │
│  3/12  🟡 团队聚餐           ¥2,000     团建    AA制          │
│                                                                │
│  ── 按分类 ────────────────────────────────────────────────  │
│  采购  ████████████████████████████  ¥30,000  (85%)          │
│  差旅  ███░░░░░░░░░░░░░░░░░░░░░░░░  ¥3,200   (9%)           │
│  团建  ██░░░░░░░░░░░░░░░░░░░░░░░░░  ¥2,000   (6%)           │
└────────────────────────────────────────────────────────────────┘
```

时间线视图（跨类型混合）：

```
│  [联系人] [组织] [日程] [待办] [收支] [●时间线] [物品] [参考] │
│                                                                │
│  查询条件：event WHERE datetime BETWEEN ... ORDER BY datetime  │
│                                                                │
│  ── 今天 3/15 ─────────────────────────────────────────────  │
│  14:00  📅 产品评审会 @ 会议室A                               │
│  ──     🤝 与张总会面 → 讨论企业版                           │
│                                                                │
│  ── 明天 3/16 ─────────────────────────────────────────────  │
│  10:00  📅 团队周会                                           │
│                                                                │
│  ── 3/19 ──────────────────────────────────────────────────  │
│  待定    📅 张总 demo @ ABC公司                               │
│  ⚠️     ☐ 给张总安排 demo（截止日）                          │
```

### 4.3 实施步骤

| 步骤 | 内容 | 工作量 |
|------|------|--------|
| 1 | `web/src/pages/Pim.tsx` 框架 + 标签页路由 + 搜索 | 2h |
| 2 | 联系人视图（按 relation 分组 + 最近互动摘要） | 3h |
| 3 | 组织视图（按关系分组 + 成员列表 + 互动摘要） | 2h |
| 4 | 待办视图（状态分组 + 优先级 + 完成切换） | 2h |
| 5 | 收支视图（月度概览 + 明细列表 + 分类饼图） | 3h |
| 6 | 时间线视图（按日期分组 + 混合事件类型） | 2h |
| 7 | 物品/参考视图（列表 + 标签筛选） | 1h |
| 8 | 编辑/新建对话框（通用字段 + category 专属字段） | 2h |
| 9 | `App.tsx` 侧边栏入口 + i18n | 0.5h |
| 10 | 测试 + 联调 | 2h |

### 4.4 测试要点

- 联系人按 relation 分组，显示最近互动和待跟进
- 组织视图展示成员列表，点击成员跳转到联系人
- 待办一键标记完成
- 收支视图月度汇总金额正确，分类统计与明细一致
- 时间线混合显示日程+互动+待办截止
- 编辑实体后保存成功
- 搜索可跨所有类别

---

## 5. 主动提醒

### 5.1 问题

AI 只在用户问时才回忆信息，重要事情容易遗忘。

### 5.2 方案

复用 Cron 机制，定期扫描 pim_items：

```typescript
// pim/reminder.ts
async function checkReminders(store: PimStore, notify: NotifyFn) {
  const now = new Date();

  // 1. 事(task) 到期提醒
  const dueTasks = await store.query({
    category: "event", subtype: "task", status: "pending",
    datetimeBefore: addHours(now, config.pim.reminders.taskDeadlineHours),
    notReminded: true,
  });

  // 2. 事(meeting) 即将开始
  const upcoming = await store.query({
    category: "event", subtype: "meeting",
    datetimeBefore: addMinutes(now, config.pim.reminders.scheduleMinutes),
    notReminded: true,
  });

  // 3. 人(client) 久未互动
  const stale = await store.getStaleContacts(config.pim.reminders.followUpDays);

  for (const item of [...dueTasks, ...upcoming]) {
    notify(`⏰ ${item.title}（${item.datetime}）`);
    await store.markReminded(item.id);
  }

  for (const c of stale) {
    notify(`👤 ${c.title} 已 ${c.daysSince} 天未联系`);
  }
}
```

### 5.3 实施步骤

| 步骤 | 内容 | 工作量 |
|------|------|--------|
| 1 | `pim/reminder.ts` 3 类提醒检查逻辑 | 3h |
| 2 | `pim_items` 新增 `reminded` 标记 | 0.5h |
| 3 | 注册到 Cron + 频道投递 | 1h |
| 4 | 配置项 | 0.5h |
| 5 | 测试 + 联调 | 2h |

### 5.4 测试要点

- 待办截止前 24h 收到提醒且不重复
- 日程开始前 1h 提醒
- 客户 7 天未互动提醒
- 提醒关闭后不发送

---

## 6. 关系图谱可视化

### 6.1 问题

列表视图适合精确查找，但无法展示实体间的网络关系。

### 6.2 方案

在个人信息页面增加"图谱"视图，以力导向图展示实体关联。不同 category 用不同颜色/形状区分：

- 🔵 人（圆形）
- 🟢 事（方形）
- 🟠 物（菱形）
- 🔴 地（三角）
- 🟣 信息（六边形）
- 🏢 组织（圆角方形）
- 💰 账（不在图谱中——账目是流水记录，不是网络节点）

点击节点查看详情，支持按类型筛选、搜索聚焦。

### 6.3 实施步骤

| 步骤 | 内容 | 工作量 |
|------|------|--------|
| 1 | `web/src/components/PimGraph.tsx` d3-force 图组件 | 5h |
| 2 | 节点交互 + 筛选 + 详情卡片 | 2h |
| 3 | 集成到 Pim 页面 | 0.5h |
| 4 | 测试 + 联调 | 1.5h |

---

## 依赖关系与实施顺序

```
#1 八元存储 + 工具  ←── 基础
        ↓
#2 自动抽取        ←── 依赖 PimStore
#4 管理页面        ←── 依赖 API，可与 #2 并行
        ↓
#3 上下文注入      ←── 依赖 #1+#2（有数据才有用）
        ↓
#5 主动提醒        ←── 依赖 #1
#6 关系图谱        ←── 依赖 #4
```

```
第一批（3.5天）：#1 八元存储 + 工具
第二批（3天）：#2 自动抽取 + #4 管理页面（并行）
第三批（2天）：#3 上下文注入
第四批（2天）：#5 主动提醒
第五批（2天）：#6 关系图谱（可选）
```

---

## 影响范围汇总

| 文件 | 功能 | 变更类型 |
|------|------|---------|
| `server/src/db/schema.ts` | #1 | 修改（新增 pim_items + pim_links） |
| `server/src/pim/types.ts` | #1 | **新增** |
| `server/src/pim/store.ts` | #1, #3, #5 | **新增** |
| `server/src/pim/extractor.ts` | #2 | **新增** |
| `server/src/pim/dedup.ts` | #2 | **新增** |
| `server/src/pim/preheat.ts` | #3 | **新增** |
| `server/src/pim/reminder.ts` | #5 | **新增** |
| `server/src/agents/tools/pim.ts` | #1 | **新增** |
| `server/src/agents/tools/index.ts` | #1 | 修改 |
| `server/src/agents/runtime.ts` | #2 | 修改（异步抽取） |
| `server/src/agents/system-prompt-builder.ts` | #3 | 修改（preheat） |
| `server/src/routes/pim.ts` | #1 | **新增** |
| `server/src/app.ts` | #1 | 修改 |
| `server/src/config/schema.ts` | #1 | 修改 |
| `server/src/gateway.ts` | #1 | 修改 |
| `server/src/cron/service.ts` | #5 | 修改 |
| `web/src/pages/Pim.tsx` | #4 | **新增** |
| `web/src/components/PimGraph.tsx` | #6 | **新增** |
| `web/src/App.tsx` | #4 | 修改 |
| `web/src/i18n/locales/{en,zh}.json` | #4 | 修改 |

## 总工作量估算

| 功能 | 后端 | 前端 | 合计 |
|------|------|------|------|
| 1. 八元存储 + 工具 | 15h | 0h | ~2.5 天 |
| 2. 自动抽取 | 12h | 0h | ~2 天 |
| 3. 上下文注入 | 7h | 0h | ~1.5 天 |
| 4. 管理页面（含组织+收支视图） | 0h | 20h | ~3.5 天 |
| 5. 主动提醒 | 7h | 0h | ~1.5 天 |
| 6. 关系图谱 | 0h | 9h | ~1.5 天 |
| **合计** | **41h** | **29h** | **~13 天** |

---

## 本期不做（后续可扩展）

以下功能在本期实现中暂不包含，但数据模型已预留扩展空间，后续可按需迭代：

| 功能 | 本期策略 | 后续扩展方向 |
|------|---------|-------------|
| 完整日历 UI（周视图/月视图/拖拽） | 日程以列表+时间线视图呈现 | 可引入日历组件（如 FullCalendar），数据层已就绪 |
| CRM 深度功能（销售漏斗/商机/报表） | 聚焦"AI 记住人和事" | 可基于人+事+账的数据扩展漏斗视图和转化分析 |
| 完整记账（预算/多账本/对账） | AI 自动记录提到的收支 | 可扩展预算管理、多币种、与账本 App 对接 |
| 组织架构编辑器 | 组织层级通过关系自动建立 | 可加可视化 OrgChart 编辑 |
| 外部同步（Google Calendar/Outlook/Notion） | 先做好内部数据 | 可通过插件实现双向同步 |
| 外部导入（Todoist/Contacts/CSV） | 先做好 AI 抽取 | 可通过插件或批量导入 API 支持 |
| 多用户共享/协作 | 个人工具，单用户 | scope 机制已支持 shared，可扩展多用户权限 |
| 抽取确认队列 | 高置信度自动写入 + 事后修正 | 可加低置信度暂存区 + 用户确认 UI |
| 子任务/依赖/甘特图 | 待办为简单状态管理 | 可扩展任务分解和依赖关系 |
| 图数据库（Neo4j） | SQLite + 应用层遍历 | 实体量超过万级时可迁移 |
| 实体嵌入向量 | 名称+别名匹配 | 规模增长后可加向量去重和语义搜索 |

---

## 优于 OpenClaw 的设计

| 维度 | OpenClaw | YanClaw PIM |
|------|----------|-------------|
| 记忆模型 | 纯文本 Memory，无类型 | 八元本体（人事物地时信息组织账）+ Memory 双层 |
| 信息录入 | 手动 `memory_store` | AI 对话自动抽取，零摩擦 |
| 结构化查询 | 仅全文搜索 | 按 category/subtype/status/datetime/关系 筛选 |
| 实体去重 | 无，重复堆积 | 名称 + 别名 + 同组织职位 三层去重 |
| 信息利用 | 被动检索 | 主动注入上下文 + 定时提醒 + 跨话题关联 |
| 收支追踪 | 无 | 对话提及金额自动记账，按月/分类汇总 |
| 组织管理 | 无 | 自动识别公司/部门，关联成员和互动 |
| 可扩展性 | 加功能要改代码 | 新增应用视图只需一条查询，本体模型不变 |
