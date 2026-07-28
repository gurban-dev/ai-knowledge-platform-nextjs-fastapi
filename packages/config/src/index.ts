import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({
  path: path.resolve(__dirname, '../../../.env'),
  // Root .env is the source of truth; do not let a stale apps/*/ .env or
  // inherited shell vars permanently shadow WEB_PUBLIC_URL / CORS_ORIGINS.
  override: true,
});

import { envSchema, type Env } from './env.js';

export type { Env } from './env.js';
export { envSchema } from './env.js';

/**
 * Strongly-typed, namespaced application configuration derived from validated env.
 * Consumers read `config.auth.accessTtl` rather than reaching into `process.env`,
 * which keeps env access centralized and the surface easy to mock in tests.
 */
export interface AppConfig {
  readonly env: Env['NODE_ENV'];
  readonly isProduction: boolean;
  readonly isTest: boolean;
  readonly logLevel: Env['LOG_LEVEL'];
  readonly server: {
    readonly host: string;
    readonly port: number;
    readonly publicUrl: string;
    readonly corsOrigins: string[];
  };
  readonly database: {
    readonly url: string;
    readonly testUrl?: string;
  };
  readonly redis: {
    readonly url: string;
  };
  readonly auth: {
    readonly accessSecret: string;
    readonly refreshSecret: string;
    readonly accessTtl: number;
    readonly refreshTtl: number;
    readonly issuer: string;
    readonly audience: string;
    readonly passwordHashMemoryCost: number;
  };
  readonly ai: {
    readonly openaiApiKey?: string;
    readonly anthropicApiKey?: string;
    readonly embeddingModel: string;
    readonly embeddingDimensions: number;
    readonly chatModel: string;
    readonly forceFake: boolean;
    readonly retrieval: {
      readonly vectorK: number;
      readonly lexicalK: number;
      readonly rerankK: number;
      readonly minScore: number;
      readonly minGroundingConfidence: number;
    };
  };
  readonly storage: {
    readonly backend: 'local' | 'gcs';
    readonly localRoot: string;
    readonly bucket: string;
    readonly gcsAccessToken?: string;
  };
  readonly queue: {
    readonly prefix: string;
    readonly ingestConcurrency: number;
    readonly webhookConcurrency: number;
  };
  readonly billing: {
    readonly stripeSecretKey?: string;
    readonly stripeWebhookSecret?: string;
  };
  readonly web: {
    readonly publicUrl: string;
  };
  readonly google: {
    /** True only when both client id and secret are configured. */
    readonly enabled: boolean;
    readonly clientId?: string;
    readonly clientSecret?: string;
  };
  readonly mcp: {
    readonly host: string;
    readonly port: number;
  };
  readonly observability: {
    readonly otelEnabled: boolean;
    readonly otelEndpoint?: string;
    readonly serviceName: string;
    readonly sentryDsn?: string;
    readonly slo: {
      readonly availabilityTarget: string;
      readonly latencyBudgetMs: number;
      readonly errorBudgetMinutesPerMonth: number;
      readonly burnAlertThreshold: string;
    };
  };
  readonly operations: {
    readonly incidentChannel: string;
    readonly runbookUrl: string;
    readonly backupProvider?: string;
    readonly lastRestoreTestAt?: string;
  };
  readonly security: {
    readonly requireMfa: boolean;
    readonly allowSso: boolean;
    readonly apiKeyRetentionDays: number;
    readonly incidentRunbookUrl: string;
    readonly mfaIssuer: string;
    readonly encryption: {
      readonly activeKeyId: string;
      /** Map of keyId -> base64-encoded 32-byte key. */
      readonly keys: Readonly<Record<string, string>>;
    };
  };
  readonly webhooks: {
    readonly maxAttempts: number;
    readonly timeoutMs: number;
  };
  readonly idempotency: {
    readonly ttlSeconds: number;
  };
  readonly retention: {
    readonly sweepEnabled: boolean;
  };
  readonly rateLimit: {
    readonly max: number;
    readonly windowMs: number;
    readonly apiKeyPerMinute: number;
  };
}

export class EncryptionKeyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncryptionKeyConfigError';
  }
}

/** Parse `keyId:base64,keyId2:base64` into a validated record. */
function parseEncryptionKeys(raw: string): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const pair of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const idx = pair.indexOf(':');
    if (idx <= 0) {
      throw new EncryptionKeyConfigError(
        `ENCRYPTION_KEYS entry "${pair}" must be in "keyId:base64Key" form`,
      );
    }
    const id = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (!id || !value) {
      throw new EncryptionKeyConfigError(`ENCRYPTION_KEYS entry "${pair}" is incomplete`);
    }
    keys[id] = value;
  }
  if (Object.keys(keys).length === 0) {
    throw new EncryptionKeyConfigError('ENCRYPTION_KEYS must contain at least one key');
  }
  return keys;
}

export class ConfigValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'ConfigValidationError';
  }
}

