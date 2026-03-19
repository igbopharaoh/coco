/**
 * State machine for mint operations:
 *
 * init -> pending -> executing -> finalized
 *          ^         |
 *          +---------+
 *
 * - init: Operation created, quote validated
 * - pending: Deterministic outputData persisted; quote may now settle remotely
 * - executing: Mint or recovery call in progress
 * - finalized: Quote reached terminal ISSUED state; proofs were saved when recoverable
 */
export type MintOperationState = 'init' | 'pending' | 'executing' | 'finalized';

import type { SerializedOutputData } from '../../utils';
import { getSecretsFromSerializedOutputData } from '../../utils';
import type { MintMethod, MintMethodMeta } from './MintMethodHandler';

interface MintOperationBase extends MintMethodMeta {
  id: string;
  mintUrl: string;
  quoteId: string;
  createdAt: number;
  updatedAt: number;
  error?: string;
}

interface PendingData {
  amount: number;
  outputData: SerializedOutputData;
}

export interface InitMintOperation extends MintOperationBase {
  state: 'init';
}

export interface PendingMintOperation extends MintOperationBase, PendingData {
  state: 'pending';
}

export interface ExecutingMintOperation extends MintOperationBase, PendingData {
  state: 'executing';
}

export interface FinalizedMintOperation extends MintOperationBase, PendingData {
  state: 'finalized';
}

export type MintOperation =
  | InitMintOperation
  | PendingMintOperation
  | ExecutingMintOperation
  | FinalizedMintOperation;

export type PendingOrLaterOperation =
  | PendingMintOperation
  | ExecutingMintOperation
  | FinalizedMintOperation;

export type TerminalMintOperation = FinalizedMintOperation;

export function hasPendingData(op: MintOperation): op is PendingOrLaterOperation {
  return op.state !== 'init';
}

export function isTerminalOperation(op: MintOperation): op is TerminalMintOperation {
  return op.state === 'finalized';
}

export function getOutputProofSecrets(op: PendingOrLaterOperation): string[] {
  const { keepSecrets, sendSecrets } = getSecretsFromSerializedOutputData(op.outputData);
  return [...keepSecrets, ...sendSecrets];
}

export function createMintOperation<M extends MintMethod>(
  id: string,
  mintUrl: string,
  quoteId: string,
  meta: MintMethodMeta<M>,
): InitMintOperation & MintMethodMeta<M> {
  const now = Date.now();
  return {
    ...meta,
    id,
    state: 'init',
    mintUrl,
    quoteId,
    createdAt: now,
    updatedAt: now,
  };
}
