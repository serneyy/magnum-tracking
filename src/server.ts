import express from 'express';
import { z } from 'zod';
import type { Identity, Touchpoint } from './core/identity.js';
import { deterministicEventId, sendMetaEvent } from './core/meta.js';
import { firstForwardedIp, verifyShopifyAppProxyRequest } from './core/shopifyProxy.js';

const app = express();
app.use(express.json({ limit: '256kb', type: ['application/json', 'text/plain'] }));

// Prototype-only storage. Production moves this to PostgreSQL and scopes every
// identity by shop domain. Do not deploy the in-memory model as production state.
const identities = new Map<string, Identity>();

const touchSchema = z.object({
  url: z.string().optional(),
  referrer: z.string().optional(),
  fbclid: z.string().optional(),
  fbc: z.string().optional(),
  fbp: z.string().optional(),
  utm_source: z.string().optional(),
  utm_medium: z.string().optional(),
  utm_campaign: z.string().optional(),
  utm_content: z.string().optional(),
  utm_term: z.string().optional(),
  captured_at: z.number(),
});

const nullableTouchSchema = z.object({
  url: z.string().nullable().optional(),
  referrer: z.string().nullable().optional(),
  fbclid: z.string().nullable().optional(),
  fbc: z.string().nullable().optional(),
  fbp: z.string().nullable().optional(),
  utm_source: z.string().nullable().optional(),
  utm_medium: z.string().nullable().optional(),
  utm_campaign: z.string().nullable().optional(),
  utm_content: z.string().nullable().optional(),
  utm_term: z.string().nullable().optional(),
  captured_at: z.number(),
});

const customerMatchSchema = {
  customer_id: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postal_code: z.string().optional(),
  country: z.string().length(2).optional(),
};

const identifySchema = z.object({
  visitor_id: z.string().min(8),
  session_id: z.string().min(8),
  cart_token: z.string().optional(),
  checkout_token: z.string().optional(),
  ...customerMatchSchema,
  first_touch: touchSchema.optional(),
  last_touch: touchSchema.optional(),
});

const proxyEnvelopeSchema = z.object({
  schema_version: z.literal(1),
  source: z.literal('shopify_app_proxy_storefront'),
  collector_version: z.string().min(1).max(32),
  sent_at: z.string().min(1),
  identity: z.object({
    mg_visitor_id: z.string().min(8).max(128),
    mg_session_id: z.string().min(8).max(128),
    cart_token: z.string().max(512).nullable().optional(),
  }),
  meta: z.object({
    fbclid: z.string().max(2048).nullable().optional(),
    fbc: z.string().max(4096).nullable().optional(),
    fbp: z.string().max(4096).nullable().optional(),
  }),
  attribution: z.object({
    current: nullableTouchSchema,
    first: nullableTouchSchema,
    last: nullableTouchSchema,
  }),
  consent: z.object({
    analytics_processing_allowed: z.boolean(),
    marketing_allowed: z.boolean(),
    preferences_processing_allowed: z.boolean().optional(),
    sale_of_data_allowed: z.boolean().optional(),
    consent_id: z.string().nullable().optional(),
    region: z.string().nullable().optional(),
  }).nullable(),
  event: z.object({
    name: z.string().min(1).max(64),
    url: z.string().max(8192).nullable().optional(),
    referrer: z.string().max(8192).nullable().optional(),
    title: z.string().max(1024).nullable().optional(),
    user_agent: z.string().max(4096).nullable().optional(),
    cart: z.unknown().nullable().optional(),
  }).passthrough(),
});

app.get('/health', (_req, res) => res.json({ ok: true, service: 'magnum' }));

