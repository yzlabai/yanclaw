import {
	Bot,
	Clock,
	History,
	Menu,
	MessageSquare,
	PanelLeftClose,
	PanelLeftOpen,
	Plug,
	Puzzle,
	Radio,
	Settings as SettingsIcon,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	BrowserRouter,
	HashRouter,
	Navigate,
	NavLink,
	Route,
	Routes,
	useLocation,
} from "react-router-dom";
import { Toaster } from "sonner";
import { ThemeToggle } from "./components/theme-toggle";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip";
import { API_BASE, apiFetch } from "./lib/api";
import { isTauri, startGateway } from "./lib/tauri";
import { Agents } from "./pages/Agents";
import { Channels } from "./pages/Channels";
import { Chat } from "./pages/Chat";
import { Cron } from "./pages/Cron";
import { McpServers } from "./pages/McpServers";
import { Onboarding } from "./pages/Onboarding";
import { Sessions } from "./pages/Sessions";
import { Settings } from "./pages/Settings";
import { Skills } from "./pages/Skills";

function SetupGuard({ children }: { children: React.ReactNode }) {
	const location = useLocation();
	const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
	const [gatewayReady, setGatewayReady] = useState(false);

	// One-time: start gateway in Tauri mode and wait for it to be ready
	useEffect(() => {
		const init = async () => {
			if (isTauri()) {
				try {
					await startGateway();
				} catch {
					// Gateway may already be running
				}
				for (let i = 0; i < 20; i++) {
					try {
						const r = await fetch(`${API_BASE}/api/system/setup`);
						if (r.ok) break;
					} catch {
						// not ready yet
					}
					await new Promise((r) => setTimeout(r, 500));
				}
			}
			setGatewayReady(true);
		};
		init();
	}, []);

	// Re-check setup status whenever pathname changes (e.g. after onboarding completes)
	useEffect(() => {
		if (!gatewayReady) return;
		apiFetch(`${API_BASE}/api/system/setup`)
			.then((r) => r.json())
			.then((data: { needsSetup: boolean }) => setNeedsSetup(data.needsSetup))
			.catch(() => setNeedsSetup(false));
	}, [gatewayReady]);

	if (needsSetup === null) return null; // loading

	if (needsSetup && location.pathname !== "/onboarding") {
		return <Navigate to="/onboarding" replace />;
	}

	if (!needsSetup && location.pathname === "/onboarding") {
		return <Navigate to="/" replace />;
	}

	return <>{children}</>;
}

const NAV_ITEMS = [
	{ to: "/", label: "聊天", icon: MessageSquare },
	{ to: "/sessions", label: "会话", icon: History },
	{ to: "/agents", label: "Agent", icon: Bot },
	{ to: "/channels", label: "频道", icon: Radio },
	{ to: "/skills", label: "Skills", icon: Puzzle },
	{ to: "/mcp", label: "MCP", icon: Plug },
	{ to: "/cron", label: "定时任务", icon: Clock },
	{ to: "/settings", label: "设置", icon: SettingsIcon },
];

function AppLayout() {
	const [drawerOpen, setDrawerOpen] = useState(false);
	const { pathname } = useLocation();

	const [collapsed, setCollapsed] = useState(() => {
		return localStorage.getItem("yanclaw_sidebar_collapsed") === "true";
	});

	const toggleCollapsed = () => {
		setCollapsed((prev) => {
			localStorage.setItem("yanclaw_sidebar_collapsed", String(!prev));
			return !prev;
		});
	};

	// Close drawer on navigation — pathname is the trigger
	const prevPathRef = useRef(pathname);
	if (prevPathRef.current !== pathname) {
		prevPathRef.current = pathname;
		if (drawerOpen) setDrawerOpen(false);
	}

	return (
		<div className="flex h-screen bg-background text-foreground">
			{/* Desktop sidebar — hidden on mobile */}
			<TooltipProvider delayDuration={0}>
				<nav
					className={`hidden md:flex flex-col gap-1 border-r border-border p-3 transition-[width] duration-200 ease-out ${
						collapsed ? "w-14" : "w-56"
					}`}
				>
					{!collapsed && <h1 className="text-lg font-bold mb-3 px-2">YanClaw</h1>}

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

					<div className="mt-auto pt-2 border-t border-border flex flex-col gap-1">
						{!collapsed && <ThemeToggle />}
						<button
							type="button"
							onClick={toggleCollapsed}
							className="flex items-center justify-center p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
						>
							{collapsed ? (
								<PanelLeftOpen className="h-5 w-5" />
							) : (
								<PanelLeftClose className="h-5 w-5" />
							)}
						</button>
					</div>
				</nav>
			</TooltipProvider>

			{/* Mobile drawer overlay */}
			{drawerOpen && (
				<div
					className="fixed inset-0 bg-black/50 z-40 md:hidden"
					onClick={() => setDrawerOpen(false)}
					onKeyDown={(e) => e.key === "Escape" && setDrawerOpen(false)}
					role="presentation"
				/>
			)}

			{/* Mobile drawer */}
			<nav
				className={`fixed inset-y-0 left-0 w-64 bg-background border-r border-border p-4 flex flex-col gap-2 z-50 transition-transform duration-200 md:hidden ${
					drawerOpen ? "translate-x-0" : "-translate-x-full"
				}`}
			>
				<div className="flex items-center justify-between mb-4">
					<h1 className="text-xl font-bold">YanClaw</h1>
					<button
						type="button"
						onClick={() => setDrawerOpen(false)}
						className="p-1 text-muted-foreground hover:text-foreground"
					>
						<X className="h-5 w-5" />
					</button>
				</div>
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
				<div className="mt-auto pt-2 border-t border-border">
					<ThemeToggle />
				</div>
			</nav>

			{/* Main content */}
			<div className="flex-1 flex flex-col overflow-hidden">
				{/* Mobile top bar */}
				<div className="md:hidden flex items-center gap-3 border-b border-border px-4 py-2">
					<button
						type="button"
						onClick={() => setDrawerOpen(true)}
						className="p-1 text-muted-foreground hover:text-foreground"
					>
						<Menu className="h-5 w-5" />
					</button>
					<span className="text-sm font-semibold">YanClaw</span>
				</div>

				<main className="flex-1 overflow-hidden">
					<Routes>
						<Route path="/" element={<Chat />} />
						<Route path="/channels" element={<Channels />} />
						<Route path="/sessions" element={<Sessions />} />
						<Route path="/mcp" element={<McpServers />} />
						<Route path="/cron" element={<Cron />} />
						<Route path="/agents" element={<Agents />} />
						<Route path="/skills" element={<Skills />} />
						<Route path="/settings" element={<Settings />} />
						<Route path="/onboarding" element={<Onboarding />} />
					</Routes>
				</main>
			</div>
		</div>
	);
}

export function App() {
	const Router = isTauri() ? HashRouter : BrowserRouter;
	return (
		<Router>
			<SetupGuard>
				<AppLayout />
			</SetupGuard>
			<Toaster position="bottom-right" />
		</Router>
	);
}
