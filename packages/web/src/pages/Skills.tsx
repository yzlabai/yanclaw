import {
	AlertTriangle,
	ChevronDown,
	ChevronRight,
	Download,
	Lock,
	Package,
	Search,
	Shield,
	Trash2,
	Wrench,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { API_BASE, apiFetch } from "../lib/api";

interface SkillConfigField {
	type: string;
	default?: unknown;
	description?: string;
	enum?: unknown[];
}

interface SkillInfo {
	id: string;
	name: string;
	version: string;
	description: string;
	author?: string;
	tags: string[];
	icon?: string;
	capabilities: string[];
	isolated: boolean;
	ownerOnly: boolean;
	tools: string[];
	requires: { env: string[]; bins: string[] };
	config: Record<string, SkillConfigField>;
	loaded: boolean;
	enabled: boolean;
	warnings: string[];
	agents: string[];
	userConfig: Record<string, unknown>;
}

export function Skills() {
	const [skills, setSkills] = useState<SkillInfo[]>([]);
	const [loading, setLoading] = useState(true);
	const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
	const [promptPreview, setPromptPreview] = useState<Record<string, string | null>>({});
	const [showInstall, setShowInstall] = useState(false);
	const [installSource, setInstallSource] = useState<"local" | "git" | "npm">("git");
	const [installUrl, setInstallUrl] = useState("");
	const [installRef, setInstallRef] = useState("");
	const [installing, setInstalling] = useState(false);
	const [filter, setFilter] = useState("");

	const fetchSkills = useCallback(() => {
		apiFetch(`${API_BASE}/api/skills`)
			.then((r) => (r.ok ? r.json() : Promise.reject()))
			.then((data: SkillInfo[]) => {
				if (Array.isArray(data)) setSkills(data);
			})
			.catch(() => {})
			.finally(() => setLoading(false));
	}, []);

	useEffect(() => {
		fetchSkills();
	}, [fetchSkills]);

	const toggleSkill = async (skillId: string, enabled: boolean) => {
		await apiFetch(`${API_BASE}/api/skills/${skillId}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ enabled }),
		});
		fetchSkills();
	};

	const uninstallSkill = async (skillId: string) => {
		if (!confirm(`确定要卸载 "${skillId}" 吗？`)) return;
		await apiFetch(`${API_BASE}/api/skills/${skillId}`, { method: "DELETE" });
		fetchSkills();
	};

	const installSkill = async () => {
		if (!installUrl.trim()) return;
		setInstalling(true);
		try {
			const resp = await apiFetch(`${API_BASE}/api/skills/install`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					source: installSource,
					url: installUrl.trim(),
					ref: installRef.trim() || undefined,
				}),
			});
			const data = await resp.json();
			if (resp.ok) {
				setShowInstall(false);
				setInstallUrl("");
				setInstallRef("");
				fetchSkills();
				alert(data.message);
			} else {
				alert(data.error || "安装失败");
			}
		} finally {
			setInstalling(false);
		}
	};

	const loadPromptPreview = async (skillId: string) => {
		if (promptPreview[skillId] !== undefined) return;
		const resp = await apiFetch(`${API_BASE}/api/skills/${skillId}/prompt`);
		const data = await resp.json();
		setPromptPreview((prev) => ({ ...prev, [skillId]: data.prompt }));
	};

	const toggleExpand = (skillId: string) => {
		if (expandedSkill === skillId) {
			setExpandedSkill(null);
		} else {
			setExpandedSkill(skillId);
			loadPromptPreview(skillId);
		}
	};

	const filtered = skills.filter(
		(s) =>
			!filter ||
			s.name.toLowerCase().includes(filter.toLowerCase()) ||
			s.id.toLowerCase().includes(filter.toLowerCase()) ||
			s.tags.some((t) => t.toLowerCase().includes(filter.toLowerCase())),
	);

	if (loading) {
		return (
			<div className="flex items-center justify-center h-full text-muted-foreground">加载中...</div>
		);
	}

	return (
		<div className="h-full overflow-y-auto p-6">
			<div className="max-w-4xl mx-auto space-y-6">
				{/* Header */}
				<div className="flex items-center justify-between">
					<h1 className="text-2xl font-bold">Skills</h1>
					<Button onClick={() => setShowInstall(!showInstall)} size="sm">
						<Download className="h-4 w-4 mr-2" />
						安装
					</Button>
				</div>

				{/* Install dialog */}
				{showInstall && (
					<div className="border border-border rounded-xl p-4 space-y-3 bg-card">
						<h3 className="font-semibold">安装 Skill</h3>
						<div className="flex gap-2">
							{(["local", "git", "npm"] as const).map((src) => (
								<button
									key={src}
									type="button"
									onClick={() => setInstallSource(src)}
									className={`px-3 py-1 rounded-lg text-sm transition-colors ${
										installSource === src
											? "bg-primary text-primary-foreground"
											: "bg-muted text-muted-foreground hover:text-foreground"
									}`}
								>
									{src === "local" ? "本地路径" : src === "git" ? "Git URL" : "npm 包"}
								</button>
							))}
						</div>
						<input
							type="text"
							value={installUrl}
							onChange={(e) => setInstallUrl(e.target.value)}
							placeholder={
								installSource === "local"
									? "/path/to/skill"
									: installSource === "git"
										? "https://github.com/user/skill.git"
										: "package-name"
							}
							className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm"
						/>
						{installSource !== "local" && (
							<input
								type="text"
								value={installRef}
								onChange={(e) => setInstallRef(e.target.value)}
								placeholder={installSource === "git" ? "分支/标签 (可选)" : "版本 (可选)"}
								className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm"
							/>
						)}
						<div className="flex gap-2 justify-end">
							<Button variant="ghost" size="sm" onClick={() => setShowInstall(false)}>
								取消
							</Button>
							<Button size="sm" onClick={installSkill} disabled={installing || !installUrl.trim()}>
								{installing ? "安装中..." : "安装"}
							</Button>
						</div>
					</div>
				)}

				{/* Search */}
				<div className="relative">
					<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
					<input
						type="text"
						value={filter}
						onChange={(e) => setFilter(e.target.value)}
						placeholder="搜索 skills..."
						className="w-full pl-10 pr-4 py-2 rounded-xl bg-muted/50 border border-border text-sm"
					/>
				</div>

				{/* Skills list */}
				{filtered.length === 0 ? (
					<div className="text-center py-12 text-muted-foreground">
						<Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
						<p>{skills.length === 0 ? "尚未安装任何 Skill" : "没有匹配的 Skill"}</p>
						<p className="text-sm mt-1">
							Skills 安装到 <code className="text-xs">~/.yanclaw/skills/</code>
						</p>
					</div>
				) : (
					<div className="space-y-3">
						{filtered.map((skill) => (
							<div
								key={skill.id}
								className="border border-border rounded-xl overflow-hidden bg-card"
							>
								{/* Skill card header */}
								<button
									type="button"
									onClick={() => toggleExpand(skill.id)}
									className="w-full flex items-center gap-3 p-4 hover:bg-muted/30 transition-colors text-left"
								>
									{expandedSkill === skill.id ? (
										<ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
									) : (
										<ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
									)}

									<span className="text-lg">{skill.icon || "🧩"}</span>

									<div className="flex-1 min-w-0">
										<div className="flex items-center gap-2">
											<span className="font-medium">{skill.name}</span>
											<span className="text-xs text-muted-foreground">v{skill.version}</span>
											{skill.ownerOnly && <Lock className="h-3 w-3 text-yellow-500" />}
											{skill.isolated && <Shield className="h-3 w-3 text-blue-500" />}
										</div>
										<p className="text-sm text-muted-foreground truncate">{skill.description}</p>
									</div>

									{/* Status badge */}
									{skill.enabled ? (
										<Badge className="bg-green-500/20 text-green-400 border-green-500/30 shrink-0">
											启用
										</Badge>
									) : (
										<Badge variant="secondary" className="shrink-0">
											禁用
										</Badge>
									)}
								</button>

								{/* Warnings */}
								{skill.warnings.length > 0 && (
									<div className="px-4 pb-2">
										{skill.warnings.map((w) => (
											<div key={w} className="flex items-center gap-1 text-xs text-yellow-500">
												<AlertTriangle className="h-3 w-3" />
												{w}
											</div>
										))}
									</div>
								)}

								{/* Expanded detail */}
								{expandedSkill === skill.id && (
									<div className="border-t border-border p-4 space-y-4 bg-muted/10">
										{/* Tools */}
										{skill.tools.length > 0 && (
											<div>
												<h4 className="text-xs font-semibold text-muted-foreground uppercase mb-1">
													Tools
												</h4>
												<div className="flex flex-wrap gap-1">
													{skill.tools.map((t) => (
														<Badge key={t} variant="outline" className="text-xs">
															<Wrench className="h-3 w-3 mr-1" />
															{skill.id}.{t}
														</Badge>
													))}
												</div>
											</div>
										)}

										{/* Capabilities */}
										{skill.capabilities.length > 0 && (
											<div>
												<h4 className="text-xs font-semibold text-muted-foreground uppercase mb-1">
													Capabilities
												</h4>
												<div className="flex flex-wrap gap-1">
													{skill.capabilities.map((cap) => (
														<Badge key={cap} variant="secondary" className="text-xs">
															{cap}
														</Badge>
													))}
												</div>
											</div>
										)}

										{/* Config fields */}
										{Object.keys(skill.config).length > 0 && (
											<div>
												<h4 className="text-xs font-semibold text-muted-foreground uppercase mb-1">
													配置
												</h4>
												<div className="space-y-1 text-sm">
													{Object.entries(skill.config).map(([key, field]) => (
														<div key={key} className="flex items-center gap-2">
															<code className="text-xs bg-muted px-1 rounded">{key}</code>
															<span className="text-muted-foreground text-xs">
																{field.description || field.type}
															</span>
															{field.default !== undefined && (
																<span className="text-xs text-muted-foreground">
																	(默认: {String(field.default)})
																</span>
															)}
														</div>
													))}
												</div>
											</div>
										)}

										{/* Prompt preview */}
										{promptPreview[skill.id] && (
											<div>
												<h4 className="text-xs font-semibold text-muted-foreground uppercase mb-1">
													Prompt 预览
												</h4>
												<pre className="text-xs bg-muted/50 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
													{promptPreview[skill.id]}
												</pre>
											</div>
										)}

										{/* Tags */}
										{skill.tags.length > 0 && (
											<div className="flex flex-wrap gap-1">
												{skill.tags.map((tag) => (
													<Badge key={tag} variant="outline" className="text-xs">
														{tag}
													</Badge>
												))}
											</div>
										)}

										{/* Security info */}
										<div className="flex items-center gap-4 text-xs text-muted-foreground">
											{skill.author && <span>Author: {skill.author}</span>}
											{skill.isolated && <span>🔒 Worker 隔离</span>}
											{skill.ownerOnly && <span>🔒 仅 Owner</span>}
											{!skill.loaded && <span className="text-yellow-500">未加载 (需重启)</span>}
										</div>

										{/* Actions */}
										<div className="flex gap-2 pt-2 border-t border-border">
											<Button
												size="sm"
												variant={skill.enabled ? "secondary" : "default"}
												onClick={() => toggleSkill(skill.id, !skill.enabled)}
											>
												{skill.enabled ? "禁用" : "启用"}
											</Button>
											<Button
												size="sm"
												variant="destructive"
												onClick={() => uninstallSkill(skill.id)}
											>
												<Trash2 className="h-3 w-3 mr-1" />
												卸载
											</Button>
										</div>
									</div>
								)}
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
