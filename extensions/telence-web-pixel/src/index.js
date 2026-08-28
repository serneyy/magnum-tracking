import { register } from "@shopify/web-pixels-extension";

register(async ({ analytics, browser, init, settings }) => {
  const version = "0.1.0";
  const visitorKey = "tl_vid";
  const sessionKey = "tl_sid";
  const firstTouchKey = "tl_first_touch";
  const lastTouchKey = "tl_last_touch";

  const randomId = (prefix) => {
    try {
      if (globalThis.crypto?.randomUUID) return `${prefix}_${globalThis.crypto.randomUUID()}`;
    } catch {}
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  };

  const localGet = async (key) => { try { return await browser.localStorage.getItem(key); } catch { return null; } };
  const localSet = async (key, value) => { try { await browser.localStorage.setItem(key, value); } catch {} };
  const sessionGet = async (key) => { try { return await browser.sessionStorage.getItem(key); } catch { return null; } };
  const sessionSet = async (key, value) => { try { await browser.sessionStorage.setItem(key, value); } catch {} };
  const cookieGet = async (key) => { try { return (await browser.cookie.get(key)) || null; } catch { return null; } };

  const visitorId = async () => {
    let value = await localGet(visitorKey);
    if (!value) { value = randomId("tl_v"); await localSet(visitorKey, value); }
    return value;
  };

  const sessionId = async () => {
    let value = await sessionGet(sessionKey);
    if (!value) { value = randomId("tl_s"); await sessionSet(sessionKey, value); }
    return value;
  };

  const parseJson = (value) => { try { return value ? JSON.parse(value) : null; } catch { return null; } };
  const eventUrl = (event) => event?.context?.document?.location?.href || init?.context?.document?.location?.href || "";
  const eventReferrer = (event) => event?.context?.document?.referrer || init?.context?.document?.referrer || "";

  const touchState = async (event) => {
    const urlString = eventUrl(event);
    let parsed;
    try { parsed = new URL(urlString); } catch { parsed = null; }
    const previousFirst = parseJson(await localGet(firstTouchKey));
    const previousLast = parseJson(await localGet(lastTouchKey));
    const fbclid = parsed?.searchParams.get("fbclid") || null;
    const cookieFbc = await cookieGet("_fbc");
    const fbp = await cookieGet("_fbp");
    let fbc = cookieFbc;

    if (fbclid) {
      if (previousLast?.fbclid === fbclid && previousLast?.fbc) fbc = previousLast.fbc;
      else if (!(cookieFbc && cookieFbc.endsWith(`.${fbclid}`))) fbc = `fb.1.${Date.now()}.${fbclid}`;
    }

    const current = {
      url: urlString,
      referrer: eventReferrer(event),
      fbclid,
      fbc: fbc || null,
      fbp: fbp || null,
      utm_source: parsed?.searchParams.get("utm_source") || null,
      utm_medium: parsed?.searchParams.get("utm_medium") || null,
      utm_campaign: parsed?.searchParams.get("utm_campaign") || null,
      utm_content: parsed?.searchParams.get("utm_content") || null,
      utm_term: parsed?.searchParams.get("utm_term") || null,
      captured_at: Date.now(),
    };

    const attributed = Boolean(current.fbclid || current.utm_source || current.utm_medium || current.utm_campaign || current.utm_content || current.utm_term);
    const first = previousFirst || current;
    const last = attributed || !previousLast ? current : previousLast;
    if (!previousFirst) await localSet(firstTouchKey, JSON.stringify(first));
    if (attributed || !previousLast) await localSet(lastTouchKey, JSON.stringify(last));
    return { current, first, last };
  };

  const address = (value) => value ? {
    first_name: value.firstName || null,
    last_name: value.lastName || null,
    city: value.city || null,
    state: value.provinceCode || value.province || null,
    postal_code: value.zip || null,
    country: value.countryCode || value.country || null,
  } : null;

  const checkoutData = (checkout) => checkout ? {
    checkout_token: checkout.token || null,
    email: checkout.email || null,
    phone: checkout.phone || null,
    shipping_address: address(checkout.shippingAddress),
    billing_address: address(checkout.billingAddress),
    total_value: checkout.totalPrice?.amount ?? null,
    currency: checkout.totalPrice?.currencyCode || null,
    order_id: checkout.order?.id || null,
    customer_id: checkout.order?.customer?.id || null,
  } : null;

  const tracked = [
    "page_viewed",
    "product_viewed",
    "product_added_to_cart",
    "cart_viewed",
    "checkout_started",
    "checkout_contact_info_submitted",
    "checkout_address_info_submitted",
    "checkout_shipping_info_submitted",
    "payment_info_submitted",
    "checkout_completed",
  ];

  for (const eventName of tracked) {
    analytics.subscribe(eventName, async (event) => {
      try {
        const touches = await touchState(event);
        const checkout = checkoutData(event?.data?.checkout);
        const payload = {
          schema_version: 1,
          source: "telence_web_pixel",
          collector_version: version,
          pixel_key: settings.publicKey,
          sent_at: new Date().toISOString(),
          consent: init.customerPrivacy || null,
          identity: {
            tl_visitor_id: await visitorId(),
            tl_session_id: await sessionId(),
            shopify_client_id: event.clientId || null,
            checkout_token: checkout?.checkout_token || null,
            customer_id: checkout?.customer_id || null,
            order_id: checkout?.order_id || null,
          },
          meta: {
            fbclid: touches.current.fbclid || touches.last?.fbclid || null,
            fbc: touches.current.fbc || touches.last?.fbc || null,
            fbp: touches.current.fbp || touches.last?.fbp || null,
          },
          attribution: touches,
          event: {
            name: event.name,
            shopify_event_id: event.id || null,
            seq: event.seq ?? null,
            timestamp: event.timestamp || null,
            url: eventUrl(event),
            referrer: eventReferrer(event),
            user_agent: event?.context?.navigator?.userAgent || null,
            checkout,
          },
        };

        await fetch(settings.endpoint, {
          method: "POST",
          body: JSON.stringify(payload),
          keepalive: true,
        });
      } catch {
        // Tracking failure must never break Shopify checkout.
      }
    });
  }
});
