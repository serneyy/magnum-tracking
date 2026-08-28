import { describe, expect, it } from 'vitest';
import { firstForwardedIp, verifyShopifyAppProxyRequest } from '../src/core/shopifyProxy.js';

describe('Shopify App Proxy verification', () => {
  it('accepts Shopify documentation signature including repeated query values', () => {
    const rawUrl = '/proxy/extra/path/components?extra=1&extra=2&shop=example.myshopify.com&logged_in_customer_id=1&path_prefix=%2Fapps%2Fawesome_reviews&timestamp=1317327555&signature=4c68c8624d737112c91818c11017d24d334b524cb5c2b8ba08daa056f7395ddb';

    const verified = verifyShopifyAppProxyRequest(rawUrl, 'hush', {
      nowMs: 1_317_327_555_000,
      maxAgeSeconds: 5,
    });

    expect(verified).toEqual({
      shop: 'example.myshopify.com',
      loggedInCustomerId: '1',
      pathPrefix: '/apps/awesome_reviews',
      timestamp: 1317327555,
    });
  });

  it('rejects a tampered signed request', () => {
    const rawUrl = '/proxy?shop=example.myshopify.com&timestamp=1700000000&signature=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    expect(
      verifyShopifyAppProxyRequest(rawUrl, 'hush', {
        nowMs: 1_700_000_000_000,
      }),
    ).toBeNull();
  });

  it('rejects stale requests even if signature validation would otherwise be considered', () => {
    const rawUrl = '/proxy/extra/path/components?extra=1&extra=2&shop=example.myshopify.com&logged_in_customer_id=1&path_prefix=%2Fapps%2Fawesome_reviews&timestamp=1317327555&signature=4c68c8624d737112c91818c11017d24d334b524cb5c2b8ba08daa056f7395ddb';
    expect(
      verifyShopifyAppProxyRequest(rawUrl, 'hush', {
        nowMs: 1_700_000_000_000,
        maxAgeSeconds: 300,
      }),
    ).toBeNull();
  });

  it('selects the first forwarded client IP', () => {
    expect(firstForwardedIp('203.0.113.10, 10.0.0.1')).toBe('203.0.113.10');
  });
});
