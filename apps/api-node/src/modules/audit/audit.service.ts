import { IdPrefix, newId } from '@akp/core';
import type { Prisma } from '@akp/db';
import type { Logger } from '@akp/observability';
import type { AuditRepository } from './audit.repository.js';

/**
 * Canonical audit action names. Using a closed set keeps the audit trail
 * queryable and consistent (e.g. filter by `auth.login`), and prevents typos
 * from fragmenting the log.
 */
export const AuditAction = {
  OrganizationCreated: 'organization.created',
  UserRegistered: 'user.registered',
  AuthLoginSucceeded: 'auth.login.succeeded',
  AuthLoginFailed: 'auth.login.failed',
  AuthTokenRefreshed: 'auth.token.refreshed',
  AuthTokenReuseDetected: 'auth.token.reuse_detected',
  AuthLoggedOut: 'auth.logout',
  AuthMfaChallenged: 'auth.mfa.challenged',
  MfaEnrollmentStarted: 'mfa.enrollment.started',
  MfaEnabled: 'mfa.enabled',
  MfaDisabled: 'mfa.disabled',
  ApiKeyCreated: 'api_key.created',
  ApiKeyRevoked: 'api_key.revoked',
  ApiKeyRotated: 'api_key.rotated',
  WebhookEndpointCreated: 'webhook.endpoint.created',
  WebhookEndpointDeleted: 'webhook.endpoint.deleted',
  OrganizationSettingsUpdated: 'organization.settings.updated',
  BudgetUpdated: 'organization.budget.updated',
  FeedbackSubmitted: 'message.feedback.submitted',
  EvaluationCreated: 'evaluation.completed',
  DocumentCreated: 'document.created',
  DocumentDeleted: 'document.deleted',
  DocumentAclsUpdated: 'document.acls.updated',
  DataSourceCreated: 'data_source.created',
  DataSourceUpdated: 'data_source.updated',
  DataSourceDeleted: 'data_source.deleted',
  TeamCreated: 'team.created',
  TeamDeleted: 'team.deleted',
  InviteCreated: 'invite.created',
  InviteAccepted: 'invite.accepted',
  InviteRevoked: 'invite.revoked',
  SsoConnectionUpserted: 'sso.connection.upserted',
  ScimTokenCreated: 'scim.token.created',
  SubscriptionUpdated: 'billing.subscription.updated',
  ChatMessageCreated: 'chat.message.created',
  ToolInvoked: 'mcp.tool.invoked',
} as const;

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export interface RecordAuditInput {
  organizationId: string;
  action: AuditAction;
  actorUserId?: string | undefined;
  resourceType?: string | undefined;
  resourceId?: string | undefined;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
  metadata?: Prisma.InputJsonValue | undefined;
}

export class AuditService {
  constructor(
    private readonly repository: AuditRepository,
    private readonly logger: Logger,
  ) {}

  /**
   * Persist an audit event. Audit logging is best-effort from the caller's
   * perspective: a failure is logged loudly but never propagated, so it cannot
   * turn a successful business operation into a failed request.
   */
  async record(input: RecordAuditInput): Promise<void> {
    try {
      await this.repository.create({
        id: newId(IdPrefix.auditLog),
        organizationId: input.organizationId,
        action: input.action,
        actorUserId: input.actorUserId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        metadata: input.metadata,
      });
    } catch (error) {
      this.logger.error({ err: error, action: input.action }, 'Failed to record audit event');
    }
  }

  /** Cursor-paginated, tenant-scoped audit trail (newest first). */
  async list(
    organizationId: string,
    pagination: { limit: number; cursor?: string | undefined },
  ): Promise<{ logs: AuditLogDto[]; nextCursor: string | null }> {
    const rows = await this.repository.listByOrganization(
      organizationId,
      pagination.limit + 1,
      pagination.cursor,
    );
    const hasMore = rows.length > pagination.limit;
    const page = hasMore ? rows.slice(0, pagination.limit) : rows;
    return {
      logs: page.map((row) => ({
        id: row.id,
        action: row.action,
        actorUserId: row.actorUserId,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        ipAddress: row.ipAddress,
        metadata: row.metadata,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
  }
}

export interface AuditLogDto {
  id: string;
  action: string;
  actorUserId: string | null;
  resourceType: string | null;
  resourceId: string | null;
  ipAddress: string | null;
  metadata: unknown;
  createdAt: string;
}
