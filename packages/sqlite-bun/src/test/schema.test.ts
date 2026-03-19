/// <reference types="bun" />

// @ts-ignore bun:test types are provided by the test runner in this workspace.
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
// @ts-ignore bun:sqlite types are provided by the runtime in this workspace.
import { Database } from 'bun:sqlite';
import { SqliteDb, ensureSchemaUpTo } from '../index.ts';
import { SqliteMintOperationRepository } from '../repositories/MintOperationRepository.ts';

describe('sqlite-bun schema migrations', () => {
  let database: Database;
  let db: SqliteDb;

  beforeEach(() => {
    database = new Database(':memory:');
    db = new SqliteDb({ database });
  });

  afterEach(async () => {
    await db.close();
  });

  it('upgrades mint operations to allow failed state persistence', async () => {
    await ensureSchemaUpTo(db, '020_mint_operations_failed_state');

    await db.run(
      `INSERT INTO coco_cashu_mint_operations
        (id, mintUrl, quoteId, state, createdAt, updatedAt, error, method, methodDataJson, amount, outputDataJson)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'mint-op-1',
        'https://mint.test',
        'quote-1',
        'executing',
        1,
        2,
        null,
        'bolt11',
        '{}',
        100,
        JSON.stringify({ keep: [], send: [] }),
      ],
    );

    await ensureSchemaUpTo(db);

    const repository = new SqliteMintOperationRepository(db);
    await repository.update({
      id: 'mint-op-1',
      mintUrl: 'https://mint.test',
      quoteId: 'quote-1',
      state: 'failed',
      createdAt: 1000,
      updatedAt: 2000,
      error: 'quote expired',
      method: 'bolt11',
      methodData: {},
      amount: 100,
      outputData: { keep: [], send: [] },
    });

    expect(await repository.getById('mint-op-1')).toEqual({
      id: 'mint-op-1',
      mintUrl: 'https://mint.test',
      quoteId: 'quote-1',
      state: 'failed',
      createdAt: 1000,
      updatedAt: expect.any(Number),
      error: 'quote expired',
      method: 'bolt11',
      methodData: {},
      amount: 100,
      outputData: { keep: [], send: [] },
    });
  });
});
