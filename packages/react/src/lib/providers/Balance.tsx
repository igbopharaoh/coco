import { useEffect, useState } from 'react';
import type { BalanceBreakdown, BalancesBreakdownByMint } from '@cashu/coco-core';
import { useManager } from '../contexts/ManagerContext';
import { BalanceCtx, type BalanceContextValue } from '../contexts/BalanceContext';

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

const useBalance = (): BalanceContextValue => {
  const [balances, setBalances] = useState<BalancesBreakdownByMint>({});
  const manager = useManager();

  useEffect(() => {
    async function getBalance() {
      try {
        setBalances(await manager.wallet.getBalances());
      } catch (error) {
        console.error(error);
      }
    }
    getBalance();
    manager.on('proofs:saved', getBalance);
    manager.on('proofs:state-changed', getBalance);
    manager.on('proofs:reserved', getBalance);
    manager.on('proofs:released', getBalance);
    return () => {
      manager.off('proofs:saved', getBalance);
      manager.off('proofs:state-changed', getBalance);
      manager.off('proofs:reserved', getBalance);
      manager.off('proofs:released', getBalance);
    };
  }, [manager]);

  return { balances, total: getTotalBalance(balances) };
};

export const BalanceProvider = ({ children }: { children: React.ReactNode }) => (
  <BalanceCtx.Provider value={useBalance()}>{children}</BalanceCtx.Provider>
);
