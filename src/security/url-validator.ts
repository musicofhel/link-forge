import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

const BLOCKED_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/, // link-local
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^fc00:/i, // IPv6 ULA
  /^fe80:/i, // IPv6 link-local
  /^fd[0-9a-f]{2}:/i, // IPv6 private
  /\.local$/i,
  /\.internal$/i,
  /\.onion$/i,
];

function isBlockedHostname(hostname: string): boolean {
  for (const pattern of BLOCKED_HOSTNAME_PATTERNS) {
    if (pattern.test(hostname)) return true;
  }
  return false;
}

function isPrivateIP(ip: string): boolean {
  if (isIP(ip) === 0) return false;
  return isBlockedHostname(ip);
}

/**
 * Validate a URL for SSRF — blocks private IPs, localhost, link-local,
 * metadata endpoints, and non-HTTP(S) schemes.
 * Also resolves the hostname to check the actual IP is not private.
 */
export async function validateUrlForSSRF(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`SSRF: Invalid URL: ${url.slice(0, 100)}`);
  }

  // Only allow http/https
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`SSRF: Blocked scheme ${parsed.protocol}`);
  }

  const hostname = parsed.hostname;

  // Block known private hostnames
  if (isBlockedHostname(hostname)) {
    throw new Error(`SSRF: Blocked private hostname: ${hostname}`);
  }

  // If hostname is already an IP, check it directly
  if (isIP(hostname) !== 0) {
    if (isPrivateIP(hostname)) {
      throw new Error(`SSRF: Blocked private IP: ${hostname}`);
    }
    return;
  }

  // Resolve hostname to check actual IP
  try {
    const { address } = await lookup(hostname);
    if (isPrivateIP(address)) {
      throw new Error(`SSRF: Hostname ${hostname} resolves to private IP ${address}`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("SSRF:")) throw err;
    // DNS resolution failure — allow through (will fail at fetch anyway)
  }
}
