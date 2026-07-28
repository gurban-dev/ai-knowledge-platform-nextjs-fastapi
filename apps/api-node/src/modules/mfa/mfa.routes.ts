import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { commonErrorResponses } from '../../lib/http.js';
import type { RequestMeta } from '../auth/auth.types.js';

function requestMeta(request: FastifyRequest): RequestMeta {
  return { ipAddress: request.ip, userAgent: request.headers['user-agent'] };
}

const enrollResponseSchema = z.object({
  secret: z.string(),
  otpauthUri: z.string(),
});

const statusResponseSchema = z.object({
  enabled: z.boolean(),
  verifiedAt: z.string().nullable(),
  recoveryCodesRemaining: z.number().int(),
});

const recoveryCodesResponseSchema = z.object({
  recoveryCodes: z.array(z.string()),
});

const activateBodySchema = z.object({ token: z.string().trim().min(6).max(10) });
const disableBodySchema = z.object({
  token: z.string().trim().min(6).max(10).optional(),
  recoveryCode: z.string().trim().min(6).max(20).optional(),
});
const regenerateBodySchema = z.object({ token: z.string().trim().min(6).max(10) });

export const mfaRoutes: FastifyPluginAsync = async (app) => {
  const fastify = app.withTypeProvider<ZodTypeProvider>();
  const { mfa } = fastify.container.services;

  fastify.get(
    '/status',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['mfa'],
        summary: 'Get the current MFA status for the authenticated user',
        security: [{ bearerAuth: [] }],
        response: { 200: statusResponseSchema, ...commonErrorResponses },
      },
    },
    async (request) => mfa.status(request.auth!.userId),
  );

  fastify.post(
    '/enroll',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['mfa'],
        summary: 'Begin TOTP enrollment (returns a secret + otpauth URI)',
        security: [{ bearerAuth: [] }],
        response: { 200: enrollResponseSchema, ...commonErrorResponses },
      },
    },
    async (request) =>
      mfa.beginEnrollment(
        request.auth!.userId,
        request.auth!.organizationId,
        requestMeta(request),
      ),
  );

  fastify.post(
    '/activate',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['mfa'],
        summary: 'Confirm a TOTP code and enable MFA (returns recovery codes once)',
        security: [{ bearerAuth: [] }],
        body: activateBodySchema,
        response: { 200: recoveryCodesResponseSchema, ...commonErrorResponses },
      },
    },
    async (request) =>
      mfa.activate(
        request.auth!.userId,
        request.auth!.organizationId,
        request.body.token,
        requestMeta(request),
      ),
  );

  fastify.post(
    '/recovery-codes',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['mfa'],
        summary: 'Regenerate recovery codes (invalidates the previous set)',
        security: [{ bearerAuth: [] }],
        body: regenerateBodySchema,
        response: { 200: recoveryCodesResponseSchema, ...commonErrorResponses },
      },
    },
    async (request) => mfa.regenerateRecoveryCodes(request.auth!.userId, request.body.token),
  );

  fastify.post(
    '/disable',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['mfa'],
        summary: 'Disable MFA after verifying a current factor',
        security: [{ bearerAuth: [] }],
        body: disableBodySchema,
        response: { 204: z.null(), ...commonErrorResponses },
      },
    },
    async (request, reply) => {
      await mfa.disable(
        request.auth!.userId,
        request.auth!.organizationId,
        { token: request.body.token, recoveryCode: request.body.recoveryCode },
        requestMeta(request),
      );
      void reply.status(204);
      return null;
    },
  );
};
