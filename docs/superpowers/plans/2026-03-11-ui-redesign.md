# UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate YanClaw web UI to shadcn/ui with warm color theme, collapsible sidebar, and improved onboarding flow.

**Architecture:** Gradual migration — update CSS variables first, add shadcn/ui components, then refactor pages one by one. prompt-kit chat components remain untouched.

**Tech Stack:** React 19, shadcn/ui (Radix + CVA), Tailwind CSS 4, Sonner toast, Lucide icons

**Spec:** `docs/superpowers/specs/2026-03-11-ui-redesign-design.md`

---

## Chunk 1: Foundation — shadcn/ui Init & Warm Theme

### Task 1: Initialize shadcn/ui

**Files:**
- Modify: `packages/web/package.json`
- Create: `packages/web/components.json`

- [ ] **Step 1: Install shadcn/ui CLI and initialize**

```bash
cd packages/web
bunx shadcn@latest init
```

Select options:
- Style: Default
- Base color: Neutral (we'll override with warm colors)
- CSS variables: Yes
- Tailwind CSS config: use existing `src/index.css`
- Components alias: `@yanclaw/web/components`
- Utils alias: `@yanclaw/web/lib`

- [ ] **Step 2: Verify initialization**

Check that `components.json` was created and `package.json` has the necessary dependencies. Run `bun install` if needed.

```bash
cat packages/web/components.json
bun install
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/components.json packages/web/package.json bun.lockb
git commit -m "chore: initialize shadcn/ui in web package"
```

### Task 2: Update CSS Variables to Warm Color Theme

**Files:**
- Modify: `packages/web/src/index.css`

- [ ] **Step 1: Update dark theme (default `@theme` block)**

Replace the existing `@theme` block with warm color values. Keep the same CSS variable names for compatibility with existing components:

```css
@theme {
	--color-background: oklch(0.18 0.02 60);
	--color-foreground: oklch(0.985 0.005 80);
	--color-primary: oklch(0.70 0.16 30);
	--color-primary-foreground: oklch(0.985 0.005 80);
	--color-secondary: oklch(0.65 0.10 75);
	--color-secondary-foreground: oklch(0.985 0.005 80);
	--color-muted: oklch(0.25 0.02 60);
	--color-muted-foreground: oklch(0.45 0.03 60);
	--color-accent: oklch(0.45 0.06 55);
	--color-accent-foreground: oklch(0.985 0.005 80);
	--color-destructive: oklch(0.55 0.2 27);
	--color-destructive-foreground: oklch(0.985 0.005 80);
	--color-border: oklch(0.30 0.02 60);
	--color-input: oklch(0.30 0.02 60);
	--color-ring: oklch(0.70 0.16 30);
	--color-card: oklch(0.22 0.015 60);
	--color-card-foreground: oklch(0.985 0.005 80);
	--radius: 0.75rem;
}
```

- [ ] **Step 2: Update light theme blocks**

Replace the **variable values** inside both light theme blocks, keeping the existing CSS selectors (`@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) { ... } }` and `:root[data-theme="light"] { ... }`) intact. Update the variables in both blocks to these warm values:

```css
--color-background: oklch(0.97 0.01 80);
--color-foreground: oklch(0.145 0.02 60);
--color-primary: oklch(0.65 0.18 30);
--color-primary-foreground: oklch(0.985 0.005 80);
--color-secondary: oklch(0.75 0.12 75);
--color-secondary-foreground: oklch(0.2 0.02 60);
--color-muted: oklch(0.93 0.01 70);
--color-muted-foreground: oklch(0.55 0.03 60);
--color-accent: oklch(0.93 0.01 70);
--color-accent-foreground: oklch(0.2 0.02 60);
--color-destructive: oklch(0.55 0.2 27);
--color-destructive-foreground: oklch(0.985 0.005 80);
--color-border: oklch(0.85 0.02 70);
--color-input: oklch(0.85 0.02 70);
--color-ring: oklch(0.65 0.18 30);
--color-card: oklch(0.99 0.005 80);
--color-card-foreground: oklch(0.145 0.02 60);
```

- [ ] **Step 3: Add global utility styles**

Append to `index.css` after existing content:

```css
/* Warm shadow utilities */
@layer utilities {
	.shadow-warm-sm {
		box-shadow: 0 1px 4px rgba(180, 120, 80, 0.06);
	}
	.shadow-warm {
		box-shadow: 0 2px 8px rgba(180, 120, 80, 0.08);
	}
	.shadow-warm-lg {
		box-shadow: 0 4px 16px rgba(180, 120, 80, 0.1);
	}
}

/* Card hover animation */
@layer utilities {
	.card-hover {
		transition: transform 200ms ease-out, box-shadow 200ms ease-out;
	}
	.card-hover:hover {
		transform: translateY(-2px);
		box-shadow: 0 4px 16px rgba(180, 120, 80, 0.12);
	}
}

/* Page enter animation */
@keyframes fade-in-up {
	from {
		opacity: 0;
		transform: translateY(8px);
	}
	to {
		opacity: 1;
		transform: translateY(0);
	}
}

@layer utilities {
	.animate-fade-in-up {
		animation: fade-in-up 150ms ease-out both;
	}
}
```

- [ ] **Step 4: Verify dev server renders with new colors**

```bash
cd /Users/yzlabmac/ai/yanclaw && bun run dev
```

Open http://localhost:5173, confirm warm color theme visible in both dark and light modes.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/index.css
git commit -m "style: update theme to warm color palette (coral/amber)"
```

### Task 3: Add shadcn/ui Components

**Files:**
- Create: Multiple files in `packages/web/src/components/ui/`

- [ ] **Step 1: Add Dialog component**

```bash
cd packages/web && bunx shadcn@latest add dialog
```

- [ ] **Step 2: Add form-related components**

```bash
cd packages/web && bunx shadcn@latest add input select switch tabs
```

- [ ] **Step 3: Add feedback components**

```bash
cd packages/web && bunx shadcn@latest add alert-dialog skeleton badge sonner
```

- [ ] **Step 4: Add data display components**

```bash
cd packages/web && bunx shadcn@latest add table pagination
```

- [ ] **Step 5: Install sonner package**

```bash
cd packages/web && bun add sonner
```

- [ ] **Step 6: Add Toaster to App**

In `packages/web/src/App.tsx`, import and add `<Toaster />` from sonner inside the Router, after `</SetupGuard>`:

```tsx
import { Toaster } from "sonner";

// Inside App():
return (
	<Router>
		<SetupGuard>
			<AppLayout />
		</SetupGuard>
		<Toaster position="bottom-right" />
	</Router>
);
```

- [ ] **Step 7: Verify all components importable**

```bash
cd /Users/yzlabmac/ai/yanclaw && bun run check
```

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/components/ui/ packages/web/src/App.tsx packages/web/package.json bun.lockb
git commit -m "feat: add shadcn/ui components (dialog, input, select, tabs, etc.)"
```

---

## Chunk 2: Collapsible Sidebar

### Task 4: Refactor Sidebar to Collapsible

**Files:**
- Modify: `packages/web/src/App.tsx`

- [ ] **Step 1: Update NAV_ITEMS with icons**

> **Note:** This step changes nav item order (per spec) and switches labels from English to Chinese. Current order is: Chat, Channels, Sessions, Cron, Agents, Settings. New order groups by usage frequency.

```tsx
import {
	Bot,
	Clock,
	History,
	Menu,
	MessageSquare,
	PanelLeftClose,
	PanelLeftOpen,
	Radio,
	Settings as SettingsIcon,
	X,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip";

const NAV_ITEMS = [
	{ to: "/", label: "聊天", icon: MessageSquare },
	{ to: "/sessions", label: "会话", icon: History },
	{ to: "/agents", label: "Agent", icon: Bot },
	{ to: "/channels", label: "频道", icon: Radio },
	{ to: "/cron", label: "定时任务", icon: Clock },
	{ to: "/settings", label: "设置", icon: SettingsIcon },
];
```

- [ ] **Step 2: Add sidebar collapse state**

In `AppLayout`, add:

```tsx
const [collapsed, setCollapsed] = useState(() => {
	return localStorage.getItem("yanclaw_sidebar_collapsed") === "true";
});

const toggleCollapsed = () => {
	setCollapsed((prev) => {
		localStorage.setItem("yanclaw_sidebar_collapsed", String(!prev));
		return !prev;
	});
};
```

- [ ] **Step 3: Rewrite desktop sidebar with collapse support**

Replace the desktop `<nav>` block:

```tsx
<TooltipProvider delayDuration={0}>
	<nav
		className={`hidden md:flex flex-col gap-1 border-r border-border p-3 transition-[width] duration-200 ease-out ${
			collapsed ? "w-14" : "w-56"
		}`}
	>
		{/* Logo */}
		{!collapsed && <h1 className="text-lg font-bold mb-3 px-2">YanClaw</h1>}

		{/* Nav items */}
		{NAV_ITEMS.map((item) => {
			const Icon = item.icon;
			return collapsed ? (
				<Tooltip key={item.to}>
					<TooltipTrigger asChild>
						<NavLink
							to={item.to}
							end={item.to === "/"}
							className={({ isActive }) =>
								`flex items-center justify-center p-2 rounded-xl transition-colors relative ${
									isActive
										? "bg-accent text-accent-foreground before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-[3px] before:h-5 before:bg-primary before:rounded-r"
										: "text-muted-foreground hover:text-foreground hover:bg-muted/50"
								}`
							}
						>
							<Icon className="h-5 w-5" />
						</NavLink>
					</TooltipTrigger>
					<TooltipContent side="right">{item.label}</TooltipContent>
				</Tooltip>
			) : (
				<NavLink
					key={item.to}
					to={item.to}
					end={item.to === "/"}
					className={({ isActive }) =>
						`flex items-center gap-3 px-3 py-2 rounded-xl transition-colors relative ${
							isActive
								? "bg-accent text-accent-foreground before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-[3px] before:h-5 before:bg-primary before:rounded-r"
								: "text-muted-foreground hover:text-foreground hover:bg-muted/50"
						}`
					}
				>
					<Icon className="h-5 w-5" />
					<span>{item.label}</span>
				</NavLink>
			);
		})}

		{/* Bottom section */}
		<div className="mt-auto pt-2 border-t border-border flex flex-col gap-1">
			{!collapsed && <ThemeToggle />}
			<button
				type="button"
				onClick={toggleCollapsed}
				className="flex items-center justify-center p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
			>
				{collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
			</button>
		</div>
	</nav>
</TooltipProvider>
```

- [ ] **Step 4: Remove old navLinkClass function**

Delete the standalone `navLinkClass` function since styles are now inline.

- [ ] **Step 5: Update mobile drawer nav items to include icons**

Update the mobile drawer `NAV_ITEMS.map` to also render icons:

```tsx
{NAV_ITEMS.map((item) => {
	const Icon = item.icon;
	return (
		<NavLink
			key={item.to}
			to={item.to}
			end={item.to === "/"}
			className={({ isActive }) =>
				`flex items-center gap-3 px-3 py-2 rounded-xl transition-colors ${
					isActive
						? "bg-accent text-accent-foreground"
						: "text-muted-foreground hover:text-foreground hover:bg-muted/50"
				}`
			}
		>
			<Icon className="h-5 w-5" />
			<span>{item.label}</span>
		</NavLink>
	);
})}
```

- [ ] **Step 6: Verify sidebar collapses correctly**

```bash
cd /Users/yzlabmac/ai/yanclaw && bun run dev
```

Test: click collapse button, verify sidebar shrinks to icon-only mode. Hover icons to see tooltips. Refresh page to verify localStorage persistence.

- [ ] **Step 7: Run lint check**

```bash
bun run check
```

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/App.tsx
git commit -m "feat: add collapsible sidebar with icons and tooltips"
```

---

## Chunk 3: Onboarding Redesign

### Task 5: Rewrite Onboarding Page

**Files:**
- Modify: `packages/web/src/pages/Onboarding.tsx`

- [ ] **Step 1: Create step indicator component**

At the top of `Onboarding.tsx`, add a `StepIndicator` component:

```tsx
const STEPS = ["欢迎", "模型配置", "频道配置", "完成"];

function StepIndicator({ current, total }: { current: number; total: number }) {
	return (
		<div className="flex items-center justify-center gap-2 mb-8">
			{Array.from({ length: total }, (_, i) => (
				<div key={i} className="flex items-center">
					<div
						className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
							i < current
								? "bg-primary text-primary-foreground"
								: i === current
									? "bg-primary text-primary-foreground ring-2 ring-primary/30"
									: "bg-muted text-muted-foreground"
						}`}
					>
						{i < current ? "✓" : i + 1}
					</div>
					{i < total - 1 && (
						<div
							className={`w-8 h-0.5 mx-1 transition-colors ${
								i < current ? "bg-primary" : "bg-border"
							}`}
						/>
					)}
				</div>
			))}
		</div>
	);
}
```

- [ ] **Step 2: Add imports and welcome step (step 0)**

Add Button import and a new step 0 before the existing model setup:

```tsx
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";

// In the component, add step 0:
{step === 0 && (
	<div className="text-center space-y-6 animate-fade-in-up">
		<h2 className="text-3xl font-bold">欢迎使用 YanClaw</h2>
		<p className="text-muted-foreground text-lg">
			AI Agent 网关平台，连接聊天频道与 AI Agent
		</p>
		<Button size="lg" onClick={() => setStep(1)} className="rounded-xl">
			开始配置
		</Button>
	</div>
)}
```

- [ ] **Step 3: Shift all existing steps by +1**

The existing code uses `step` state (0, 1, 2). Shift all step references:
- `step === 0` (model setup) → `step === 1`
- `step === 1` (channels) → `step === 2`
- `step === 2` (ready) → `step === 3`

**Also update callbacks that set step:**
- In `saveModelConfig`: change `setStep(1)` → `setStep(2)` (currently at ~line 186)
- In `saveChannelConfig`: change `setStep(2)` → `setStep(3)` (currently at ~line 230)
- Update `STEP_NAMES` from 3 items to 4: `["欢迎", "模型配置", "频道配置", "完成"]`

- [ ] **Step 4: Restyle provider selection as card grid**

The existing code uses `PROVIDERS` array (uppercase) with `ProviderOption` objects having `{ id, label }` fields. Restyle the provider buttons:

```tsx
<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
	{PROVIDERS.map((p) => (
		<button
			key={p.id}
			type="button"
			onClick={() => selectProvider(p)}
			className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all card-hover ${
				providerId === p.id
					? "border-primary bg-primary/10"
					: "border-border hover:border-primary/50"
			}`}
		>
			<span className="text-sm font-medium">{p.label}</span>
		</button>
	))}
</div>
```

> **Note:** `selectProvider` takes a `ProviderOption` object (not a string). `providerId` is the current state variable (not `selectedProvider`). `p.label` is the display name (not `p.name`). `ProviderOption` has no `icon` field.

- [ ] **Step 5: Update channel step to step 2 with skip button**

Add skip button to channel config step:

```tsx
{step === 2 && (
	<div className="space-y-6 animate-fade-in-up">
		<div className="flex items-center justify-between">
			<h2 className="text-xl font-bold">频道配置</h2>
			<button
				type="button"
				onClick={() => setStep(3)}
				className="text-sm text-muted-foreground hover:text-foreground transition-colors"
			>
				跳过
			</button>
		</div>
		{/* Existing Telegram + Slack inputs, updated to use shadcn Input */}
	</div>
)}
```

- [ ] **Step 6: Update completion step to step 3**

Restyle the completion step:

```tsx
{step === 3 && (
	<div className="text-center space-y-6 animate-fade-in-up">
		<div className="text-5xl">🎉</div>
		<h2 className="text-2xl font-bold">配置完成！</h2>
		<p className="text-muted-foreground">一切就绪，开始使用 YanClaw</p>
		<Button size="lg" onClick={() => navigate("/")} className="rounded-xl">
			进入应用
		</Button>
	</div>
)}
```

- [ ] **Step 7: Update step count and navigation buttons**

Update total steps from 3 to 4. Add `StepIndicator` at top of the card. Add consistent prev/next buttons at card bottom:

```tsx
<div className="flex justify-between mt-8">
	{step > 0 && step < 3 && (
		<Button variant="outline" onClick={() => setStep(step - 1)} className="rounded-xl">
			上一步
		</Button>
	)}
	{/* Next button rendered per-step with validation */}
</div>
```

- [ ] **Step 7: Wrap in centered card layout**

The whole onboarding should be a centered card:

```tsx
return (
	<div className="min-h-screen flex items-center justify-center bg-background p-4">
		<div className="w-full max-w-lg">
			<StepIndicator current={step} total={4} />
			<div className="bg-card rounded-2xl shadow-warm p-8 border border-border">
				{/* Step content */}
			</div>
		</div>
	</div>
);
```

- [ ] **Step 8: Replace form controls with shadcn/ui Input**

Replace all `<input>` elements with shadcn/ui `<Input>`:

```tsx
import { Input } from "../components/ui/input";
// Replace: <input className="..." />
// With: <Input className="rounded-xl" />
```

- [ ] **Step 9: Verify onboarding flow**

```bash
cd /Users/yzlabmac/ai/yanclaw && bun run dev
```

Visit `/onboarding` and test all 4 steps, including skip on channel step. Verify animations work.

- [ ] **Step 10: Run lint**

```bash
bun run check
```

- [ ] **Step 11: Commit**

```bash
git add packages/web/src/pages/Onboarding.tsx
git commit -m "feat: redesign onboarding with 4-step card wizard and warm theme"
```

---

## Chunk 4: Page Migrations — Settings & Agents

### Task 6: Migrate Settings Page

**Files:**
- Modify: `packages/web/src/pages/Settings.tsx`

- [ ] **Step 1: Add shadcn/ui imports**

```tsx
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { toast } from "sonner";
```

- [ ] **Step 2: Wrap sections in Tabs component**

Replace the current sequential sections layout with Tabs. The 4 existing sections map to 4 tabs:

```tsx
<Tabs defaultValue="providers" className="w-full">
	<TabsList className="grid w-full grid-cols-4 rounded-xl">
		<TabsTrigger value="providers" className="rounded-xl">Providers</TabsTrigger>
		<TabsTrigger value="models" className="rounded-xl">Models</TabsTrigger>
		<TabsTrigger value="agent" className="rounded-xl">Default Agent</TabsTrigger>
		<TabsTrigger value="gateway" className="rounded-xl">Gateway</TabsTrigger>
	</TabsList>
	<TabsContent value="providers">
		{/* Existing providers section content */}
	</TabsContent>
	{/* ... other tabs */}
</Tabs>
```

- [ ] **Step 3: Replace input elements with shadcn Input**

Replace all `<input className="...">` with `<Input className="rounded-xl" />`. Replace all `<select>` with appropriate markup (keep `<select>` for now since shadcn Select requires more restructuring).

- [ ] **Step 4: Replace save feedback with toast**

The current code uses `setStatus("saved")` / `setStatus("error")` with inline `<span>` elements for feedback (lines ~462-467). Replace these with toast:

```tsx
// Remove: setStatus("saved") and the inline status <span>
// Replace with:
toast.success("设置已保存");
// on error:
toast.error("保存失败");
```

Remove the `status` state variable and the inline status display.

- [ ] **Step 5: Update card styling**

Add `rounded-2xl shadow-warm` to section cards. Ensure consistent spacing with `space-y-4` or `space-y-6`.

- [ ] **Step 6: Add page animation class**

Wrap the page content with:

```tsx
<div className="p-6 max-w-4xl mx-auto animate-fade-in-up">
```

- [ ] **Step 7: Verify Settings page**

```bash
cd /Users/yzlabmac/ai/yanclaw && bun run dev
```

Navigate to Settings, test all 4 tabs, save config changes.

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/pages/Settings.tsx
git commit -m "feat: migrate Settings page to shadcn/ui Tabs with toast feedback"
```

### Task 7: Migrate Agents Page

**Files:**
- Modify: `packages/web/src/pages/Agents.tsx`

- [ ] **Step 1: Replace modal with shadcn Dialog**

```tsx
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
```

Replace the custom modal overlay/card. The current state variable is `editing` / `setEditing` (not `editAgent`):

```tsx
<Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
	<DialogContent className="rounded-2xl">
		<DialogHeader>
			<DialogTitle>{editing?.id ? "编辑 Agent" : "新建 Agent"}</DialogTitle>
		</DialogHeader>
		{/* Existing form content */}
	</DialogContent>
</Dialog>
```

- [ ] **Step 2: Convert agent list to card grid**

Replace the list layout with a responsive grid:

```tsx
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
	{agents.map((agent) => (
		<div
			key={agent.id}
			className="bg-card border border-border rounded-2xl p-4 shadow-warm-sm card-hover cursor-pointer"
			onClick={() => setEditing(agent)}
		>
			<h3 className="font-semibold mb-2">{agent.name || agent.id}</h3>
			<div className="flex flex-wrap gap-2">
				<Badge variant="secondary">{agent.model || "default"}</Badge>
				{agent.runtime === "claude-code" && <Badge>Claude Code</Badge>}
			</div>
		</div>
	))}
</div>
```

- [ ] **Step 3: Replace inputs with shadcn Input, alert() with toast, confirm() with AlertDialog**

- Replace all `<input>` and `<textarea>` in the edit form with shadcn/ui components. Keep `<textarea>` for system prompt (multi-line).
- Replace `alert()` calls (lines ~86, 98, 115) with `toast.error(...)`.
- Replace `confirm()` for delete (line ~110) with shadcn AlertDialog:

```tsx
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "../components/ui/alert-dialog";
import { toast } from "sonner";
```

- [ ] **Step 4: Add page animation**

Wrap page content with `animate-fade-in-up` class.

- [ ] **Step 5: Verify Agents page**

```bash
cd /Users/yzlabmac/ai/yanclaw && bun run dev
```

Test create, edit, delete agents. Verify card grid layout and Dialog behavior.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/pages/Agents.tsx
git commit -m "feat: migrate Agents page to card grid with shadcn Dialog"
```

---

## Chunk 5: Page Migrations — Channels, Sessions, Cron

### Task 8: Migrate Channels Page

**Files:**
- Modify: `packages/web/src/pages/Channels.tsx`

- [ ] **Step 1: Add shadcn imports**

```tsx
import { Badge } from "../components/ui/badge";
import { Switch } from "../components/ui/switch";
```

- [ ] **Step 2: Restyle channel items as cards with Badge status and Switch**

Replace list items with cards. Map all 4 connection statuses to Badge variants:

```tsx
const statusBadge = (status: string) => {
	switch (status) {
		case "connected": return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">在线</Badge>;
		case "connecting": return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">连接中</Badge>;
		case "error": return <Badge variant="destructive">错误</Badge>;
		default: return <Badge variant="secondary">离线</Badge>;
	}
};
```

Wrap each channel in a card. Preserve existing functionality (emoji icons from `CHANNEL_ICONS`, `accountId` display, connect/disconnect buttons) and add `Switch` for enable/disable:

```tsx
<div className="bg-card border border-border rounded-2xl p-4 shadow-warm-sm">
	<div className="flex items-center justify-between">
		<div className="flex items-center gap-3">
			<span>{CHANNEL_ICONS[channel.type]}</span>
			<div>
				<span className="font-medium">{channel.type}</span>
				{channel.accountId && <span className="text-sm text-muted-foreground ml-2">{channel.accountId}</span>}
			</div>
			{statusBadge(channel.status)}
		</div>
		<div className="flex items-center gap-3">
			<Switch checked={channel.enabled} onCheckedChange={() => toggleEnabled(channel)} />
			{/* Existing connect/disconnect button */}
		</div>
	</div>
</div>
```

- [ ] **Step 3: Add page animation**

Wrap page content with `animate-fade-in-up` class.

- [ ] **Step 4: Verify Channels page**

Open dev server, navigate to Channels, verify cards render with correct status badges.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/pages/Channels.tsx
git commit -m "feat: migrate Channels page to card layout with status badges"
```

### Task 9: Migrate Sessions Page

**Files:**
- Modify: `packages/web/src/pages/Sessions.tsx`

- [ ] **Step 1: Add shadcn imports**

```tsx
import { Input } from "../components/ui/input";
import {
	Pagination,
	PaginationContent,
	PaginationItem,
	PaginationLink,
	PaginationNext,
	PaginationPrevious,
} from "../components/ui/pagination";
```

- [ ] **Step 2: Replace search input**

Replace the search `<input>` with shadcn Input + search icon:

```tsx
import { Search } from "lucide-react";

<div className="relative">
	<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
	<Input
		placeholder="搜索会话..."
		value={search}
		onChange={(e) => setSearch(e.target.value)}
		className="pl-9 rounded-xl"
	/>
</div>
```

- [ ] **Step 3: Update session list item styling**

Add hover highlight to session list items. The current code navigates on click via `navigate()` (no selected state needed):

```tsx
<div
	className="p-3 rounded-xl cursor-pointer transition-colors hover:bg-muted/50"
	onClick={() => openSession(session)}
>
```

- [ ] **Step 4: Replace pagination with shadcn Pagination**

The current code uses custom prev/next buttons with `page` state (lines ~225-247). Replace with shadcn Pagination:

```tsx
<Pagination>
	<PaginationContent>
		<PaginationItem>
			<PaginationPrevious
				onClick={() => setPage(Math.max(1, page - 1))}
				className={page <= 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
			/>
		</PaginationItem>
		{Array.from({ length: totalPages }, (_, i) => (
			<PaginationItem key={i + 1}>
				<PaginationLink
					onClick={() => setPage(i + 1)}
					isActive={page === i + 1}
					className="cursor-pointer"
				>
					{i + 1}
				</PaginationLink>
			</PaginationItem>
		))}
		<PaginationItem>
			<PaginationNext
				onClick={() => setPage(Math.min(totalPages, page + 1))}
				className={page >= totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
			/>
		</PaginationItem>
	</PaginationContent>
</Pagination>
```

- [ ] **Step 5: Replace agent filter select**

Replace the agent filter `<select>` (lines ~142-157) with shadcn Input or keep as `<select>` with consistent styling for now.

- [ ] **Step 6: Add page animation**

Wrap content with `animate-fade-in-up`.

- [ ] **Step 7: Verify Sessions page**

Test search, pagination, session list hover.

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/pages/Sessions.tsx
git commit -m "feat: migrate Sessions page to shadcn Input and Pagination"
```

### Task 10: Migrate Cron Page

**Files:**
- Modify: `packages/web/src/pages/Cron.tsx`

- [ ] **Step 1: Add shadcn imports**

```tsx
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Switch } from "../components/ui/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "../components/ui/table";
import { toast } from "sonner";
```

- [ ] **Step 2: Replace task list with Table component**

Replace the current list/card layout with a proper Table. **Note:** The `CronTask` interface uses `id` (not `name`), `nextRunAt` (not `nextRun`), and `lastRunAt`. Preserve existing functionality including mode badge, agent name, prompt preview, running spinner, and all action buttons:

```tsx
<Table>
	<TableHeader>
		<TableRow>
			<TableHead>任务 ID</TableHead>
			<TableHead>模式</TableHead>
			<TableHead>调度</TableHead>
			<TableHead>Agent</TableHead>
			<TableHead>状态</TableHead>
			<TableHead>下次运行</TableHead>
			<TableHead>操作</TableHead>
		</TableRow>
	</TableHeader>
	<TableBody>
		{tasks.map((task) => (
			<TableRow key={task.id}>
				<TableCell className="font-medium">{task.id}</TableCell>
				<TableCell><Badge variant="outline">{task.mode}</Badge></TableCell>
				<TableCell className="font-mono text-sm">{task.schedule}</TableCell>
				<TableCell>{task.agentId}</TableCell>
				<TableCell>
					<Switch checked={task.enabled} onCheckedChange={() => toggleEnabled(task.id)} />
				</TableCell>
				<TableCell>{task.nextRunAt ? new Date(task.nextRunAt).toLocaleString() : "—"}</TableCell>
				<TableCell>
					{/* Existing action buttons: run, edit, delete */}
				</TableCell>
			</TableRow>
		))}
	</TableBody>
