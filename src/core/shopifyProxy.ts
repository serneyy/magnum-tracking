import { createHmac, timingSafeEqual } from 'node:crypto';

export type VerifiedShopifyProxy = {
  shop: string;
  loggedInCustomerId?: string;
  pathPrefix?: string;
  timestamp: number;
};

/**
 * Verify Shopify App Proxy query authentication from the raw request URL.
 *
 * Shopify signs the query parameters (excluding `signature`) by grouping
 * repeated values with commas, sorting the resulting `key=value` strings,
 * concatenating them without separators and applying HMAC-SHA256 with the
 * app shared secret.
 */
export function verifyShopifyAppProxyRequest(
  rawUrl: string,
  sharedSecret: string,
  options: { nowMs?: number; maxAgeSeconds?: number } = {},
): VerifiedShopifyProxy | null {
  if (!sharedSecret) return null;

  const url = new URL(rawUrl, 'https://magnum.invalid');
  const suppliedSignature = url.searchParams.get('signature');
  if (!suppliedSignature || !/^[a-f0-9]{64}$/i.test(suppliedSignature)) return null;

  const grouped = new Map<string, string[]>();
  for (const [key, value] of url.searchParams.entries()) {
    if (key === 'signature') continue;
    const values = grouped.get(key) ?? [];
    values.push(value);
    grouped.set(key, values);
  }

  const canonical = [...grouped.entries()]
    .map(([key, values]) => `${key}=${values.join(',')}`)
    .sort()
    .join('');

  const expectedSignature = createHmac('sha256', sharedSecret)
    .update(canonical)
    .digest('hex');

  const suppliedBuffer = Buffer.from(suppliedSignature.toLowerCase(), 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');

  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    return null;
  }

  const shop = url.searchParams.get('shop')?.trim().toLowerCase();
  const timestampRaw = url.searchParams.get('timestamp');
  const timestamp = timestampRaw ? Number(timestampRaw) : NaN;

  if (!shop || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) return null;
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;

  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);
  const maxAgeSeconds = options.maxAgeSeconds ?? 300;
  if (Math.abs(nowSeconds - timestamp) > maxAgeSeconds) return null;

  const loggedInCustomerId = url.searchParams.get('logged_in_customer_id') || undefined;
  const pathPrefix = url.searchParams.get('path_prefix') || undefined;

  return {
    shop,
    loggedInCustomerId,
    pathPrefix,
    timestamp,
  };
}

/**
 * Shopify places the browser IP in X-Forwarded-For for App Proxy requests.
 * Only use this after the request signature has been verified.
 */
export function firstForwardedIp(value?: string): string | undefined {
  return value
    ?.split(',')
    .map((part) => part.trim())
    .find(Boolean);
}
