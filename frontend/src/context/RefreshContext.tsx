import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface RefreshValue {
  tick: number;
  bump: () => void;
}

const RefreshContext = createContext<RefreshValue>({ tick: 0, bump: () => {} });

// One shared "something changed" signal. The Omni-Bar bumps it after a commit so every
// panel on screen (and the Day dashboard) refetches without prop-drilling callbacks.
export function RefreshProvider({ children }: { children: ReactNode }) {
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);
  const value = useMemo(() => ({ tick, bump }), [tick, bump]);
  return <RefreshContext.Provider value={value}>{children}</RefreshContext.Provider>;
}

export function useRefresh() {
  return useContext(RefreshContext);
}
