import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { createResponsiveLayout } from './responsive';

export function useResponsiveLayout() {
  const { width, height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  return useMemo(
    () => createResponsiveLayout({ width, height, fontScale, insets }),
    [
      width,
      height,
      fontScale,
      insets.top,
      insets.right,
      insets.bottom,
      insets.left,
    ],
  );
}
