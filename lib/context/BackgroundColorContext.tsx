import React, { createContext, ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { darkTheme } from "../themes/darkTheme";

type BGContext = {
  color: string; // current active color (top of stack)
  pushColor: (c: string) => void;
  popColor: (c: string) => void;
  // direct set still available for advanced use
  setColor: (c: string) => void;
};

export const DEFAULT = darkTheme.background; // single source of truth

const BackgroundColorContext = createContext<BGContext | undefined>(undefined);

export const BackgroundColorProvider = ({ children }: { children: ReactNode }) => {
  const [stack, setStack] = useState<string[]>([DEFAULT]);

  const pushColor = useCallback((c: string) => {
    setStack(s => [...s, c]);
  }, []);

  const popColor = useCallback((c: string) => {
    setStack(s => {
      const copy = [...s];
      const idx = copy.lastIndexOf(c);
      if (idx >= 0) {
        copy.splice(idx, 1);
      }
      if (copy.length === 0) return [DEFAULT];
      return copy;
    });
  }, []);

  const setColor = useCallback((c: string) => setStack([c]), []);

  const color = stack[stack.length - 1] ?? DEFAULT;

  const value = useMemo(
    () => ({ color, pushColor, popColor, setColor }),
    [color, pushColor, popColor, setColor]
  );

  return (
    <BackgroundColorContext.Provider value={value}>
      {children}
    </BackgroundColorContext.Provider>
  );
};

export const useBackgroundColor = () => {
  const ctx = useContext(BackgroundColorContext);
  if (!ctx) throw new Error("useBackgroundColor must be used within BackgroundColorProvider");
  return ctx;
};

export default BackgroundColorContext;
