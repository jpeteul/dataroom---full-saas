import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';

const SuperAdminDashboard = () => {
  const [tenants, setTenants] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState('30d');
  
  const { getAuthHeaders, isSuperAdmin } = useAuth();
  const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

  // Load tenants
  const loadTenants = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/tenants`, {
        headers: getAuthHeaders()
      });
      
      if (response.ok) {
        const data = await response.json();
        setTenants(data.tenants);
      }
    } catch (error) {
      console.error('Failed to load tenants:', error);
    } finally {
      setLoading(false);
    }
  }, [API_BASE, getAuthHeaders]);

  // Load analytics
  const loadAnalytics = useCallback(async () => {
    try {
      const endDate = new Date();
      const startDate = new Date();
      
      switch (selectedPeriod) {
        case '7d':
          startDate.setDate(endDate.getDate() - 7);
          break;
        case '30d':
          startDate.setDate(endDate.getDate() - 30);
          break;
        case '90d':
          startDate.setDate(endDate.getDate() - 90);
          break;
        default:
          startDate.setDate(endDate.getDate() - 30);
      }

      const response = await fetch(`${API_BASE}/tenants/analytics?startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`, {
        headers: getAuthHeaders()
      });
      
      if (response.ok) {
        const data = await response.json();
        setAnalytics(data.analytics);
      }
    } catch (error) {
      console.error('Failed to load analytics:', error);
    }
  }, [API_BASE, getAuthHeaders, selectedPeriod]);

  useEffect(() => {
    if (isSuperAdmin) {
      loadTenants();
      loadAnalytics();
    }
  }, [isSuperAdmin, loadTenants, loadAnalytics]);

  if (!isSuperAdmin) {
    return (
      <div className="text-center py-12">
        <div className="text-red-600 text-lg">
          Access Denied - Superadmin Only
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Platform Overview</h1>
          <p className="text-gray-600">Manage tenants and monitor platform usage</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          Create New Tenant
        </button>
      </div>

      {/* Platform Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <MetricCard
          title="Active Tenants"
          value={tenants.filter(t => t.subscription_status === 'active').length}
          icon="🏢"
          color="blue"
        />
        <MetricCard
          title="Total Users"
          value={tenants.reduce((sum, t) => sum + parseInt(t.user_count), 0)}
          icon="👥"
          color="green"
        />
        <MetricCard
          title="Total Documents"
          value={tenants.reduce((sum, t) => sum + parseInt(t.document_count), 0)}
          icon="📄"
          color="purple"
        />
        <MetricCard
          title="Storage Used"
          value={formatBytes(tenants.reduce((sum, t) => sum + parseInt(t.storage_used || 0), 0))}
          icon="💾"
          color="orange"
        />
      </div>

      {/* Analytics Period Selector */}
      <div className="bg-white rounded-lg border p-4">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold">Platform Analytics</h2>
          <select
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(e.target.value)}
            className="border rounded-md px-3 py-1"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </select>
        </div>
        
        {analytics && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
            <div className="text-center p-4 bg-blue-50 rounded-lg">
              <div className="text-2xl font-bold text-blue-600">
                {analytics.reduce((sum, t) => sum + parseInt(t.total_questions), 0)}
              </div>
              <div className="text-sm text-gray-600">Total Questions</div>
            </div>
            <div className="text-center p-4 bg-green-50 rounded-lg">
              <div className="text-2xl font-bold text-green-600">
                {analytics.reduce((sum, t) => sum + parseInt(t.total_sessions), 0)}
              </div>
              <div className="text-sm text-gray-600">Login Sessions</div>
            </div>
            <div className="text-center p-4 bg-purple-50 rounded-lg">
              <div className="text-2xl font-bold text-purple-600">
                {analytics.reduce((sum, t) => sum + parseInt(t.document_interactions), 0)}
              </div>
              <div className="text-sm text-gray-600">Document Views</div>
            </div>
          </div>
        )}
      </div>

      {/* Tenants List */}
      <div className="bg-white rounded-lg border">
        <div className="p-4 border-b">
          <h2 className="text-lg font-semibold">Tenant Management</h2>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Organization</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Plan</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Users</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Documents</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Storage</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {tenants.map(tenant => (
                <TenantRow key={tenant.id} tenant={tenant} onUpdate={loadTenants} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Tenant Modal */}
      {showCreateModal && (
        <CreateTenantModal
          onClose={() => setShowCreateModal(false)}
          onCreate={loadTenants}
        />
      )}
    </div>
  );
};

const MetricCard = ({ title, value, icon, color }) => {
  const colorClasses = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    purple: 'bg-purple-50 text-purple-600',
    orange: 'bg-orange-50 text-orange-600'
  };

  return (
    <div className={`rounded-lg border p-4 ${colorClasses[color]}`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-2xl font-bold">{value}</div>
          <div className="text-sm font-medium">{title}</div>
        </div>
        <div className="text-2xl">{icon}</div>
      </div>
    </div>
  );
};

const TenantRow = ({ tenant, onUpdate }) => {
  const { getAuthHeaders } = useAuth();
  const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

  const getStatusBadge = (status) => {
    const styles = {
      active: 'bg-green-100 text-green-800',
      suspended: 'bg-red-100 text-red-800',
      trial: 'bg-yellow-100 text-yellow-800'
    };

    return (
      <span className={`px-2 py-1 text-xs rounded-full ${styles[status] || 'bg-gray-100 text-gray-800'}`}>
        {status}
      </span>
    );
  };

  const getPlanBadge = (tier) => {
    const styles = {
      free: 'bg-gray-100 text-gray-800',
      starter: 'bg-blue-100 text-blue-800',
      professional: 'bg-purple-100 text-purple-800',
      enterprise: 'bg-gold-100 text-yellow-800'
    };

    return (
      <span className={`px-2 py-1 text-xs rounded-full ${styles[tier] || 'bg-gray-100 text-gray-800'}`}>
        {tier}
      </span>
    );
  };

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-3">
        <div>
          <div className="font-medium text-gray-900">{tenant.name}</div>
          <div className="text-sm text-gray-500">{tenant.slug}</div>
        </div>
      </td>
      <td className="px-4 py-3">
        {getPlanBadge(tenant.subscription_tier)}
      </td>
      <td className="px-4 py-3 text-sm text-gray-900">
        {tenant.user_count}
      </td>
      <td className="px-4 py-3 text-sm text-gray-900">
        {tenant.document_count}
      </td>
      <td className="px-4 py-3 text-sm text-gray-900">
        {formatBytes(tenant.storage_used || 0)}
      </td>
      <td className="px-4 py-3">
        {getStatusBadge(tenant.subscription_status)}
      </td>
      <td className="px-4 py-3">
        <div className="flex gap-2">
          <button className="text-blue-600 hover:text-blue-800 text-sm">
            View
          </button>
          <button className="text-green-600 hover:text-green-800 text-sm">
            Edit
          </button>
          {tenant.subscription_status === 'active' ? (
            <button className="text-red-600 hover:text-red-800 text-sm">
              Suspend
            </button>
          ) : (
            <button className="text-green-600 hover:text-green-800 text-sm">
              Activate
            </button>
          )}
        </div>
      </td>
    </tr>
  );
};

const CreateTenantModal = ({ onClose, onCreate }) => {
  const [formData, setFormData] = useState({
    tenant: {
      name: '',
      slug: '',
      subscription_tier: 'starter',
      primary_contact_email: ''
    },
    admin: {
      name: '',
      email: '',
      password: ''
    }
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const { getAuthHeaders } = useAuth();
  const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

  // Auto-generate slug from name
  const handleNameChange = (name) => {
    const slug = name.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
    
    setFormData(prev => ({
      ...prev,
      tenant: {
        ...prev.tenant,
        name,
        slug
      }
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE}/tenants`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(formData)
      });

      const data = await response.json();

      if (response.ok) {
        onCreate();
        onClose();
      } else {
        setError(data.error || 'Failed to create tenant');
      }
    } catch (err) {
      setError('Failed to create tenant');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg max-w-md w-full p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">Create New Tenant</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Organization Details */}
          <div>
            <h3 className="font-medium text-gray-900 mb-2">Organization</h3>
            
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Organization Name"
                value={formData.tenant.name}
                onChange={(e) => handleNameChange(e.target.value)}
                className="w-full px-3 py-2 border rounded-md"
                required
              />
              
              <input
                type="text"
                placeholder="URL Slug (auto-generated)"
                value={formData.tenant.slug}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  tenant: { ...prev.tenant, slug: e.target.value }
                }))}
                className="w-full px-3 py-2 border rounded-md text-gray-600"
                required
              />
              
              <select
                value={formData.tenant.subscription_tier}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  tenant: { ...prev.tenant, subscription_tier: e.target.value }
                }))}
                className="w-full px-3 py-2 border rounded-md"
              >
                <option value="free">Free Tier</option>
                <option value="starter">Starter ($29/month)</option>
                <option value="professional">Professional ($99/month)</option>
                <option value="enterprise">Enterprise ($299/month)</option>
              </select>
              
              <input
                type="email"
                placeholder="Primary Contact Email"
                value={formData.tenant.primary_contact_email}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  tenant: { ...prev.tenant, primary_contact_email: e.target.value }
                }))}
                className="w-full px-3 py-2 border rounded-md"
                required
              />
            </div>
          </div>

          {/* Admin User */}
          <div>
            <h3 className="font-medium text-gray-900 mb-2">Admin User</h3>
            
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Admin Name"
                value={formData.admin.name}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  admin: { ...prev.admin, name: e.target.value }
                }))}
                className="w-full px-3 py-2 border rounded-md"
                required
              />
              
              <input
                type="email"
                placeholder="Admin Email"
                value={formData.admin.email}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  admin: { ...prev.admin, email: e.target.value }
                }))}
                className="w-full px-3 py-2 border rounded-md"
                required
              />
              
              <input
                type="password"
                placeholder="Temporary Password"
                value={formData.admin.password}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  admin: { ...prev.admin, password: e.target.value }
                }))}
                className="w-full px-3 py-2 border rounded-md"
                required
              />
            </div>
          </div>

          {error && (
            <div className="text-red-600 text-sm">{error}</div>
          )}

          <div className="flex gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-gray-700 border rounded-md hover:bg-gray-50"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              disabled={loading}
            >
              {loading ? 'Creating...' : 'Create Tenant'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Helper function to format bytes
const formatBytes = (bytes) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export default SuperAdminDashboard;