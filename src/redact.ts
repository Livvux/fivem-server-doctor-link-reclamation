const secretPatterns: RegExp[] = [
  /\bcfxk_[A-Za-z0-9_-]+_[A-Za-z0-9_-]+\b/g,
  /\bsv_licenseKey\s+["']?[^"'\s]+["']?/gi,
  /\b(mysql|mariadb):\/\/[^@\s]+@/gi,
  /\b(password|passwd|pwd|token|secret|apikey|api_key)\s*[:=]\s*["']?[^"',\s]+["']?/gi,
  /\bx-txadmin-envtoken\s*[:=]\s*["']?[^"',\s]+["']?/gi,
];

export function redact(value: string): string {
  return secretPatterns.reduce(
    (text, pattern) => text.replace(pattern, (match) => maskMatch(match)),
    value,
  );
}

export function redactJson(value: unknown): unknown {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map((item) => redactJson(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactJson(item)]),
    );
  }
  return value;
}

function maskMatch(match: string): string {
  const separator = match.match(/[:=]/)?.[0];
  if (!separator) return "[redacted]";
  return `${match.slice(0, match.indexOf(separator) + 1)}[redacted]`;
}
