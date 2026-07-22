const LEGAL_SUFFIXES = [
  "limited",
  "ltd",
  "llc",
  "l.l.c",
  "bv",
  "b.v",
  "gmbh",
  "ag",
  "plc",
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "holding",
  "holdings",
];

export function normaliseCompanyName(value: string): string {
  let normalized = value
    .normalize("NFKD")
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
  const suffix = new RegExp(`\\s+(?:${LEGAL_SUFFIXES.join("|")})$`, "i");
  while (suffix.test(normalized))
    normalized = normalized.replace(suffix, "").trim();
  return normalized;
}

export function normaliseDomain(value?: string): string | undefined {
  if (!value?.trim()) return undefined;
  const input = value.includes("://") ? value : `https://${value}`;
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error(`Invalid company domain: ${value}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
    throw new Error("Company domains must use HTTP or HTTPS.");
  const hostname = parsed.hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.$/, "");
  if (!hostname.includes(".") || !/^[a-z0-9.-]+$/.test(hostname))
    throw new Error(`Invalid public company domain: ${value}`);
  return hostname;
}

export function canonicalisePublicUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("Only HTTP and HTTPS URLs are supported.");
  url.hash = "";
  url.username = "";
  url.password = "";
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}