</Table>
```

- [ ] **Step 3: Replace modal with shadcn Dialog**

Replace custom modal with `<Dialog>`. Use same pattern as Agents page — use the existing state variable for edit mode (check current code for variable name, likely `editing` / `setEditing`).

- [ ] **Step 4: Replace inputs with shadcn Input, checkbox with Switch**

- Update all form `<input>` elements in the edit dialog to shadcn `<Input>`.
- Replace the "Enabled" checkbox in the form with `<Switch>`.
- Replace `alert()` calls with `toast.error(...)`.

- [ ] **Step 5: Add page animation**

Wrap content with `animate-fade-in-up`.

- [ ] **Step 6: Verify Cron page**

Test create, edit, delete, toggle, run tasks.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/pages/Cron.tsx
git commit -m "feat: migrate Cron page to shadcn Table and Dialog"
```

---

## Chunk 6: Polish & Final Verification

### Task 11: Update Button Styles

**Files:**
- Modify: `packages/web/src/components/ui/button.tsx`

- [ ] **Step 1: Update button default radius and transition**

In the button CVA config (`button.tsx:7`), replace `rounded-md` with `rounded-xl` in the base class. Also replace `transition-[color,box-shadow]` with `transition-all` and add hover scale. Also update size variants: replace `rounded-md` in `sm` and `lg` size variants (lines ~22-23) with `rounded-xl`:

