import { z } from 'zod';
import { ALL_ROLES } from '@akp/core';

export const organizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  status: z.string(),
  createdAt: z.string(),
});

export const memberSchema = z.object({
  userId: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.enum(ALL_ROLES as [string, ...string[]]),
  status: z.string(),
  joinedAt: z.string(),
});

export const membersResponseSchema = z.object({
  members: z.array(memberSchema),
});

/**
 * Canonical, validated organization governance settings. This is the single
 * source of truth for the shape persisted in `organizations.settings` (JSON),
 * the API response, and the defaults applied when a field is absent. Extending
 * governance here (residency, budgets, provider controls) keeps enterprise
 * policy in one auditable place rather than scattered flags.
 */
export const AI_PROVIDERS = ['openai', 'anthropic'] as const;
export const DATA_RESIDENCY_REGIONS = ['us', 'eu', 'global'] as const;

export const organizationSettingsSchema = z.object({
  /** Allow SSO (SAML/OIDC) sign-in for this organization. */
  allowSso: z.boolean().default(false),
  /** Require MFA for all interactive sign-ins. */
  requireMfa: z.boolean().default(false),
  /** Allow issuing programmatic API keys. */
  allowApiKeys: z.boolean().default(true),
  /** Data retention window (days) for audit logs, usage, and conversations. */
  retentionDays: z.number().int().min(1).max(3650).default(365),
  /** Data residency region the tenant's data must be pinned to. */
  dataResidencyRegion: z.enum(DATA_RESIDENCY_REGIONS).default('global'),
  /** Hard monthly AI spend cap in micro-USD; null disables enforcement. */
  monthlySpendCapMicros: z.number().int().nonnegative().nullable().default(null),
  /** AI providers permitted for this tenant (some customers forbid US providers). */
  allowedAiProviders: z.array(z.enum(AI_PROVIDERS)).default([...AI_PROVIDERS]),
  /** Redact detected PII from ingested content and model inputs. */
  piiRedactionEnabled: z.boolean().default(true),
  /** Retrieval confidence below which the assistant abstains ("I don't know"). */
  abstainThreshold: z.number().min(0).max(1).default(0.15),
  /** Whether the tenant permits AI providers to retain/train on their data. */
  allowModelTraining: z.boolean().default(false),
});

export type OrganizationSettings = z.infer<typeof organizationSettingsSchema>;

/** Fully-defaulted settings, used when an org has never configured governance. */
export const defaultOrganizationSettings: OrganizationSettings =
  organizationSettingsSchema.parse({});

export const updateOrganizationSettingsBodySchema = organizationSettingsSchema.partial();

export type UpdateOrganizationSettingsInput = z.infer<
  typeof updateOrganizationSettingsBodySchema
>;
