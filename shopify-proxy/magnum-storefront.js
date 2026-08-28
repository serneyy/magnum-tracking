/*
 * Magnum Tracking - Storefront proxy collector
 * Version: 0.1.1
 *
 * Intended production installation: Shopify Theme App Extension / App Embed.
 * Browser requests stay on the merchant storefront origin and are sent to:
 *   /apps/magnum/e
 * Shopify App Proxy then forwards them to:
 *   https://d.magnus.com/proxy/e
 *
 * Do not deploy until the Shopify app proxy is configured and the backend
 * verifies Shopify's proxy signature.
 */

(() => {
  'use strict';

  const MAGNUM = Object.freeze({
    VERSION: '0.1.1',
    PROXY_ENDPOINT: '/apps/magnum/e',
    STORAGE: {
      VISITOR_ID: 'mg_vid',
      SESSION_ID: 'mg_sid',
      FIRST_TOUCH: 'mg_first_touch',
      LAST_TOUCH: 'mg_last_touch',
      LAST_FBP: 'mg_last_fbp',
    },
  });

  let started = false;
  let cartSyncTimer = null;

  function randomId(prefix) {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return `${prefix}_${globalThis.crypto.randomUUID()}`;
    }
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
  }

  function readCookie(name) {
    const prefix = `${name}=`;
    for (const part of document.cookie.split(';')) {
      const value = part.trim();
      if (value.startsWith(prefix)) return decodeURIComponent(value.slice(prefix.length));
    }
    return null;
  }

  function getOrCreate(storage, key, prefix) {
    try {
      let value = storage.getItem(key);
      if (!value) {
        value = randomId(prefix);
        storage.setItem(key, value);
      }
      return value;
    } catch (_) {
      return randomId(prefix);
    }
  }

  function parseJson(value) {
    if (!value) return null;
    try { return JSON.parse(value); } catch (_) { return null; }
  }

  function saveJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  function currentTouch(previousLast) {
    const url = new URL(location.href);
    const fbclid = url.searchParams.get('fbclid') || null;
    const cookieFbc = readCookie('_fbc');
    const cookieFbp = readCookie('_fbp');

    if (cookieFbp) {
      try { localStorage.setItem(MAGNUM.STORAGE.LAST_FBP, cookieFbp); } catch (_) {}
    }

    let fbc = cookieFbc || null;
    if (fbclid) {
      if (previousLast?.fbclid === fbclid && previousLast?.fbc) {
        fbc = previousLast.fbc;
      } else if (!(cookieFbc && cookieFbc.endsWith(`.${fbclid}`))) {
        fbc = `fb.1.${Date.now()}.${fbclid}`;
      }
    }

    return {
      url: location.href,
      referrer: document.referrer || null,
      fbclid,
      fbc,
      fbp: cookieFbp || localStorage.getItem(MAGNUM.STORAGE.LAST_FBP) || null,
      utm_source: url.searchParams.get('utm_source'),
      utm_medium: url.searchParams.get('utm_medium'),
      utm_campaign: url.searchParams.get('utm_campaign'),
      utm_content: url.searchParams.get('utm_content'),
      utm_term: url.searchParams.get('utm_term'),
      captured_at: Date.now(),
    };
  }

  function resolveTouches() {
    const first = parseJson(localStorage.getItem(MAGNUM.STORAGE.FIRST_TOUCH));
    const last = parseJson(localStorage.getItem(MAGNUM.STORAGE.LAST_TOUCH));
    const current = currentTouch(last);
    const hasAttribution = Boolean(
      current.fbclid || current.utm_source || current.utm_medium ||
      current.utm_campaign || current.utm_content || current.utm_term
    );

    const resolvedFirst = first || current;
    const resolvedLast = hasAttribution || !last ? current : last;

    if (!first) saveJson(MAGNUM.STORAGE.FIRST_TOUCH, resolvedFirst);
    if (hasAttribution || !last) saveJson(MAGNUM.STORAGE.LAST_TOUCH, resolvedLast);

    return { current, first: resolvedFirst, last: resolvedLast };
  }

  async function getCart() {
    try {
      const response = await fetch('/cart.js', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return null;
      const cart = await response.json();
      return {
        token: cart.token || null,
        item_count: cart.item_count ?? null,
        total_price: cart.total_price ?? null,
        currency: cart.currency || null,
        items: Array.isArray(cart.items)
          ? cart.items.slice(0, 100).map((item) => ({
              variant_id: item.variant_id || null,
              product_id: item.product_id || null,
              sku: item.sku || null,
              quantity: item.quantity || null,
              final_price: item.final_price ?? null,
            }))
          : [],
      };
    } catch (_) {
      return null;
    }
  }

  function privacyAllowed() {
    const privacy = window.Shopify?.customerPrivacy;
    if (!privacy) return false;
    return privacy.analyticsProcessingAllowed() === true && privacy.marketingAllowed() === true;
  }

  function privacySnapshot() {
    const privacy = window.Shopify?.customerPrivacy;
    if (!privacy) return null;
    return {
      analytics_processing_allowed: privacy.analyticsProcessingAllowed() === true,
      marketing_allowed: privacy.marketingAllowed() === true,
      preferences_processing_allowed: privacy.preferencesProcessingAllowed() === true,
      sale_of_data_allowed: privacy.saleOfDataAllowed() === true,
      consent_id: typeof privacy.consentId === 'function' ? privacy.consentId() : null,
      region: typeof privacy.getRegion === 'function' ? privacy.getRegion() : null,
    };
  }

  async function send(eventName, extra = {}) {
    if (!privacyAllowed()) return;

    const visitorId = getOrCreate(localStorage, MAGNUM.STORAGE.VISITOR_ID, 'mg_v');
    const sessionId = getOrCreate(sessionStorage, MAGNUM.STORAGE.SESSION_ID, 'mg_s');
    const touches = resolveTouches();
    const cart = await getCart();

    const payload = {
      schema_version: 1,
      source: 'shopify_app_proxy_storefront',
      collector_version: MAGNUM.VERSION,
      sent_at: new Date().toISOString(),
      identity: {
        mg_visitor_id: visitorId,
        mg_session_id: sessionId,
        cart_token: cart?.token || null,
      },
      meta: {
        fbclid: touches.current.fbclid || touches.last.fbclid || null,
        fbc: touches.current.fbc || touches.last.fbc || null,
        fbp: touches.current.fbp || touches.last.fbp || null,
      },
      attribution: touches,
      consent: privacySnapshot(),
      event: {
        name: eventName,
        url: location.href,
        referrer: document.referrer || null,
        title: document.title || null,
        user_agent: navigator.userAgent || null,
        cart,
        ...extra,
      },
    };

    try {
      await fetch(MAGNUM.PROXY_ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify(payload),
      });
    } catch (_) {
      // Tracking must never break the storefront.
    }
  }

  function scheduleCartSync(reason) {
    clearTimeout(cartSyncTimer);
    cartSyncTimer = setTimeout(() => send('cart_state_changed', { reason }), 120);
  }

  function installFetchCartObserver() {
    if (typeof window.fetch !== 'function') return;
    const originalFetch = window.fetch;

    window.fetch = async function magnumObservedFetch(input, init) {
      const response = await originalFetch.apply(this, arguments);
      try {
        const url = typeof input === 'string' ? input : input?.url || '';
        if (/\/cart\/(add|change|update|clear)(\.js)?(?:\?|$)/.test(url)) {
          scheduleCartSync('storefront_fetch');
        }
      } catch (_) {}
      return response;
    };
  }

  function installXhrCartObserver() {
    const proto = window.XMLHttpRequest?.prototype;
    if (!proto || proto.__magnumObserved) return;

    const originalOpen = proto.open;
    const originalSend = proto.send;

    proto.open = function magnumObservedOpen(method, url) {
      this.__magnumUrl = String(url || '');
      return originalOpen.apply(this, arguments);
    };

    proto.send = function magnumObservedSend() {
      if (!this.__magnumListenerAdded) {
        this.__magnumListenerAdded = true;
        this.addEventListener('loadend', () => {
          const url = this.__magnumUrl || '';
          if (/\/cart\/(add|change|update|clear)(\.js)?(?:\?|$)/.test(url)) {
            scheduleCartSync('storefront_xhr');
          }
        });
      }
      return originalSend.apply(this, arguments);
    };

    proto.__magnumObserved = true;
  }

  function start() {
    if (started || !privacyAllowed()) return;
    started = true;
    installFetchCartObserver();
    installXhrCartObserver();
    send('page_viewed');
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) send('page_restored');
    });
  }

  function loadPrivacyApi() {
    if (!window.Shopify?.loadFeatures) return;

    window.Shopify.loadFeatures(
      [{ name: 'consent-tracking-api', version: '0.1' }],
      (error) => {
        if (error) return;
        start();
        document.addEventListener('visitorConsentCollected', start);
      },
    );
  }

  loadPrivacyApi();
})();
