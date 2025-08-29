import React, { useState, useEffect, useRef } from 'react';
import { useTenant } from '../contexts/TenantContext';
import { useAuth } from '../contexts/AuthContext';

const TenantSettings = () => {
  const { tenantSettings, updateTenantSettings, tenant, hasFeature, isAdmin } = useTenant();
  const { user } = useAuth();
  
  const [formData, setFormData] = useState({
    company_name: '',
    app_title: '',
    primary_color: '#4F46E5',
    secondary_color: '#10B981',
    logo_url: '',
    welcome_message: '',
    custom_domain: ''
  });
  
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [previewMode, setPreviewMode] = useState(false);
  const fileInputRef = useRef(null);

  // Update form data when tenant settings load
  useEffect(() => {
    setFormData({
      company_name: tenantSettings.company_name || tenant?.name || '',
      app_title: tenantSettings.app_title || 'Smart DataRoom',
      primary_color: tenantSettings.primary_color || '#4F46E5',
      secondary_color: tenantSettings.secondary_color || '#10B981',
      logo_url: tenantSettings.logo_url || '',
      welcome_message: tenantSettings.welcome_message || '',
      custom_domain: tenantSettings.custom_domain || ''
    });
  }, [tenantSettings, tenant]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const success = await updateTenantSettings(formData);
      
      if (success) {
        setMessage('Settings updated successfully');
        setTimeout(() => setMessage(''), 3000);
      } else {
        setMessage('Failed to update settings');
      }
    } catch (error) {
      setMessage('Error updating settings');
    } finally {
      setLoading(false);
    }
  };

  const handleLogoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Validate file
    if (!file.type.startsWith('image/')) {
      setMessage('Please select an image file');
      return;
    }

    if (file.size > 2 * 1024 * 1024) { // 2MB limit
      setMessage('Logo must be smaller than 2MB');
      return;
    }

    // Convert to base64 for preview (in production, upload to S3)
    const reader = new FileReader();
    reader.onloadend = () => {
      setFormData(prev => ({
        ...prev,
        logo_url: reader.result
      }));
    };
    reader.readAsDataURL(file);
  };

  const applyPreview = () => {
    if (previewMode) {
      // Apply theme
      document.documentElement.style.setProperty('--primary-color', formData.primary_color);
      document.documentElement.style.setProperty('--secondary-color', formData.secondary_color);
      document.title = formData.app_title;
    } else {
      // Restore original theme
      document.documentElement.style.setProperty('--primary-color', tenantSettings.primary_color || '#4F46E5');
      document.documentElement.style.setProperty('--secondary-color', tenantSettings.secondary_color || '#10B981');
      document.title = tenantSettings.app_title || 'Smart DataRoom';
    }
  };

  useEffect(() => {
    applyPreview();
  }, [previewMode, formData.primary_color, formData.secondary_color, formData.app_title]);

  if (!isAdmin) {
    return (
      <div className="text-center py-8">
        <div className="text-gray-600">
          You don't have permission to manage settings.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Organization Settings</h2>
          <p className="text-gray-600">Customize your organization's branding and configuration</p>
        </div>
        
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={previewMode}
            onChange={(e) => setPreviewMode(e.target.checked)}
            className="rounded"
          />
          <span className="text-sm">Live Preview</span>
        </label>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Information */}
        <div className="bg-white rounded-lg border p-6">
          <h3 className="text-lg font-semibold mb-4">Basic Information</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Organization Name
              </label>
              <input
                type="text"
                value={formData.company_name}
                onChange={(e) => setFormData(prev => ({ ...prev, company_name: e.target.value }))}
                className="w-full px-3 py-2 border rounded-md"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Application Title
              </label>
              <input
                type="text"
                value={formData.app_title}
                onChange={(e) => setFormData(prev => ({ ...prev, app_title: e.target.value }))}
                className="w-full px-3 py-2 border rounded-md"
                placeholder="Smart DataRoom"
              />
            </div>
          </div>

          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Welcome Message
            </label>
            <textarea
              value={formData.welcome_message}
              onChange={(e) => setFormData(prev => ({ ...prev, welcome_message: e.target.value }))}
              className="w-full px-3 py-2 border rounded-md"
              rows="3"
              placeholder="Welcome to your secure data room..."
            />
          </div>
        </div>

        {/* Branding */}
        {hasFeature('custom_branding') ? (
          <div className="bg-white rounded-lg border p-6">
            <h3 className="text-lg font-semibold mb-4">Branding & Theme</h3>
            
            {/* Logo Upload */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Organization Logo
              </label>
              
              <div className="flex items-center gap-4">
                {formData.logo_url && (
                  <img
                    src={formData.logo_url}
                    alt="Logo preview"
                    className="w-16 h-16 object-contain border rounded"
                  />
                )}
                
                <div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="bg-gray-100 text-gray-700 px-3 py-2 rounded-md hover:bg-gray-200"
                  >
                    {formData.logo_url ? 'Change Logo' : 'Upload Logo'}
                  </button>
                  
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    className="hidden"
                  />
                  
                  <p className="text-xs text-gray-500 mt-1">
                    PNG, JPG up to 2MB. Recommended: 200x80px
                  </p>
                </div>
              </div>
            </div>

            {/* Color Theme */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Primary Color
                </label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={formData.primary_color}
                    onChange={(e) => setFormData(prev => ({ ...prev, primary_color: e.target.value }))}
                    className="w-12 h-10 rounded border"
                  />
                  <input
                    type="text"
                    value={formData.primary_color}
                    onChange={(e) => setFormData(prev => ({ ...prev, primary_color: e.target.value }))}
                    className="flex-1 px-3 py-2 border rounded-md"
                    placeholder="#4F46E5"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Secondary Color
                </label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={formData.secondary_color}
                    onChange={(e) => setFormData(prev => ({ ...prev, secondary_color: e.target.value }))}
                    className="w-12 h-10 rounded border"
                  />
                  <input
                    type="text"
                    value={formData.secondary_color}
                    onChange={(e) => setFormData(prev => ({ ...prev, secondary_color: e.target.value }))}
                    className="flex-1 px-3 py-2 border rounded-md"
                    placeholder="#10B981"
                  />
                </div>
              </div>
            </div>

            {/* Theme Preview */}
            {previewMode && (
              <div className="mt-4 p-4 border rounded-lg">
                <h4 className="text-sm font-medium mb-2">Preview</h4>
                <div 
                  className="p-4 rounded-lg text-white"
                  style={{ backgroundColor: formData.primary_color }}
                >
                  <div className="font-semibold">{formData.app_title}</div>
                  <div className="text-sm opacity-90">{formData.company_name}</div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-gray-50 rounded-lg border p-6">
            <h3 className="text-lg font-semibold mb-2">Branding & Theme</h3>
            <div className="text-center py-8">
              <div className="text-gray-500 mb-2">🎨</div>
              <div className="text-gray-600">Custom branding available with Starter plan and above</div>
              <button className="mt-3 text-blue-600 hover:text-blue-800 text-sm">
                Upgrade Plan
              </button>
            </div>
          </div>
        )}

        {/* Advanced Settings */}
        {hasFeature('custom_domain') ? (
          <div className="bg-white rounded-lg border p-6">
            <h3 className="text-lg font-semibold mb-4">Advanced Settings</h3>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Custom Domain
              </label>
              <input
                type="text"
                value={formData.custom_domain}
                onChange={(e) => setFormData(prev => ({ ...prev, custom_domain: e.target.value }))}
                className="w-full px-3 py-2 border rounded-md"
                placeholder="dataroom.yourcompany.com"
              />
              <p className="text-xs text-gray-500 mt-1">
                Contact support to set up DNS configuration
              </p>
            </div>
          </div>
        ) : (
          <div className="bg-gray-50 rounded-lg border p-6">
            <h3 className="text-lg font-semibold mb-2">Advanced Settings</h3>
            <div className="text-center py-4">
              <div className="text-gray-500 mb-2">🌐</div>
              <div className="text-gray-600">Custom domain available with Enterprise plan</div>
              <button className="mt-3 text-blue-600 hover:text-blue-800 text-sm">
                Upgrade to Enterprise
              </button>
            </div>
          </div>
        )}

        {/* Submit */}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setPreviewMode(!previewMode)}
            className="px-4 py-2 text-gray-700 border rounded-md hover:bg-gray-50"
          >
            {previewMode ? 'Exit Preview' : 'Preview Changes'}
          </button>
          
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Saving...' : 'Save Settings'}
          </button>
        </div>

        {message && (
          <div className={`text-center py-2 text-sm ${
            message.includes('success') ? 'text-green-600' : 'text-red-600'
          }`}>
            {message}
          </div>
        )}
      </form>

      {/* Subscription Info */}
      <div className="bg-white rounded-lg border p-6">
        <h3 className="text-lg font-semibold mb-4">Subscription Information</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="text-center p-4 bg-blue-50 rounded-lg">
            <div className="text-lg font-semibold text-blue-600">
              {tenant?.subscription_tier || 'Unknown'}
            </div>
            <div className="text-sm text-gray-600">Current Plan</div>
          </div>
          
          <div className="text-center p-4 bg-green-50 rounded-lg">
            <div className="text-lg font-semibold text-green-600">
              {tenant?.subscription_status || 'Unknown'}
            </div>
            <div className="text-sm text-gray-600">Status</div>
          </div>
          
          <div className="text-center p-4 bg-purple-50 rounded-lg">
            <div className="text-lg font-semibold text-purple-600">
              {tenant?.subscription_expires_at ? 
                new Date(tenant.subscription_expires_at).toLocaleDateString() : 
                'Never'
              }
            </div>
            <div className="text-sm text-gray-600">Expires</div>
          </div>
        </div>

        <div className="mt-4 text-center">
          <button className="text-blue-600 hover:text-blue-800 text-sm">
            Manage Subscription
          </button>
        </div>
      </div>

      {/* Feature Availability */}
      <div className="bg-white rounded-lg border p-6">
        <h3 className="text-lg font-semibold mb-4">Available Features</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FeatureItem
            name="Custom Branding"
            available={hasFeature('custom_branding')}
            description="Logo, colors, and custom styling"
          />
          <FeatureItem
            name="User Management"
            available={hasFeature('user_management')}
            description="Invite and manage team members"
          />
          <FeatureItem
            name="Advanced Analytics"
            available={hasFeature('advanced_analytics')}
            description="Detailed usage reports and insights"
          />
          <FeatureItem
            name="API Access"
            available={hasFeature('api_access')}
            description="Programmatic access to your data"
          />
          <FeatureItem
            name="Single Sign-On"
            available={hasFeature('sso')}
            description="SAML and OAuth integration"
          />
          <FeatureItem
            name="Custom Domain"
            available={hasFeature('custom_domain')}
            description="Use your own domain name"
          />
        </div>
      </div>
    </div>
  );
};

const FeatureItem = ({ name, available, description }) => (
  <div className="flex items-center gap-3 p-3 border rounded-lg">
    <div className={`w-3 h-3 rounded-full ${available ? 'bg-green-500' : 'bg-gray-300'}`}></div>
    <div>
      <div className={`font-medium ${available ? 'text-gray-900' : 'text-gray-500'}`}>
        {name}
      </div>
      <div className="text-sm text-gray-500">{description}</div>
    </div>
    {!available && (
      <div className="ml-auto">
        <button className="text-xs text-blue-600 hover:text-blue-800">
          Upgrade
        </button>
      </div>
    )}
  </div>
);

export default TenantSettings;