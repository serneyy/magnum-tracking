import { describe, expect, it } from 'vitest';
import { firstForwardedIp, verifyShopifyAppProxyRequest } from '../src/core/shopifyProxy.js';

describe('Shopify App Proxy verification', () => {
  it('accepts a valid signature including repeated query values', () => {
    const rawUrl = '/proxy/e?extra=1&extra=2&shop=example.myshopify.com&logged_in_customer_id=1&path_prefix=%2Fapps%2Fmagnum&timestamp=1700000000&signature=fd5bf507d92fcb639bb6add8077816af3b5329edf6937e4c338bf75c83dd1f37';

    const verified = verifyShopifyAppProxyRequest(rawUrl, 'hush', {
      nowMs: 1_700_000_000_000,
      maxAgeSeconds: 5,
    });

    expect(verified).toEqual({
      shop: 'example.myshopify.com',
      loggedInCustomerId: '1',
      pathPrefix: '/apps/magnum',
      timestamp: 1700000000,
    });
  });

  it('rejects a tampered signed request', () => {
    const rawUrl = '/proxy/e?shop=example.myshopify.com&timestamp=1700000000&signature=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    expect(
      verifyShopifyAppProxyRequest(rawUrl, 'hush', {
        nowMs: 1_700_000_000_000,
      }),
    ).toBeNull();
  });

  it('rejects stale requests', () => {
    const rawUrl = '/proxy/e?extra=1&extra=2&shop=example.myshopify.com&logged_in_customer_id=1&path_prefix=%2Fapps%2Fmagnum&timestamp=1700000000&signature=fd5bf507d92fcb639bb6add8077816af3b5329edf6937e4c338bf75c83dd1f37';
    expect(
      verifyShopifyAppProxyRequest(rawUrl, 'hush', {
        nowMs: 1_800_000_000_000,
        maxAgeSeconds: 300,
      }),
    ).toBeNull();
  });

  it('selects the first forwarded client IP', () => {
    expect(firstForwardedIp('203.0.113.10, 10.0.0.1')).toBe('203.0.113.10');
  });
});
