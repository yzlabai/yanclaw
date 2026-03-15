# 工具系统

> 内置工具、三层策略、能力模型、执行审批、重试机制。

---

## 1. 内置工具

| 工具 | 功能 | ownerOnly |
|------|------|-----------|
| `shell` | 执行 Shell 命令 | 是 |
| `code_exec` | 沙箱代码执行 | 是 |
| `file_read` | 读取文件（支持行号范围） | 否 |
| `file_write` | 写入/创建文件 | 是 |
| `file_edit` | diff 编辑（old_string → new_string） | 是 |
| `web_search` | 网络搜索（Brave/Google） | 否 |
| `web_fetch` | 网页抓取（SSRF 防护） | 否 |
| `browser_navigate` | Playwright 导航 | 是 |
| `browser_screenshot` | 浏览器截图 | 是 |
| `browser_action` | 浏览器交互 | 是 |
| `memory_store` | 存储记忆 | 否 |
| `memory_search` | 检索记忆 | 否 |
| `memory_delete` | 删除记忆 | 否 |
| `pim_query` | 查询 PIM | 否 |
| `pim_save` | 保存 PIM | 否 |
| `pim_update` | 更新 PIM | 否 |
| `pim_inspect` | 查看 PIM 详情 | 否 |
| `session_list` | 列出会话 | 否 |
| `session_send` | 跨会话发送 | 否 |
| `session_history` | 查看会话历史 | 否 |
| `screenshot_desktop` | macOS 桌面截图 | 是 |

---

## 2. 工具组

| 组名 | 包含工具 |
|------|----------|
| `group:web` | web_search, web_fetch |
| `group:file` | file_read, file_write, file_edit |
| `group:exec` | shell, code_exec |
| `group:browser` | browser_navigate, browser_screenshot, browser_action |
| `group:memory` | memory_store, memory_search, memory_delete |
| `group:pim` | pim_query, pim_save, pim_update, pim_inspect |
| `group:session` | session_list, session_send, session_history |
| `group:desktop` | screenshot_desktop |
| `group:plugins` | 所有插件注册的工具 |

---

## 3. 三层策略

策略按 **全局 → Agent → 通道** 逐层合并，后者覆盖前者：

```json5
{
  "tools": {
    // 全局策略
    "policy": { "default": "allow", "deny": ["browser_navigate"] },

    // Agent 级覆盖
    "byAgent": {
      "code-agent": { "allow": ["group:file", "group:exec"] }
    },

    // 通道级覆盖
    "byChannel": {
      "telegram": { "deny": ["group:exec"], "allow": ["group:web"] }
    }
  }
}
```

**策略类型**：

```typescript
type ToolPolicy = {
  default: "allow" | "deny";
  allow?: string[];       // 允许列表
  alsoAllow?: string[];   // 追加允许
  deny?: string[];        // 拒绝列表（优先级最高）
};
```

---

## 4. 能力模型

Per-Agent 配置，与工具策略叠加过滤：

| 预设 | 能力 |
|------|------|
| `safe-reader` | 只读文件 + 记忆 |
| `researcher` | 读 + 网络 + 记忆 |
| `developer` | 读写 + shell + 网络 + 记忆 |
| `full-access` | 所有工具 |

自定义：

```json5
{
  "agents": [{
    "capabilities": ["fs:read", "fs:write", "net:http", "memory:read"]
  }]
}
```

---

## 5. 执行审批

高风险工具可配置审批流程：

| 模式 | 说明 |
|------|------|
| `off` | 不需要审批 |
| `on-miss` | 不在 safeBins 白名单时需审批 |
| `always` | 每次都需审批 |

**safeBins** 安全白名单：

```json5
{
  "tools": {
    "exec": {
      "ask": "on-miss",
      "safeBins": ["ls", "cat", "grep", "find", "echo", "date", "pwd", "wc"]
    }
  }
}
```

**审批流程**：

```
Agent 发起工具调用
  → 策略检查
  → 审批模式判断
  → 注册审批请求（ID + 超时 5min）
  → WebSocket 推送到前端
  → 用户批准/拒绝（或超时自动拒绝）
  → 记录到 approvals 表
```

---

## 6. 工具重试

幂等工具自动重试暂态错误（429、超时、连接重置）：

| 类别 | 工具 | 重试 |
|------|------|------|
| 幂等 | web_search, web_fetch, browser_*, memory_search, session_list, pim_query | 自动重试 |
| 副作用 | shell, file_write, file_edit | 委托给 LLM 决策 |

配置：

```json5
{
  "tools": {
    "retry": {
      "attempts": 3,
      "backoff": { "initial": 1000, "multiplier": 2, "max": 30000 },
      "jitter": 0.2
    }
  }
}
```

---

## 7. 工具沙箱

- **Docker 隔离**：可选容器化执行
- **文件系统限制**：仅允许访问 Agent 工作目录
- **Symlink 防护**：`realpath()` 校验防止目录逃逸
- **SSRF 防护**：web_fetch 阻止内网地址
- **输出截断**：超过 10KB 自动截断

---

## 8. 元数据 API

`GET /api/tools/metadata` 返回：

- `TOOL_GROUPS` — 工具组定义
- `CAPABILITY_PRESETS` — 能力预设
- `TOOL_CAPABILITIES` — 每个工具的能力标签
- `OWNER_ONLY_TOOLS` — ownerOnly 工具列表

前端工具策略编辑器（Agents 页面）基于此 API 构建。

---

## 9. 源码位置

| 文件 | 说明 |
|------|------|
| `server/src/agents/tools/index.ts` | 工具注册 + 策略 + 能力模型 |
| `server/src/agents/tools/retry.ts` | 重试逻辑 |
| `server/src/agents/tools/shell.ts` | Shell 工具 |
| `server/src/agents/tools/file.ts` | 文件工具 |
| `server/src/agents/tools/web.ts` | 网络工具 |
| `server/src/agents/tools/browser.ts` | 浏览器工具 |
| `server/src/agents/tools/memory.ts` | 记忆工具 |
| `server/src/agents/tools/pim.ts` | PIM 工具 |
| `server/src/approvals/manager.ts` | 审批管理器 |
| `server/src/routes/tools-metadata.ts` | 元数据 API |
