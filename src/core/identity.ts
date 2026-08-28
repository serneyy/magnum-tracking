import { createHash, randomUUID } from 'node:crypto';

export type Touchpoint = {
  url?: string;
  referrer?: string;
  fbclid?: string;
  fbc?: string;
  fbp?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  captured_at: number;
};

export type Identity = {
  visitor_id: string;
  session_id: string;
  cart_token?: string;
  checkout_token?: string;
  customer_id?: string;
  email?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  first_touch?: Touchpoint;
  last_touch?: Touchpoint;
};

export function newVisitorId(): string {
  return `mg_v_${randomUUID()}`;
}

export function newSessionId(): string {
  return `mg_s_${randomUUID()}`;
}

export function normalizeEmail(value?: string): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

/**
 * Meta expects the phone match key to contain digits including country code.
 * Magnum deliberately does not guess a missing country code here. Production
 * order ingestion should canonicalize local numbers with the Shopify country
 * before calling this function.
 */
export function normalizePhone(value?: string): string | undefined {
  const normalized = value?.replace(/\D/g, '');
  return normalized || undefined;
}

export function normalizeLower(value?: string): string | undefined {
  const normalized = value?.normalize('NFKC').trim().toLowerCase();
  return normalized || undefined;
}

export function normalizeCountry(value?: string): string | undefined {
  const normalized = normalizeLower(value);
  if (!normalized) return undefined;
  return normalized.length === 2 ? normalized : undefined;
}

export function sha256(value?: string): string | undefined {
  if (!value) return undefined;
  return createHash('sha256').update(value).digest('hex');
}

export function buildFbc(fbclid?: string, timestampMs = Date.now()): string | undefined {
  if (!fbclid) return undefined;

  // Meta's fbc format uses the click/cookie creation timestamp in milliseconds.
  // Keep this value stable for a captured click instead of rebuilding it later.
  return `fb.1.${Math.floor(timestampMs)}.${fbclid}`;
}

export function mergeTouchpoint(identity: Identity, touch: Touchpoint): Identity {
  return {
    ...identity,
    first_touch: identity.first_touch ?? touch,
    last_touch: touch,
  };
}

/**
 * Build Meta Conversions API customer information parameters.
 *
 * Hash before transmission:
 * - email, phone, name, city, state, postal code, country
 * - external IDs
 *
 * Send raw as required by Meta:
 * - fbc, fbp
 * - client IP address
 * - client user agent
 *
 * We intentionally do not synthesize DOB, gender, fbc or any other match key.
 * Missing legitimate data is better than fabricated matching data.
 */
export function metaUserData(identity: Identity, clientIp?: string, userAgent?: string) {
  const em = sha256(normalizeEmail(identity.email));
  const ph = sha256(normalizePhone(identity.phone));
  const fn = sha256(normalizeLower(identity.first_name));
  const ln = sha256(normalizeLower(identity.last_name));
  const ct = sha256(normalizeLower(identity.city));
  const st = sha256(normalizeLower(identity.state));
  const zp = sha256(normalizeLower(identity.postal_code));
  const country = sha256(normalizeCountry(identity.country));

  // Keep a stable merchant/customer identity when available, while also
  // preserving Magnum's long-lived visitor ID as a second deterministic key.
  // Session IDs are intentionally excluded because they are ephemeral.
  const externalIds = uniqueDefined([
    sha256(identity.customer_id),
    sha256(identity.visitor_id),
  ]);

  return compact({
    em: em ? [em] : undefined,
    ph: ph ? [ph] : undefined,
    fn: fn ? [fn] : undefined,
    ln: ln ? [ln] : undefined,
    ct: ct ? [ct] : undefined,
    st: st ? [st] : undefined,
    zp: zp ? [zp] : undefined,
    country: country ? [country] : undefined,
    external_id: externalIds.length ? externalIds : undefined,
    fbc: identity.last_touch?.fbc || identity.first_touch?.fbc,
    fbp: identity.last_touch?.fbp || identity.first_touch?.fbp,
    client_ip_address: clientIp,
    client_user_agent: userAgent,
  });
}

/**
 * Diagnostics only. This lets Magnum explain why a Purchase has strong or weak
 * matching without pretending that Meta publishes an exact per-field formula.
 */
export function matchKeyPresence(identity: Identity, clientIp?: string, userAgent?: string) {
  const userData = metaUserData(identity, clientIp, userAgent);

  return {
    em: Boolean(userData.em),
    ph: Boolean(userData.ph),
    fn: Boolean(userData.fn),
    ln: Boolean(userData.ln),
    ct: Boolean(userData.ct),
    st: Boolean(userData.st),
    zp: Boolean(userData.zp),
    country: Boolean(userData.country),
    external_id: Boolean(userData.external_id),
    fbc: Boolean(userData.fbc),
    fbp: Boolean(userData.fbp),
    client_ip_address: Boolean(userData.client_ip_address),
    client_user_agent: Boolean(userData.client_user_agent),
  };
}

function uniqueDefined(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function compact<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined)) as T;
}
