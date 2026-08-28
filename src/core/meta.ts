import { createHash } from 'node:crypto';
import type { Identity } from './identity.js';
import { metaUserData } from './identity.js';

export type MetaEvent = {
  eventName: string;
  eventId: string;
  eventTime: number;
  eventSourceUrl?: string;
  actionSource?: 'website';
  identity: Identity;
  clientIp?: string;
  userAgent?: string;
  customData?: Record<string, unknown>;
};

export type MetaConfig = {
  pixelId: string;
  accessToken: string;
  apiVersion?: string;
  testEventCode?: string;
};

const delivered = new Set<string>();

export function deterministicEventId(parts: Array<string | number | undefined>): string {
  const canonical = parts.filter((v) => v !== undefined && v !== '').join('|');
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

export async function sendMetaEvent(config: MetaConfig, event: MetaEvent) {
  if (delivered.has(event.eventId)) {
    return { skipped: true, reason: 'duplicate_event_id' } as const;
  }

  const body: Record<string, unknown> = {
    data: [
      {
        event_name: event.eventName,
        event_time: event.eventTime,
        event_id: event.eventId,
        action_source: event.actionSource ?? 'website',
        event_source_url: event.eventSourceUrl,
        user_data: metaUserData(event.identity, event.clientIp, event.userAgent),
        custom_data: event.customData,
      },
    ],
  };

  if (config.testEventCode) body.test_event_code = config.testEventCode;

  const version = config.apiVersion ?? 'v23.0';
  const url = new URL(`https://graph.facebook.com/${version}/${config.pixelId}/events`);
  url.searchParams.set('access_token', config.accessToken);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Meta CAPI ${response.status}: ${JSON.stringify(payload)}`);
  }

  delivered.add(event.eventId);
  return { skipped: false, payload } as const;
}
