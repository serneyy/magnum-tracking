type MagnumConsent = {
  analytics: boolean;
  marketing: boolean;
};

type MagnumConfig = {
  endpoint: string;
  consent: () => MagnumConsent;
};

const VISITOR_KEY = 'mg_visitor_id';
const SESSION_KEY = 'mg_session_id';
const TOUCH_KEY = 'mg_touch';

function uuid(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function getCookie(name: string): string | undefined {
  return document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${name}=`))
    ?.split('=')
    .slice(1)
    .join('=');
}

function captureTouch() {
  const url = new URL(location.href);
  const fbclid = url.searchParams.get('fbclid') || undefined;
  const now = Date.now();
  return {
    url: location.href,
    referrer: document.referrer || undefined,
    fbclid,
    fbc: getCookie('_fbc') || (fbclid ? `fb.1.${Math.floor(now / 1000)}.${fbclid}` : undefined),
    fbp: getCookie('_fbp'),
    utm_source: url.searchParams.get('utm_source') || undefined,
    utm_medium: url.searchParams.get('utm_medium') || undefined,
    utm_campaign: url.searchParams.get('utm_campaign') || undefined,
    utm_content: url.searchParams.get('utm_content') || undefined,
    utm_term: url.searchParams.get('utm_term') || undefined,
    captured_at: now,
  };
}

export function initMagnum(config: MagnumConfig) {
  const consent = config.consent();
  if (!consent.analytics && !consent.marketing) return;

  let visitorId = localStorage.getItem(VISITOR_KEY);
  if (!visitorId) {
    visitorId = uuid('mg_v');
    localStorage.setItem(VISITOR_KEY, visitorId);
  }

  let sessionId = sessionStorage.getItem(SESSION_KEY);
  if (!sessionId) {
    sessionId = uuid('mg_s');
    sessionStorage.setItem(SESSION_KEY, sessionId);
  }

  const touch = captureTouch();
  const previous = localStorage.getItem(TOUCH_KEY);
  let firstTouch = touch;
  if (previous) {
    try {
      firstTouch = JSON.parse(previous).first_touch || touch;
    } catch {}
  }

  localStorage.setItem(TOUCH_KEY, JSON.stringify({ first_touch: firstTouch, last_touch: touch }));

  const payload = {
    visitor_id: visitorId,
    session_id: sessionId,
    first_touch: firstTouch,
    last_touch: touch,
  };

  navigator.sendBeacon?.(`${config.endpoint}/v1/identify`, JSON.stringify(payload)) ||
    fetch(`${config.endpoint}/v1/identify`, {
      method: 'POST',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => undefined);
}
