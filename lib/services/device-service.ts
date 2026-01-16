import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { supabase } from '../supabase';

export interface UserDevice {
    id: string;
    user_id: string;
    device_name: string;
    device_type: string;
    ip_address?: string;
    last_active: string;
    is_current?: boolean;
    created_at: string;
    is_active: boolean;
}

export const deviceService = {
    /**
     * Register the current device or update its last active timestamp
     */
    async registerCurrentDevice(): Promise<void> {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            // Get unique device ID (or generate one and store it if needed)
            // For simplicity, we'll try to use a persistent ID from expo-application or fall back to a generated one stored in SecureStore if strictly needed.
            // But for this implementation, we will rely on finding a device by its properties or creating a new one for each session if we lack a strict unique hardware ID that persists safely.
            // To strictly verify "this device", we would typically store a UUID in SecureStore.
            // Let's assume we create a new session record for each login, or update 'is_current' if we can identify it.

            const deviceName = Device.modelName || `Unknown ${Platform.OS} Device`;
            const deviceType = getDeviceType();

            // Simple implementation: Insert a new record on login, or update if we stored an ID locally.
            // For now, let's just insert/update based on a loose heuristic or just insert a new "active" session.
            // Pruning old sessions might be needed later.

            // Let's try to fetch if we have a device for this user with this name (simple heuristic)
            // A robust implementation would store a generated 'local_device_id' in SecureStore.

            const { data: existingDevice } = await supabase
                .from('user_devices')
                .select('*')
                .eq('user_id', user.id)
                .eq('device_name', deviceName)
                .eq('is_active', true)
                .order('last_active', { ascending: false })
                .limit(1)
                .single();

            if (existingDevice) {
                // Update last active
                await supabase
                    .from('user_devices')
                    .update({
                        last_active: new Date().toISOString(),
                        is_active: true
                    })
                    .eq('id', existingDevice.id);
            } else {
                // Create new
                await supabase
                    .from('user_devices')
                    .insert({
                        user_id: user.id,
                        device_name: deviceName,
                        device_type: deviceType,
                        is_active: true,
                        last_active: new Date().toISOString()
                    });
            }
        } catch (error) {
            console.error('[DeviceService] Error registering device:', error);
        }
    },

    /**
     * Get all active devices for current user
     */
    async getDevices(): Promise<UserDevice[]> {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return [];

            const { data, error } = await supabase
                .from('user_devices')
                .select('*')
                .eq('user_id', user.id)
                .eq('is_active', true)
                .order('last_active', { ascending: false });

            if (error) throw error;

            // Mark current device
            const currentDeviceName = Device.modelName || `Unknown ${Platform.OS} Device`;

            return (data || []).map(device => ({
                ...device,
                is_current: device.device_name === currentDeviceName // Simple heuristic for now
            }));
        } catch (error) {
            console.error('[DeviceService] Error fetching devices:', error);
            return [];
        }
    },

    /**
     * Revoke a specific device
     */
    async revokeDevice(deviceId: string): Promise<boolean> {
        try {
            const { error } = await supabase
                .from('user_devices')
                .update({ is_active: false })
                .eq('id', deviceId);

            if (error) throw error;
            return true;
        } catch (error) {
            console.error('[DeviceService] Error revoking device:', error);
            return false;
        }
    },

    /**
     * Check if current device is still active (not revoked)
     * Should be called periodically or on app resume
     */
    async checkDeviceStatus(): Promise<boolean> {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return false;

            const currentDeviceName = Device.modelName || `Unknown ${Platform.OS} Device`;

            const { data } = await supabase
                .from('user_devices')
                .select('is_active')
                .eq('user_id', user.id)
                .eq('device_name', currentDeviceName)
                .eq('is_active', true)
                .single();

            // If no active record found, return false (revoked)
            return !!data;
        } catch (error) {
            // If network error, default to true to avoid locking out user unnecessarily
            return true;
        }
    }
};

function getDeviceType(): string {
    if (Platform.OS === 'web') return 'Web Browser';
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
        // Very rough check, relying on Device module is better if available
        // @ts-ignore
        const deviceType = Device.deviceType;
        // @ts-ignore
        if (deviceType === Device.DeviceType.TABLET) return 'Tablet';
        return 'Mobile';
    }
    return 'Desktop';
}
