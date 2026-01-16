import { useEffect } from 'react';
import { BackHandler } from 'react-native';

/**
 * Hook to handle the Android hardware back button.
 * 
 * @param onBack - Function to call when back button is pressed. 
 *                 Return true to consume the event (prevent default behavior).
 *                 Return false to allow default behavior (usually navigating back).
 * @param enabled - Whether the back handler should be active.
 */
export function useBackHandler(onBack: () => boolean, enabled: boolean = true) {
    useEffect(() => {
        if (!enabled) return;

        const subscription = BackHandler.addEventListener('hardwareBackPress', onBack);

        return () => subscription.remove();
    }, [onBack, enabled]);
}
