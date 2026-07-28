import type { Role } from '@akp/core';
import type { preHandlerHookHandler } from 'fastify';
import type { AppContainer } from '../container.js';
import type { ApiKeyContext, AuthContext } from '../plugins/auth.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Composition-root container: config, clients, repositories, services. */
    container: AppContainer;
    /** preHandler that verifies the Bearer access token and populates `request.auth`. */
    authenticate: preHandlerHookHandler;
    /** preHandler that verifies an API key and populates `request.apiKey`/`request.auth`. */
    authenticateApiKey: preHandlerHookHandler;
    /** preHandler factory enforcing a minimum role (run after `authenticate`). */
    requireRole: (required: Role) => preHandlerHookHandler;
    /** preHandler factory enforcing an API-key scope (run after `authenticateApiKey`). */
    requireScope: (required: string) => preHandlerHookHandler;
  }

  interface FastifyRequest {
    /** Populated by `authenticate`/`authenticateApiKey`; null on unauthenticated routes. */
    auth: AuthContext | null;
    /** Populated by `authenticateApiKey`; null for user (JWT) or anonymous requests. */
    apiKey: ApiKeyContext | null;
  }
}
