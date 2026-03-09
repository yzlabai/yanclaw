export function Settings() {
	return (
		<div className="p-6">
			<h2 className="text-lg font-semibold mb-4">Settings</h2>
			<div className="space-y-6 max-w-xl">
				<div>
					<label className="block text-sm text-gray-400 mb-1">
						Anthropic API Key
					</label>
					<input
						type="password"
						placeholder="sk-ant-..."
						className="w-full bg-gray-800 rounded-lg px-4 py-2 text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-blue-500"
					/>
				</div>
				<div>
					<label className="block text-sm text-gray-400 mb-1">
						OpenAI API Key
					</label>
					<input
						type="password"
						placeholder="sk-..."
						className="w-full bg-gray-800 rounded-lg px-4 py-2 text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-blue-500"
					/>
				</div>
				<div>
					<label className="block text-sm text-gray-400 mb-1">
						Gateway Port
					</label>
					<input
						type="number"
						defaultValue={18789}
						className="w-full bg-gray-800 rounded-lg px-4 py-2 text-white outline-none focus:ring-2 focus:ring-blue-500"
					/>
				</div>
			</div>
		</div>
	);
}
