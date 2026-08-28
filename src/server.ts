import express from 'express';
import { z } from 'zod';
import type { Identity } from './core/identity.js';
import { deterministicEventId, sendMetaEvent } from './core/meta.js';

const app = express();
app.use(express.json({ limit: '256kb', type: ['application/json', 'text/plain'] }));

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

const identifySchema = z.object({
  visitor_id: z.string().min(8),
  session_id: z.string().min(8),
  cart_token: z.string().optional(),
  checkout_token: z.string().optional(),
  customer_id: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  first_touch: touchSchema.optional(),
  last_touch: touchSchema.optional(),
});

app.get('/health', (_req, res) => res.json({ ok: true, service: 'magnum' }));

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
  customer_id: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  contents: z.array(z.object({ id: z.string(), quantity: z.number().positive(), item_price: z.number().nonnegative().optional() })).optional(),
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

const port = Number(process.env.PORT || 8787);
app.listen(port, () => console.log(`Magnum listening on :${port}`));
