import { describe, it, beforeEach, afterEach, expect } from 'bun:test';
import { MintOperationProcessor } from '../../services/watchers/MintOperationProcessor';
import { EventBus } from '../../events/EventBus';
import type { CoreEvents } from '../../events/types';
import type { MintOperationService } from '../../operations/mint/MintOperationService';
import { MintOperationError, NetworkError } from '../../models/Error';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('MintOperationProcessor', () => {
  let bus: EventBus<CoreEvents>;
  let processor: MintOperationProcessor;
  let mockMintOperationService: MintOperationService;
  let finalizeCalls: string[];

  const TEST_PROCESS_INTERVAL = 50;
  const TEST_RETRY_DELAY = 100;
  const TEST_INITIAL_DELAY = 10;

  beforeEach(() => {
    bus = new EventBus<CoreEvents>();
    finalizeCalls = [];

    mockMintOperationService = {
      async finalize(operationId: string) {
        finalizeCalls.push(operationId);
      },
    } as unknown as MintOperationService;

    processor = new MintOperationProcessor(mockMintOperationService, bus, undefined, {
      processIntervalMs: TEST_PROCESS_INTERVAL,
      baseRetryDelayMs: TEST_RETRY_DELAY,
      maxRetries: 3,
      initialEnqueueDelayMs: TEST_INITIAL_DELAY,
    });
  });

  afterEach(async () => {
    if (processor.isRunning()) {
      await processor.stop();
    }
  });

  it('starts and stops correctly', async () => {
    expect(processor.isRunning()).toBe(false);

    await processor.start();
    expect(processor.isRunning()).toBe(true);

    await processor.stop();
    expect(processor.isRunning()).toBe(false);
  });

  it('processes PAID operations from mint-op:quote-state-changed', async () => {
    await processor.start();

    await bus.emit('mint-op:quote-state-changed', {
      mintUrl: 'https://mint.test',
      operationId: 'mint-op-1',
      operation: {
        id: 'mint-op-1',
        mintUrl: 'https://mint.test',
        method: 'bolt11',
      } as any,
      quoteId: 'quote-1',
      state: 'PAID',
    });

    await sleep(TEST_PROCESS_INTERVAL + 20);

    expect(finalizeCalls).toEqual(['mint-op-1']);
  });

  it('processes already-paid pending operations from mint-op:pending', async () => {
    await processor.start();

    await bus.emit('mint-op:pending', {
      mintUrl: 'https://mint.test',
      operationId: 'mint-op-2',
      operation: {
        id: 'mint-op-2',
        state: 'pending',
        mintUrl: 'https://mint.test',
        method: 'bolt11',
        lastObservedRemoteState: 'PAID',
      } as any,
    });

    await sleep(TEST_PROCESS_INTERVAL + 20);

    expect(finalizeCalls).toEqual(['mint-op-2']);
  });

  it('processes explicit mint-op:requeue events', async () => {
    await processor.start();

    await bus.emit('mint-op:requeue', {
      mintUrl: 'https://mint.test',
      operationId: 'mint-op-3',
      operation: {
        id: 'mint-op-3',
        mintUrl: 'https://mint.test',
        method: 'bolt11',
      } as any,
    });

    await sleep(TEST_PROCESS_INTERVAL + 20);

    expect(finalizeCalls).toEqual(['mint-op-3']);
  });

  it('ignores non-PAID quote-state changes', async () => {
    await processor.start();

    await bus.emit('mint-op:quote-state-changed', {
      mintUrl: 'https://mint.test',
      operationId: 'mint-op-4',
      operation: {
        id: 'mint-op-4',
        mintUrl: 'https://mint.test',
        method: 'bolt11',
      } as any,
      quoteId: 'quote-4',
      state: 'UNPAID',
    });

    await sleep(TEST_PROCESS_INTERVAL + 20);

    expect(finalizeCalls).toEqual([]);
  });

  it('deduplicates repeated enqueue requests for the same operation', async () => {
    await processor.start();

    for (let i = 0; i < 3; i++) {
      await bus.emit('mint-op:quote-state-changed', {
        mintUrl: 'https://mint.test',
        operationId: 'mint-op-5',
        operation: {
          id: 'mint-op-5',
          mintUrl: 'https://mint.test',
          method: 'bolt11',
        } as any,
        quoteId: 'quote-5',
        state: 'PAID',
      });
    }

    await sleep(TEST_PROCESS_INTERVAL + 20);

    expect(finalizeCalls).toEqual(['mint-op-5']);
  });

  it('retries network errors with exponential backoff', async () => {
    let attemptCount = 0;
    const attemptTimes: number[] = [];

    mockMintOperationService = {
      async finalize(operationId: string) {
        attemptCount++;
        attemptTimes.push(Date.now());
        if (attemptCount <= 2) {
          throw new NetworkError(`network failure for ${operationId}`);
        }
        finalizeCalls.push(operationId);
      },
    } as unknown as MintOperationService;

    processor = new MintOperationProcessor(mockMintOperationService, bus, undefined, {
      processIntervalMs: TEST_PROCESS_INTERVAL,
      baseRetryDelayMs: TEST_RETRY_DELAY,
      maxRetries: 3,
      initialEnqueueDelayMs: TEST_INITIAL_DELAY,
    });

    await processor.start();

    await bus.emit('mint-op:requeue', {
      mintUrl: 'https://mint.test',
      operationId: 'mint-op-network',
      operation: {
        id: 'mint-op-network',
        mintUrl: 'https://mint.test',
        method: 'bolt11',
      } as any,
    });

    await sleep(TEST_PROCESS_INTERVAL + 20);
    expect(attemptCount).toBe(1);

    await sleep(TEST_RETRY_DELAY + 50);
    expect(attemptCount).toBe(2);

    await sleep(TEST_RETRY_DELAY * 2 + 50);
    expect(attemptCount).toBe(3);
    expect(finalizeCalls).toEqual(['mint-op-network']);

    if (attemptTimes.length >= 2) {
      const firstRetryDelay = attemptTimes[1]! - attemptTimes[0]!;
      expect(firstRetryDelay).toBeGreaterThan(TEST_RETRY_DELAY - 20);
      expect(firstRetryDelay).toBeLessThan(TEST_RETRY_DELAY + 100);
    }

    if (attemptTimes.length >= 3) {
      const secondRetryDelay = attemptTimes[2]! - attemptTimes[1]!;
      expect(secondRetryDelay).toBeGreaterThan(TEST_RETRY_DELAY * 2 - 20);
      expect(secondRetryDelay).toBeLessThan(TEST_RETRY_DELAY * 2 + 100);
    }
  });

  it('does not retry mint operation errors', async () => {
    let attemptCount = 0;

    mockMintOperationService = {
      async finalize() {
        attemptCount++;
        throw new MintOperationError(10000, 'operation failed');
      },
    } as unknown as MintOperationService;

    processor = new MintOperationProcessor(mockMintOperationService, bus, undefined, {
      processIntervalMs: TEST_PROCESS_INTERVAL,
      baseRetryDelayMs: TEST_RETRY_DELAY,
      maxRetries: 3,
      initialEnqueueDelayMs: TEST_INITIAL_DELAY,
    });

    await processor.start();

    await bus.emit('mint-op:requeue', {
      mintUrl: 'https://mint.test',
      operationId: 'mint-op-error',
      operation: {
        id: 'mint-op-error',
        mintUrl: 'https://mint.test',
        method: 'bolt11',
      } as any,
    });

    await sleep(TEST_PROCESS_INTERVAL + 20);

    expect(attemptCount).toBe(1);
  });
});
