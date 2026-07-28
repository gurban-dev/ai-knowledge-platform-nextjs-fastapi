import { createAiRegistry, type AiProvider } from '@akp/ai';
import { FieldEncryptor, StaticKeyProvider } from '@akp/core';
import type { PrismaClient } from '@akp/db';
import { AppMetrics, type Logger } from '@akp/observability';
import { createObjectStorage, type ObjectStorage } from '@akp/storage';
import type { Redis } from 'ioredis';
import type { Queue } from 'bullmq';
import type { AppConfig } from './config.js';
import { GoogleOAuthClient, type GoogleOAuthProvider } from './lib/google-oauth.js';
import { JwtService } from './lib/jwt.js';
import { createQueues } from './lib/queues.js';
import type {
  IngestJobPayload,
  MaintenanceJobPayload,
  WebhookJobPayload,
} from './lib/queues.js';
import { MfaService } from './modules/mfa/mfa.service.js';
import { UserRepository } from './modules/users/user.repository.js';
import { OrganizationRepository } from './modules/organizations/organization.repository.js';
import { MembershipRepository } from './modules/memberships/membership.repository.js';
import { SessionRepository } from './modules/sessions/session.repository.js';
import { AuditRepository } from './modules/audit/audit.repository.js';
import { AuditService } from './modules/audit/audit.service.js';
import { AuthService } from './modules/auth/auth.service.js';
import { OrganizationService } from './modules/organizations/organization.service.js';
import { ApiKeyRepository } from './modules/api-keys/api-key.repository.js';
import { ApiKeyService } from './modules/api-keys/api-key.service.js';
import { EvaluationRepository } from './modules/evaluations/evaluation.repository.js';
import { EvaluationService } from './modules/evaluations/evaluation.service.js';
import { DocumentRepository } from './modules/documents/document.repository.js';
import { DocumentService } from './modules/documents/document.service.js';
import { SearchService } from './modules/search/search.service.js';
import { ChatService } from './modules/chat/chat.service.js';
import { UsageRepository } from './modules/usage/usage.repository.js';
import { UsageService } from './modules/usage/usage.service.js';
import { BillingService } from './modules/billing/billing.service.js';
import { WebhookService } from './modules/webhooks/webhook.service.js';
import { TeamService } from './modules/teams/team.service.js';
import { InviteService } from './modules/invites/invite.service.js';

export interface AppContainer {
  config: AppConfig;
  logger: Logger;
  prisma: PrismaClient;
  redis: Redis;
  jwt: JwtService;
  encryptor: FieldEncryptor;
  metrics: AppMetrics;
  ai: AiProvider;
  storage: ObjectStorage;
  googleOAuth: GoogleOAuthProvider;
  queues: {
    ingest: Queue<IngestJobPayload>;
    webhook: Queue<WebhookJobPayload>;
    maintenance: Queue<MaintenanceJobPayload>;
  };
  resolveTeamIds: (organizationId: string, userId: string) => Promise<string[]>;
  repositories: {
    users: UserRepository;
    organizations: OrganizationRepository;
    memberships: MembershipRepository;
    sessions: SessionRepository;
    audit: AuditRepository;
    apiKeys: ApiKeyRepository;
    evaluations: EvaluationRepository;
    documents: DocumentRepository;
    usage: UsageRepository;
  };
  services: {
    audit: AuditService;
    auth: AuthService;
    organizations: OrganizationService;
    apiKeys: ApiKeyService;
    mfa: MfaService;
    evaluations: EvaluationService;
    documents: DocumentService;
    search: SearchService;
    chat: ChatService;
    usage: UsageService;
    billing: BillingService;
    webhooks: WebhookService;
    teams: TeamService;
    invites: InviteService;
  };
}

export interface ContainerDeps {
  config: AppConfig;
  logger: Logger;
  prisma: PrismaClient;
  redis: Redis;
}

