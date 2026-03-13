# v0.8.3 待完善功能清单

> 基于代码审查整理，已交叉验证源码和 git 历史。

---

## 已完成功能（文档归档）

以下功能已实现，设计文档仅作参考：

| 功能 | 设计文档 | 实现位置 | 关键 commit |
|------|----------|----------|-------------|
| 后台运行 & 托盘最小化 | `docs/todos/2026-03-11-background-running.md` | `src-tauri/src/lib.rs:106-478` | `3157860` |
| 模型列表动态拉取 | `docs/todos/2026-03-11-post-ui.md` | `routes/models.ts`, `Onboarding.tsx` | `46b898c` |
| Steering 改进 | `docs/plans/2026-03-13-steering-improvements.md` | `agents/steering.ts` + test | `7a2a7ff` |
| Skill 管理 UI | `docs/plans/2026-03-12-skill-management.md` | `routes/skills.ts`, `pages/Skills.tsx`, `skill-loader.ts`, `skill-installer.ts` | `d2463c9` |
| UI 重设计 | `docs/plans/2026-03-12-ui-redesign.md` | 全局暖色主题、shadcn/ui、可折叠侧边栏 | `0aa0705` |
| 安全加固全套 | `docs/plans/2026-03-10-security-hardening.md` | `security/vault.ts`、`rate-limit.ts`、`sanitize.ts`、`audit.ts`、`anomaly.ts`、`token-rotation.ts` | `ce6b9bd` |
| Model 负载均衡 | `docs/todos/2026-03-09-model-load-balance.md` | `agents/model-manager.ts`（failover + round-robin + scene×preference） | `b4db907` |
| Agent P2: 会话重置/审批/跨会话 | `docs/plans/2026-03-12-agent-capabilities-enhancement.md` | `gateway.ts`、`session-comm.ts` | — |
| Onboarding Bug 修复 | `docs/todos/2026-03-13-oboarding.md` | `App.tsx` localStorage guard + scroll fix | `0c7f315` |
| 删除 messages 空壳路由 | `docs/plans/2026-03-13-code-cleanup-plan.md` | 删除 `routes/messages.ts`、清理 `app.ts` 和 `DESIGN.md` | — |
| Plugin 版本兼容校验 | 同上 | `plugins/skill-loader.ts` 新增 `satisfiesRange()` | — |
| DM Pairing 标记实验性 | 同上 | `channels/dm-policy.ts` 注释更新 | — |
| 凭证迁移启动提示 | 同上 | `config/store.ts` + `security/vault.ts` 共享 `CREDENTIAL_FIELDS` | — |

---

## 待完成项

### P2 — 未实现的规划功能

#### 1. 微信小程序渠道

设计文档：`docs/todos/2026-03-12-wechat-miniprogram.md`（Relay 架构）

现有渠道适配器：Telegram、Discord、Slack、Feishu。微信小程序尚无代码。

#### 2. 会话序列化（防并发）

同一 session 多条消息可能并发进入 `agentRuntime.run()`，导致上下文竞争。需实现 per-session 串行队列。

详见：`docs/plans/2026-03-13-code-cleanup-plan.md` §5

#### 3. Discord 线程绑定

Discord 频道对话无法按线程隔离 session，需 threadId 自动绑定/闲时解绑。

详见：`docs/plans/2026-03-13-code-cleanup-plan.md` §6

---

### P3 — 质量 & 防御性

| 项目 | 现状 | 说明 |
|------|------|------|
| 审计日志 UI | API 已有（`routes/audit.ts`） | 缺前端展示界面 |
| RBAC | 仅 owner/non-owner | 无细粒度角色体系 |
| 测试覆盖 | 12 个测试文件 | STT、Markdown 渲染缺专项测试 |
