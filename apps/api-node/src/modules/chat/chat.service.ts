import {
  ABSTENTION_MESSAGE,
  assessGrounding,
  DEFAULT_RAG_PROMPT,
  formatContextBlocks,
  renderPrompt,
  shouldAbstain,
  type AiProvider,
} from '@akp/ai';
import {
  IdPrefix,
  newId,
  NotFoundError,
  PromptInjectionError,
  scanForInjection,
  type Role,
} from '@akp/core';
import type { PrismaClient } from '@akp/db';
import type { AppConfig } from '../../config.js';
import type { SearchService } from '../search/search.service.js';
import type { UsageService } from '../usage/usage.service.js';
import type { AuditService } from '../audit/audit.service.js';
import { AuditAction } from '../audit/audit.service.js';
import type { OrganizationService } from '../organizations/organization.service.js';

export interface ChatCitation {
  documentId: string;
  chunkId: string;
  score: number;
  snippet: string;
  title: string;
  index: number;
}

export interface ChatAnswer {
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  content: string;
  citations: ChatCitation[];
  abstained: boolean;
  model: string;
  promptVersion: string;
  latencyMs: number;
  groundingConfidence: number;
}

export class ChatService {
  constructor(
    private readonly deps: {
      prisma: PrismaClient;
      search: SearchService;
      ai: AiProvider;
      usage: UsageService;
      audit: AuditService;
      organizations: OrganizationService;
      config: AppConfig;
    },
  ) {}

  async createConversation(params: {
    organizationId: string;
    userId: string;
    title?: string;
    collectionIds?: string[];
  }) {
    return this.deps.prisma.conversation.create({
      data: {
        id: newId(IdPrefix.conversation),
        organizationId: params.organizationId,
        userId: params.userId,
        title: params.title ?? 'New conversation',
        metadata: { collectionIds: params.collectionIds ?? [] },
      },
    });
  }

  async listConversations(organizationId: string, userId: string) {
    return this.deps.prisma.conversation.findMany({
      where: { organizationId, userId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
  }

  async getConversation(organizationId: string, conversationId: string, userId: string) {
    const c = await this.deps.prisma.conversation.findFirst({
      where: { id: conversationId, organizationId, userId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          include: { citations: true },
        },
      },
    });
    if (!c) throw new NotFoundError('Conversation');
    return c;
  }

  async ask(params: {
    organizationId: string;
    userId: string;
    role: Role;
    conversationId: string;
    question: string;
  }): Promise<ChatAnswer> {
    const started = Date.now();
    const injection = scanForInjection(params.question);
    if (injection.flagged) {
      throw new PromptInjectionError('Potential prompt injection detected in question', {
        score: injection.score,
        signals: injection.signals.map((s) => s.pattern),
      });
    }

    const conversation = await this.getConversation(
      params.organizationId,
      params.conversationId,
      params.userId,
    );
    const settings = await this.deps.organizations.getSettings(params.organizationId);
    const meta = conversation.metadata as { collectionIds?: string[] };
    const collectionId = meta.collectionIds?.[0];

    const hits = await this.deps.search.search({
      organizationId: params.organizationId,
      userId: params.userId,
      role: params.role,
      query: params.question,
      ...(collectionId ? { collectionId } : {}),
    });

    const topScore = hits[0]?.score ?? 0;
    const contexts = formatContextBlocks(
      hits.map((h) => ({
        title: h.title,
        content: h.content,
        documentId: h.documentId,
      })),
    );
    const prompt = renderPrompt(DEFAULT_RAG_PROMPT, {
      context: contexts || '(no context)',
      question: params.question,
    });

    let content: string;
    let model = this.deps.config.ai.chatModel;
    let promptTokens = 0;
    let completionTokens = 0;
    let costMicros = 0;
    let groundingConfidence = 0;
    let abstained = false;

    if (
      shouldAbstain({
        topScore,
        groundingConfidence: 1,
        minRetrievalScore: settings.abstainThreshold,
        minGroundingConfidence: this.deps.config.ai.retrieval.minGroundingConfidence,
      }) ||
      hits.length === 0
    ) {
      content = ABSTENTION_MESSAGE;
      abstained = true;
      groundingConfidence = 0;
    } else {
      const chat = await this.deps.ai.chat({
        model: this.deps.config.ai.chatModel,
        temperature: 0.2,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
      });
      model = chat.model;
      promptTokens = chat.promptTokens;
      completionTokens = chat.completionTokens;
      costMicros = chat.costMicros;
      content = chat.content;

      const grounding = assessGrounding(
        content,
        hits.map((h) => h.content),
      );
      groundingConfidence = grounding.confidence;
      if (
        shouldAbstain({
          topScore,
          groundingConfidence,
          minRetrievalScore: settings.abstainThreshold,
          minGroundingConfidence: this.deps.config.ai.retrieval.minGroundingConfidence,
        })
      ) {
        content = ABSTENTION_MESSAGE;
        abstained = true;
      }

      await this.deps.usage.record({
        organizationId: params.organizationId,
        userId: params.userId,
        kind: 'CHAT_COMPLETION',
        model,
        promptTokens,
        completionTokens,
        costMicros,
        latencyMs: chat.latencyMs,
        metadata: { promptVersion: prompt.promptVersion, abstained },
      });
    }

    const userMessageId = newId(IdPrefix.message);
    const assistantMessageId = newId(IdPrefix.message);
    const latencyMs = Date.now() - started;

    await this.deps.prisma.$transaction(async (tx) => {
      await tx.message.create({
        data: {
          id: userMessageId,
          organizationId: params.organizationId,
          conversationId: params.conversationId,
          role: 'USER',
          content: params.question,
        },
      });
      await tx.message.create({
        data: {
          id: assistantMessageId,
          organizationId: params.organizationId,
          conversationId: params.conversationId,
          role: 'ASSISTANT',
          content,
          promptTokens: abstained ? null : promptTokens,
          completionTokens: abstained ? null : completionTokens,
          latencyMs,
          model,
          metadata: {
            promptVersion: prompt.promptVersion,
            abstained,
            groundingConfidence,
            topScore,
          },
        },
      });
      if (!abstained) {
        for (const hit of hits) {
          await tx.citation.create({
            data: {
              id: newId(IdPrefix.citation),
              messageId: assistantMessageId,
              documentId: hit.documentId,
              chunkId: hit.chunkId,
              score: hit.score,
              snippet: hit.content.slice(0, 400),
            },
          });
        }
      }
      await tx.conversation.update({
        where: { id: params.conversationId },
        data: {
          updatedAt: new Date(),
          title:
            conversation.title === 'New conversation'
              ? params.question.slice(0, 80)
              : conversation.title,
        },
      });
    });

    await this.deps.audit.record({
      organizationId: params.organizationId,
      actorUserId: params.userId,
      action: AuditAction.ChatMessageCreated,
      resourceType: 'message',
      resourceId: assistantMessageId,
      metadata: { abstained, groundingConfidence },
    });

    return {
      conversationId: params.conversationId,
      userMessageId,
      assistantMessageId,
      content,
      citations: abstained
        ? []
        : hits.map((h, index) => ({
            documentId: h.documentId,
            chunkId: h.chunkId,
            score: h.score,
            snippet: h.content.slice(0, 400),
            title: h.title,
            index: index + 1,
          })),
      abstained,
      model,
      promptVersion: prompt.promptVersion,
      latencyMs,
      groundingConfidence,
    };
  }
}
