import type { Organization, Role, User } from '@akp/db';

/** Request-derived metadata captured for security auditing. */
export interface RequestMeta {
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Access-token lifetime in seconds (for client-side refresh scheduling). */
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export interface PublicOrganization {
  id: string;
  name: string;
  slug: string;
}

export interface AuthResult {
  user: PublicUser;
  organization: PublicOrganization;
  role: Role;
  tokens: AuthTokens;
}

export function toPublicUser(user: User): PublicUser {
  return { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl };
}

export function toPublicOrganization(org: Organization): PublicOrganization {
  return { id: org.id, name: org.name, slug: org.slug };
}
