import { fastify, type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { IdPrefix, newId } from '@akp/core';
import type { AppContainer } from './container.js';
import containerPlugin from './plugins/container.js';
import requestContextPlugin from './plugins/request-context.js';
import errorHandlerPlugin from './plugins/error-handler.js';
import securityPlugin from './plugins/security.js';
import authPlugin from './plugins/auth.js';
import rateLimitPlugin from './plugins/rate-limit.js';
import swaggerPlugin from './plugins/swagger.js';
import metricsPlugin from './plugins/metrics.js';
import idempotencyPlugin from './plugins/idempotency.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { mfaRoutes } from './modules/mfa/mfa.routes.js';
import { organizationRoutes } from './modules/organizations/organization.routes.js';
import { evaluationRoutes } from './modules/evaluations/evaluation.routes.js';
import { apiKeyRoutes } from './modules/api-keys/api-key.routes.js';
import { incidentRoutes } from './modules/incident-response/incident.routes.js';
import { sloRoutes } from './modules/health/slo.routes.js';
import { auditRoutes } from './modules/audit/audit.routes.js';
import { documentRoutes } from './modules/documents/document.routes.js';
import { searchRoutes } from './modules/search/search.routes.js';
import { chatRoutes } from './modules/chat/chat.routes.js';
import { usageRoutes } from './modules/usage/usage.routes.js';
import { billingRoutes } from './modules/billing/billing.routes.js';
import { webhookRoutes } from './modules/webhooks/webhook.routes.js';
import { teamRoutes } from './modules/teams/team.routes.js';
import { inviteRoutes } from './modules/invites/invite.routes.js';
import { feedbackRoutes } from './modules/feedback/feedback.routes.js';
import { ssoRoutes } from './modules/sso/sso.routes.js';

export interface BuildAppOptions {
  container: AppContainer;
}

/**
 * Construct a fully-wired Fastify instance. Kept free of side effects (no
 * `listen`) so tests can build the app and drive it via `inject()` without
 * binding a port.
 */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { container } = options;

  const app = fastify({
    logger: container.logger as unknown as FastifyBaseLogger,
    disableRequestLogging: false,
    genReqId: () => newId(IdPrefix.session).replace('ses_', 'req_'),
    trustProxy: true,
    // Document upload bodies are capped here; larger binary uploads use object storage.
    bodyLimit: 5 * 1024 * 1024,
    ajv: { customOptions: { coerceTypes: false } },
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(containerPlugin, { container });
  await app.register(errorHandlerPlugin);
  await app.register(requestContextPlugin);
  await app.register(securityPlugin);
  await app.register(authPlugin);
  await app.register(rateLimitPlugin);
  await app.register(swaggerPlugin);
  await app.register(metricsPlugin);
  await app.register(idempotencyPlugin);

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/v1/auth' });
  await app.register(mfaRoutes, { prefix: '/v1/auth/mfa' });
  await app.register(organizationRoutes, { prefix: '/v1/organizations' });
  await app.register(evaluationRoutes);
  await app.register(apiKeyRoutes);
  await app.register(incidentRoutes);
  await app.register(sloRoutes);
  await app.register(auditRoutes);
  await app.register(documentRoutes);
  await app.register(searchRoutes);
  await app.register(chatRoutes);
  await app.register(usageRoutes);
  await app.register(billingRoutes);
  await app.register(webhookRoutes);
  await app.register(teamRoutes);
  await app.register(inviteRoutes);
  await app.register(feedbackRoutes);
  await app.register(ssoRoutes);

  await app.ready();
  return app;
}
