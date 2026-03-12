import type {
  ExecuteContext,
  MintMethodMeta,
  PrepareContext,
  MintMethodHandler,
  MintExecutionResult,
  PreparedMintOperation,
  RecoverExecutingResult,
  RecoverExecutingContext,
  PendingContext,
  PendingMintCheckResult,
  RollbackContext,
} from '@core/operations/mint';
import { MintOperationError } from '../../../models/Error';
import { deserializeOutputData, mapProofToCoreProof, serializeOutputData } from '@core/utils';
import type { MintQuoteBolt11Response } from '@cashu/cashu-ts';

export class MintBolt11Handler implements MintMethodHandler<'bolt11'> {
  async prepare(
    ctx: PrepareContext<'bolt11'>,
  ): Promise<PreparedMintOperation & MintMethodMeta<'bolt11'>> {
    const quote = await ctx.mintQuoteRepository.getMintQuote(
      ctx.operation.mintUrl,
      ctx.operation.quoteId,
    );

    if (!quote) {
      throw new Error(`Mint quote ${ctx.operation.quoteId} not found`);
    }

    if (!quote.amount || quote.amount <= 0) {
      throw new Error(`Mint quote ${ctx.operation.quoteId} has invalid amount`);
    }

    const outputData = await ctx.proofService.createOutputsAndIncrementCounters(
      ctx.operation.mintUrl,
      {
        keep: quote.amount,
        send: 0,
      },
    );

    if (outputData.keep.length === 0) {
      throw new Error('Failed to create deterministic outputs for mint operation');
    }

    return {
      ...ctx.operation,
      amount: quote.amount,
      outputData: serializeOutputData({ keep: outputData.keep, send: [] }),
      state: 'prepared',
    };
  }

  async execute(ctx: ExecuteContext<'bolt11'>): Promise<MintExecutionResult> {
    const outputData = deserializeOutputData(ctx.operation.outputData);

    try {
      const proofs = await ctx.wallet.mintProofsBolt11(
        ctx.operation.amount,
        ctx.operation.quoteId,
        undefined,
        {
          type: 'custom',
          data: outputData.keep,
        },
      );

      return { status: 'ISSUED', proofs };
    } catch (err) {
      if (err instanceof MintOperationError && err.code === 20002) {
        return { status: 'ALREADY_ISSUED' };
      }
      throw err;
    }
  }

  async recoverExecuting(ctx: RecoverExecutingContext<'bolt11'>): Promise<RecoverExecutingResult> {
    const { mintUrl, quoteId } = ctx.operation;
    let remoteQuote: MintQuoteBolt11Response;
    try {
      remoteQuote = await ctx.mintAdapter.checkMintQuoteState(mintUrl, quoteId);
    } catch (error) {
      ctx.logger?.warn('Failed to check mint quote state during recovery', {
        mintUrl,
        quoteId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { status: 'STAY_EXECUTING' };
    }

    if (remoteQuote.state === 'PAID') {
      const outputData = deserializeOutputData(ctx.operation.outputData);
      try {
        const proofs = await ctx.wallet.mintProofsBolt11(
          ctx.operation.amount,
          ctx.operation.quoteId,
          undefined,
          {
            type: 'custom',
            data: outputData.keep,
          },
        );

        await ctx.proofService.saveProofs(
          ctx.operation.mintUrl,
          mapProofToCoreProof(ctx.operation.mintUrl, 'ready', proofs, {
            createdByOperationId: ctx.operation.id,
          }),
        );

        return { status: 'FINALIZED' };
      } catch (err) {
        if (err instanceof MintOperationError) {
          if (err.code === 20002) {
            // Quote already issued; fall through to proof recovery
          } else if (err.code === 20007) {
            return {
              status: 'ROLLED_BACK',
              error: `Recovered: quote ${quoteId} expired while executing mint`,
            };
          } else {
            return { status: 'STAY_EXECUTING' };
          }
        } else {
          return { status: 'STAY_EXECUTING' };
        }
      }
    } else if (remoteQuote.state === 'UNPAID') {
      return {
        status: 'ROLLED_BACK',
        error: `Recovered: quote ${quoteId} is UNPAID during mint execution`,
      };
    } else if (remoteQuote.state !== 'ISSUED') {
      return {
        status: 'ROLLED_BACK',
        error: `Recovered: quote ${quoteId} not issued remotely (${remoteQuote.state})`,
      };
    }

    try {
      const recovered = await ctx.proofService.recoverProofsFromOutputData(
        ctx.operation.mintUrl,
        ctx.operation.outputData,
        {
          createdByOperationId: ctx.operation.id,
        },
      );
      if (recovered.length === 0) {
        return {
          status: 'ROLLED_BACK',
          error: `Recovered: quote ${quoteId} issued remotely but proofs were not recoverable`,
        };
      }
      return { status: 'FINALIZED' };
    } catch {
      return { status: 'STAY_EXECUTING' };
    }
  }

  async checkPending(ctx: PendingContext<'bolt11'>): Promise<PendingMintCheckResult> {
    const { mintUrl, quoteId } = ctx.operation;
    ctx.logger?.info('Checking pending mint operation', { mintUrl, quoteId });

    const quote = await ctx.mintAdapter.checkMintQuoteState(mintUrl, quoteId);
    ctx.logger?.info('Pending mint quote state', { mintUrl, quoteId, state: quote.state });

    switch (quote.state) {
      case 'UNPAID':
        return 'unpaid';
      case 'PAID':
        return 'paid';
      case 'ISSUED':
        return 'issued';
      default:
        throw new Error(
          `Unexpected mint quote state: ${quote.state} for quote ${quoteId} at mint ${mintUrl}`,
        );
    }
  }

  async rollback(ctx: RollbackContext<'bolt11'>, reason?: string): Promise<void> {
    const { mintUrl, quoteId } = ctx.operation;
    ctx.logger?.info('Rolling back mint operation', {
      mintUrl,
      quoteId,
      reason: reason ?? 'Rollback requested',
    });
    // Mint quotes do not support rollback; we only abandon the local operation.
  }
}
