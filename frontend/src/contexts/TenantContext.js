import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';

const TenantContext = createContext();

export const useTenant = () => {
  const context = useContext(TenantContext);
  if (!context) {
    throw new Error('useTenant must be used within a TenantProvider');
  }
  return context;
};

export const TenantProvider = ({ children }) => {
  const [tenant, setTenant] = useState(null);
  const [tenantSettings, setTenantSettings] = useState({});
  const [usage, setUsage] = useState({});
  const [limits, setLimits] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const { user, getAuthHeaders, logout } = useAuth();
  const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

  // Load tenant information
  const loadTenant = useCallback(async () => {
    if (!user?.tenant_id) {
      setTenant(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/tenant/current`, {
        headers: getAuthHeaders()
      });

      if (response.ok) {
        const data = await response.json();
        setTenant(data.tenant);
        setUsage(data.tenant.usage || {});
        setLimits(data.tenant.limits || {});
      } else if (response.status === 403) {
        setError('Access denied to tenant information');
        logout(); // Force re-login if tenant access is denied
      } else {
        throw new Error('Failed to load tenant information');
      }
    } catch (err) {
      setError(err.message);
      console.error('Failed to load tenant:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.tenant_id, getAuthHeaders, logout, API_BASE]);

  // Load tenant settings
  const loadTenantSettings = useCallback(async () => {
    if (!user?.tenant_id) return;

    try {
      const response = await fetch(`${API_BASE}/settings`, {
        headers: getAuthHeaders()
      });

      if (response.ok) {
        const data = await response.json();
        setTenantSettings(data);
        
        // Apply theme to document
        if (data.primary_color) {
          document.documentElement.style.setProperty('--primary-color', data.primary_color);
        }
        if (data.secondary_color) {
          document.documentElement.style.setProperty('--secondary-color', data.secondary_color);
        }
        if (data.app_title) {
          document.title = data.app_title;
        }
      }
    } catch (err) {
      console.error('Failed to load tenant settings:', err);
    }
  }, [user?.tenant_id, getAuthHeaders, API_BASE]);

  // Update tenant settings
  const updateTenantSettings = useCallback(async (newSettings) => {
    if (!user?.tenant_id) return false;

    try {
      const response = await fetch(`${API_BASE}/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify(newSettings)
      });

      if (response.ok) {
        const data = await response.json();
        setTenantSettings(data);
        return true;
      } else {
        throw new Error('Failed to update settings');
      }
    } catch (err) {
      console.error('Failed to update tenant settings:', err);
      return false;
    }
  }, [user?.tenant_id, getAuthHeaders, API_BASE]);

  // Get tenant usage information
  const refreshUsage = useCallback(async () => {
    if (!user?.tenant_id || user.tenant_role !== 'admin') return;

    try {
      const response = await fetch(`${API_BASE}/tenant/usage`, {
        headers: getAuthHeaders()
      });

      if (response.ok) {
        const data = await response.json();
        setUsage(data.usage);
        setLimits(data.limits);
      }
    } catch (err) {
      console.error('Failed to load tenant usage:', err);
    }
  }, [user?.tenant_id, user?.tenant_role, getAuthHeaders, API_BASE]);

  // Check if feature is available for tenant
  const hasFeature = useCallback((feature) => {
    if (!tenant) return false;
    
    const tierFeatures = {
      free: ['basic_analytics', 'document_upload'],
      starter: ['basic_analytics', 'document_upload', 'user_management', 'custom_branding'],
      professional: ['basic_analytics', 'document_upload', 'user_management', 'custom_branding', 'advanced_analytics', 'api_access'],
      enterprise: ['basic_analytics', 'document_upload', 'user_management', 'custom_branding', 'advanced_analytics', 'api_access', 'sso', 'audit_logs', 'custom_domain']
    };
    
    const availableFeatures = tierFeatures[tenant.subscription_tier] || [];
    return availableFeatures.includes(feature);
  }, [tenant]);

  // Check if limit is approaching
  const isApproachingLimit = useCallback((resource, threshold = 0.8) => {
    if (!limits[resource]) return false;
    
    const current = limits[resource].current || 0;
    const limit = limits[resource].limit || 0;
    
    return (current / limit) >= threshold;
  }, [limits]);

  // Load tenant data when user changes
  useEffect(() => {
    if (user?.tenant_id) {
      loadTenant();
      loadTenantSettings();
    }
  }, [user?.tenant_id, loadTenant, loadTenantSettings]);

  // Auto-refresh usage for admins
  useEffect(() => {
    if (user?.tenant_role === 'admin') {
      const interval = setInterval(refreshUsage, 5 * 60 * 1000); // Every 5 minutes
      return () => clearInterval(interval);
    }
  }, [user?.tenant_role, refreshUsage]);

  const value = {
    tenant,
    tenantSettings,
    usage,
    limits,
    loading,
    error,
    
    // Actions
    loadTenant,
    loadTenantSettings,
    updateTenantSettings,
    refreshUsage,
    
    // Utilities
    hasFeature,
    isApproachingLimit,
    
    // Computed properties
    isAdmin: user?.tenant_role === 'admin' || user?.global_role === 'superadmin',
    isSuperAdmin: user?.global_role === 'superadmin',
    tenantName: tenant?.name || tenantSettings?.company_name || 'DataRoom',
    appTitle: tenantSettings?.app_title || 'Smart DataRoom',
    primaryColor: tenantSettings?.primary_color || '#4F46E5',
    logoUrl: tenantSettings?.logo_url
  };

  return (
    <TenantContext.Provider value={value}>
      {children}
    </TenantContext.Provider>
  );
};

export default TenantContext;