import { Languages } from "lucide-react";
import { type Locale, useI18n } from "../i18n";

const LOCALES: { value: Locale; label: string }[] = [
	{ value: "zh", label: "中文" },
	{ value: "en", label: "EN" },
];

export function LanguageToggle() {
	const { locale, setLocale, t } = useI18n();

	const cycle = () => {
		setLocale(locale === "zh" ? "en" : "zh");
	};

	const current = LOCALES.find((l) => l.value === locale) ?? LOCALES[0];

	return (
		<button
			type="button"
			onClick={cycle}
			className="flex items-center gap-2 px-3 py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors text-sm"
			title={t("language.label")}
		>
			<Languages className="h-4 w-4" />
			<span>{current.label}</span>
		</button>
	);
}
