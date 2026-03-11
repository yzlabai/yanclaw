import { Menu, X } from "lucide-react";
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
import { API_BASE, apiFetch } from "./lib/api";
import { isTauri, startGateway } from "./lib/tauri";
import { Agents } from "./pages/Agents";
import { Channels } from "./pages/Channels";
import { Chat } from "./pages/Chat";
import { Cron } from "./pages/Cron";
import { Onboarding } from "./pages/Onboarding";
import { Sessions } from "./pages/Sessions";
import { Settings } from "./pages/Settings";

function SetupGuard({ children }: { children: React.ReactNode }) {
	const location = useLocation();
	const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);

	useEffect(() => {
		const init = async () => {
			// Auto-start gateway server in Tauri mode
			if (isTauri()) {
				try {
					await startGateway();
				} catch {
					// Gateway may already be running
				}
				// Wait for server to be ready
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
			apiFetch(`${API_BASE}/api/system/setup`)
				.then((r) => r.json())
				.then((data: { needsSetup: boolean }) => setNeedsSetup(data.needsSetup))
				.catch(() => setNeedsSetup(false));
		};
		init();
	}, []);

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
	{ to: "/", label: "Chat" },
	{ to: "/channels", label: "Channels" },
	{ to: "/sessions", label: "Sessions" },
	{ to: "/cron", label: "Cron" },
	{ to: "/agents", label: "Agents" },
	{ to: "/settings", label: "Settings" },
];

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
	`px-3 py-2 rounded-lg transition-colors ${isActive ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`;

function AppLayout() {
	const [drawerOpen, setDrawerOpen] = useState(false);
	const { pathname } = useLocation();

	// Close drawer on navigation — pathname is the trigger
	const prevPathRef = useRef(pathname);
	if (prevPathRef.current !== pathname) {
		prevPathRef.current = pathname;
		if (drawerOpen) setDrawerOpen(false);
	}

	return (
		<div className="flex h-screen bg-background text-foreground">
			{/* Desktop sidebar — hidden on mobile */}
			<nav className="hidden md:flex w-56 border-r border-border p-4 flex-col gap-2">
				<h1 className="text-xl font-bold mb-4">YanClaw</h1>
				{NAV_ITEMS.map((item) => (
					<NavLink key={item.to} to={item.to} end={item.to === "/"} className={navLinkClass}>
						{item.label}
					</NavLink>
				))}
				<div className="mt-auto pt-2 border-t border-border">
					<ThemeToggle />
				</div>
			</nav>

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
				{NAV_ITEMS.map((item) => (
					<NavLink key={item.to} to={item.to} end={item.to === "/"} className={navLinkClass}>
						{item.label}
					</NavLink>
				))}
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
						<Route path="/cron" element={<Cron />} />
						<Route path="/agents" element={<Agents />} />
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
