import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { FeatureDisabledError, UnauthorizedError, ValidationError } from '@akp/core';
import { commonErrorResponses } from '../../lib/http.js';
import { createOAuthState, verifyOAuthState } from '../../lib/oauth-state.js';
import type { RequestMeta } from './auth.types.js';
import {
  authResultSchema,
  completeMfaBodySchema,
  googleCredentialBodySchema,
  googleExchangeBodySchema,
  googleStartResponseSchema,
  loginBodySchema,
  logoutBodySchema,
  profileSchema,
  refreshBodySchema,
  registerBodySchema,
} from './auth.schemas.js';

function requestMeta(request: FastifyRequest): RequestMeta {
  return {
    ipAddress: request.ip,
    userAgent: request.headers['user-agent'],
  };
}

/** Tighter limits on unauthenticated credential endpoints to slow brute force. */
const authRateLimit = { max: 10, timeWindow: 60_000 };

/** Exact Google callback path under the public web origin. */
const GOOGLE_CALLBACK_PATH = '/api/auth/google/callback';

export const authRoutes: FastifyPluginAsync = async (app) => {
  const fastify = app.withTypeProvider<ZodTypeProvider>();
  const { auth } = fastify.container.services;

  fastify.post(
    '/register',
    {
      schema: {
        tags: ['auth'],
        summary: 'Register a new organization and its first (owner) user',
        body: registerBodySchema,
        response: { 201: authResultSchema, ...commonErrorResponses },
      },
      config: { rateLimit: authRateLimit },
    },
    async (request, reply) => {
      const result = await auth.register(request.body, requestMeta(request));
      void reply.status(201);
      return result;
    },
  );

  fastify.post(
    '/login',
    {
      schema: {
        tags: ['auth'],
        summary: 'Authenticate with email and password',
        body: loginBodySchema,
        response: { 200: authResultSchema, ...commonErrorResponses },
      },
      config: { rateLimit: authRateLimit },
    },
    async (request) => auth.login(request.body, requestMeta(request)),
  );

  fastify.post(
    '/mfa/complete',
    {
      schema: {
        tags: ['auth'],
        summary: 'Complete MFA after password or Google primary-factor success',
        body: completeMfaBodySchema,
        response: { 200: authResultSchema, ...commonErrorResponses },
      },
      config: { rateLimit: authRateLimit },
    },
    async (request) => auth.completeMfa(request.body, requestMeta(request)),
  );

  fastify.post(
    '/refresh',
    {
      schema: {
        tags: ['auth'],
        summary: 'Rotate a refresh token for a fresh access token',
        body: refreshBodySchema,
        response: { 200: authResultSchema, ...commonErrorResponses },
      },
      config: { rateLimit: authRateLimit },
    },
    async (request) => auth.refresh(request.body.refreshToken, requestMeta(request)),
  );

  fastify.post(
    '/logout',
    {
      schema: {
        tags: ['auth'],
        summary: 'Revoke a refresh-token session',
        body: logoutBodySchema,
        response: { 204: z.null(), ...commonErrorResponses },
      },
    },
    async (request, reply) => {
      await auth.logout(request.body.refreshToken, requestMeta(request));
      void reply.status(204);
      return null;
    },
  );

  fastify.get(
    '/me',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['auth'],
        summary: 'Current authenticated user and active organization',
        security: [{ bearerAuth: [] }],
        response: { 200: profileSchema, ...commonErrorResponses },
      },
    },
    async (request) => auth.getProfile(request.auth!.userId),
  );

  /**
   * Allow the configured web public URL and every CORS origin's Google callback.
   * Google Console still enforces registered redirect URIs; this is defense in depth
   * while supporting local + preview/tunnel frontends.
   */
  const assertTrustedRedirect = (redirectUri: string): void => {
    const allowed = new Set<string>();
    const addOrigin = (raw: string) => {
      const base = raw.replace(/\/$/, '');
      if (base) allowed.add(`${base}${GOOGLE_CALLBACK_PATH}`);
    };
    addOrigin(fastify.container.config.web.publicUrl);
    for (const origin of fastify.container.config.server.corsOrigins) {
      addOrigin(origin);
    }
    if (!allowed.has(redirectUri)) {
      throw new ValidationError('redirectUri is not an allowed callback URL');
    }
  };

  const assertGoogleEnabled = (): void => {
    if (!fastify.container.config.google.enabled) {
      throw new FeatureDisabledError('Google sign-in is not configured');
    }
  };

  fastify.get(
    '/google/config',
    {
      schema: {
        tags: ['auth'],
        summary: 'Public Google Identity Services config (client id is not a secret)',
        response: {
          200: z.object({
            enabled: z.boolean(),
            clientId: z.string().nullable(),
          }),
          ...commonErrorResponses,
        },
      },
    },
    async () => {
      const clientId = fastify.container.config.google.clientId ?? null;
      return {
        enabled: fastify.container.config.google.enabled,
        clientId,
      };
    },
  );

  fastify.get(
    '/google/start',
    {
      schema: {
        tags: ['auth'],
        summary: 'Begin Google OAuth: get the consent-screen URL and a signed CSRF/PKCE state',
        querystring: z.object({ redirectUri: z.string().url() }),
        response: { 200: googleStartResponseSchema, ...commonErrorResponses },
      },
      config: { rateLimit: authRateLimit },
    },
    async (request) => {
      assertGoogleEnabled();
      assertTrustedRedirect(request.query.redirectUri);
      const { state, codeChallenge } = createOAuthState(
        request.query.redirectUri,
        fastify.container.config.auth.accessSecret,
      );
      const authorizationUrl = fastify.container.googleOAuth.buildAuthorizationUrl({
        redirectUri: request.query.redirectUri,
        state,
        codeChallenge,
      });
      return { authorizationUrl, state };
    },
  );

  fastify.post(
    '/google/exchange',
    {
      schema: {
        tags: ['auth'],
        summary: 'Complete Google OAuth: exchange the code (+ PKCE) for an authenticated session',
        body: googleExchangeBodySchema,
        response: { 200: authResultSchema, ...commonErrorResponses },
      },
      config: { rateLimit: authRateLimit },
    },
    async (request) => {
      assertGoogleEnabled();
      assertTrustedRedirect(request.body.redirectUri);

      const payload = verifyOAuthState(
        request.body.state,
        fastify.container.config.auth.accessSecret,
      );
      if (!payload?.redirectUri || payload.redirectUri !== request.body.redirectUri) {
        throw new UnauthorizedError('Invalid or expired OAuth state');
      }

      const identity = await fastify.container.googleOAuth.exchangeCode({
        code: request.body.code,
        redirectUri: request.body.redirectUri,
        codeVerifier: payload.codeVerifier,
      });
      return auth.loginOrRegisterWithGoogle(identity, requestMeta(request));
    },
  );

  fastify.post(
    '/google/credential',
    {
      schema: {
        tags: ['auth'],
        summary:
          'Complete Google sign-in from the GIS button / One Tap credential (OIDC id_token)',
        body: googleCredentialBodySchema,
        response: { 200: authResultSchema, ...commonErrorResponses },
      },
      config: { rateLimit: authRateLimit },
    },
    async (request) => {
      assertGoogleEnabled();
      const identity = await fastify.container.googleOAuth.verifyIdToken(request.body.idToken);
      return auth.loginOrRegisterWithGoogle(identity, requestMeta(request));
    },
  );
};
