import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, INTEGRATION_ENABLED, type TestHarness } from './harness.js';

/**
 * End-to-end knowledge flow against real Postgres (pgvector) + Redis:
 *   register → upload document → ingest → hybrid search → grounded chat.
 *
 * The deterministic FakeAiProvider (auto-selected in NODE_ENV=test) keeps
 * embeddings, reranking, and generation reproducible with no network calls.
 */

const OWNER = {
  email: 'owner@knowledge.test',
  password: 'KnowledgePass1',
  name: 'Knowledge Owner',
  organizationName: 'Knowledge Co',
};

const VPN_DOC = {
  title: 'Acme Remote Access and VPN Policy',
  mimeType: 'text/plain',
  content: [
    'Acme Corporation Remote Access and VPN Policy.',
    '',
    'All employees who connect to the corporate network from outside the office',
    'must use the approved VPN client. To connect, employees authenticate with',
    'their single sign-on credentials and an MFA token. The VPN gateway enforces',
    'least-privilege access: contractors receive access only to the specific',
    'systems required for their engagement. Remote sessions automatically',
    'disconnect after thirty minutes of inactivity. Employees must never share',
    'their VPN credentials or MFA devices with anyone.',
    '',
    'This knowledge base article has provided context and sources so the',
    'assistant can answer questions only using grounded facts drawn from',
    'approved company knowledge.',
  ].join('\n'),
};

const VPN_QUESTION =
  'How do employees connect to the corporate network, and what VPN credentials and access rules apply to remote sessions?';

async function registerOwner(harness: TestHarness): Promise<string> {
  const res = await harness.app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: OWNER,
  });
  expect(res.statusCode).toBe(201);
  return res.json().tokens.accessToken as string;
}

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

