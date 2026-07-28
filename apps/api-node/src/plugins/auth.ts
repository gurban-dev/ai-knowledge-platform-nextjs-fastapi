import type { FastifyPluginAsync, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import fp from 'fastify-plugin';
import {
  ForbiddenError,
  InsufficientScopeError,
  RateLimitError,
  Role,
  roleSatisfies,
  scopeSatisfies,
  UnauthorizedError,
} from '@akp/core';

/** Identity resolved from a verified access token and attached to the request. */
export interface AuthContext {
  userId: string;
  organizationId: string;
  role: Role;
  sessionId: string;
}

/** Identity resolved from a verified API key (programmatic / MCP access). */
export interface ApiKeyContext {
  id: string;
  organizationId: string;
  name: string;
  scopes: string[];
  rateLimitPerMinute: number | null;
}

function extractBearer(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}

/** Pull an API-key secret from `x-api-key` or a `Bearer akp_...` header. */
function extractApiKey(request: FastifyRequest): string | null {
  const headerKey = request.headers['x-api-key'];
  if (typeof headerKey === 'string' && headerKey.trim()) return headerKey.trim();
  const bearer = extractBearer(request);
  if (bearer?.startsWith('akp_')) return bearer;
  return null;
}

/**
 * Registers authentication/authorization primitives:
 *   - `request.auth`      : populated AuthContext once authenticated.
 *   - `fastify.authenticate` : preHandler that verifies the Bearer access token.
 *   - `fastify.requireRole(role)` : preHandler factory enforcing a minimum role.
 *
 * Access tokens are verified statelessly (signature + claims). Revocation is
 * bounded by the short access-token TTL; refresh tokens carry the revocable,
 * stateful part of the session.
 */
const authPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorateRequest('auth', null);
  fastify.decorateRequest('apiKey', null);

  const authenticate: preHandlerHookHandler = async (request: FastifyRequest) => {
    const token = extractBearer(request);
    if (!token) {
      throw new UnauthorizedError('Missing or malformed Authorization header');
    }
    const claims = await fastify.container.jwt.verifyAccessToken(token);
    request.auth = {
      userId: claims.sub,
      organizationId: claims.org,
      role: claims.role as Role,
      sessionId: claims.sid,
    };
  };

  fastify.decorate('authenticate', authenticate);

  /**
   * Authenticate a programmatic/MCP request via an API key. Populates both
   * `request.apiKey` (for scope checks) and `request.auth` (so downstream
   * tenant-scoping works uniformly). Programmatic routes authorize with
   * `requireScope`, not `requireRole`.
   */
  const authenticateApiKey: preHandlerHookHandler = async (request: FastifyRequest) => {
    const secret = extractApiKey(request);
    if (!secret) {
      throw new UnauthorizedError('Missing API key');
    }
    const verified = await fastify.container.services.apiKeys.verify(secret, {
      ip: request.ip,
    });

    // Per-key fixed-window rate limit (Redis-backed so it holds across
    // horizontally-scaled instances). Prevents a single key from starving the
    // tenant's shared quota — the global limiter runs before route preHandlers
    // and cannot see the key, so we enforce it here where the key is known.
    const limit =
      verified.rateLimitPerMinute ?? fastify.container.config.rateLimit.apiKeyPerMinute;
    const windowKey = `akp-akrl:${verified.id}:${Math.floor(Date.now() / 60_000)}`;
    const count = await fastify.container.redis.incr(windowKey);
    if (count === 1) {
      await fastify.container.redis.expire(windowKey, 60);
    }
    if (count > limit) {
      throw new RateLimitError('API key rate limit exceeded', { limit, windowSeconds: 60 });
    }

    request.apiKey = verified;
    request.auth = {
      userId: verified.id,
      organizationId: verified.organizationId,
      role: Role.MEMBER,
      sessionId: verified.id,
    };
  };

  fastify.decorate('authenticateApiKey', authenticateApiKey);

  fastify.decorate('requireRole', (required: Role): preHandlerHookHandler => {
    return async (request: FastifyRequest, _reply: FastifyReply) => {
      // requireRole must run after `authenticate` in the preHandler chain.
      if (!request.auth) {
        throw new UnauthorizedError('Authentication required');
      }
      if (!roleSatisfies(request.auth.role, required)) {
        throw new ForbiddenError(`Requires ${required} role or higher`);
      }
    };
  });

  fastify.decorate('requireScope', (required: string): preHandlerHookHandler => {
    return async (request: FastifyRequest, _reply: FastifyReply) => {
      // requireScope must run after `authenticateApiKey`.
      if (!request.apiKey) {
        throw new UnauthorizedError('API key authentication required');
      }
      if (!scopeSatisfies(request.apiKey.scopes, required)) {
        throw new InsufficientScopeError(`Requires the "${required}" scope`);
      }
    };
  });
};

export default fp(authPlugin, { name: 'auth', dependencies: ['container'] });
