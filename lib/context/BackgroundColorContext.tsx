import React, { createContext, ReactNode, useContext, useState } from "react";

type BGContext = {
  color: string; // current active color (top of stack)
  pushColor: (c: string) => void;
  popColor: (c: string) => void;
  // direct set still available for advanced use
  setColor: (c: string) => void;
};

export const DEFAULT = "#059669"; // Bounty app default (emerald-600) fallback

const BackgroundColorContext = createContext<BGContext | undefined>(undefined);

export const BackgroundColorProvider = ({ children }: { children: ReactNode }) => {
  const [stack, setStack] = useState<string[]>([DEFAULT]);

  const pushColor = (c: string) => {
    setStack(s => {
      // if identical to current top, avoid duplicate push
      const top = s[s.length - 1];
      if (top === c) return s;
      return [...s, c];
    });
  };

  const popColor = (c: string) => {
    setStack(s => {
      const copy = [...s];
      const idx = copy.lastIndexOf(c);
      if (idx >= 0) {
        copy.splice(idx, 1);
      }
      if (copy.length === 0) return [DEFAULT];
      return copy;
    });
  };

  const setColor = (c: string) => setStack([c]);

  const color = stack[stack.length - 1] ?? DEFAULT;

  return (
    <BackgroundColorContext.Provider value={{ color, pushColor, popColor, setColor }}>
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