function shape(env: Env): AppConfig {
  return {
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    logLevel: env.LOG_LEVEL,
    server: {
      host: env.API_HOST,
      port: env.API_PORT,
      publicUrl: env.API_PUBLIC_URL,
      corsOrigins: env.CORS_ORIGINS,
    },
    database: {
      url: env.DATABASE_URL,
      ...(env.TEST_DATABASE_URL ? { testUrl: env.TEST_DATABASE_URL } : {}),
    },
    redis: { url: env.REDIS_URL },
    auth: {
      accessSecret: env.JWT_ACCESS_SECRET,
      refreshSecret: env.JWT_REFRESH_SECRET,
      accessTtl: env.JWT_ACCESS_TTL,
      refreshTtl: env.JWT_REFRESH_TTL,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      passwordHashMemoryCost: env.PASSWORD_HASH_MEMORY_COST,
    },
    ai: {
      ...(env.OPENAI_API_KEY ? { openaiApiKey: env.OPENAI_API_KEY } : {}),
      ...(env.ANTHROPIC_API_KEY ? { anthropicApiKey: env.ANTHROPIC_API_KEY } : {}),
      embeddingModel: env.EMBEDDING_MODEL,
      embeddingDimensions: env.EMBEDDING_DIMENSIONS,
      chatModel: env.CHAT_MODEL,
      forceFake: env.AI_FORCE_FAKE,
      retrieval: {
        vectorK: env.RETRIEVAL_VECTOR_K,
        lexicalK: env.RETRIEVAL_LEXICAL_K,
        rerankK: env.RETRIEVAL_RERANK_K,
        minScore: env.RETRIEVAL_MIN_SCORE,
        minGroundingConfidence: env.GROUNDING_MIN_CONFIDENCE,
      },
    },
    storage: {
      backend: env.STORAGE_BACKEND,
      localRoot: env.STORAGE_LOCAL_ROOT,
      bucket: env.STORAGE_BUCKET,
      ...(env.STORAGE_GCS_ACCESS_TOKEN
        ? { gcsAccessToken: env.STORAGE_GCS_ACCESS_TOKEN }
        : {}),
    },
    queue: {
      prefix: env.QUEUE_PREFIX,
      ingestConcurrency: env.INGEST_CONCURRENCY,
      webhookConcurrency: env.WEBHOOK_CONCURRENCY,
    },
    billing: {
      ...(env.STRIPE_SECRET_KEY ? { stripeSecretKey: env.STRIPE_SECRET_KEY } : {}),
      ...(env.STRIPE_WEBHOOK_SECRET
        ? { stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET }
        : {}),
    },
    web: { publicUrl: env.WEB_PUBLIC_URL },
    google: {
      enabled: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      ...(env.GOOGLE_CLIENT_ID ? { clientId: env.GOOGLE_CLIENT_ID } : {}),
      ...(env.GOOGLE_CLIENT_SECRET ? { clientSecret: env.GOOGLE_CLIENT_SECRET } : {}),
    },
    mcp: { host: env.MCP_HOST, port: env.MCP_PORT },
    observability: {
      otelEnabled: env.OTEL_ENABLED,
      ...(env.OTEL_EXPORTER_OTLP_ENDPOINT
        ? { otelEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT }
        : {}),
      serviceName: env.OTEL_SERVICE_NAME,
      ...(env.SENTRY_DSN ? { sentryDsn: env.SENTRY_DSN } : {}),
      slo: {
        availabilityTarget: env.SLO_AVAILABILITY_TARGET,
        latencyBudgetMs: env.SLO_LATENCY_BUDGET_MS,
        errorBudgetMinutesPerMonth: env.SLO_ERROR_BUDGET_MINUTES,
        burnAlertThreshold: env.SLO_BURN_ALERT,
      },
    },
    operations: {
      incidentChannel: env.INCIDENT_CHANNEL,
      runbookUrl: env.INCIDENT_RUNBOOK_URL,
      ...(env.BACKUP_PROVIDER ? { backupProvider: env.BACKUP_PROVIDER } : {}),
      ...(env.BACKUP_LAST_RESTORE_TEST_AT
        ? { lastRestoreTestAt: env.BACKUP_LAST_RESTORE_TEST_AT }
        : {}),
    },
    security: {
      requireMfa: env.SECURITY_REQUIRE_MFA,
      allowSso: env.SECURITY_ALLOW_SSO,
      apiKeyRetentionDays: env.SECURITY_API_KEY_RETENTION_DAYS,
      incidentRunbookUrl: env.INCIDENT_RUNBOOK_URL,
      mfaIssuer: env.MFA_ISSUER,
      encryption: {
        activeKeyId: env.ENCRYPTION_ACTIVE_KEY_ID,
        keys: parseEncryptionKeys(env.ENCRYPTION_KEYS),
      },
    },
    webhooks: {
      maxAttempts: env.WEBHOOK_MAX_ATTEMPTS,
      timeoutMs: env.WEBHOOK_TIMEOUT_MS,
    },
    idempotency: {
      ttlSeconds: env.IDEMPOTENCY_TTL_SECONDS,
    },
    retention: {
      sweepEnabled: env.RETENTION_SWEEP_ENABLED,
    },
    rateLimit: {
      max: env.RATE_LIMIT_MAX,
      windowMs: env.RATE_LIMIT_WINDOW,
      apiKeyPerMinute: env.API_KEY_RATE_LIMIT_PER_MINUTE,
    },
  };
}

/**
 * Parse and validate configuration from a raw env source (defaults to
 * `process.env`). Throws {@link ConfigValidationError} with all issues listed.
 * Pure and side-effect free so it can be called deterministically in tests.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new ConfigValidationError(issues);
  }
  return shape(parsed.data);
}

let cached: AppConfig | undefined;

/** Lazily load and memoize the process-wide config. */
export function getConfig(): AppConfig {
  cached ??= loadConfig();
  return cached;
}

/** Reset the memoized config (test-only). */
export function resetConfigCache(): void {
  cached = undefined;
}
