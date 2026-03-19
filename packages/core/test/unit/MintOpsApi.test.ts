import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { MintOpsApi } from '../../api/MintOpsApi.ts';
import type { MintOperationService } from '../../operations/mint/MintOperationService.ts';
import type {
  ExecutingMintOperation,
  FinalizedMintOperation,
  MintOperation,
  PendingMintOperation,
  TerminalMintOperation,
} from '../../operations/mint/MintOperation.ts';

const mintUrl = 'https://mint.test';
const quoteId = 'quote-1';

const makePendingOperation = (): PendingMintOperation => ({
  id: 'op-1',
  state: 'pending',
  mintUrl,
  quoteId,
  method: 'bolt11',
  methodData: {},
  createdAt: Date.now(),
  updatedAt: Date.now(),
  amount: 10,
  outputData: { keep: [], send: [] },
});

describe('MintOpsApi', () => {
  let api: MintOpsApi;
  let mintOperationService: MintOperationService;
  let pendingOperation: PendingMintOperation;

  beforeEach(() => {
    pendingOperation = makePendingOperation();
    const executingOperation: ExecutingMintOperation = {
      ...pendingOperation,
      state: 'executing',
    };
    const finalizedOperation: TerminalMintOperation = {
      ...pendingOperation,
      state: 'finalized',
    };

    mintOperationService = {
      init: mock(async () => ({ id: pendingOperation.id })),
      prepare: mock(async () => pendingOperation),
      execute: mock(async () => finalizedOperation),
      getOperation: mock(async () => pendingOperation),
      getOperationByQuote: mock(async () => pendingOperation),
      getPendingOperations: mock(async () => [pendingOperation]),
      getInFlightOperations: mock(async () => [pendingOperation, executingOperation]),
      checkPendingOperation: mock(async () => 'unpaid'),
      recoverExecutingOperation: mock(async () => {}),
      finalize: mock(async () => finalizedOperation),
      recoverPendingOperations: mock(async () => {}),
      isOperationLocked: mock(() => false),
      isRecoveryInProgress: mock(() => false),
    } as unknown as MintOperationService;

    api = new MintOpsApi(mintOperationService);
  });

  it('prepare creates an operation and returns a pending mint operation', async () => {
    const result = await api.prepare({
      mintUrl,
      quoteId,
      method: 'bolt11',
      methodData: {},
    });

    expect(mintOperationService.init).toHaveBeenCalledWith(mintUrl, quoteId, 'bolt11', {});
    expect(mintOperationService.prepare).toHaveBeenCalledWith('op-1');
    expect(result).toBe(pendingOperation);
  });

  it('execute only allows pending operations', async () => {
    const result = await api.execute(pendingOperation.id);

    expect(mintOperationService.getOperation).toHaveBeenCalledWith(pendingOperation.id);
    expect(mintOperationService.execute).toHaveBeenCalledWith(pendingOperation.id);
    expect(result.state).toBe('finalized');

    (mintOperationService.getOperation as unknown as ReturnType<typeof mock>).mockResolvedValueOnce({
      ...pendingOperation,
      state: 'executing',
    } as MintOperation);

    await expect(api.execute(pendingOperation.id)).rejects.toThrow("Expected 'pending'");
  });

  it('listPending and listInFlight delegate to separate service methods', async () => {
    const pending = await api.listPending();
    const inFlight = await api.listInFlight();

    expect(mintOperationService.getPendingOperations).toHaveBeenCalledWith();
    expect(mintOperationService.getInFlightOperations).toHaveBeenCalledWith();
    expect(pending).toEqual([pendingOperation]);
    expect(inFlight).toHaveLength(2);
  });

  it('refresh reconciles pending and executing operations', async () => {
    const finalizedOperation: TerminalMintOperation = {
      ...pendingOperation,
      state: 'finalized',
    };

    (mintOperationService.getOperation as unknown as ReturnType<typeof mock>)
      .mockResolvedValueOnce(pendingOperation as MintOperation)
      .mockResolvedValueOnce(finalizedOperation as MintOperation);

    const refreshedPending = await api.refresh(pendingOperation.id);

    expect(mintOperationService.checkPendingOperation).toHaveBeenCalledWith(pendingOperation.id);
    expect(refreshedPending).toBe(finalizedOperation);

    const executingOperation: ExecutingMintOperation = {
      ...pendingOperation,
      state: 'executing',
    };

    (mintOperationService.getOperation as unknown as ReturnType<typeof mock>)
      .mockResolvedValueOnce(executingOperation as MintOperation)
      .mockResolvedValueOnce(finalizedOperation as MintOperation);

    const refreshedExecuting = await api.refresh(pendingOperation.id);

    expect(mintOperationService.recoverExecutingOperation).toHaveBeenCalledWith(executingOperation);
    expect(refreshedExecuting).toBe(finalizedOperation);
  });
});
