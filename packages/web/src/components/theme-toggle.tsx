import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "../i18n";

type Theme = "system" | "light" | "dark";

function getStoredTheme(): Theme {
	return (localStorage.getItem("yanclaw_theme") as Theme) ?? "system";
}

function applyTheme(theme: Theme) {
	const root = document.documentElement;
	if (theme === "system") {
		root.removeAttribute("data-theme");
		root.classList.remove("light", "dark");
	} else {
		root.setAttribute("data-theme", theme);
		root.classList.remove("light", "dark");
		root.classList.add(theme);
	}
}

export function ThemeToggle() {
	const [theme, setTheme] = useState<Theme>(getStoredTheme);
	const { t } = useI18n();

	useEffect(() => {
		applyTheme(theme);
		localStorage.setItem("yanclaw_theme", theme);
	}, [theme]);

	const cycle = () => {
		setTheme((prev) => {
			if (prev === "system") return "light";
			if (prev === "light") return "dark";
			return "system";
		});
	};

	const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
	const label = t(`theme.${theme}`);

	return (
		<button
			type="button"
			onClick={cycle}
			className="flex items-center gap-2 px-3 py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors text-sm"
			title={label}
		>
			<Icon className="h-4 w-4" />
			<span>{label}</span>
		</button>
	);
}
