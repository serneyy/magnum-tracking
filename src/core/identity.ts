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

export function normalizePhone(value?: string): string | undefined {
  const normalized = value?.replace(/[^\d+]/g, '');
  return normalized || undefined;
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

export function metaUserData(identity: Identity, clientIp?: string, userAgent?: string) {
  const em = sha256(normalizeEmail(identity.email));
  const ph = sha256(normalizePhone(identity.phone));
  const external = sha256(identity.customer_id || identity.visitor_id);

  return compact({
    em: em ? [em] : undefined,
    ph: ph ? [ph] : undefined,
    external_id: external ? [external] : undefined,
    fbc: identity.last_touch?.fbc || identity.first_touch?.fbc,
    fbp: identity.last_touch?.fbp || identity.first_touch?.fbp,
    client_ip_address: clientIp,
    client_user_agent: userAgent,
  });
}

function compact<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined)) as T;
}
