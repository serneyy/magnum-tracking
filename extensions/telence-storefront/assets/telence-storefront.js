/* Telence storefront collector - Shopify Theme App Embed */
(() => {
  "use strict";

  const TL = {
    version: "0.1.0",
    endpoint: "/apps/telence/e",
    visitorKey: "tl_vid",
    sessionKey: "tl_sid",
    firstTouchKey: "tl_first_touch",
    lastTouchKey: "tl_last_touch",
  };

  let started = false;
  let cartTimer;

  const randomId = (prefix) => {
    if (globalThis.crypto?.randomUUID) return `${prefix}_${globalThis.crypto.randomUUID()}`;
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  };

  const storageId = (storage, key, prefix) => {
    try {
      let value = storage.getItem(key);
      if (!value) {
        value = randomId(prefix);
        storage.setItem(key, value);
      }
      return value;
    } catch {
      return randomId(prefix);
    }
  };

  const cookie = (name) => {
    const prefix = `${name}=`;
    for (const part of document.cookie.split(";")) {
      const value = part.trim();
      if (value.startsWith(prefix)) return decodeURIComponent(value.slice(prefix.length));
    }
    return null;
  };

  const readJson = (key) => {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
  };

  const writeJson = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  };

  const currentTouch = () => {
    const url = new URL(location.href);
    const previous = readJson(TL.lastTouchKey);
    const fbclid = url.searchParams.get("fbclid");
    const cookieFbc = cookie("_fbc");
    let fbc = cookieFbc;

    if (fbclid) {
      if (previous?.fbclid === fbclid && previous?.fbc) fbc = previous.fbc;
      else if (!(cookieFbc && cookieFbc.endsWith(`.${fbclid}`))) fbc = `fb.1.${Date.now()}.${fbclid}`;
    }

    return {
      url: location.href,
      referrer: document.referrer || null,
      fbclid: fbclid || null,
      fbc: fbc || null,
      fbp: cookie("_fbp") || null,
      utm_source: url.searchParams.get("utm_source"),
      utm_medium: url.searchParams.get("utm_medium"),
      utm_campaign: url.searchParams.get("utm_campaign"),
      utm_content: url.searchParams.get("utm_content"),
      utm_term: url.searchParams.get("utm_term"),
      captured_at: Date.now(),
    };
  };

  const resolveTouches = () => {
    const first = readJson(TL.firstTouchKey);
    const last = readJson(TL.lastTouchKey);
    const current = currentTouch();
    const attributed = Boolean(current.fbclid || current.utm_source || current.utm_medium || current.utm_campaign || current.utm_content || current.utm_term);
    const nextFirst = first || current;
    const nextLast = attributed || !last ? current : last;
    if (!first) writeJson(TL.firstTouchKey, nextFirst);
    if (attributed || !last) writeJson(TL.lastTouchKey, nextLast);
    return { current, first: nextFirst, last: nextLast };
  };

  const consent = () => {
    const privacy = window.Shopify?.customerPrivacy;
    if (!privacy) return false;
    return privacy.analyticsProcessingAllowed() === true && privacy.marketingAllowed() === true;
  };

  const privacySnapshot = () => {
    const privacy = window.Shopify?.customerPrivacy;
    if (!privacy) return null;
    return {
      analytics_processing_allowed: privacy.analyticsProcessingAllowed() === true,
      marketing_allowed: privacy.marketingAllowed() === true,
      preferences_processing_allowed: privacy.preferencesProcessingAllowed() === true,
      sale_of_data_allowed: privacy.saleOfDataAllowed() === true,
    };
  };

  const getCart = async () => {
    try {
      const response = await fetch("/cart.js", { credentials: "same-origin", headers: { Accept: "application/json" } });
      if (!response.ok) return null;
      const cart = await response.json();
      return {
        token: cart.token || null,
        item_count: cart.item_count ?? null,
        total_price: cart.total_price ?? null,
        currency: cart.currency || null,
      };
    } catch { return null; }
  };

  const send = async (name, extra = {}) => {
    if (!consent()) return;
    const touches = resolveTouches();
    const cart = await getCart();
    const payload = {
      schema_version: 1,
      source: "telence_storefront_proxy",
      collector_version: TL.version,
      sent_at: new Date().toISOString(),
      consent: privacySnapshot(),
      identity: {
        tl_visitor_id: storageId(localStorage, TL.visitorKey, "tl_v"),
        tl_session_id: storageId(sessionStorage, TL.sessionKey, "tl_s"),
        cart_token: cart?.token || null,
      },
      meta: {
        fbclid: touches.current.fbclid || touches.last?.fbclid || null,
        fbc: touches.current.fbc || touches.last?.fbc || null,
        fbp: touches.current.fbp || touches.last?.fbp || null,
      },
      attribution: touches,
      event: {
        name,
        url: location.href,
        referrer: document.referrer || null,
        user_agent: navigator.userAgent,
        cart,
        ...extra,
      },
    };

    try {
      await fetch(TL.endpoint, {
        method: "POST",
        credentials: "same-origin",
        keepalive: true,
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify(payload),
      });
    } catch {}
  };

  const scheduleCart = (reason) => {
    clearTimeout(cartTimer);
    cartTimer = setTimeout(() => send("cart_state_changed", { reason }), 120);
  };

  const observeCart = () => {
    const originalFetch = window.fetch;
    if (typeof originalFetch === "function") {
      window.fetch = async function (...args) {
        const response = await originalFetch.apply(this, args);
        const input = args[0];
        const url = typeof input === "string" ? input : input?.url || "";
        if (/\/cart\/(add|change|update|clear)(\.js)?(?:\?|$)/.test(url)) scheduleCart("fetch");
        return response;
      };
    }
  };

  const start = () => {
    if (started || !consent()) return;
    started = true;
    observeCart();
    send("page_viewed");
  };

  const loadPrivacy = () => {
    if (!window.Shopify?.loadFeatures) return;
    window.Shopify.loadFeatures([{ name: "consent-tracking-api", version: "0.1" }], (error) => {
      if (error) return;
      start();
      document.addEventListener("visitorConsentCollected", start);
    });
  };

  loadPrivacy();
})();