describe.skipIf(!INTEGRATION_ENABLED)('Knowledge flow (integration)', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
  });

  it('walks register → upload → ingest → search → grounded chat with citations', async () => {
    const token = await registerOwner(harness);

    // 1. Upload the document.
    const upload = await harness.app.inject({
      method: 'POST',
      url: '/v1/documents',
      headers: authHeaders(token),
      payload: VPN_DOC,
    });
    expect(upload.statusCode).toBe(201);
    const documentId = upload.json().id as string;
    expect(documentId).toMatch(/^doc_/);

    // The org this document belongs to (derived from the profile).
    const me = await harness.app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: authHeaders(token),
    });
    const organizationId = me.json().organization.id as string;

    // 2. Run ingestion (chunk → embed → pgvector), mirroring the worker.
    const chunkCount = await harness.ingest(organizationId, documentId);
    expect(chunkCount).toBeGreaterThan(0);

    // 3. The document is now listed as INDEXED.
    const list = await harness.app.inject({
      method: 'GET',
      url: '/v1/documents',
      headers: authHeaders(token),
    });
    expect(list.statusCode).toBe(200);
    const documents = list.json().documents as { id: string; status: string }[];
    const listed = documents.find((d) => d.id === documentId);
    expect(listed).toBeDefined();
    expect(listed?.status).toBe('INDEXED');

    // 4. Hybrid retrieval surfaces the ingested document.
    const search = await harness.app.inject({
      method: 'POST',
      url: '/v1/search',
      headers: authHeaders(token),
      payload: { query: VPN_QUESTION },
    });
    expect(search.statusCode).toBe(200);
    const hits = search.json().hits as { documentId: string; score: number }[];
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.documentId === documentId)).toBe(true);

    // 5. Grounded chat returns an answer with citations that map to the document.
    const convo = await harness.app.inject({
      method: 'POST',
      url: '/v1/conversations',
      headers: authHeaders(token),
      payload: { title: 'VPN questions' },
    });
    expect(convo.statusCode).toBe(201);
    const conversationId = convo.json().id as string;

    const answer = await harness.app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/messages`,
      headers: authHeaders(token),
      payload: { question: VPN_QUESTION },
    });
    expect(answer.statusCode).toBe(200);
    const body = answer.json();
    expect(body.abstained).toBe(false);
    expect(body.citations.length).toBeGreaterThan(0);
    expect(body.citations[0].documentId).toBe(documentId);
    expect(body.groundingConfidence).toBeGreaterThan(0);
    expect(body.promptVersion).toBe('rag-default@1');

    // Citations are persisted with the assistant message.
    const persisted = await harness.prisma.citation.count({
      where: { messageId: body.assistantMessageId },
    });
    expect(persisted).toBe(body.citations.length);

    // 6. Usage/cost accounting recorded the retrieval + chat events. (The
    //    deterministic offline provider is priced at zero, so we assert on
    //    recorded events/tokens rather than dollar spend.)
    const usage = await harness.app.inject({
      method: 'GET',
      url: '/v1/usage/summary',
      headers: authHeaders(token),
    });
    expect(usage.statusCode).toBe(200);
    const usageBody = usage.json();
    expect(typeof usageBody.spentMicros).toBe('string');
    const breakdown = usageBody.breakdown as {
      kind: string;
      totalTokens: string;
      events: number;
    }[];
    const kinds = breakdown.map((b) => b.kind);
    expect(kinds).toContain('EMBEDDING');
    expect(kinds).toContain('CHAT_COMPLETION');
    const chatRow = breakdown.find((b) => b.kind === 'CHAT_COMPLETION')!;
    expect(chatRow.events).toBeGreaterThan(0);
    expect(Number(chatRow.totalTokens)).toBeGreaterThan(0);
  });

  it('abstains (no citations) when no relevant knowledge exists', async () => {
    const token = await registerOwner(harness);

    const convo = await harness.app.inject({
      method: 'POST',
      url: '/v1/conversations',
      headers: authHeaders(token),
      payload: {},
    });
    const conversationId = convo.json().id as string;

    const answer = await harness.app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/messages`,
      headers: authHeaders(token),
      payload: { question: 'What were our third quarter revenue figures for the Berlin office?' },
    });
    expect(answer.statusCode).toBe(200);
    const body = answer.json();
    expect(body.abstained).toBe(true);
    expect(body.citations).toHaveLength(0);
  });

  it('enforces document ACLs in the retrieval path', async () => {
    const token = await registerOwner(harness);

    const upload = await harness.app.inject({
      method: 'POST',
      url: '/v1/documents',
      headers: authHeaders(token),
      payload: VPN_DOC,
    });
    const documentId = upload.json().id as string;
    const me = await harness.app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: authHeaders(token),
    });
    const organizationId = me.json().organization.id as string;
    await harness.ingest(organizationId, documentId);

    const runSearch = async () => {
      const res = await harness.app.inject({
        method: 'POST',
        url: '/v1/search',
        headers: authHeaders(token),
        payload: { query: VPN_QUESTION },
      });
      return res.json().hits as { documentId: string }[];
    };

    // Baseline: visible with no ACL entries (organization-visible default).
    expect((await runSearch()).some((h) => h.documentId === documentId)).toBe(true);

    // Restrict the document to a different user → the owner no longer retrieves
    // it (search does NOT apply admin bypass; ACLs are enforced pre-rerank).
    const restrict = await harness.app.inject({
      method: 'PUT',
      url: `/v1/documents/${documentId}/acls`,
      headers: authHeaders(token),
      payload: { entries: [{ subjectType: 'USER', subjectId: 'usr_someone_else', permission: 'READ' }] },
    });
    expect(restrict.statusCode).toBe(200);
    expect((await runSearch()).some((h) => h.documentId === documentId)).toBe(false);

    // Grant access back via a role ACL the owner satisfies.
    const grant = await harness.app.inject({
      method: 'PUT',
      url: `/v1/documents/${documentId}/acls`,
      headers: authHeaders(token),
      payload: { entries: [{ subjectType: 'ROLE', subjectId: 'VIEWER', permission: 'READ' }] },
    });
    expect(grant.statusCode).toBe(200);
    expect((await runSearch()).some((h) => h.documentId === documentId)).toBe(true);
  });
});
