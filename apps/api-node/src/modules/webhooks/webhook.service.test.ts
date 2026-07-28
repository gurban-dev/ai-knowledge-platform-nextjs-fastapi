import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { signWebhookPayload } from './webhook.service.js';

describe('signWebhookPayload', () => {
  it('produces a verifiable HMAC signature', () => {
    const secret = 'whsec_test';
    const body = '{"ok":true}';
    const header = signWebhookPayload(secret, body, 1_700_000_000);
    expect(header.startsWith('t=1700000000,v1=')).toBe(true);
    const sig = header.split('v1=')[1]!;
    const expected = createHmac('sha256', secret)
      .update(`1700000000.${body}`)
      .digest('hex');
    expect(sig).toBe(expected);
  });
});
