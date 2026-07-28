import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import {
  type AppError,
  NotFoundError,
  RateLimitError,
  toAppError,
  ValidationError,
  type SerializedError,
} from '@akp/core';

/**
 * Central error boundary. Every thrown error — domain, validation, framework —
 * is normalized into the platform's stable error envelope. Server errors (5xx)
 * are logged with full context and their messages masked; client errors (4xx)
 * are returned as-is. A `requestId` is always included for support correlation.
 */
const errorHandlerPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.setErrorHandler((error, request, reply) => {
    const appError = normalize(error);
    const body = serialize(appError, request.id);

    if (appError.statusCode >= 500) {
      request.log.error(
        { err: appError, cause: appError.cause, reqId: request.id },
        'Unhandled server error',
      );
    } else {
      request.log.info({ code: appError.code, statusCode: appError.statusCode }, 'Request error');
    }

    void reply.status(appError.statusCode).send(body);
  });

  fastify.setNotFoundHandler((request, reply) => {
    const err = new NotFoundError('Route');
    void reply
      .status(err.statusCode)
      .send(serialize(err, request.id));
  });
};

/**
 * Extract a {@link ZodError} from whatever `fastify-type-provider-zod` surfaced.
 * The v2 validator compiler returns the raw `ZodError`; Fastify may hand it to
 * the error handler directly or nested under `error.validation`.
 */
function extractZodError(error: unknown): ZodError | null {
  if (error instanceof ZodError) return error;
  if (typeof error === 'object' && error !== null && 'validation' in error) {
    const validation = (error).validation;
    if (validation instanceof ZodError) return validation;
  }
  return null;
}

function normalize(error: unknown): AppError {
  // Zod request-validation failures raised by fastify-type-provider-zod.
  const zodError = extractZodError(error);
  if (zodError) {
    const details = zodError.issues.map((issue) => ({
      path: `/${issue.path.join('/')}`,
      message: issue.message,
    }));
    return new ValidationError('Request validation failed', details);
  }

  // Fastify framework errors carry a statusCode and code we can map cleanly.
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const status = Number((error).statusCode);
    if (status === 429) return new RateLimitError();
    if (status === 400) {
      const message = (error as { message?: unknown }).message;
      return new ValidationError(typeof message === 'string' ? message : 'Bad request');
    }
  }

  return toAppError(error);
}

function serialize(error: AppError, requestId: string): { error: SerializedError } {
  const base = error.toJSON();
  return {
    error: {
      ...base,
      // Never leak internal messages/details for masked (5xx) errors.
      message: error.expose ? base.message : 'An unexpected error occurred',
      ...(error.expose ? {} : { details: undefined }),
      requestId,
    },
  };
}

export default fp(errorHandlerPlugin, { name: 'error-handler' });
