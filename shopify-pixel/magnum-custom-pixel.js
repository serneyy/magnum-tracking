/*
 * Magnum Tracking - Shopify Custom Pixel collector
 * Version: 0.1.0
 *
 * Install target:
 * Shopify Admin -> Settings -> Customer events -> Add custom pixel
 *
 * This is the first prototype collector. It intentionally sends events to a
 * Magnum-owned third-party collector domain while using Shopify's browser APIs
 * for top-frame storage when the customer privacy state allows tracking.
 *
 * IMPORTANT:
 * - Replace COLLECTOR_URL only with a hostname we actually control.
 * - Do not log the payload in production because checkout events can contain PII.
 * - The Magnum ingestion API must normalize/hash protected customer data and
 *   avoid retaining unnecessary raw PII.
 */

const MAGNUM = Object.freeze({
  VERSION: '0.1.0',
  COLLECTOR_URL: 'https://d.magnum.com/v1/events',
  STORAGE: {
    VISITOR_ID: 'mg_vid',
    SESSION_ID: 'mg_sid',
    FIRST_TOUCH: 'mg_first_touch',
    LAST_TOUCH: 'mg_last_touch',
    LAST_FBP: 'mg_last_fbp',
  },
});

const TRACKED_EVENTS = [
  'page_viewed',
  'product_viewed',
  'product_added_to_cart',
  'cart_viewed',
  'checkout_started',
  'checkout_contact_info_submitted',
  'checkout_address_info_submitted',
  'checkout_shipping_info_submitted',
  'payment_info_submitted',
  'checkout_completed',
];

let privacyState = init.customerPrivacy || {};

customerPrivacy.subscribe('visitorConsentCollected', (event) => {
  if (event && event.customerPrivacy) {
    privacyState = event.customerPrivacy;
  }
});

function trackingAllowed() {
  return (
    privacyState.analyticsProcessingAllowed === true &&
    privacyState.marketingAllowed === true
  );
}

