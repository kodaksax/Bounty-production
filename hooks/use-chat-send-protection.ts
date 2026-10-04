import { useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { messagingStrings } from '../lib/strings/messaging';
import { trustSafetyStrings } from '../lib/strings/trust-safety';
import { detectOffPlatformRisk } from '../lib/utils/off-platform-risk';

/** Native confirmation happens before any draft, reply, attachment, or send state is changed. */
export function useChatSendProtection(conversationId?: string) {
  const pending = useRef<((approved: boolean) => void) | null>(null);
  useEffect(() => () => {
    pending.current?.(false);
    pending.current = null;
  }, [conversationId]);

  return useCallback((text: string): Promise<boolean> => {
    if (pending.current) return Promise.resolve(false);
    const risk = detectOffPlatformRisk(text);
    if (!risk) return Promise.resolve(true);
    return new Promise(resolve => {
      const finish = (approved: boolean) => {
        if (pending.current !== finish) return;
        pending.current = null;
        resolve(approved);
      };
      pending.current = finish;
      Alert.alert(
        messagingStrings.confirmTitle,
        risk === 'payment' ? trustSafetyStrings.paymentRequest : trustSafetyStrings.contactRequest,
        [
          { text: messagingStrings.edit, style: 'cancel', onPress: () => finish(false) },
          { text: messagingStrings.sendAnyway, onPress: () => finish(true) },
        ],
        { cancelable: true, onDismiss: () => finish(false) },
      );
    });
  }, []);
}
