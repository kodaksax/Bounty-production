import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
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

const DEVICE_RECORD_ID_KEY = 'bounty_device_record_id';

/**
 * Get stored device record ID from SecureStore
 * This is the UUID of the device record in the database
 */
async function getStoredDeviceRecordId(): Promise<string | null> {
    try {
        return await SecureStore.getItemAsync(DEVICE_RECORD_ID_KEY);
    } catch (error) {
        console.error('[DeviceService] Error retrieving device record ID:', error);
        return null;
    }
}

/**
 * Store device record ID in SecureStore
 */
async function storeDeviceRecordId(deviceId: string): Promise<void> {
    try {
        await SecureStore.setItemAsync(DEVICE_RECORD_ID_KEY, deviceId);
    } catch (error) {
        console.error('[DeviceService] Error storing device record ID:', error);
    }
}

export const deviceService = {
    /**
     * Register the current device or update its last active timestamp
     * Uses SecureStore to persistently identify this specific device across sessions
     */
    async registerCurrentDevice(): Promise<void> {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const deviceName = Device.modelName || `Unknown ${Platform.OS} Device`;
            const deviceType = getDeviceType();

            // Try to get the stored device record ID for this device
            const storedDeviceRecordId = await getStoredDeviceRecordId();
            let existingDevice = null;

            if (storedDeviceRecordId) {
                // Try to find the device record using the stored ID
                const { data } = await supabase
                    .from('user_devices')
                    .select('*')
                    .eq('id', storedDeviceRecordId)
                    .eq('user_id', user.id)
                    .eq('is_active', true)
                    .single();
                
                existingDevice = data;
            }

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
                // Create new device record
                const { data: newDevice, error: insertError } = await supabase
                    .from('user_devices')
                    .insert({
                        user_id: user.id,
                        device_name: deviceName,
                        device_type: deviceType,
                        is_active: true,
                        last_active: new Date().toISOString()
                    })
                    .select()
                    .single();

                if (!insertError && newDevice) {
                    // Store the new device record ID in SecureStore for future lookups
                    await storeDeviceRecordId(newDevice.id);
                }
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
