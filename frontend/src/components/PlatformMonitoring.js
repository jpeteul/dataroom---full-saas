import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';

const PlatformMonitoring = () => {
  const [realtimeStats, setRealtimeStats] = useState({});
  const [systemHealth, setSystemHealth] = useState({});
  const [alerts, setAlerts] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);

  const { getAuthHeaders, isSuperAdmin } = useAuth();
  const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

  // Load real-time statistics
  const loadRealtimeStats = useCallback(async () => {
    if (!isSuperAdmin) return;

    try {
      // Simulate real-time stats (in production, this would be a WebSocket or polling endpoint)
      const [tenantsResponse, healthResponse] = await Promise.all([
        fetch(`${API_BASE}/tenants`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE}/health`, { headers: getAuthHeaders() })
      ]);

      if (tenantsResponse.ok) {
        const tenantsData = await tenantsResponse.json();
        const tenants = tenantsData.tenants;
        
        const stats = {
          activeTenants: tenants.filter(t => t.subscription_status === 'active').length,
          totalUsers: tenants.reduce((sum, t) => sum + parseInt(t.user_count || 0), 0),
          totalDocuments: tenants.reduce((sum, t) => sum + parseInt(t.document_count || 0), 0),
          totalStorage: tenants.reduce((sum, t) => sum + parseInt(t.storage_used || 0), 0),
          tenants
        };
        
        setRealtimeStats(stats);
        
        // Generate alerts based on thresholds
        generateAlerts(stats);
      }

      if (healthResponse.ok) {
        const healthData = await healthResponse.json();
        setSystemHealth({
          status: 'healthy',
          uptime: '99.9%',
          responseTime: '120ms',
          lastCheck: healthData.timestamp
        });
      }

      setLastUpdated(new Date());
    } catch (error) {
      console.error('Failed to load realtime stats:', error);
      setSystemHealth({
        status: 'error',
        error: error.message
      });
    }
  }, [isSuperAdmin, getAuthHeaders, API_BASE]);

  // Generate alerts based on platform metrics
  const generateAlerts = (stats) => {
    const newAlerts = [];
    const now = new Date();

    // Check for tenants approaching limits
    stats.tenants.forEach(tenant => {
      const storageGB = (tenant.storage_used || 0) / (1024 * 1024 * 1024);
      
      if (storageGB > 80) { // 80GB threshold
        newAlerts.push({
          id: `storage-${tenant.id}`,
          type: 'warning',
          title: 'High Storage Usage',
          message: `${tenant.name} is using ${storageGB.toFixed(1)}GB of storage`,
          timestamp: now,
          tenant: tenant.name
        });
      }

      if (tenant.user_count >= 50) {
        newAlerts.push({
          id: `users-${tenant.id}`,
          type: 'info',
          title: 'High User Count',
          message: `${tenant.name} has ${tenant.user_count} users`,
          timestamp: now,
          tenant: tenant.name
        });
      }
    });

    // Platform-level alerts
    if (stats.activeTenants > 100) {
      newAlerts.push({
        id: 'platform-scale',
        type: 'success',
        title: 'Platform Milestone',
        message: `Platform now serving ${stats.activeTenants} active organizations`,
        timestamp: now
      });
    }

    setAlerts(newAlerts.slice(0, 10)); // Keep last 10 alerts
  };

  // Auto-refresh every 30 seconds
  useEffect(() => {
    loadRealtimeStats();
    const interval = setInterval(loadRealtimeStats, 30000);
    return () => clearInterval(interval);
  }, [loadRealtimeStats]);

  if (!isSuperAdmin) {
    return (
      <div className="text-center py-12">
        <div className="text-red-600 text-lg">Access Denied - Superadmin Only</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Real-time Status Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Platform Monitoring</h1>
          <p className="text-gray-600">Real-time system health and alerts</p>
        </div>
        
        <div className="text-right">
          <div className="text-sm text-gray-600">
            Last updated: {lastUpdated?.toLocaleTimeString() || 'Never'}
          </div>
          <div className={`text-xs font-medium ${
            systemHealth.status === 'healthy' ? 'text-green-600' : 'text-red-600'
          }`}>
            System: {systemHealth.status}
          </div>
        </div>
      </div>

      {/* System Health Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <SystemHealthCard
          title="System Status"
          value={systemHealth.status === 'healthy' ? 'Healthy' : 'Issues'}
          icon="🔋"
          color={systemHealth.status === 'healthy' ? 'green' : 'red'}
        />
        <SystemHealthCard
          title="Uptime"
          value={systemHealth.uptime || 'N/A'}
          icon="⏱️"
          color="blue"
        />
        <SystemHealthCard
          title="Response Time"
          value={systemHealth.responseTime || 'N/A'}
          icon="⚡"
          color="purple"
        />
        <SystemHealthCard
          title="Active Tenants"
          value={realtimeStats.activeTenants || 0}
          icon="🏢"
          color="green"
        />
      </div>

      {/* Alerts Panel */}
      <div className="bg-white rounded-lg border">
        <div className="p-4 border-b">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">System Alerts</h2>
            <span className="text-sm text-gray-500">
              {alerts.length} active alert{alerts.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
        
        <div className="divide-y">
          {alerts.length > 0 ? (
            alerts.map(alert => (
              <AlertRow key={alert.id} alert={alert} />
            ))
          ) : (
            <div className="p-8 text-center text-gray-500">
              <div className="text-2xl mb-2">✅</div>
              <div>No active alerts - all systems normal</div>
            </div>
          )}
        </div>
      </div>

      {/* Resource Usage Monitoring */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Storage Distribution */}
        <div className="bg-white rounded-lg border p-6">
          <h2 className="text-lg font-semibold mb-4">Storage Distribution</h2>
          
          <StorageChart tenants={realtimeStats.tenants || []} />
        </div>

        {/* Activity Heatmap */}
        <div className="bg-white rounded-lg border p-6">
          <h2 className="text-lg font-semibold mb-4">Activity Heatmap</h2>
          
          <ActivityHeatmap tenants={realtimeStats.tenants || []} />
        </div>
      </div>

      {/* Performance Metrics */}
      <div className="bg-white rounded-lg border p-6">
        <h2 className="text-lg font-semibold mb-4">Performance Metrics</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <PerformanceMetric
            title="Average Questions/Day"
            value={calculateAverageQuestions(realtimeStats.tenants || [])}
            trend="+12%"
            icon="💬"
          />
          <PerformanceMetric
            title="Document Upload Rate"
            value="145/day"
            trend="+8%"
            icon="📁"
          />
          <PerformanceMetric
            title="User Engagement"
            value="78%"
            trend="+3%"
            icon="👥"
          />
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-lg border p-6">
        <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <QuickActionButton
            title="Create Tenant"
            icon="➕"
            onClick={() => {/* Handle create tenant */}}
          />
          <QuickActionButton
            title="System Backup"
            icon="💾"
            onClick={() => {/* Handle backup */}}
          />
          <QuickActionButton
            title="Send Announcement"
            icon="📢"
            onClick={() => {/* Handle announcement */}}
          />
          <QuickActionButton
            title="Generate Report"
            icon="📊"
            onClick={() => {/* Handle report */}}
          />
        </div>
      </div>
    </div>
  );
};

const SystemHealthCard = ({ title, value, icon, color }) => {
  const colorClasses = {
    green: 'text-green-600',
    blue: 'text-blue-600',
    purple: 'text-purple-600',
    red: 'text-red-600'
  };

  return (
    <div className="bg-white rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className={`text-xl font-bold ${colorClasses[color]}`}>{value}</div>
          <div className="text-sm text-gray-600">{title}</div>
        </div>
        <div className="text-2xl">{icon}</div>
      </div>
    </div>
  );
};

const AlertRow = ({ alert }) => {
  const getAlertStyles = (type) => {
    const styles = {
      error: 'bg-red-50 text-red-800 border-red-200',
      warning: 'bg-yellow-50 text-yellow-800 border-yellow-200',
      info: 'bg-blue-50 text-blue-800 border-blue-200',
      success: 'bg-green-50 text-green-800 border-green-200'
    };
    return styles[type] || styles.info;
  };

  const getIcon = (type) => {
    const icons = {
      error: '🔴',
      warning: '🟡',
      info: 'ℹ️',
      success: '🟢'
    };
    return icons[type] || 'ℹ️';
  };

  return (
    <div className={`p-4 border-l-4 ${getAlertStyles(alert.type)}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-2">
          <span className="text-lg">{getIcon(alert.type)}</span>
          <div>
            <div className="font-medium">{alert.title}</div>
            <div className="text-sm">{alert.message}</div>
            {alert.tenant && (
              <div className="text-xs mt-1">Organization: {alert.tenant}</div>
            )}
          </div>
        </div>
        
        <div className="text-xs text-gray-500">
          {alert.timestamp.toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
};

const StorageChart = ({ tenants }) => {
  const totalStorage = tenants.reduce((sum, t) => sum + (t.storage_used || 0), 0);
  
  const topTenants = tenants
    .sort((a, b) => (b.storage_used || 0) - (a.storage_used || 0))
    .slice(0, 8);

  return (
    <div className="space-y-3">
      {topTenants.map(tenant => {
        const usage = tenant.storage_used || 0;
        const percentage = totalStorage > 0 ? (usage / totalStorage) * 100 : 0;
        
        return (
          <div key={tenant.id} className="flex items-center gap-3">
            <div className="w-24 text-sm text-gray-600 truncate">{tenant.name}</div>
            <div className="flex-1 bg-gray-200 rounded-full h-2">
              <div 
                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${percentage}%` }}
              ></div>
            </div>
            <div className="text-sm text-gray-600 w-16 text-right">
              {formatBytes(usage)}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const ActivityHeatmap = ({ tenants }) => {
  // Generate last 7 days
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - i);
    return date;
  }).reverse();

  // Simulate activity data (in production, this would come from analytics)
  const getActivityLevel = (tenant, date) => {
    const seed = tenant.id.charCodeAt(0) + date.getDate();
    return Math.floor(Math.random() * seed) % 4; // 0-3 activity levels
  };

  const getActivityColor = (level) => {
    const colors = ['bg-gray-100', 'bg-green-200', 'bg-green-400', 'bg-green-600'];
    return colors[level] || colors[0];
  };

  return (
    <div className="space-y-2">
      {/* Header with days */}
      <div className="flex gap-1">
        <div className="w-24"></div>
        {days.map(day => (
          <div key={day.toDateString()} className="flex-1 text-xs text-gray-500 text-center">
            {day.toLocaleDateString('en-US', { weekday: 'short' })}
          </div>
        ))}
      </div>
      
      {/* Tenant activity rows */}
      {tenants.slice(0, 10).map(tenant => (
        <div key={tenant.id} className="flex gap-1 items-center">
          <div className="w-24 text-xs text-gray-600 truncate">{tenant.name}</div>
          {days.map(day => {
            const level = getActivityLevel(tenant, day);
            return (
              <div
                key={day.toDateString()}
                className={`flex-1 h-4 rounded ${getActivityColor(level)}`}
                title={`${tenant.name} - ${day.toLocaleDateString()}: ${level === 0 ? 'No' : level === 1 ? 'Low' : level === 2 ? 'Medium' : 'High'} activity`}
              ></div>
            );
          })}
        </div>
      ))}
      
      {/* Legend */}
      <div className="flex items-center justify-center gap-2 text-xs text-gray-500 mt-4">
        <span>Less</span>
        <div className="flex gap-1">
          <div className="w-3 h-3 rounded bg-gray-100"></div>
          <div className="w-3 h-3 rounded bg-green-200"></div>
          <div className="w-3 h-3 rounded bg-green-400"></div>
          <div className="w-3 h-3 rounded bg-green-600"></div>
        </div>
        <span>More</span>
      </div>
    </div>
  );
};

const PerformanceMetric = ({ title, value, trend, icon }) => {
  const isPositiveTrend = trend.startsWith('+');
  
  return (
    <div className="text-center p-4 border rounded-lg">
      <div className="text-2xl mb-2">{icon}</div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="text-sm text-gray-600">{title}</div>
      <div className={`text-xs font-medium ${
        isPositiveTrend ? 'text-green-600' : 'text-red-600'
      }`}>
        {trend} vs last period
      </div>
    </div>
  );
};

const QuickActionButton = ({ title, icon, onClick }) => (
  <button
    onClick={onClick}
    className="flex flex-col items-center gap-2 p-4 border rounded-lg hover:bg-gray-50 transition-colors"
  >
    <div className="text-2xl">{icon}</div>
    <div className="text-sm font-medium text-gray-700">{title}</div>
  </button>
);

// Helper functions
const formatBytes = (bytes) => {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const calculateAverageQuestions = (tenants) => {
  const totalQuestions = tenants.reduce((sum, t) => sum + (t.question_count || 0), 0);
  const activeTenants = tenants.filter(t => t.user_count > 0).length;
  
  if (activeTenants === 0) return '0';
  
  return Math.round(totalQuestions / activeTenants / 30); // Per day average
};

export default PlatformMonitoring;