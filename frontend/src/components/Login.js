import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

const Login = () => {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    tenantSlug: ''
  });
  const [loginMode, setLoginMode] = useState('tenant'); // 'tenant' or 'superadmin'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const { login, loading: authLoading } = useAuth();

  // Extract tenant slug from URL if present
  useEffect(() => {
    const url = new URL(window.location.href);
    const subdomain = url.hostname.split('.')[0];
    
    // If we're on a subdomain that's not 'www' or 'app', use it as tenant slug
    if (subdomain && subdomain !== 'www' && subdomain !== 'app' && subdomain !== 'localhost') {
      setFormData(prev => ({ ...prev, tenantSlug: subdomain }));
      setLoginMode('tenant');
    }
    
    // Check for tenant slug in path
    const pathMatch = url.pathname.match(/^\/t\/([^\/]+)/);
    if (pathMatch) {
      setFormData(prev => ({ ...prev, tenantSlug: pathMatch[1] }));
      setLoginMode('tenant');
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const tenantSlug = loginMode === 'tenant' ? formData.tenantSlug : null;
      const result = await login(formData.email, formData.password, tenantSlug);
      
      if (!result.success) {
        setError(result.error);
      }
    } catch (err) {
      setError('Login failed');
    } finally {
      setLoading(false);
    }
  };

  const isSubmitting = loading || authLoading;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <h2 className="mt-6 text-3xl font-extrabold text-gray-900">
            Sign in to your account
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            Access your secure data room
          </p>
        </div>

        {/* Login Mode Selector */}
        <div className="flex bg-gray-100 rounded-lg p-1">
          <button
            type="button"
            onClick={() => setLoginMode('tenant')}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
              loginMode === 'tenant' 
                ? 'bg-white text-gray-900 shadow' 
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Organization Login
          </button>
          <button
            type="button"
            onClick={() => setLoginMode('superadmin')}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
              loginMode === 'superadmin' 
                ? 'bg-white text-gray-900 shadow' 
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Platform Admin
          </button>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4">
            {/* Tenant Slug (only for tenant login) */}
            {loginMode === 'tenant' && (
              <div>
                <label htmlFor="tenantSlug" className="sr-only">
                  Organization ID
                </label>
                <input
                  id="tenantSlug"
                  name="tenantSlug"
                  type="text"
                  required
                  value={formData.tenantSlug}
                  onChange={(e) => setFormData(prev => ({ ...prev, tenantSlug: e.target.value }))}
                  className="relative block w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="Organization ID (e.g., acme-corp)"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Your organization's unique identifier
                </p>
              </div>
            )}

            {/* Email */}
            <div>
              <label htmlFor="email" className="sr-only">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={formData.email}
                onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                className="relative block w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="Email address"
              />
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="sr-only">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={formData.password}
                onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                className="relative block w-full px-3 py-2 border border-gray-300 rounded-md placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="Password"
              />
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          <div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"></circle>
                    <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" className="opacity-75"></path>
                  </svg>
                  Signing in...
                </>
              ) : (
                `Sign in${loginMode === 'superadmin' ? ' as Platform Admin' : ''}`
              )}
            </button>
          </div>

          {loginMode === 'tenant' && (
            <div className="text-center text-sm">
              <div className="text-gray-600">
                Don't have an account?{' '}
                <button 
                  type="button"
                  className="text-indigo-600 hover:text-indigo-500"
                  onClick={() => window.open('/contact', '_blank')}
                >
                  Contact us for access
                </button>
              </div>
            </div>
          )}

          {loginMode === 'superadmin' && (
            <div className="text-center">
              <div className="text-xs text-gray-500">
                Platform administrator access only
              </div>
            </div>
          )}
        </form>

        {/* Tenant Access Helper */}
        {loginMode === 'tenant' && !formData.tenantSlug && (
          <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg">
            <h4 className="text-sm font-medium text-blue-900 mb-2">
              How to Access Your Organization
            </h4>
            <div className="text-xs text-blue-700 space-y-1">
              <div>• Use your organization's custom URL</div>
              <div>• Or enter your organization ID above</div>
              <div>• Contact your admin if you're unsure</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Login;