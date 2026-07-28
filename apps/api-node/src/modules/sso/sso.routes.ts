import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { FeatureDisabledError, IdPrefix, newId, NotFoundError, Role } from '@akp/core';
import type { Prisma } from '@akp/db';
import { commonErrorResponses } from '../../lib/http.js';
import { AuditAction } from '../audit/audit.service.js';
import { parseOrganizationSettings } from '../organizations/organization.service.js';

/**
 * OIDC SSO connection management + authorization-code start endpoint.
 * Full IdP callback exchange is completed by posting the code to /callback,
 * which upserts the user membership for the allowed domain.
 */
export const ssoRoutes: FastifyPluginAsync = async (app) => {
  const fastify = app.withTypeProvider<ZodTypeProvider>();

  fastify.post(
    '/v1/sso/connections',
    {
      onRequest: [fastify.authenticate, fastify.requireRole(Role.OWNER)],
      schema: {
        tags: ['sso'],
        body: z.object({
          provider: z.enum(['OIDC', 'SAML']),
          name: z.string().min(1),
          config: z.record(z.unknown()),
          clientSecret: z.string().optional(),
          allowedDomains: z.array(z.string()).default([]),
        }),
        response: {
          201: z.object({ id: z.string(), name: z.string(), provider: z.string() }),
          ...commonErrorResponses,
        },
      },
    },
    async (request, reply) => {
      if (!fastify.container.config.security.allowSso) {
        throw new FeatureDisabledError('SSO is disabled by platform policy');
      }
      const org = await fastify.container.prisma.organization.findUniqueOrThrow({
        where: { id: request.auth!.organizationId },
      });
      const settings = parseOrganizationSettings(org.settings);
      if (!settings.allowSso) {
        throw new FeatureDisabledError('SSO is disabled for this organization');
      }

      const row = await fastify.container.prisma.ssoConnection.create({
        data: {
          id: newId(IdPrefix.ssoConnection),
          organizationId: request.auth!.organizationId,
          provider: request.body.provider,
          name: request.body.name,
          config: request.body.config as Prisma.InputJsonValue,
          secretCiphertext: request.body.clientSecret
            ? fastify.container.encryptor.encrypt(request.body.clientSecret)
            : null,
          allowedDomains: request.body.allowedDomains,
        },
      });
      await fastify.container.services.audit.record({
        organizationId: request.auth!.organizationId,
        actorUserId: request.auth!.userId,
        action: AuditAction.SsoConnectionUpserted,
        resourceType: 'sso_connection',
        resourceId: row.id,
      });
      return reply.status(201).send({ id: row.id, name: row.name, provider: row.provider });
    },
  );

  fastify.get(
    '/v1/sso/connections',
    {
      onRequest: [fastify.authenticate, fastify.requireRole(Role.ADMIN)],
      schema: {
        tags: ['sso'],
        response: {
          200: z.object({
            connections: z.array(
              z.object({
                id: z.string(),
                name: z.string(),
                provider: z.string(),
                enabled: z.boolean(),
                allowedDomains: z.array(z.string()),
              }),
            ),
          }),
          ...commonErrorResponses,
        },
      },
    },
    async (request) => {
      const rows = await fastify.container.prisma.ssoConnection.findMany({
        where: { organizationId: request.auth!.organizationId },
      });
      return {
        connections: rows.map((r) => ({
          id: r.id,
          name: r.name,
          provider: r.provider,
          enabled: r.enabled,
          allowedDomains: r.allowedDomains,
        })),
      };
    },
  );

  fastify.get(
    '/v1/sso/:connectionId/start',
    {
      schema: {
        tags: ['sso'],
        params: z.object({ connectionId: z.string() }),
        querystring: z.object({ redirectUri: z.string().url() }),
        response: {
          200: z.object({ authorizationUrl: z.string().url(), state: z.string() }),
          ...commonErrorResponses,
        },
      },
    },
    async (request) => {
      const connection = await fastify.container.prisma.ssoConnection.findUnique({
        where: { id: request.params.connectionId },
      });
      if (!connection?.enabled) throw new NotFoundError('SSO connection');
      const cfg = connection.config as { issuer?: string; clientId?: string; authorizeUrl?: string };
      const state = newId(IdPrefix.session);
      const authorizeUrl =
        cfg.authorizeUrl ??
        `${(cfg.issuer ?? '').replace(/\/$/, '')}/authorize`;
      const url = new URL(authorizeUrl);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', cfg.clientId ?? '');
      url.searchParams.set('redirect_uri', request.query.redirectUri);
      url.searchParams.set('scope', 'openid email profile');
      url.searchParams.set('state', state);
      return { authorizationUrl: url.toString(), state };
    },
  );
};
