const SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
	{ pattern: /Bearer\s+[A-Za-z0-9._~+/=-]+/gi, replacement: "Bearer [REDACTED]" },
	{ pattern: /(access_token|refresh_token|id_token)=[^&\s]+/gi, replacement: "$1=[REDACTED]" },
	{ pattern: /(authorization|proxy-authorization)\s*:\s*[^\n]+/gi, replacement: "$1: [REDACTED]" },
	{ pattern: /(x-goog-api-key|api-key|apikey)\s*:\s*[^\n]+/gi, replacement: "$1: [REDACTED]" },
	{ pattern: /("?(token|access|refresh|secret|password)"?\s*:\s*")([^"]+)(")/gi, replacement: "$1[REDACTED]$4" },
	{ pattern: /\bprojects\/[A-Za-z0-9-]{4,}\b/g, replacement: "projects/[REDACTED]" },
];

export function redactText(input: string): string {
	let value = input;
	for (const rule of SECRET_PATTERNS) {
		value = value.replace(rule.pattern, rule.replacement);
	}
	return value;
}

export function redactUnknown<T>(value: T): T {
	if (typeof value === "string") {
		return redactText(value) as T;
	}
	if (Array.isArray(value)) {
		return value.map((item) => redactUnknown(item)) as T;
	}
	if (!value || typeof value !== "object") {
		return value;
	}

	const obj = value as Record<string, unknown>;
	const result: Record<string, unknown> = {};
	for (const [key, fieldValue] of Object.entries(obj)) {
		if (/token|secret|password|authorization|cookie/i.test(key)) {
			result[key] = "[REDACTED]";
			continue;
		}
		result[key] = redactUnknown(fieldValue);
	}
	return result as T;
}
