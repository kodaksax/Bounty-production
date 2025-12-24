import { Alert } from 'react-native';

export type ToastType = 'success' | 'error' | 'info';

export function showToast(type: ToastType, message: string, title?: string) {
  const defaultTitle =
    type === 'success' ? 'Success' : type === 'error' ? 'Error' : 'Notice';
  Alert.alert(title || defaultTitle, message);
}
