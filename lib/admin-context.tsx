// lib/admin-context.tsx - Admin authentication and role management context
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from './supabase';

interface AdminContextValue {
  isAdmin: boolean;
  isAdminTabEnabled: boolean;
  isLoading: boolean;
  setIsAdmin: (value: boolean) => void;
  setAdminTabEnabled: (value: boolean) => void;
  verifyAdminStatus: () => Promise<boolean>;
}

const AdminContext = createContext<AdminContextValue | undefined>(undefined);

const ADMIN_KEY = 'BE:isAdmin';
const ADMIN_TAB_ENABLED_KEY = 'BE:adminTabEnabled';
const ADMIN_VERIFIED_AT_KEY = 'BE:adminVerifiedAt';
const VERIFICATION_EXPIRY = 5 * 60 * 1000; // 5 minutes

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const [isAdmin, setIsAdminState] = useState(false);
  const [isAdminTabEnabled, setIsAdminTabEnabledState] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Verify admin status with backend
  const verifyAdminStatus = async (): Promise<boolean> => {
    if (!isSupabaseConfigured) {
      console.warn('[AdminContext] Supabase not configured - cannot verify admin status');
      return false;
    }

    try {
      // Get current session
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      
      if (sessionError || !session) {
        console.log('[AdminContext] No active session - user not admin');
        await setIsAdmin(false);
        return false;
      }

      // Check user metadata for admin role
      // In production, this should be verified via a backend API call
      // that checks the database for the user's role
      const isAdminUser = session.user?.user_metadata?.role === 'admin' || 
                          session.user?.app_metadata?.role === 'admin';
      
      if (isAdminUser) {
        await AsyncStorage.setItem(ADMIN_VERIFIED_AT_KEY, Date.now().toString());
      }
      
      await setIsAdmin(isAdminUser);
      return isAdminUser;
      
    } catch (error) {
      console.error('[AdminContext] Error verifying admin status:', error);
      await setIsAdmin(false);
      return false;
    }
  };

  // Load and verify admin status on mount
  useEffect(() => {
    const loadAdminStatus = async () => {
      try {
        const stored = await AsyncStorage.getItem(ADMIN_KEY);
        const verifiedAt = await AsyncStorage.getItem(ADMIN_VERIFIED_AT_KEY);
        const adminTabEnabled = await AsyncStorage.getItem(ADMIN_TAB_ENABLED_KEY);
        
        // Load admin tab enabled preference (defaults to false on initial login)
        setIsAdminTabEnabledState(adminTabEnabled === 'true');
        
        if (stored === 'true' && verifiedAt) {
          const verifiedTime = parseInt(verifiedAt, 10);
          const isExpired = Date.now() - verifiedTime > VERIFICATION_EXPIRY;
          
          if (!isExpired) {
            // Use cached value if recent
            setIsAdminState(true);
            setIsLoading(false);
            // Still verify in background
            verifyAdminStatus();
            return;
          }
        }
        
        // Verify with backend if cache expired or not found
        await verifyAdminStatus();
        
      } catch (error) {
        console.error('[AdminContext] Error loading admin status:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadAdminStatus();
  }, []);

  // Listen for auth state changes
  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        await setIsAdmin(false);
        // Reset admin tab preference on sign out so it's hidden on next sign in (initial login behavior)
        await setAdminTabEnabled(false);
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        await verifyAdminStatus();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const setIsAdmin = async (value: boolean) => {
    try {
      await AsyncStorage.setItem(ADMIN_KEY, String(value));
      if (!value) {
        await AsyncStorage.removeItem(ADMIN_VERIFIED_AT_KEY);
      }
      setIsAdminState(value);
    } catch (error) {
      console.error('[AdminContext] Error saving admin status:', error);
    }
  };

  const setAdminTabEnabled = async (value: boolean) => {
    try {
      await AsyncStorage.setItem(ADMIN_TAB_ENABLED_KEY, String(value));
      setIsAdminTabEnabledState(value);
    } catch (error) {
      console.error('[AdminContext] Error saving admin tab preference:', error);
    }
  };

  return (
    <AdminContext.Provider value={{ isAdmin, isAdminTabEnabled, isLoading, setIsAdmin, setAdminTabEnabled, verifyAdminStatus }}>
      {children}
    </AdminContext.Provider>
  );
}

export function useAdmin() {
  const context = useContext(AdminContext);
  if (context === undefined) {
    throw new Error('useAdmin must be used within AdminProvider');
  }
  return context;
}

// Hook to require admin access - redirects if not admin
export function useRequireAdmin() {
  const { isAdmin, isLoading } = useAdmin();
  return { isAdmin, isLoading, hasAccess: isAdmin };
}
