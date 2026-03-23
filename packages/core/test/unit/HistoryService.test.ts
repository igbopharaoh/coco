import { describe, it, beforeEach, expect } from 'bun:test';
import { HistoryService } from '../../services/HistoryService';
import { EventBus } from '../../events/EventBus';
import type { CoreEvents } from '../../events/types';
import type { HistoryRepository } from '../../repositories';
import type { HistoryEntry, MintHistoryEntry } from '../../models/History';
import type { PendingMintOperation } from '../../operations/mint';

describe('HistoryService - mint operations', () => {
  let service: HistoryService;
  let mockRepo: HistoryRepository;
  let eventBus: EventBus<CoreEvents>;
  let historyEntries: Map<string, HistoryEntry>;
  let historyUpdateEvents: Array<{ mintUrl: string; entry: HistoryEntry }>;

  const makePendingOperation = (
    quoteId: string,
    overrides: Partial<PendingMintOperation> = {},
  ): PendingMintOperation =>
    ({
      id: `mint-op-${quoteId}`,
      state: 'pending',
      mintUrl: 'https://mint.test',
      method: 'bolt11',
      methodData: {},
      amount: 1000,
      unit: 'sat',
      quoteId,
      request: `request-${quoteId}`,
      expiry: Math.floor(Date.now() / 1000) + 3600,
      outputData: { keep: [], send: [] },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastObservedRemoteState: 'UNPAID',
      lastObservedRemoteStateAt: Date.now(),
      ...overrides,
    }) as PendingMintOperation;

  beforeEach(() => {
    historyEntries = new Map();
    historyUpdateEvents = [];

    mockRepo = {
      async addHistoryEntry(entry: Omit<HistoryEntry, 'id'>): Promise<HistoryEntry> {
        const id = Math.random().toString(36).substring(7);
        const fullEntry = { ...entry, id } as HistoryEntry;
        historyEntries.set(id, fullEntry);
        return fullEntry;
      },
      async getMintHistoryEntry(
        mintUrl: string,
        quoteId: string,
      ): Promise<MintHistoryEntry | null> {
        for (const entry of historyEntries.values()) {
          if (entry.type === 'mint' && entry.mintUrl === mintUrl && entry.quoteId === quoteId) {
            return entry as MintHistoryEntry;
          }
        }
        return null;
      },
      async getPaginatedHistoryEntries(): Promise<HistoryEntry[]> {
        return Array.from(historyEntries.values());
      },
      async getMeltHistoryEntry(): Promise<null> {
        return null;
      },
      async getSendHistoryEntry(): Promise<null> {
        return null;
      },
      async getReceiveHistoryEntry(): Promise<null> {
        return null;
      },
      async updateHistoryEntryState(): Promise<void> {},
      async getHistoryEntryById(): Promise<null> {
        return null;
      },
      async updateHistoryEntry(entry: HistoryEntry): Promise<HistoryEntry> {
        historyEntries.set(entry.id, entry);
        return entry;
      },
      async updateSendHistoryState(): Promise<void> {},
      async deleteHistoryEntry(): Promise<void> {},
    } as HistoryRepository;

    eventBus = new EventBus<CoreEvents>();
    eventBus.on('history:updated', (payload) => {
      historyUpdateEvents.push(payload);
    });

    service = new HistoryService(mockRepo, eventBus);
  });

  it('creates history entry for mint-op:pending', async () => {
    const operation = makePendingOperation('pending-quote', {
      amount: 1000,
      request: 'lnbc1000...',
      lastObservedRemoteState: 'UNPAID',
    });

    await eventBus.emit('mint-op:pending', {
      mintUrl: operation.mintUrl,
      operationId: operation.id,
      operation,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(historyEntries.size).toBe(1);
    const entry = Array.from(historyEntries.values())[0] as MintHistoryEntry;
    expect(entry.type).toBe('mint');
    expect(entry.mintUrl).toBe(operation.mintUrl);
    expect(entry.quoteId).toBe(operation.quoteId);
    expect(entry.amount).toBe(operation.amount);
    expect(entry.state).toBe('UNPAID');
    expect(entry.unit).toBe(operation.unit);
    expect(entry.paymentRequest).toBe(operation.request);
    expect(historyUpdateEvents.length).toBe(1);
  });

  it('updates existing history entry on mint-op:quote-state-changed', async () => {
    const operation = makePendingOperation('stateful-quote', {
      amount: 500,
      request: 'lnbc500...',
      lastObservedRemoteState: 'UNPAID',
    });

    await mockRepo.addHistoryEntry({
      type: 'mint',
      mintUrl: operation.mintUrl,
      quoteId: operation.quoteId,
      amount: operation.amount,
      state: 'UNPAID',
      unit: operation.unit,
      paymentRequest: operation.request,
      createdAt: operation.createdAt,
    } as Omit<MintHistoryEntry, 'id'>);

    await eventBus.emit('mint-op:quote-state-changed', {
      mintUrl: operation.mintUrl,
      operationId: operation.id,
      operation,
      quoteId: operation.quoteId,
      state: 'PAID',
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const entry = Array.from(historyEntries.values())[0] as MintHistoryEntry;
    expect(entry.state).toBe('PAID');
    expect(historyUpdateEvents.length).toBe(1);
    expect(historyUpdateEvents[0]?.entry.type).toBe('mint');
  });

  it('updates an existing history entry instead of creating a duplicate pending entry', async () => {
    const operation = makePendingOperation('existing-quote', {
      amount: 750,
      request: 'lnbc750...',
      lastObservedRemoteState: 'PAID',
    });

    await mockRepo.addHistoryEntry({
      type: 'mint',
      mintUrl: operation.mintUrl,
      quoteId: operation.quoteId,
      amount: 10,
      state: 'UNPAID',
      unit: operation.unit,
      paymentRequest: 'old-request',
      createdAt: operation.createdAt,
    } as Omit<MintHistoryEntry, 'id'>);

    await eventBus.emit('mint-op:pending', {
      mintUrl: operation.mintUrl,
      operationId: operation.id,
      operation,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(historyEntries.size).toBe(1);
    const entry = Array.from(historyEntries.values())[0] as MintHistoryEntry;
    expect(entry.amount).toBe(operation.amount);
    expect(entry.paymentRequest).toBe(operation.request);
    expect(entry.state).toBe('PAID');
    expect(historyUpdateEvents.length).toBe(1);
  });
});
