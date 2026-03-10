import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { API_BASE, apiFetch } from "./lib/api";
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
		apiFetch(`${API_BASE}/api/system/setup`)
			.then((r) => r.json())
			.then((data: { needsSetup: boolean }) => setNeedsSetup(data.needsSetup))
			.catch(() => setNeedsSetup(false));
	}, []);

	if (needsSetup === null) return null; // loading

	if (needsSetup && location.pathname !== "/onboarding") {
		return <Navigate to="/onboarding" replace />;
	}

	// Redirect away from onboarding if setup is already done
	if (!needsSetup && location.pathname === "/onboarding") {
		return <Navigate to="/" replace />;
	}

	return <>{children}</>;
}

export function App() {
	return (
		<BrowserRouter>
			<SetupGuard>
				<div className="flex h-screen bg-gray-950 text-gray-100">
					<nav className="w-56 border-r border-gray-800 p-4 flex flex-col gap-2">
						<h1 className="text-xl font-bold mb-4 text-white">YanClaw</h1>
						<NavLink
							to="/"
							className={({ isActive }) =>
								`px-3 py-2 rounded-lg transition-colors ${isActive ? "bg-gray-800 text-white" : "text-gray-400 hover:text-white hover:bg-gray-800/50"}`
							}
						>
							Chat
						</NavLink>
						<NavLink
							to="/channels"
							className={({ isActive }) =>
								`px-3 py-2 rounded-lg transition-colors ${isActive ? "bg-gray-800 text-white" : "text-gray-400 hover:text-white hover:bg-gray-800/50"}`
							}
						>
							Channels
						</NavLink>
						<NavLink
							to="/sessions"
							className={({ isActive }) =>
								`px-3 py-2 rounded-lg transition-colors ${isActive ? "bg-gray-800 text-white" : "text-gray-400 hover:text-white hover:bg-gray-800/50"}`
							}
						>
							Sessions
						</NavLink>
						<NavLink
							to="/cron"
							className={({ isActive }) =>
								`px-3 py-2 rounded-lg transition-colors ${isActive ? "bg-gray-800 text-white" : "text-gray-400 hover:text-white hover:bg-gray-800/50"}`
							}
						>
							Cron
						</NavLink>
						<NavLink
							to="/agents"
							className={({ isActive }) =>
								`px-3 py-2 rounded-lg transition-colors ${isActive ? "bg-gray-800 text-white" : "text-gray-400 hover:text-white hover:bg-gray-800/50"}`
							}
						>
							Agents
						</NavLink>
						<NavLink
							to="/settings"
							className={({ isActive }) =>
								`px-3 py-2 rounded-lg transition-colors ${isActive ? "bg-gray-800 text-white" : "text-gray-400 hover:text-white hover:bg-gray-800/50"}`
							}
						>
							Settings
						</NavLink>
					</nav>
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
			</SetupGuard>
		</BrowserRouter>
	);
}
