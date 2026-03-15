# 记忆系统

> FTS5 全文搜索 + 向量嵌入混合检索、自动索引、记忆预热。

---

## 1. 架构

```
MemoryStore (SQLite)
  ├─→ FTS5 全文搜索（BM25 关键词匹配）
  ├─→ Embedding BLOB（JS 侧余弦相似度）
  └─→ 混合排序（融合两种结果，去重）

MemoryAutoIndexer
  └─→ 监听 indexDirs 文件变更 → 分块 → 存储

Agent 集成
  ├─→ memory_search 工具（主动检索）
  ├─→ memory_store 工具（主动存储）
  ├─→ 会话开始时自动预热
  └─→ 上下文溢出时自动 flush 到记忆
```

---

## 2. 混合搜索

两种搜索方式同时执行，结果合并去重：

| 方式 | 技术 | 适用场景 |
|------|------|----------|
| 全文搜索 | SQLite FTS5（BM25） | 精确关键词匹配 |
| 向量搜索 | Embedding + 余弦相似度 | 语义相似匹配 |

**为什么不用 sqlite-vec**：避免原生扩展在 Windows 上的兼容问题，JS 侧余弦相似度对于本地规模的记忆数据量足够。

### Embedding 模型

支持多种提供商：

| 提供商 | 模型 |
|--------|------|
| OpenAI | `text-embedding-3-small` |
| Google | `text-embedding-004` |
| Ollama | 本地模型 |

---

## 3. 配置

```json5
{
  "memory": {
    "enabled": true,
    "autoIndex": true,
    "indexDirs": ["~/Documents/notes"],
    "autoFlushMs": 300000,
    "maxMemories": 10000,
    "embedModel": "text-embedding-3-small"
  }
}
```

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `enabled` | 是否启用记忆系统 | `false` |
| `autoIndex` | 自动索引文件 | `true` |
| `indexDirs` | 监听目录列表 | `[]` |
| `autoFlushMs` | 上下文溢出自动存储间隔 | 300000 (5min) |
| `maxMemories` | 最大记忆条数 | 10000 |
| `embedModel` | Embedding 模型 | `text-embedding-3-small` |

---

## 4. 自动索引

`MemoryAutoIndexer` 监听配置的目录，发现新文件或修改时：

1. 读取文件内容
2. 按段落分块（`chunker.ts`）
3. 生成 Embedding
4. 存储到 MemoryStore（带 tags + source 元数据）

---

## 5. Agent 工具

| 工具 | 说明 |
|------|------|
| `memory_search` | 搜索记忆（关键词 + 语义） |
| `memory_store` | 存储新记忆 |
| `memory_delete` | 删除记忆 |

### 记忆预热

会话开始时，自动搜索与当前对话相关的记忆，注入到系统提示词中。

### 自动 Flush

上下文窗口超出预算时，被压缩的消息自动存储为记忆，防止信息丢失。

---

## 6. 记忆 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/memory` | 搜索记忆 |
| POST | `/api/memory` | 存储记忆 |
| DELETE | `/api/memory/:id` | 删除记忆 |

---

## 7. MMR 去重

搜索结果使用 Maximal Marginal Relevance (MMR) 算法，平衡相关性和多样性，避免返回大量相似内容。

---

## 8. 源码位置

| 文件 | 说明 |
|------|------|
| `server/src/db/memories.ts` | MemoryStore（FTS5 + Embedding） |
| `server/src/memory/embeddings.ts` | Embedding 生成 |
| `server/src/memory/auto-indexer.ts` | 文件自动索引 |
| `server/src/memory/chunker.ts` | 文本分块 |
| `server/src/routes/memory.ts` | 记忆 API |
