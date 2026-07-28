import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, INTEGRATION_ENABLED, type TestHarness } from './harness.js';

const REGISTER = {
  method: 'POST' as const,
  url: '/v1/auth/register',
};

const validRegistration = {
  email: 'owner@integration.test',
  password: 'IntegrationPass1',
  name: 'Integration Owner',
  organizationName: 'Integration Co',
};

describe.skipIf(!INTEGRATION_ENABLED)('Auth flow (integration)', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
  });

  it('registers an organization and returns a usable session', async () => {
    const res = await harness.app.inject({ ...REGISTER, payload: validRegistration });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.role).toBe('OWNER');
    expect(body.organization.slug).toBe('integration-co');
    expect(body.tokens.accessToken).toBeTruthy();
    expect(body.tokens.refreshToken).toBeTruthy();
    expect(res.headers['x-request-id']).toBeTruthy();

    // The access token authorizes /me.
    const me = await harness.app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { authorization: `Bearer ${body.tokens.accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe('owner@integration.test');
  });

  it('rejects duplicate registration', async () => {
    await harness.app.inject({ ...REGISTER, payload: validRegistration });
    const dup = await harness.app.inject({ ...REGISTER, payload: validRegistration });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('ALREADY_EXISTS');
  });

  it('rejects a weak password with a validation error', async () => {
    const res = await harness.app.inject({
      ...REGISTER,
      payload: { ...validRegistration, password: 'weak' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('logs in with valid credentials and rejects bad ones', async () => {
    await harness.app.inject({ ...REGISTER, payload: validRegistration });

    const good = await harness.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: validRegistration.email, password: validRegistration.password },
    });
    expect(good.statusCode).toBe(200);

    const bad = await harness.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: validRegistration.email, password: 'WrongPassword9' },
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rotates refresh tokens and detects reuse', async () => {
    const reg = await harness.app.inject({ ...REGISTER, payload: validRegistration });
    const { refreshToken } = reg.json().tokens;

    const rotated = await harness.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken },
    });
    expect(rotated.statusCode).toBe(200);
    const newRefresh = rotated.json().tokens.refreshToken;
    expect(newRefresh).not.toBe(refreshToken);

    // Reusing the original (now rotated) token must fail and revoke the family.
    const reuse = await harness.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken },
    });
    expect(reuse.statusCode).toBe(401);

    // The rotated token is now also revoked (family burned).
    const afterBurn = await harness.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: newRefresh },
    });
    expect(afterBurn.statusCode).toBe(401);
  });

  it('rejects /me without a token', async () => {
    const res = await harness.app.inject({ method: 'GET', url: '/v1/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('enforces RBAC on the members endpoint', async () => {
    const reg = await harness.app.inject({ ...REGISTER, payload: validRegistration });
    const token = reg.json().tokens.accessToken;
    // Owner satisfies ADMIN requirement.
    const res = await harness.app.inject({
      method: 'GET',
      url: '/v1/organizations/current/members',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().members).toHaveLength(1);
  });
});
