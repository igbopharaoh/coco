import { describe, it, beforeEach, expect, mock, type Mock } from 'bun:test';
import { OutputData, type Proof } from '@cashu/cashu-ts';
import { EventBus } from '../../events/EventBus';
import type { CoreEvents } from '../../events/types';
import { MintOperationService } from '../../operations/mint/MintOperationService';
import type {
  ExecutingMintOperation,
  InitMintOperation,
  PendingMintOperation,
} from '../../operations/mint/MintOperation';
import type {
  MintExecutionResult,
  MintMethodHandler,
  PendingMintCheckResult,
  RecoverExecutingResult,
} from '../../operations/mint/MintMethodHandler';
import type { MintHandlerProvider } from '../../infra/handlers/mint';
import { MemoryMintOperationRepository } from '../../repositories/memory/MemoryMintOperationRepository';
import { MemoryMintQuoteRepository } from '../../repositories/memory/MemoryMintQuoteRepository';
import { MemoryProofRepository } from '../../repositories/memory/MemoryProofRepository';
import type { MintService } from '../../services/MintService';
import type { WalletService } from '../../services/WalletService';
import type { ProofService } from '../../services/ProofService';
import type { MintAdapter } from '../../infra/MintAdapter';
import { serializeOutputData } from '../../utils';
import type { CoreProof } from '../../types';

