import { describe, expect, it } from 'vitest';
import { EvaluationService } from './evaluation.service.js';

describe('EvaluationService', () => {
  it('computes aggregate quality metrics and hallucination rate', () => {
    const service = new EvaluationService({} as never);

    const summary = service.buildSummary([
      {
        question: 'What is the policy?',
        expected: 'Policy A',
        answer: 'Policy A',
        scores: { faithfulness: 0.9, answerRelevance: 0.8, contextPrecision: 0.7, contextRecall: 0.6 },
        hallucinated: false,
      },
      {
        question: 'What is the SLA?',
        expected: '99.9%',
        answer: '97%',
        scores: { faithfulness: 0.5, answerRelevance: 0.4, contextPrecision: 0.8, contextRecall: 0.3 },
        hallucinated: true,
      },
    ]);

    expect(summary).toMatchObject({
      sampleCount: 2,
      averageFaithfulness: 0.7,
      averageAnswerRelevance: 0.6,
      averageContextPrecision: 0.75,
      averageContextRecall: 0.45,
      hallucinationRate: 0.5,
    });
  });
});
