import { describe, expect, it } from 'vitest';
import {
  buildFbc,
  matchKeyPresence,
  metaUserData,
  normalizeEmail,
  normalizePhone,
} from '../src/core/identity.js';
import { deterministicEventId } from '../src/core/meta.js';

describe('Magnum identity primitives', () => {
  it('normalizes email before hashing', () => {
    expect(normalizeEmail('  Test@Example.COM ')).toBe('test@example.com');
  });

  it('normalizes phone to digits without inventing a country code', () => {
    expect(normalizePhone('+421 903 123 456')).toBe('421903123456');
  });

  it('builds a Meta fbc value from fbclid using milliseconds', () => {
    expect(buildFbc('abc123', 1_700_000_000_000)).toBe('fb.1.1700000000000.abc123');
  });

  it('generates stable event ids for deduplication', () => {
    expect(deterministicEventId(['purchase', '1001'])).toBe(deterministicEventId(['purchase', '1001']));
    expect(deterministicEventId(['purchase', '1001'])).not.toBe(deterministicEventId(['purchase', '1002']));
  });

  it('builds a full advanced-matching CAPI user_data payload', () => {
    const identity = {
      visitor_id: 'mg_v_12345678',
      session_id: 'mg_s_12345678',
      customer_id: 'shopify_customer_42',
      email: ' Test@Example.COM ',
      phone: '+421 903 123 456',
      first_name: ' Daniel ',
      last_name: ' Example ',
      city: ' Bratislava ',
      state: ' Bratislavsky kraj ',
      postal_code: '811 01',
      country: 'SK',
      first_touch: {
        fbc: 'fb.1.1700000000000.click',
        fbp: 'fb.1.1700000000000.browser',
        captured_at: 1,
      },
    };

    const data = metaUserData(identity, '203.0.113.10', 'Mozilla/5.0');

    expect(data.em).toHaveLength(1);
    expect(data.ph).toHaveLength(1);
    expect(data.fn).toHaveLength(1);
    expect(data.ln).toHaveLength(1);
    expect(data.ct).toHaveLength(1);
    expect(data.st).toHaveLength(1);
    expect(data.zp).toHaveLength(1);
    expect(data.country).toHaveLength(1);
    expect(data.external_id).toHaveLength(2);
    expect(data.fbc).toBe('fb.1.1700000000000.click');
    expect(data.fbp).toBe('fb.1.1700000000000.browser');
    expect(data.client_ip_address).toBe('203.0.113.10');
    expect(data.client_user_agent).toBe('Mozilla/5.0');

    expect(matchKeyPresence(identity, '203.0.113.10', 'Mozilla/5.0')).toEqual({
      em: true,
      ph: true,
      fn: true,
      ln: true,
      ct: true,
      st: true,
      zp: true,
      country: true,
      external_id: true,
      fbc: true,
      fbp: true,
      client_ip_address: true,
      client_user_agent: true,
    });
  });
});
