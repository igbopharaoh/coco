import { createContext, useContext } from 'react';
import type { BalanceBreakdown, BalancesBreakdownByMint } from '@cashu/coco-core';

export type BalanceContextValue = {
  balances: BalancesBreakdownByMint;
  total: BalanceBreakdown;
};

export const BalanceCtx = createContext<BalanceContextValue | undefined>(undefined);

export const useBalanceContext = (): BalanceContextValue => {
  const ctx = useContext(BalanceCtx);
  if (!ctx) {
    throw new Error(
      'BalanceProvider is missing. Wrap your app in <CocoCashuProvider> or <BalanceProvider>.',
    );
  }
  return ctx;
};