export function buildContainer(deps: ContainerDeps): AppContainer {
  const { config, logger, prisma, redis } = deps;

  const metrics = new AppMetrics({ service: config.observability.serviceName });

  const encryptor = new FieldEncryptor(
    new StaticKeyProvider({
      activeKeyId: config.security.encryption.activeKeyId,
      keys: { ...config.security.encryption.keys },
    }),
  );

  const ai = createAiRegistry({
    openaiApiKey: config.ai.openaiApiKey,
    anthropicApiKey: config.ai.anthropicApiKey,
    forceFake: config.ai.forceFake || config.isTest,
  });

  const storage = createObjectStorage({
    backend: config.storage.backend,
    localRoot: config.storage.localRoot,
    bucket: config.storage.bucket,
    gcsAccessToken: config.storage.gcsAccessToken,
  });

  const googleOAuth = new GoogleOAuthClient({
    clientId: config.google.clientId,
    clientSecret: config.google.clientSecret,
  });

  const queues = createQueues(config.queue.prefix, config.redis.url);

  const repositories = {
    users: new UserRepository(prisma),
    organizations: new OrganizationRepository(prisma),
    memberships: new MembershipRepository(prisma),
    sessions: new SessionRepository(prisma),
    audit: new AuditRepository(prisma),
    apiKeys: new ApiKeyRepository(prisma),
    evaluations: new EvaluationRepository(prisma),
    documents: new DocumentRepository(prisma),
    usage: new UsageRepository(prisma),
  };

  const auditService = new AuditService(repositories.audit, logger);
  const organizationService = new OrganizationService(
    repositories.organizations,
    repositories.memberships,
  );
  const billingService = new BillingService(prisma, organizationService, auditService);
  const usageService = new UsageService(repositories.usage, billingService);
  const teamService = new TeamService(prisma, auditService);

  const resolveTeamIds = (organizationId: string, userId: string) =>
    teamService.listTeamIdsForUser(organizationId, userId);

  const apiKeyService = new ApiKeyService(repositories.apiKeys, logger);
  const mfaService = new MfaService({
    users: repositories.users,
    encryptor,
    audit: auditService,
    logger,
    issuer: config.security.mfaIssuer,
  });
  const evaluationService = new EvaluationService({
    repository: repositories.evaluations,
    audit: auditService,
    logger,
  });
  const jwtService = new JwtService({
    secret: config.auth.accessSecret,
    issuer: config.auth.issuer,
    audience: config.auth.audience,
    accessTtlSeconds: config.auth.accessTtl,
  });
  const authService = new AuthService({
    prisma,
    users: repositories.users,
    organizations: repositories.organizations,
    memberships: repositories.memberships,
    sessions: repositories.sessions,
    audit: auditService,
    jwt: jwtService,
    logger,
    mfa: mfaService,
    config: {
      accessTtl: config.auth.accessTtl,
      refreshTtl: config.auth.refreshTtl,
      passwordHashMemoryCost: config.auth.passwordHashMemoryCost,
    },
  });

  const documentService = new DocumentService({
    prisma,
    documents: repositories.documents,
    storage,
    organizations: organizationService,
    billing: billingService,
    audit: auditService,
    ingestQueue: queues.ingest,
    logger,
  });

  const searchService = new SearchService({
    prisma,
    documents: repositories.documents,
    ai,
    usage: usageService,
    config,
    resolveTeamIds,
  });

  const chatService = new ChatService({
    prisma,
    search: searchService,
    ai,
    usage: usageService,
    audit: auditService,
    organizations: organizationService,
    config,
  });

  const webhookService = new WebhookService({
    prisma,
    encryptor,
    audit: auditService,
    webhookQueue: queues.webhook,
    maxAttempts: config.webhooks.maxAttempts,
  });

  const inviteService = new InviteService(prisma, billingService, auditService);

  return {
    config,
    logger,
    prisma,
    redis,
    jwt: jwtService,
    encryptor,
    metrics,
    ai,
    storage,
    googleOAuth,
    queues,
    resolveTeamIds,
    repositories,
    services: {
      audit: auditService,
      auth: authService,
      organizations: organizationService,
      apiKeys: apiKeyService,
      mfa: mfaService,
      evaluations: evaluationService,
      documents: documentService,
      search: searchService,
      chat: chatService,
      usage: usageService,
      billing: billingService,
      webhooks: webhookService,
      teams: teamService,
      invites: inviteService,
    },
  };
}
