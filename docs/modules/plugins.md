# 插件系统

> 插件发现、加载、注册、生命周期钩子与工具命名空间。

---

## 1. 架构

```
PluginLoader（发现 + 加载）
  ├─→ 扫描 ~/.yanclaw/plugins/
  ├─→ 扫描自定义目录
  └─→ 动态 import() 加载

PluginRegistry（注册表）
  ├─→ 工具注册（命名空间: pluginId.toolName）
  ├─→ 通道工厂注册
  └─→ 生命周期钩子注册
```

---

## 2. 插件定义

```typescript
import { definePlugin } from "@yanclaw/plugin-sdk";
import { z } from "zod";

export default definePlugin({
  id: "my-plugin",
  name: "My Plugin",
  version: "1.0.0",

  tools: [
    {
      name: "query_db",
      description: "查询数据库",
      parameters: z.object({ sql: z.string() }),
      execute: async ({ sql }) => { /* ... */ },
    }
  ],

  hooks: {
    onGatewayStart: async (ctx) => { /* 初始化 */ },
    onGatewayStop: async () => { /* 清理 */ },
    onMessageInbound: async (msg) => { /* 可修改/过滤，返回 null 拦截 */ },
    beforeToolCall: async (call) => { /* 可拦截/修改 */ },
    afterToolCall: async (call, result) => { /* 后处理 */ },
  }
});
```

---

## 3. 生命周期钩子

| 钩子 | 触发时机 | 可修改 |
|------|----------|--------|
| `onGatewayStart` | Gateway 启动后 | — |
| `onGatewayStop` | Gateway 关闭前 | — |
| `onMessageInbound` | 收到消息时 | 消息内容（返回 null 拦截） |
| `beforeToolCall` | 工具执行前 | 工具参数（返回 null 拦截） |
| `afterToolCall` | 工具执行后 | — |

---

## 4. 工具命名空间

插件注册的工具自动添加前缀：

```
pluginId.toolName
```

例如 `my-plugin.query_db`。这避免了与内置工具或其他插件的命名冲突。

插件工具受 Agent 能力模型和工具策略过滤。

---

## 5. 插件发现与加载

1. **发现**：扫描 `~/.yanclaw/plugins/` + 配置的 `plugins.dirs`
2. **加载**：ESM 动态 `import()` 加载插件入口
3. **注册**：工具、通道、钩子注册到 PluginRegistry
4. **隔离**：可选 Worker 线程隔离（高风险插件）

---

## 6. 配置

```json5
{
  "plugins": {
    "dirs": ["./my-plugins"],
    "installations": {
      "my-plugin": { "enabled": true, "config": { /* 插件参数 */ } }
    }
  }
}
```

---

## 7. 内置插件

| 插件 | 说明 |
|------|------|
| `web-knowledge` | 自动将 `web_fetch` 抓取结果存入记忆 |

---

## 8. 管理 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/plugins` | 列出已加载插件 |
| POST | `/api/plugins/install` | 安装插件（git/npm/本地） |

前端 Skills 页面提供可视化管理：安装、启停、配置编辑。

---

## 9. 源码位置

| 文件 | 说明 |
|------|------|
| `server/src/plugins/types.ts` | 插件类型定义 |
| `server/src/plugins/registry.ts` | PluginRegistry |
| `server/src/plugins/loader.ts` | PluginLoader |
| `server/src/routes/plugins.ts` | 插件 API |