app.post('/proxy/e', (req, res) => {
  const sharedSecret = process.env.SHOPIFY_APP_SECRET;
  if (!sharedSecret) return res.status(503).json({ error: 'shopify_proxy_not_configured' });

  const verified = verifyShopifyAppProxyRequest(req.originalUrl, sharedSecret, {
    maxAgeSeconds: 300,
  });
  if (!verified) return res.status(401).json({ error: 'invalid_shopify_proxy_signature' });

  const parsed = proxyEnvelopeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  if (
    parsed.data.consent &&
    (!parsed.data.consent.analytics_processing_allowed ||
      !parsed.data.consent.marketing_allowed)
  ) {
    return res.status(403).json({ error: 'marketing_processing_not_allowed' });
  }

  const data = parsed.data;
  const visitorId = data.identity.mg_visitor_id;
  const current = identities.get(visitorId);

  const firstTouch = toTouchpoint(data.attribution.first);
  const lastTouch = toTouchpoint(data.attribution.last);

  const merged: Identity = {
    ...current,
    visitor_id: visitorId,
    session_id: data.identity.mg_session_id,
    cart_token: data.identity.cart_token ?? current?.cart_token,
    customer_id: verified.loggedInCustomerId ?? current?.customer_id,
    first_touch: current?.first_touch ?? firstTouch,
    last_touch: lastTouch ?? current?.last_touch,
  };

  identities.set(visitorId, merged);

  const clientIp = firstForwardedIp(req.get('x-forwarded-for'));

  return res.status(202).json({
    ok: true,
    shop: verified.shop,
    logged_in_customer_id: verified.loggedInCustomerId ?? null,
    client_ip_present: Boolean(clientIp),
  });
});

app.post('/v1/identify', (req, res) => {
  const parsed = identifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const incoming = parsed.data;
  const current = identities.get(incoming.visitor_id);
  const merged: Identity = {
    ...current,
    ...incoming,
    first_touch: current?.first_touch ?? incoming.first_touch,
    last_touch: incoming.last_touch ?? current?.last_touch,
  };

  identities.set(incoming.visitor_id, merged);
  return res.status(202).json({ ok: true });
});

const purchaseSchema = z.object({
  order_id: z.string().min(1),
  visitor_id: z.string().min(8),
  value: z.number().nonnegative(),
  currency: z.string().length(3),
  source_url: z.string().optional(),
  ...customerMatchSchema,
  contents: z.array(z.object({
    id: z.string(),
    quantity: z.number().positive(),
    item_price: z.number().nonnegative().optional(),
  })).optional(),
});

app.post('/v1/purchase', async (req, res) => {
  const parsed = purchaseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const data = parsed.data;
  const current = identities.get(data.visitor_id);
  if (!current) return res.status(409).json({ error: 'identity_not_found' });

  const identity: Identity = {
    ...current,
    customer_id: data.customer_id ?? current.customer_id,
    email: data.email ?? current.email,
    phone: data.phone ?? current.phone,
    first_name: data.first_name ?? current.first_name,
    last_name: data.last_name ?? current.last_name,
    city: data.city ?? current.city,
    state: data.state ?? current.state,
    postal_code: data.postal_code ?? current.postal_code,
    country: data.country ?? current.country,
  };

  identities.set(data.visitor_id, identity);

  const pixelId = process.env.META_PIXEL_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;
  if (!pixelId || !accessToken) return res.status(503).json({ error: 'meta_not_configured' });

  const eventId = deterministicEventId(['purchase', data.order_id]);
  try {
    const result = await sendMetaEvent(
      {
        pixelId,
        accessToken,
        apiVersion: process.env.META_API_VERSION,
        testEventCode: process.env.META_TEST_EVENT_CODE,
      },
      {
        eventName: 'Purchase',
        eventId,
        eventTime: Math.floor(Date.now() / 1000),
        eventSourceUrl: data.source_url || identity.last_touch?.url,
        identity,
        clientIp: req.ip,
        userAgent: req.get('user-agent'),
        customData: {
          currency: data.currency.toUpperCase(),
          value: data.value,
          order_id: data.order_id,
          contents: data.contents,
          content_type: data.contents?.length ? 'product' : undefined,
        },
      },
    );
    return res.status(202).json({ ok: true, event_id: eventId, meta: result });
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : 'meta_send_failed' });
  }
});

function toTouchpoint(
  value: z.infer<typeof nullableTouchSchema> | undefined,
): Touchpoint | undefined {
  if (!value) return undefined;

  return {
    captured_at: value.captured_at,
    url: value.url ?? undefined,
    referrer: value.referrer ?? undefined,
    fbclid: value.fbclid ?? undefined,
    fbc: value.fbc ?? undefined,
    fbp: value.fbp ?? undefined,
    utm_source: value.utm_source ?? undefined,
    utm_medium: value.utm_medium ?? undefined,
    utm_campaign: value.utm_campaign ?? undefined,
    utm_content: value.utm_content ?? undefined,
    utm_term: value.utm_term ?? undefined,
  };
}

const port = Number(process.env.PORT || 8787);
app.listen(port, () => console.log(`Magnum listening on :${port}`));
