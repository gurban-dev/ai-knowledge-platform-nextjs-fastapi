import { z } from 'zod';
import { ALL_ROLES } from '@akp/core';

/** Password policy: length + basic complexity. Enforced at the edge via Zod. */
export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(200, 'Password must be at most 200 characters')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a digit');

export const emailSchema = z.string().trim().toLowerCase().email().max(320);

export const registerBodySchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1).max(120),
  organizationName: z.string().trim().min(2).max(120),
});

export const loginBodySchema = z.object({
  email: emailSchema,
  // Do not apply the complexity regex on login — only registration mints new
  // passwords; login must accept whatever was previously set.
  password: z.string().min(1).max(200),
  // Optional second factor; required when the account has MFA enabled.
  mfaToken: z.string().trim().min(6).max(10).optional(),
  recoveryCode: z.string().trim().min(6).max(20).optional(),
});

export const refreshBodySchema = z.object({
  refreshToken: z.string().min(1),
});

/** Body for completing the Google OAuth authorization-code exchange. */
export const googleExchangeBodySchema = z.object({
  code: z.string().min(1).max(2048),
  redirectUri: z.string().url(),
  /** Signed OAuth state returned by /google/start (binds PKCE verifier + redirect). */
  state: z.string().min(1).max(4096),
});

/**
 * Body for the Google Identity Services button / One Tap credential callback.
 * The `idToken` is Google's OIDC JWT (`credential` field from GIS).
 */
export const googleCredentialBodySchema = z.object({
  idToken: z.string().min(1).max(8192),
});

/** Complete an MFA challenge after password or Google primary-factor success. */
export const completeMfaBodySchema = z.object({
  mfaToken: z.string().min(1).max(4096),
  mfaCode: z.string().trim().min(6).max(10).optional(),
  recoveryCode: z.string().trim().min(6).max(20).optional(),
});

export const logoutBodySchema = z.object({
  refreshToken: z.string().min(1),
});

/* ----------------------------- responses -------------------------------- */

export const tokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int(),
  tokenType: z.literal('Bearer'),
});

export const publicUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
});

export const publicOrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
});

export const roleSchema = z.enum(ALL_ROLES as [string, ...string[]]);

export const authResultSchema = z.object({
  user: publicUserSchema,
  organization: publicOrganizationSchema,
  role: roleSchema,
  tokens: tokensSchema,
});

export const profileSchema = z.object({
  user: publicUserSchema,
  organization: publicOrganizationSchema,
  role: roleSchema,
});

export const googleStartResponseSchema = z.object({
  authorizationUrl: z.string().url(),
  state: z.string(),
});

export type RegisterBody = z.infer<typeof registerBodySchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;
export type RefreshBody = z.infer<typeof refreshBodySchema>;
export type LogoutBody = z.infer<typeof logoutBodySchema>;
export type GoogleExchangeBody = z.infer<typeof googleExchangeBodySchema>;
export type GoogleCredentialBody = z.infer<typeof googleCredentialBodySchema>;
export type CompleteMfaBody = z.infer<typeof completeMfaBodySchema>;
