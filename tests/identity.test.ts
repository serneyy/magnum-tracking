import { describe, expect, it } from 'vitest';
import { buildFbc, metaUserData, normalizeEmail } from '../src/core/identity.js';
import { deterministicEventId } from '../src/core/meta.js';

describe('Magnum identity primitives', () => {
  it('normalizes email before hashing', () => {
    expect(normalizeEmail('  Test@Example.COM ')).toBe('test@example.com');
  });

  it('builds a Meta fbc value from fbclid', () => {
    expect(buildFbc('abc123', 1_700_000_000_000)).toBe('fb.1.1700000000.abc123');
  });

  it('generates stable event ids for deduplication', () => {
    expect(deterministicEventId(['purchase', '1001'])).toBe(deterministicEventId(['purchase', '1001']));
    expect(deterministicEventId(['purchase', '1001'])).not.toBe(deterministicEventId(['purchase', '1002']));
  });

  it('uses persisted fbc/fbp in Meta user_data', () => {
    const data = metaUserData({
      visitor_id: 'mg_v_12345678',
      session_id: 'mg_s_12345678',
      email: 'test@example.com',
      first_touch: { fbc: 'fb.1.1.click', fbp: 'fb.1.1.browser', captured_at: 1 },
    });

    expect(data.fbc).toBe('fb.1.1.click');
    expect(data.fbp).toBe('fb.1.1.browser');
    expect(data.em).toHaveLength(1);
    expect(data.external_id).toHaveLength(1);
  });
});
