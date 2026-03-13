import { createContext, useCallback, useContext, useEffect, useState } from "react";
import en from "./locales/en.json";
import zh from "./locales/zh.json";

export type Locale = "zh" | "en";

const messages: Record<Locale, Record<string, unknown>> = { zh, en };

function getNestedValue(obj: unknown, path: string): string {
	const keys = path.split(".");
	let current: unknown = obj;
	for (const key of keys) {
		if (current == null || typeof current !== "object") return path;
		current = (current as Record<string, unknown>)[key];
	}
	return typeof current === "string" ? current : path;
}

function detectLocale(): Locale {
	const stored = localStorage.getItem("yanclaw_locale") as Locale | null;
	if (stored && stored in messages) return stored;
	const browserLang = navigator.language.toLowerCase();
	if (browserLang.startsWith("zh")) return "zh";
	return "en";
}

interface I18nContextValue {
	locale: Locale;
	setLocale: (locale: Locale) => void;
	t: (key: string) => string;
}

const I18nContext = createContext<I18nContextValue>({
	locale: "zh",
	setLocale: () => {},
	t: (key) => key,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
	const [locale, setLocaleState] = useState<Locale>(detectLocale);

	const setLocale = useCallback((l: Locale) => {
		setLocaleState(l);
		localStorage.setItem("yanclaw_locale", l);
		document.documentElement.lang = l;
	}, []);

	useEffect(() => {
		document.documentElement.lang = locale;
	}, [locale]);

	const t = useCallback((key: string) => getNestedValue(messages[locale], key), [locale]);

	return <I18nContext.Provider value={{ locale, setLocale, t }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
	return useContext(I18nContext);
}
