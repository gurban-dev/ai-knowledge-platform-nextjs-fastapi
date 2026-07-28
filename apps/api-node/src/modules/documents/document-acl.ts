import { Role, roleSatisfies } from '@akp/core';
import type { DocumentAcl } from '@akp/db';

export interface AclPrincipal {
  userId: string;
  role: Role;
  teamIds: string[];
}

/**
 * Document ACL evaluation.
 * - Empty ACL list → organization-visible (default for member uploads).
 * - Non-empty → principal must match USER, TEAM, or ROLE subject.
 * OWNER/ADMIN bypass for administrative operations when `adminBypass` is set.
 */
export function canAccessDocument(
  acls: DocumentAcl[],
  principal: AclPrincipal,
  options?: { adminBypass?: boolean },
): boolean {
  if (options?.adminBypass && roleSatisfies(principal.role, Role.ADMIN)) {
    return true;
  }
  if (acls.length === 0) return true;

  for (const acl of acls) {
    if (acl.subjectType === 'USER' && acl.subjectId === principal.userId) return true;
    if (acl.subjectType === 'TEAM' && principal.teamIds.includes(acl.subjectId)) return true;
    if (acl.subjectType === 'ROLE') {
      const required = acl.subjectId as Role;
      if (Object.values(Role).includes(required) && roleSatisfies(principal.role, required)) {
        return true;
      }
    }
  }
  return false;
}

export function filterAccessibleDocumentIds(
  documentIds: string[],
  aclsByDocument: Map<string, DocumentAcl[]>,
  principal: AclPrincipal,
): string[] {
  return documentIds.filter((id) =>
    canAccessDocument(aclsByDocument.get(id) ?? [], principal),
  );
}
