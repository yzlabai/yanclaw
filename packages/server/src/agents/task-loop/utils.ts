/** 截断保留尾部 N 行 */
export function truncateTail(text: string, maxLines: number): string {
	const lines = text.split("\n");
	if (lines.length <= maxLines) return text;
	return `... (truncated ${lines.length - maxLines} lines)\n${lines.slice(-maxLines).join("\n")}`;
}
