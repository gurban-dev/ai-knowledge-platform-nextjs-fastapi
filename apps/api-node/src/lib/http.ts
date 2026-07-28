import { z } from 'zod';

/**
 * Reusable OpenAPI/response building blocks. Declaring the error envelope once
 * keeps the documented contract consistent across every route.
 */
export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string().describe('Stable, machine-readable error code'),
    message: z.string(),
    statusCode: z.number().int(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;

/** Standard error responses attached to authenticated routes for documentation. */
export const commonErrorResponses = {
  400: errorResponseSchema.describe('Bad request'),
  401: errorResponseSchema.describe('Unauthorized'),
  403: errorResponseSchema.describe('Forbidden'),
  404: errorResponseSchema.describe('Not found'),
  422: errorResponseSchema.describe('Validation error'),
  429: errorResponseSchema.describe('Rate limited'),
  500: errorResponseSchema.describe('Internal server error'),
} as const;

/** Query params for cursor-paginated list endpoints. */
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
