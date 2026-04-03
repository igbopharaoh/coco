import { useEffect, useState, useCallback } from 'react';
import { useManager } from '../contexts/ManagerContext';
import type { BalanceBreakdown, BalancesBreakdownByMint } from '@cashu/coco-core';

export type TrustedBalanceValue = {
  balances: BalancesBreakdownByMint;
  total: BalanceBreakdown;
};

const EMPTY_BALANCE: BalanceBreakdown = { ready: 0, reserved: 0, total: 0 };

function getTotalBalance(balances: BalancesBreakdownByMint): BalanceBreakdown {
  return Object.values(balances).reduce(
    (total, balance) => ({
      ready: total.ready + balance.ready,
      reserved: total.reserved + balance.reserved,
      total: total.total + balance.total,
    }),
    EMPTY_BALANCE,
  );
}

/**
 * Hook that returns balances only for trusted mints.
 * Returns per-mint balance breakdowns and a total across all trusted mints.
 */
const useTrustedBalance = () => {
  const [balances, setBalances] = useState<BalancesBreakdownByMint>({});
  const manager = useManager();

  const refreshBalance = useCallback(async () => {
    try {
      setBalances(await manager.wallet.getTrustedBalances());
    } catch (error) {
      console.error(error);
    }
  }, [manager]);

  useEffect(() => {
    refreshBalance();
    manager.on('proofs:saved', refreshBalance);
    manager.on('proofs:state-changed', refreshBalance);
    manager.on('mint:updated', refreshBalance);
    manager.on('proofs:reserved', refreshBalance);
    manager.on('proofs:released', refreshBalance);
    return () => {
      manager.off('proofs:saved', refreshBalance);
      manager.off('proofs:state-changed', refreshBalance);
      manager.off('mint:updated', refreshBalance);
      manager.off('proofs:reserved', refreshBalance);
      manager.off('proofs:released', refreshBalance);
    };
  }, [manager, refreshBalance]);

  return { balances, total: getTotalBalance(balances) };
};

export default useTrustedBalance;