function randomId(prefix) {
  try {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return `${prefix}_${globalThis.crypto.randomUUID()}`;
    }
  } catch (_) {
    // Fall through to a non-cryptographic collision-resistant fallback.
  }

  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2)}_${Math.random().toString(36).slice(2)}`;
}

async function safeLocalGet(key) {
  try {
    return await browser.localStorage.getItem(key);
  } catch (_) {
    return null;
  }
}

async function safeLocalSet(key, value) {
  try {
    await browser.localStorage.setItem(key, value);
  } catch (_) {
    // Tracking must never break the storefront or checkout.
  }
}

async function safeSessionGet(key) {
  try {
    return await browser.sessionStorage.getItem(key);
  } catch (_) {
    return null;
  }
}

async function safeSessionSet(key, value) {
  try {
    await browser.sessionStorage.setItem(key, value);
  } catch (_) {
    // Tracking must never break the storefront or checkout.
  }
}

async function safeCookieGet(name) {
  try {
    return (await browser.cookie.get(name)) || null;
  } catch (_) {
    return null;
  }
}

function parseStoredJson(value) {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

async function getOrCreateVisitorId() {
  let id = await safeLocalGet(MAGNUM.STORAGE.VISITOR_ID);

  if (!id) {
    id = randomId('mg_v');
    await safeLocalSet(MAGNUM.STORAGE.VISITOR_ID, id);
  }

  return id;
}

async function getOrCreateSessionId() {
  let id = await safeSessionGet(MAGNUM.STORAGE.SESSION_ID);

  if (!id) {
    id = randomId('mg_s');
    await safeSessionSet(MAGNUM.STORAGE.SESSION_ID, id);
  }

  return id;
}

function eventUrl(event) {
  return (
    event?.context?.document?.location?.href ||
    event?.context?.window?.location?.href ||
    init?.context?.document?.location?.href ||
    ''
  );
}

function eventReferrer(event) {
  return (
    event?.context?.document?.referrer ||
    init?.context?.document?.referrer ||
    ''
  );
}

function parseUrl(url) {
  try {
    return new URL(url);
  } catch (_) {
    return null;
  }
}

function valueOrNull(value) {
  return value === undefined || value === null || value === '' ? null : value;
}

function compactObject(object) {
  const result = {};

  for (const [key, value] of Object.entries(object || {})) {
    if (value !== undefined && value !== null && value !== '') {
      result[key] = value;
    }
  }

  return result;
}

function fbcContainsFbclid(fbc, fbclid) {
  return Boolean(fbc && fbclid && fbc.endsWith(`.${fbclid}`));
}

async function resolveFbp() {
  const cookieFbp = await safeCookieGet('_fbp');

  if (cookieFbp) {
    await safeLocalSet(MAGNUM.STORAGE.LAST_FBP, cookieFbp);
    return cookieFbp;
  }

  return await safeLocalGet(MAGNUM.STORAGE.LAST_FBP);
}

async function buildCurrentTouch(event, previousLastTouch) {
  const href = eventUrl(event);
  const parsed = parseUrl(href);
  const params = parsed ? parsed.searchParams : null;

  const fbclid = params ? valueOrNull(params.get('fbclid')) : null;
  const cookieFbc = await safeCookieGet('_fbc');
  const fbp = await resolveFbp();

  let fbc = cookieFbc;

  if (fbclid) {
    if (
      previousLastTouch &&
      previousLastTouch.fbclid === fbclid &&
      previousLastTouch.fbc
    ) {
      // Freeze the original fbc creation timestamp for this click.
      fbc = previousLastTouch.fbc;
    } else if (fbcContainsFbclid(cookieFbc, fbclid)) {
      // Meta Pixel already created the correct _fbc for this exact click.
      fbc = cookieFbc;
    } else {
      // Meta's fbc creation timestamp is milliseconds, not seconds.
      fbc = `fb.1.${Date.now()}.${fbclid}`;
    }
  }

  const touch = compactObject({
    url: href,
    referrer: eventReferrer(event),
    fbclid,
    fbc,
    fbp,
    utm_source: params ? valueOrNull(params.get('utm_source')) : null,
    utm_medium: params ? valueOrNull(params.get('utm_medium')) : null,
    utm_campaign: params ? valueOrNull(params.get('utm_campaign')) : null,
    utm_content: params ? valueOrNull(params.get('utm_content')) : null,
    utm_term: params ? valueOrNull(params.get('utm_term')) : null,
    captured_at: Date.now(),
  });

  const hasNewAttribution = Boolean(
    touch.fbclid ||
      touch.utm_source ||
      touch.utm_medium ||
      touch.utm_campaign ||
      touch.utm_content ||
      touch.utm_term
  );

  return { touch, hasNewAttribution };
}

async function resolveTouchState(event) {
  const storedFirst = parseStoredJson(
    await safeLocalGet(MAGNUM.STORAGE.FIRST_TOUCH),
  );
  const storedLast = parseStoredJson(
    await safeLocalGet(MAGNUM.STORAGE.LAST_TOUCH),
  );

  const { touch: currentTouch, hasNewAttribution } = await buildCurrentTouch(
    event,
    storedLast,
  );

  const firstTouch = storedFirst || currentTouch;
  let lastTouch = storedLast || currentTouch;

  if (!storedFirst) {
    await safeLocalSet(
      MAGNUM.STORAGE.FIRST_TOUCH,
      JSON.stringify(firstTouch),
    );
  }

  if (hasNewAttribution || !storedLast) {
    lastTouch = currentTouch;
    await safeLocalSet(
      MAGNUM.STORAGE.LAST_TOUCH,
      JSON.stringify(lastTouch),
    );
  }

  return {
    current: currentTouch,
    first: firstTouch,
    last: lastTouch,
    has_new_attribution: hasNewAttribution,
  };
}

function pickAddress(address) {
  if (!address) return null;

  // Only fields useful for deterministic customer matching are forwarded.
  // Street address is intentionally omitted from the first prototype.
  return compactObject({
    first_name: valueOrNull(address.firstName),
    last_name: valueOrNull(address.lastName),
    city: valueOrNull(address.city),
    province: valueOrNull(address.province),
    province_code: valueOrNull(address.provinceCode),
    postal_code: valueOrNull(address.zip),
    country: valueOrNull(address.country),
    country_code: valueOrNull(address.countryCode),
  });
}

function pickCheckout(checkout) {
  if (!checkout) return null;

  return compactObject({
    checkout_token: valueOrNull(checkout.token),
    email: valueOrNull(checkout.email),
    phone: valueOrNull(checkout.phone),
    shipping_address: pickAddress(checkout.shippingAddress),
    billing_address: pickAddress(checkout.billingAddress),
    subtotal_value: valueOrNull(checkout.subtotalPrice?.amount),
    subtotal_currency: valueOrNull(checkout.subtotalPrice?.currencyCode),
    total_value: valueOrNull(checkout.totalPrice?.amount),
    total_currency: valueOrNull(checkout.totalPrice?.currencyCode),
    total_tax: valueOrNull(checkout.totalTax?.amount),
    order_id: valueOrNull(checkout.order?.id),
    customer_id: valueOrNull(checkout.order?.customer?.id),
    line_items: Array.isArray(checkout.lineItems)
      ? checkout.lineItems.slice(0, 100).map((line) =>
          compactObject({
            line_id: valueOrNull(line.id),
            quantity: valueOrNull(line.quantity),
            title: valueOrNull(line.title),
            variant_id: valueOrNull(line.variant?.id),
            variant_sku: valueOrNull(line.variant?.sku),
            variant_title: valueOrNull(line.variant?.title),
            product_id: valueOrNull(line.variant?.product?.id),
          }),
        )
      : undefined,
  });
}

function pickProduct(event) {
  const variant =
    event?.data?.productVariant ||
    event?.data?.cartLine?.merchandise ||
    null;

  if (!variant) return null;

  return compactObject({
    variant_id: valueOrNull(variant.id),
    variant_sku: valueOrNull(variant.sku),
    variant_title: valueOrNull(variant.title),
    product_id: valueOrNull(variant.product?.id),
    product_title: valueOrNull(variant.product?.title),
    price: valueOrNull(variant.price?.amount),
    currency: valueOrNull(variant.price?.currencyCode),
  });
}

function pickCart() {
  const cart = init?.data?.cart;
  if (!cart) return null;

  return compactObject({
    cart_id: valueOrNull(cart.id),
    total_quantity: valueOrNull(cart.totalQuantity),
    total_value: valueOrNull(cart.cost?.totalAmount?.amount),
    currency: valueOrNull(cart.cost?.totalAmount?.currencyCode),
  });
}

function privacySnapshot() {
  return {
    analytics_processing_allowed:
      privacyState.analyticsProcessingAllowed === true,
    marketing_allowed: privacyState.marketingAllowed === true,
    preferences_processing_allowed:
      privacyState.preferencesProcessingAllowed === true,
    sale_of_data_allowed: privacyState.saleOfDataAllowed === true,
  };
}

async function buildEnvelope(event) {
  const visitorId = await getOrCreateVisitorId();
  const sessionId = await getOrCreateSessionId();
  const touches = await resolveTouchState(event);

  const checkout = event?.data?.checkout
    ? pickCheckout(event.data.checkout)
    : null;

  return {
    schema_version: 1,
    source: 'shopify_custom_pixel',
    pixel_version: MAGNUM.VERSION,
    sent_at: new Date().toISOString(),
    consent: privacySnapshot(),
    identity: compactObject({
      mg_visitor_id: visitorId,
      mg_session_id: sessionId,
      shopify_client_id: valueOrNull(event.clientId),
      shopify_customer_id: valueOrNull(init?.data?.customer?.id),
      cart_id: valueOrNull(init?.data?.cart?.id),
      checkout_token: valueOrNull(checkout?.checkout_token),
      order_id: valueOrNull(checkout?.order_id),
    }),
    meta: compactObject({
      fbclid: valueOrNull(touches.current.fbclid || touches.last.fbclid),
      fbc: valueOrNull(touches.current.fbc || touches.last.fbc),
      fbp: valueOrNull(touches.current.fbp || touches.last.fbp),
    }),
    attribution: touches,
    event: {
      name: event.name,
      shopify_event_id: valueOrNull(event.id),
      seq: valueOrNull(event.seq),
      timestamp: valueOrNull(event.timestamp),
      url: eventUrl(event),
      referrer: eventReferrer(event),
      user_agent: valueOrNull(event?.context?.navigator?.userAgent),
      cart: pickCart(),
      product: pickProduct(event),
      checkout,
    },
  };
}

async function sendEnvelope(payload) {
  // A string body keeps the request simple and avoids unnecessary custom
  // headers/preflight. The Magnum API accepts text/plain JSON bodies.
  await fetch(MAGNUM.COLLECTOR_URL, {
    method: 'POST',
    body: JSON.stringify(payload),
    keepalive: true,
  });
}

for (const eventName of TRACKED_EVENTS) {
  analytics.subscribe(eventName, async (event) => {
    if (!trackingAllowed()) return;

    try {
      const payload = await buildEnvelope(event);
      await sendEnvelope(payload);
    } catch (_) {
      // Tracking failure must never interrupt the storefront or checkout.
      // Server-side health monitoring is responsible for detecting drops.
    }
  });
}
