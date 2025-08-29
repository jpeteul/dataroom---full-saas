import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

  // Get auth headers for API requests
  const getAuthHeaders = useCallback(() => {
    const headers = {
      'Content-Type': 'application/json'
    };
    
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    
    // Add tenant context if available
    if (user?.tenant_slug) {
      headers['x-tenant-slug'] = user.tenant_slug;
    }
    
    return headers;
  }, [token, user?.tenant_slug]);

  // Login with optional tenant context
  const login = useCallback(async (email, password, tenantSlug = null) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email,
          password,
          tenantSlug
        })
      });

      const data = await response.json();

      if (response.ok) {
        setToken(data.token);
        setUser(data.user);
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        return { success: true };
      } else {
        throw new Error(data.error || 'Login failed');
      }
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  }, [API_BASE]);

  // Logout
  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setError(null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    
    // Clear any applied themes
    document.documentElement.style.removeProperty('--primary-color');
    document.documentElement.style.removeProperty('--secondary-color');
    document.title = 'Smart DataRoom';
  }, []);

  // Register new user (admin only)
  const register = useCallback(async (userData) => {
    if (!user || (user.tenant_role !== 'admin' && user.global_role !== 'superadmin')) {
      throw new Error('Only admins can register new users');
    }

    try {
      const response = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(userData)
      });

      const data = await response.json();

      if (response.ok) {
        return { success: true, user: data.user };
      } else {
        throw new Error(data.error || 'Registration failed');
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  }, [user, API_BASE, getAuthHeaders]);

  // Load user profile
  const loadProfile = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/auth/profile`, {
        headers: getAuthHeaders()
      });

      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
        localStorage.setItem('user', JSON.stringify(data.user));
        
        // Apply tenant branding if available
        if (data.user.settings) {
          const settings = data.user.settings;
          if (settings.primary_color) {
            document.documentElement.style.setProperty('--primary-color', settings.primary_color);
          }
          if (settings.app_title) {
            document.title = settings.app_title;
          }
        }
      } else if (response.status === 401) {
        // Token is invalid, clear auth state
        logout();
      }
    } catch (err) {
      console.error('Failed to load profile:', err);
      if (err.message.includes('401') || err.message.includes('403')) {
        logout();
      }
    } finally {
      setLoading(false);
    }
  }, [token, API_BASE, getAuthHeaders, logout]);

  // Accept invitation
  const acceptInvitation = useCallback(async (token, name, password) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/auth/accept-invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          token,
          name,
          password
        })
      });

      const data = await response.json();

      if (response.ok) {
        setToken(data.token);
        setUser(data.user);
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        return { success: true };
      } else {
        throw new Error(data.error || 'Failed to accept invitation');
      }
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  }, [API_BASE]);

  // Create invitation
  const createInvitation = useCallback(async (email, role = 'user') => {
    if (!user || user.tenant_role !== 'admin') {
      throw new Error('Only admins can create invitations');
    }

    try {
      const response = await fetch(`${API_BASE}/auth/invite`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ email, role })
      });

      const data = await response.json();

      if (response.ok) {
        return { success: true, invitation: data.invitation };
      } else {
        throw new Error(data.error || 'Failed to create invitation');
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  }, [user, API_BASE, getAuthHeaders]);

  // Get tenant users
  const getTenantUsers = useCallback(async () => {
    if (!user || user.tenant_role !== 'admin') {
      return { success: false, error: 'Admin access required' };
    }

    try {
      const response = await fetch(`${API_BASE}/auth/users`, {
        headers: getAuthHeaders()
      });

      const data = await response.json();

      if (response.ok) {
        return { success: true, users: data.users };
      } else {
        throw new Error(data.error || 'Failed to load users');
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  }, [user, API_BASE, getAuthHeaders]);

  // Update user
  const updateUser = useCallback(async (userId, updates) => {
    if (!user || user.tenant_role !== 'admin') {
      throw new Error('Admin access required');
    }

    try {
      const response = await fetch(`${API_BASE}/auth/users/${userId}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify(updates)
      });

      const data = await response.json();

      if (response.ok) {
        return { success: true, user: data.user };
      } else {
        throw new Error(data.error || 'Failed to update user');
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  }, [user, API_BASE, getAuthHeaders]);

  // Check permissions
  const hasPermission = useCallback((permission) => {
    if (!user) return false;
    
    // Superadmin has all permissions
    if (user.global_role === 'superadmin') return true;
    
    // Define permission mappings
    const permissions = {
      'manage_users': user.tenant_role === 'admin',
      'manage_settings': user.tenant_role === 'admin',
      'view_analytics': user.tenant_role === 'admin',
      'upload_documents': user.tenant_role === 'admin',
      'delete_documents': user.tenant_role === 'admin',
      'view_documents': true, // All authenticated users
      'ask_questions': true, // All authenticated users
      'global_analytics': user.global_role === 'superadmin',
      'manage_tenants': user.global_role === 'superadmin'
    };
    
    return permissions[permission] || false;
  }, [user]);

  // Get usage percentage for display
  const getUsagePercentage = useCallback((resource) => {
    if (!limits[resource]) return 0;
    
    const current = limits[resource].current || 0;
    const limit = limits[resource].limit || 1;
    
    return Math.min((current / limit) * 100, 100);
  }, [limits]);

  // Check if resource is over limit
  const isOverLimit = useCallback((resource) => {
    if (!limits[resource]) return false;
    return limits[resource].exceeded || false;
  }, [limits]);

  // Load initial data when component mounts
  useEffect(() => {
    if (token && !user) {
      loadProfile();
    } else if (!token) {
      setLoading(false);
    }
  }, [token, user, loadProfile]);

  const value = {
    user,
    token,
    loading,
    error,
    tenant,
    tenantSettings,
    usage,
    limits,
    
    // Auth actions
    login,
    logout,
    register,
    loadProfile,
    
    // Invitation actions
    acceptInvitation,
    createInvitation,
    
    // User management
    getTenantUsers,
    updateUser,
    
    // Tenant actions
    loadTenant,
    loadTenantSettings,
    updateTenantSettings,
    refreshUsage,
    
    // Utility functions
    getAuthHeaders,
    hasPermission,
    getUsagePercentage,
    isOverLimit,
    
    // Role checks
    isAuthenticated: !!user,
    isAdmin: user?.tenant_role === 'admin' || user?.global_role === 'superadmin',
    isSuperAdmin: user?.global_role === 'superadmin',
    isTenantUser: !!user?.tenant_id
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;