import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';

const SuperAdminAnalytics = () => {
  const [analytics, setAnalytics] = useState(null);
  const [tenantStats, setTenantStats] = useState([]);
  const [timeRange, setTimeRange] = useState('30d');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const { getAuthHeaders, isSuperAdmin } = useAuth();
  const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

  // Load global analytics data
  const loadAnalytics = useCallback(async () => {
    if (!isSuperAdmin) return;
    
    setLoading(true);
    setError('');

    try {
      const endDate = new Date();
      const startDate = new Date();
      
      switch (timeRange) {
        case '7d':
          startDate.setDate(endDate.getDate() - 7);
          break;
        case '30d':
          startDate.setDate(endDate.getDate() - 30);
          break;
        case '90d':
          startDate.setDate(endDate.getDate() - 90);
          break;
        case '1y':
          startDate.setFullYear(endDate.getFullYear() - 1);
          break;
        default:
          startDate.setDate(endDate.getDate() - 30);
      }

      const response = await fetch(
        `${API_BASE}/analytics/global?startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`,
        { headers: getAuthHeaders() }
      );

      if (response.ok) {
        const data = await response.json();
        setAnalytics(data);
      } else {
        throw new Error('Failed to load analytics');
      }
    } catch (err) {
      setError(err.message);
      console.error('Analytics error:', err);
    } finally {
      setLoading(false);
    }
  }, [isSuperAdmin, timeRange, getAuthHeaders, API_BASE]);

  // Load tenant statistics
  const loadTenantStats = useCallback(async () => {
    if (!isSuperAdmin) return;

    try {
      const response = await fetch(`${API_BASE}/tenants/analytics`, {
        headers: getAuthHeaders()
      });

      if (response.ok) {
        const data = await response.json();
        setTenantStats(data.analytics);
      }
    } catch (err) {
      console.error('Tenant stats error:', err);
    }
  }, [isSuperAdmin, getAuthHeaders, API_BASE]);

  useEffect(() => {
    loadAnalytics();
    loadTenantStats();
  }, [loadAnalytics, loadTenantStats]);

  if (!isSuperAdmin) {
    return (
      <div className="text-center py-12">
        <div className="text-red-600 text-lg">Access Denied - Superadmin Only</div>
      </div>
    );
  }

  if (loading && !analytics) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <div className="mt-2 text-gray-600">Loading analytics...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Platform Analytics</h1>
          <p className="text-gray-600">Cross-tenant usage insights and platform metrics</p>
        </div>
        
        <select
          value={timeRange}
          onChange={(e) => setTimeRange(e.target.value)}
          className="border rounded-md px-3 py-2"
        >
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="1y">Last year</option>
        </select>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {analytics && (
        <>
          {/* Platform Overview Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <MetricCard
              title="Total Tenants"
              value={analytics.platformStats.total_tenants}
              change={`${analytics.platformStats.active_tenants} active`}
              icon="🏢"
              color="blue"
            />
            <MetricCard
              title="Total Users"
              value={analytics.platformStats.total_users}
              change={`Across all organizations`}
              icon="👥"
              color="green"
            />
            <MetricCard
              title="Documents Stored"
              value={analytics.platformStats.total_documents}
              change={formatBytes(analytics.platformStats.total_storage || 0)}
              icon="📄"
              color="purple"
            />
            <MetricCard
              title="Platform Revenue"
              value="$12,450"
              change="+15% this month"
              icon="💰"
              color="green"
            />
          </div>

          {/* Usage Trends Chart */}
          <div className="bg-white rounded-lg border p-6">
            <h2 className="text-lg font-semibold mb-4">Platform Usage Trends</h2>
            
            {analytics.usageTrend && analytics.usageTrend.length > 0 ? (
              <UsageTrendChart data={analytics.usageTrend} />
            ) : (
              <div className="text-center py-8 text-gray-500">
                No usage data available for the selected period
              </div>
            )}
          </div>

          {/* Top Tenants */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Most Active Tenants */}
            <div className="bg-white rounded-lg border p-6">
              <h2 className="text-lg font-semibold mb-4">Most Active Tenants</h2>
              
              <div className="space-y-3">
                {analytics.topTenants.slice(0, 10).map((tenant, index) => (
                  <TenantActivityRow key={tenant.id} tenant={tenant} rank={index + 1} />
                ))}
              </div>
            </div>

            {/* Subscription Distribution */}
            <div className="bg-white rounded-lg border p-6">
              <h2 className="text-lg font-semibold mb-4">Subscription Tiers</h2>
              
              <SubscriptionChart tenants={tenantStats} />
            </div>
          </div>

          {/* Tenant Performance Table */}
          <div className="bg-white rounded-lg border">
            <div className="p-4 border-b">
              <h2 className="text-lg font-semibold">Tenant Performance Overview</h2>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Organization</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Plan</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Users</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Questions</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Documents</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Storage</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Health</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {analytics.topTenants.map(tenant => (
                    <TenantPerformanceRow key={tenant.id} tenant={tenant} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

const MetricCard = ({ title, value, change, icon, color }) => {
  const colorClasses = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    purple: 'bg-purple-50 text-purple-600',
    red: 'bg-red-50 text-red-600'
  };

  return (
    <div className="bg-white rounded-lg border p-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-2xl font-bold text-gray-900">{value}</div>
          <div className="text-sm font-medium text-gray-600">{title}</div>
          <div className="text-xs text-gray-500 mt-1">{change}</div>
        </div>
        <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${colorClasses[color]}`}>
          <span className="text-2xl">{icon}</span>
        </div>
      </div>
    </div>
  );
};

const UsageTrendChart = ({ data }) => {
  const maxQuestions = Math.max(...data.map(d => d.total_questions), 1);
  const maxTenants = Math.max(...data.map(d => d.active_tenants), 1);

  return (
    <div className="space-y-4">
      {/* Chart Legend */}
      <div className="flex justify-center gap-6 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-blue-500 rounded"></div>
          <span>Questions Asked</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-green-500 rounded"></div>
          <span>Active Tenants</span>
        </div>
      </div>

      {/* Simple Chart */}
      <div className="relative h-64 border rounded-lg p-4">
        <div className="flex items-end justify-between h-full gap-1">
          {data.slice(0, 14).map((point, index) => {
            const questionHeight = (point.total_questions / maxQuestions) * 80;
            const tenantHeight = (point.active_tenants / maxTenants) * 80;
            
            return (
              <div key={index} className="flex flex-col items-center gap-1 flex-1">
                {/* Bars */}
                <div className="flex items-end gap-1 h-32">
                  <div 
                    className="bg-blue-500 w-2 rounded-t"
                    style={{ height: `${questionHeight}%` }}
                    title={`${point.total_questions} questions`}
                  ></div>
                  <div 
                    className="bg-green-500 w-2 rounded-t"
                    style={{ height: `${tenantHeight}%` }}
                    title={`${point.active_tenants} tenants`}
                  ></div>
                </div>
                
                {/* Date Label */}
                <div className="text-xs text-gray-500 transform -rotate-45 whitespace-nowrap">
                  {new Date(point.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const TenantActivityRow = ({ tenant, rank }) => {
  const getHealthScore = () => {
    const questionScore = Math.min(tenant.question_count / 100, 1) * 40;
    const userScore = Math.min(tenant.user_count / 10, 1) * 30;
    const storageScore = Math.min(tenant.storage_used / (1024 * 1024 * 1024), 1) * 30;
    
    return Math.round(questionScore + userScore + storageScore);
  };

  const healthScore = getHealthScore();

  return (
    <div className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50">
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
          rank <= 3 ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-600'
        }`}>
          #{rank}
        </div>
        
        <div>
          <div className="font-medium text-gray-900">{tenant.name}</div>
          <div className="text-sm text-gray-500">
            {tenant.question_count} questions • {tenant.user_count} users
          </div>
        </div>
      </div>
      
      <div className="text-right">
        <div className={`text-sm font-medium ${
          healthScore >= 70 ? 'text-green-600' : 
          healthScore >= 40 ? 'text-yellow-600' : 
          'text-red-600'
        }`}>
          {healthScore}% active
        </div>
        <div className="text-xs text-gray-500">{tenant.subscription_tier}</div>
      </div>
    </div>
  );
};

const SubscriptionChart = ({ tenants }) => {
  const tierCounts = tenants.reduce((acc, tenant) => {
    acc[tenant.subscription_tier] = (acc[tenant.subscription_tier] || 0) + 1;
    return acc;
  }, {});

  const total = tenants.length;
  const colors = {
    free: '#6B7280',
    starter: '#3B82F6',
    professional: '#8B5CF6',
    enterprise: '#F59E0B'
  };

  return (
    <div className="space-y-4">
      {Object.entries(tierCounts).map(([tier, count]) => {
        const percentage = total > 0 ? (count / total) * 100 : 0;
        
        return (
          <div key={tier} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div 
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: colors[tier] }}
              ></div>
              <span className="text-sm font-medium capitalize">{tier}</span>
            </div>
            
            <div className="flex items-center gap-2">
              <div className="w-24 bg-gray-200 rounded-full h-2">
                <div 
                  className="h-2 rounded-full transition-all duration-300"
                  style={{ 
                    width: `${percentage}%`,
                    backgroundColor: colors[tier]
                  }}
                ></div>
              </div>
              <span className="text-sm text-gray-600 w-12 text-right">
                {count} ({Math.round(percentage)}%)
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

const TenantPerformanceRow = ({ tenant }) => {
  const getHealthStatus = () => {
    const hasUsers = tenant.user_count > 0;
    const hasQuestions = tenant.question_count > 0;
    const hasDocuments = tenant.document_count > 0;
    
    const activeFactors = [hasUsers, hasQuestions, hasDocuments].filter(Boolean).length;
    
    if (activeFactors >= 3) return { status: 'Excellent', color: 'green' };
    if (activeFactors >= 2) return { status: 'Good', color: 'blue' };
    if (activeFactors >= 1) return { status: 'Fair', color: 'yellow' };
    return { status: 'Inactive', color: 'red' };
  };

  const getTierBadge = (tier) => {
    const styles = {
      free: 'bg-gray-100 text-gray-800',
      starter: 'bg-blue-100 text-blue-800',
      professional: 'bg-purple-100 text-purple-800',
      enterprise: 'bg-yellow-100 text-yellow-800'
    };

    return (
      <span className={`px-2 py-1 text-xs rounded-full ${styles[tier] || 'bg-gray-100 text-gray-800'}`}>
        {tier}
      </span>
    );
  };

  const health = getHealthStatus();

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-3">
        <div>
          <div className="font-medium text-gray-900">{tenant.name}</div>
          <div className="text-sm text-gray-500">{tenant.slug}</div>
        </div>
      </td>
      <td className="px-4 py-3">
        {getTierBadge(tenant.subscription_tier)}
      </td>
      <td className="px-4 py-3 text-sm text-gray-900">
        {tenant.user_count}
      </td>
      <td className="px-4 py-3 text-sm text-gray-900">
        {tenant.question_count}
      </td>
      <td className="px-4 py-3 text-sm text-gray-900">
        {tenant.document_count}
      </td>
      <td className="px-4 py-3 text-sm text-gray-900">
        {formatBytes(tenant.storage_used || 0)}
      </td>
      <td className="px-4 py-3">
        <span className={`px-2 py-1 text-xs rounded-full ${
          health.color === 'green' ? 'bg-green-100 text-green-800' :
          health.color === 'blue' ? 'bg-blue-100 text-blue-800' :
          health.color === 'yellow' ? 'bg-yellow-100 text-yellow-800' :
          'bg-red-100 text-red-800'
        }`}>
          {health.status}
        </span>
      </td>
    </tr>
  );
};

// Helper function to format bytes
const formatBytes = (bytes) => {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export default SuperAdminAnalytics;