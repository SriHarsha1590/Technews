import { lookup } from "node:dns/promises";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { isIP } from "node:net";

type Address = { address: string; family: number };
export interface SafeFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  userAgent?: string;
  /** DNS and transport adapters allow controlled network fixtures at this public boundary. */
  resolve?: (hostname: string) => Promise<Address[]>;
  request?: typeof httpsRequest;
  /** Optional policy for every hop, including the original URL. */
  isAllowed?: (url: URL) => boolean;
}

function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99)))
      return false;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (isIP(address) !== 6) return false;
  const lower = address.toLowerCase();
  if (lower.includes(".")) return false; // IPv4-mapped and transition forms are not needed for article hosts.
  const first = Number.parseInt(lower.split(":")[0], 16);
  if (!(first >= 0x2000 && first <= 0x3fff)) return false;
  if (first === 0x2001) {
    const second = Number.parseInt(lower.split(":")[1] || "0", 16);
    if (
      second < 0x200 ||
      second === 0xdb8 ||
      (second >= 0x20 && second <= 0x2f)
    )
      return false;
  }
  if (first === 0x2002 || first === 0x3fff) return false;
  return true;
}

function readPage(
  url: URL,
  address: Address,
  options: SafeFetchOptions,
  statusOnly: boolean,
): Promise<{
  status: number;
  location?: string;
  html: string;
  contentType: string;
}> {
  let deadline: NodeJS.Timeout | undefined;
  return new Promise<{
    status: number;
    location?: string;
    html: string;
    contentType: string;
  }>((resolve, reject) => {
    const reqOptions: RequestOptions = {
      headers: { "User-Agent": options.userAgent ?? "TechNews/1.0" },
      timeout: options.timeoutMs ?? 15_000,
      lookup: (_host, lookupOptions, callback) => {
        // Node's automatic family selection asks for all addresses. Return the
        // pinned address in that callback shape as well as the scalar shape.
        if (typeof lookupOptions === "object" && lookupOptions.all) {
          callback(null, [address]);
        } else {
          callback(null, address.address, address.family);
        }
      },
    };
    const req = (options.request ?? httpsRequest)(url, reqOptions, (res) => {
      if (statusOnly) {
        resolve({
          status: res.statusCode ?? 0,
          location:
            typeof res.headers.location === "string"
              ? res.headers.location
              : undefined,
          contentType: "",
          html: "",
        });
        res.destroy();
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      const cap = options.maxBytes ?? 1_000_000;
      res.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > cap) {
          req.destroy();
          reject(new Error("HTML body exceeds byte cap"));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          location:
            typeof res.headers.location === "string"
              ? res.headers.location
              : undefined,
          contentType: String(res.headers["content-type"] ?? ""),
          html: Buffer.concat(chunks).toString("utf8"),
        }),
      );
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("HTML request timed out")));
    req.on("error", reject);
    deadline = setTimeout(
      () => req.destroy(new Error("HTML request timed out")),
      options.timeoutMs ?? 15_000,
    );
    req.end();
  }).finally(() => clearTimeout(deadline));
}

async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions,
  statusOnly: boolean,
): Promise<{
  status: number;
  finalUrl: string;
  html: string;
  contentType: string;
} | null> {
  try {
    let current = new URL(rawUrl);
    const seen = new Set<string>();
    for (
      let redirects = 0;
      redirects <= (options.maxRedirects ?? 5);
      redirects++
    ) {
      if (
        current.protocol !== "https:" ||
        current.username ||
        current.password ||
        seen.has(current.href) ||
        (options.isAllowed && !options.isAllowed(current))
      )
        return null;
      seen.add(current.href);
      const addresses = isIP(current.hostname)
        ? [{ address: current.hostname, family: isIP(current.hostname) }]
        : await (
            options.resolve ?? ((hostname) => lookup(hostname, { all: true }))
          )(current.hostname);
      if (
        !addresses.length ||
        addresses.some(({ address }) => !publicAddress(address))
      )
        return null;
      const result = await readPage(current, addresses[0], options, statusOnly);
      if ([301, 302, 303, 307, 308].includes(result.status)) {
        if (!result.location) return null;
        current = new URL(result.location, current);
        continue;
      }
      return { ...result, finalUrl: current.toString() };
    }
  } catch {
    // Malformed URLs, DNS failures, timeouts, and oversized responses are treated as unavailable pages.
  }
  return null;
}

/** Fetch bounded HTML only from validated public HTTPS destinations. Errors return an empty page. */
export async function safeFetchHtml(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<string> {
  const result = await safeFetch(rawUrl, options, false);
  return result &&
    result.status >= 200 &&
    result.status < 300 &&
    /(?:^|\s|;)text\/html(?:\s|;|$)/i.test(result.contentType)
    ? result.html
    : "";
}

/** Fetch a bounded RSS/Atom document through the same validated network path. */
export async function safeFetchFeed(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<string> {
  const result = await safeFetch(
    rawUrl,
    { maxBytes: 2_000_000, ...options },
    false,
  );
  return result &&
    result.status >= 200 &&
    result.status < 300 &&
    /^(?:application\/(?:rss\+xml|atom\+xml|rdf\+xml|xml)|text\/(?:xml|plain))(?:;|\s|$)/i.test(
      result.contentType,
    )
    ? result.html
    : "";
}

/** Check an HTTPS destination without reading its body. Every redirect is revalidated. */
export async function safeFetchStatus(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<{ status: number; finalUrl: string } | null> {
  const result = await safeFetch(rawUrl, options, true);
  return result && { status: result.status, finalUrl: result.finalUrl };
}
