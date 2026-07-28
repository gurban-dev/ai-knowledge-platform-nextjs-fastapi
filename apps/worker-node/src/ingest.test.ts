import { describe, expect, it } from 'vitest';
import { FakeAiProvider } from '@akp/ai';
import { chunkText } from '@akp/ai';

describe('ingest chunking orchestration', () => {
  it('produces embeddings for every chunk with the fake provider', async () => {
    const text = Array.from({ length: 10 }, (_, i) => `Section ${i}. ${'content '.repeat(40)}`).join(
      '\n\n',
    );
    const chunks = chunkText(text, { maxChars: 200 });
    expect(chunks.length).toBeGreaterThan(1);

    const ai = new FakeAiProvider();
    const result = await ai.embed({
      texts: chunks.map((c) => c.content),
      model: 'fake',
      dimensions: 16,
    });
    expect(result.embeddings).toHaveLength(chunks.length);
    expect(result.embeddings[0]).toHaveLength(16);
  });
});