describe('MintOperationService', () => {
  const mintUrl = 'https://mint.test';
  const quoteId = 'quote-1';
  const keysetId = 'keyset-1';

  let operationRepo: MemoryMintOperationRepository;
  let mintQuoteRepo: MemoryMintQuoteRepository;
  let proofRepo: MemoryProofRepository;
  let proofService: ProofService;
  let mintService: MintService;
  let walletService: WalletService;
  let mintAdapter: MintAdapter;
  let eventBus: EventBus<CoreEvents>;
  let handler: MintMethodHandler<'bolt11'>;
  let handlerProvider: MintHandlerProvider;
  let service: MintOperationService;

  const makeProof = (secret: string): Proof =>
    ({
      id: keysetId,
      amount: 10,
      secret,
      C: `C_${secret}`,
    }) as Proof;

  const makeSerializedOutputData = (secret: string) =>
    serializeOutputData({
      keep: [
        new OutputData(
          {
            amount: 10,
            id: keysetId,
            B_: `B_${secret}`,
          },
          BigInt(1),
          new TextEncoder().encode(secret),
        ),
      ],
      send: [],
    });

  const toCoreProof = (secret: string, operationId: string): CoreProof => ({
    id: keysetId,
    amount: 10,
    secret,
    C: `C_${secret}`,
    mintUrl,
    state: 'ready',
    createdByOperationId: operationId,
  });

  const makeInitOp = (id: string): InitMintOperation => ({
    id,
    state: 'init',
    mintUrl,
    quoteId,
    method: 'bolt11',
    methodData: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  const makePendingOp = (id: string, secret = 'out-1'): PendingMintOperation => ({
    ...makeInitOp(id),
    state: 'pending',
    amount: 10,
    outputData: makeSerializedOutputData(secret),
  });

  const makeExecutingOp = (id: string, secret = 'out-1'): ExecutingMintOperation => ({
    ...makePendingOp(id, secret),
    state: 'executing',
  });

  beforeEach(async () => {
    operationRepo = new MemoryMintOperationRepository();
    mintQuoteRepo = new MemoryMintQuoteRepository();
    proofRepo = new MemoryProofRepository();
    eventBus = new EventBus<CoreEvents>();

    await mintQuoteRepo.addMintQuote({
      mintUrl,
      quote: quoteId,
      request: 'lnbc1test',
      amount: 10,
      unit: 'sat',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      state: 'PAID',
    });

    const mockPrepare = mock(async ({ operation }: { operation: InitMintOperation }) => {
      return makePendingOp(operation.id);
    });

    const mockExecute = mock(async (): Promise<MintExecutionResult> => {
      return { status: 'ISSUED', proofs: [makeProof('out-1')] };
    });

    const mockRecoverExecuting = mock(async (): Promise<RecoverExecutingResult> => {
      return { status: 'PENDING' };
    });

    const mockCheckPending = mock(async (): Promise<PendingMintCheckResult> => 'unpaid');

    handler = {
      prepare: mockPrepare,
      execute: mockExecute,
      recoverExecuting: mockRecoverExecuting,
      checkPending: mockCheckPending,
    };

    handlerProvider = {
      get: mock(() => handler),
    } as unknown as MintHandlerProvider;

    proofService = {
      saveProofs: mock(async (_mintUrl: string, proofs: CoreProof[]) => {
        await proofRepo.saveProofs(mintUrl, proofs);
      }),
      recoverProofsFromOutputData: mock(async (_mintUrl: string, _outputData, options) => {
        if (!options?.createdByOperationId) {
          return [];
        }
        await proofRepo.saveProofs(mintUrl, [toCoreProof('out-1', options.createdByOperationId)]);
        return [makeProof('out-1')];
      }),
    } as unknown as ProofService;

    mintService = {
      isTrustedMint: mock(async () => true),
    } as unknown as MintService;

    walletService = {
      getWalletWithActiveKeysetId: mock(async () => ({ wallet: {} })),
    } as unknown as WalletService;

    mintAdapter = {} as MintAdapter;

    service = new MintOperationService(
      handlerProvider,
      operationRepo,
      mintQuoteRepo,
      proofRepo,
      proofService,
      mintService,
      walletService,
      mintAdapter,
      eventBus,
    );
  });

  it('redeem runs init -> pending -> execute and finalizes quote/proofs', async () => {
    const redeemedEvents: Array<CoreEvents['mint-quote:redeemed']> = [];
    eventBus.on('mint-quote:redeemed', (event) => {
      redeemedEvents.push(event);
    });

    const finalized = await service.redeem(mintUrl, quoteId);

    expect(finalized?.state).toBe('finalized');

    const quote = await mintQuoteRepo.getMintQuote(mintUrl, quoteId);
    expect(quote?.state).toBe('ISSUED');

    const stored = await operationRepo.getByQuoteId(mintUrl, quoteId);
    expect(stored.length).toBe(1);
    expect(stored[0]?.state).toBe('finalized');

    const saved = await proofRepo.getProofBySecret(mintUrl, 'out-1');
    expect(saved).not.toBeNull();
    expect(saved?.createdByOperationId).toBe(finalized?.id);

    expect(redeemedEvents.length).toBe(1);
    expect(redeemedEvents[0]?.quoteId).toBe(quoteId);
  });

  it('redeem is idempotent after finalize', async () => {
    const first = await service.redeem(mintUrl, quoteId);
    const second = await service.redeem(mintUrl, quoteId);

    expect(first?.state).toBe('finalized');
    expect(second?.id).toBe(first?.id);

    const ops = await operationRepo.getByQuoteId(mintUrl, quoteId);
    expect(ops.length).toBe(1);
  });

  it('recoverExecutingOperation finalizes when handler marks FINALIZED', async () => {
    const op = makeExecutingOp('exec-1');
    await operationRepo.create(op);

    (handler.recoverExecuting as Mock<any>).mockResolvedValueOnce({ status: 'FINALIZED' });

    await service.recoverExecutingOperation(op);

    const stored = await operationRepo.getById(op.id);
    expect(stored?.state).toBe('finalized');

    const quote = await mintQuoteRepo.getMintQuote(mintUrl, quoteId);
    expect(quote?.state).toBe('ISSUED');
  });

  it('recoverExecutingOperation returns to pending when quote was not issued remotely', async () => {
    const op = makeExecutingOp('exec-2');
    await operationRepo.create(op);

    (handler.recoverExecuting as Mock<any>).mockResolvedValueOnce({
      status: 'PENDING',
      error: 'Recovered: quote not issued remotely',
    });

    await service.recoverExecutingOperation(op);

    const stored = await operationRepo.getById(op.id);
    expect(stored?.state).toBe('pending');
    expect(stored?.error).toBe('Recovered: quote not issued remotely');

    const quote = await mintQuoteRepo.getMintQuote(mintUrl, quoteId);
    expect(quote?.state).toBe('PAID');
  });

  it('recoverExecutingOperation returns to pending when proofs are not recoverable', async () => {
    const op = makeExecutingOp('exec-3');
    await operationRepo.create(op);

    (handler.recoverExecuting as Mock<any>).mockResolvedValueOnce({ status: 'FINALIZED' });
    (proofService.recoverProofsFromOutputData as Mock<any>).mockResolvedValueOnce([]);

    await service.recoverExecutingOperation(op);

    const stored = await operationRepo.getById(op.id);
    expect(stored?.state).toBe('pending');
  });

  it('recoverExecutingOperation finalizes expired quotes as terminal failures', async () => {
    const op = makeExecutingOp('exec-expired');
    await operationRepo.create(op);

    (handler.recoverExecuting as Mock<any>).mockResolvedValueOnce({
      status: 'TERMINAL',
      error: `Recovered: quote ${quoteId} expired while executing mint`,
    });

    await service.recoverExecutingOperation(op);

    const stored = await operationRepo.getById(op.id);
    const quote = await mintQuoteRepo.getMintQuote(mintUrl, quoteId);

    expect(stored?.state).toBe('failed');
    expect(stored?.error).toBe(`Recovered: quote ${quoteId} expired while executing mint`);
    expect(quote?.state).toBe('PAID');
  });

  it('redeem returns a failed operation when recovery finds an expired quote', async () => {
    const op = makeExecutingOp('exec-expired-redeem');
    await operationRepo.create(op);

    (handler.recoverExecuting as Mock<any>).mockResolvedValueOnce({
      status: 'TERMINAL',
      error: `Recovered: quote ${quoteId} expired while executing mint`,
    });

    const result = await service.redeem(mintUrl, quoteId);

    expect(result?.state).toBe('failed');
    expect(result?.id).toBe(op.id);
  });

  it('redeem retries when executing operation is recovered back to pending', async () => {
    const op = makeExecutingOp('exec-4');
    await operationRepo.create(op);

    (handler.recoverExecuting as Mock<any>).mockResolvedValueOnce({ status: 'PENDING' });

    const finalized = await service.redeem(mintUrl, quoteId);

    expect(finalized?.state).toBe('finalized');
  });

  it('execute finalizes when already issued proofs cannot be restored', async () => {
    const pendingOp = makePendingOp('pending-2');
    await operationRepo.create(pendingOp);

    (handler.execute as Mock<any>).mockResolvedValueOnce({ status: 'ALREADY_ISSUED' });
    (proofService.recoverProofsFromOutputData as Mock<any>).mockResolvedValueOnce([]);

    const finalized = await service.execute(pendingOp.id);

    const stored = await operationRepo.getById(pendingOp.id);
    const quote = await mintQuoteRepo.getMintQuote(mintUrl, quoteId);

    expect(finalized.state).toBe('finalized');
    expect(finalized.error).toBe(
      `Recovered issued quote ${pendingOp.quoteId} but no proofs could be restored`,
    );
    expect(stored?.state).toBe('finalized');
    expect(stored?.error).toBe(
      `Recovered issued quote ${pendingOp.quoteId} but no proofs could be restored`,
    );
    expect(quote?.state).toBe('ISSUED');
  });

  it('recoverPendingOperations cleans init operations and reconciles stale pending ones', async () => {
    const initOp = makeInitOp('init-1');
    const pendingOp = makePendingOp('pending-1');

    await operationRepo.create(initOp);
    await operationRepo.create(pendingOp);

    (handler.checkPending as Mock<any>).mockResolvedValueOnce('paid');

    await service.recoverPendingOperations();

    const initStored = await operationRepo.getById(initOp.id);
    const pendingStored = await operationRepo.getById(pendingOp.id);

    expect(initStored).toBeNull();
    expect(pendingStored?.state).toBe('finalized');
  });

  it('checkPendingOperation leaves unpaid operations pending', async () => {
    const pendingOp = makePendingOp('pending-3');
    await operationRepo.create(pendingOp);

    const result = await service.checkPendingOperation(pendingOp.id);
    const stored = await operationRepo.getById(pendingOp.id);

    expect(result).toBe('unpaid');
    expect(stored?.state).toBe('pending');
  });
});