```tsx
const buttonVariants = cva(
	"inline-flex items-center justify-center ... rounded-xl transition-all hover:scale-[1.02]",
	{
		variants: {
			size: {
				sm: "h-8 rounded-xl gap-1.5 px-3 ...",
				lg: "h-10 rounded-xl px-6 ...",
				// ...
			}
		}
	}
);
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/ui/button.tsx
git commit -m "style: update button component with warm theme radius and hover effect"
```

### Task 12: Full Integration Verification

- [ ] **Step 1: Run lint and type check**

```bash
cd /Users/yzlabmac/ai/yanclaw && bun run check
```

Fix any errors.

- [ ] **Step 2: Run tests**

```bash
bun run test
```

Fix any failures.

- [ ] **Step 3: Visual smoke test**

Start dev server, manually verify each page:
- [ ] Sidebar collapses and expands correctly
- [ ] Theme toggle works (system/light/dark) with warm colors
- [ ] Onboarding 4-step flow with skip on channels
- [ ] Chat page (prompt-kit) renders correctly (unchanged)
- [ ] Settings tabs work, save shows toast
- [ ] Agents card grid and Dialog edit
- [ ] Channels status badges
- [ ] Sessions search and pagination
- [ ] Cron table and Dialog

- [ ] **Step 4: Build check**

```bash
bun run build
```

Ensure production build succeeds.

- [ ] **Step 5: Final commit (if any fixes)**

```bash
git add -u
git commit -m "fix: address lint and build issues from UI migration"
```
