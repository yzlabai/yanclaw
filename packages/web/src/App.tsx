import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import { Chat } from "./pages/Chat";
import { Settings } from "./pages/Settings";
import { Channels } from "./pages/Channels";

export function App() {
	return (
		<BrowserRouter>
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
						<Route path="/settings" element={<Settings />} />
					</Routes>
				</main>
			</div>
		</BrowserRouter>
	);
}
