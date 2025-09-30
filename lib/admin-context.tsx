// lib/admin-context.tsx - Admin authentication and role management context
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useState } from 'react';

interface AdminContextValue {
  isAdmin: boolean;
  isLoading: boolean;
  setIsAdmin: (value: boolean) => void;
}

const AdminContext = createContext<AdminContextValue | undefined>(undefined);

const ADMIN_KEY = 'BE:isAdmin';

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const [isAdmin, setIsAdminState] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Load admin status from storage on mount
  useEffect(() => {
    const loadAdminStatus = async () => {
      try {
        const stored = await AsyncStorage.getItem(ADMIN_KEY);
        if (stored === 'true') {
          setIsAdminState(true);
        }
      } catch (error) {
        console.error('Error loading admin status:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadAdminStatus();
  }, []);

  const setIsAdmin = async (value: boolean) => {
    try {
      await AsyncStorage.setItem(ADMIN_KEY, String(value));
      setIsAdminState(value);
    } catch (error) {
      console.error('Error saving admin status:', error);
    }
  };

  return (
    <AdminContext.Provider value={{ isAdmin, isLoading, setIsAdmin }}>
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
