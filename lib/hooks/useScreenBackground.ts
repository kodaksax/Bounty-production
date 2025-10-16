import { useEffect } from 'react';
import { useBackgroundColor } from '../context/BackgroundColorContext';

/**
 * Hook for screens to set the active background color while mounted.
 * Uses a stack so multiple mounted screens push colors and unmounting pops them.
 */
export const useScreenBackground = (color: string) => {
  const { pushColor, popColor } = useBackgroundColor();
  useEffect(() => {
    pushColor(color);
    return () => {
      popColor(color);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [color]);
};

export default useScreenBackground;
