import { describe, expect, it } from 'vitest';
import { Role } from '@akp/core';
import type { DocumentAcl } from '@akp/db';
import { canAccessDocument, filterAccessibleDocumentIds } from './document-acl.js';

function acl(
  partial: Partial<DocumentAcl> & Pick<DocumentAcl, 'subjectType' | 'subjectId'>,
): DocumentAcl {
  return {
    id: 'acl_1',
    organizationId: 'org_1',
    documentId: 'doc_1',
    permission: 'READ',
    createdAt: new Date(),
    ...partial,
  };
}

describe('document ACL', () => {
  const member = { userId: 'usr_1', role: Role.MEMBER, teamIds: ['tem_1'] };

  it('allows organization-visible docs with empty ACL', () => {
    expect(canAccessDocument([], member)).toBe(true);
  });

  it('allows matching user subject', () => {
    expect(canAccessDocument([acl({ subjectType: 'USER', subjectId: 'usr_1' })], member)).toBe(
      true,
    );
  });

  it('allows matching team subject', () => {
    expect(canAccessDocument([acl({ subjectType: 'TEAM', subjectId: 'tem_1' })], member)).toBe(
      true,
    );
  });

  it('denies non-matching principals', () => {
    expect(canAccessDocument([acl({ subjectType: 'USER', subjectId: 'usr_other' })], member)).toBe(
      false,
    );
  });

  it('admin bypass works when enabled', () => {
    const admin = { userId: 'usr_admin', role: Role.ADMIN, teamIds: [] as string[] };
    expect(
      canAccessDocument([acl({ subjectType: 'USER', subjectId: 'usr_other' })], admin, {
        adminBypass: true,
      }),
    ).toBe(true);
  });

  it('filters document ids by ACL map', () => {
    const map = new Map<string, DocumentAcl[]>([
      ['doc_open', []],
      ['doc_private', [acl({ documentId: 'doc_private', subjectType: 'USER', subjectId: 'usr_x' })]],
    ]);
    expect(filterAccessibleDocumentIds(['doc_open', 'doc_private'], map, member)).toEqual([
      'doc_open',
    ]);
  });
});
