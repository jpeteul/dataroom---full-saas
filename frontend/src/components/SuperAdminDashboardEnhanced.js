import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import SuperAdminAnalytics from './SuperAdminAnalytics';
import PlatformMonitoring from './PlatformMonitoring';
import RevenueAnalytics from './RevenueAnalytics';

const SuperAdminDashboardEnhanced = () => {
  const [activeTab, setActiveTab] = useState('overview');
  const [notifications, setNotifications] = useState([]);
  const [platformStats, setPlatformStats] = useState(null);

  const { user, isSuperAdmin, getAuthHeaders } = useAuth();
  const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

  // Load platform overview stats
  useEffect(() => {
    if (isSuperAdmin) {
      loadPlatformStats();
      loadNotifications();
    }
  }, [isSuperAdmin]);

  const loadPlatformStats = async () => {
    try {
      const response = await fetch(`${API_BASE}/tenants`, {
        headers: getAuthHeaders()
      });
      
      if (response.ok) {
        const data = await response.json();
        setPlatformStats(data);
      }
    } catch (error) {
      console.error('Failed to load platform stats:', error);
    }
  };

  const loadNotifications = async () => {
    // Simulate notifications (in production, these would come from your backend)
    const mockNotifications = [
      {
        id: 1,
        type: 'info',
        title: 'New tenant signup',
        message: 'Acme Corp just upgraded to Professional tier',
        timestamp: new Date(Date.now() - 2 * 60 * 1000),
        read: false
      },
      {
        id: 2,
        type: 'warning',
        title: 'High storage usage',
        message: 'TechStartup Inc is approaching their storage limit',
        timestamp: new Date(Date.now() - 15 * 60 * 1000),
        read: false
      },
      {
        id: 3,
        type: 'success',
        title: 'System update completed',
        message: 'Multi-tenant architecture deployed successfully',
        timestamp: new Date(Date.now() - 60 * 60 * 1000),
        read: true
      }
    ];
    
    setNotifications(mockNotifications);
  };

  if (!isSuperAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">🔒</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Restricted</h2>
          <p className="text-gray-600">This area is reserved for platform administrators only.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <div className="w-8 h-8 bg-purple-600 rounded mr-3 flex items-center justify-center">
                <span className="text-white font-bold text-sm">SA</span>
              </div>
              <div>
                <h1 className="text-xl font-semibold text-gray-900">Platform Administration</h1>
                <div className="text-xs text-gray-500">Multi-Tenant SaaS Control Center</div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              {/* Notifications */}
              <NotificationDropdown notifications={notifications} />
              
              {/* User Profile */}
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
                  <span className="text-purple-600 font-bold text-sm">
                    {user?.name?.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="hidden md:block text-sm">
                  <div className="font-medium text-gray-900">{user?.name}</div>
                  <div className="text-xs text-gray-500">Platform Admin</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-8">
            <TabButton
              active={activeTab === 'overview'}
              onClick={() => setActiveTab('overview')}
              icon="📊"
            >
              Overview
            </TabButton>
            
            <TabButton
              active={activeTab === 'tenants'}
              onClick={() => setActiveTab('tenants')}
              icon="🏢"
            >
              Tenants
            </TabButton>
            
            <TabButton
              active={activeTab === 'analytics'}
              onClick={() => setActiveTab('analytics')}
              icon="📈"
            >
              Analytics
            </TabButton>
            
            <TabButton
              active={activeTab === 'revenue'}
              onClick={() => setActiveTab('revenue')}
              icon="💰"
            >
              Revenue
            </TabButton>
            
            <TabButton
              active={activeTab === 'monitoring'}
              onClick={() => setActiveTab('monitoring')}
              icon="🔍"
            >
              Monitoring
            </TabButton>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        {activeTab === 'overview' && <PlatformOverview stats={platformStats} />}
        {activeTab === 'tenants' && <TenantManagement />}
        {activeTab === 'analytics' && <SuperAdminAnalytics />}
        {activeTab === 'revenue' && <RevenueAnalytics />}
        {activeTab === 'monitoring' && <PlatformMonitoring />}
      </main>
    </div>
  );
};

const TabButton = ({ active, onClick, children, icon }) => (
  <button
    onClick={onClick}
    className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 ${
      active
        ? 'border-purple-500 text-purple-600'
        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
    }`}
  >
    <span>{icon}</span>
    {children}
  </button>
);

const NotificationDropdown = ({ notifications }) => {
  const [isOpen, setIsOpen] = useState(false);
  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-gray-400 hover:text-gray-600"
      >
        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
        </svg>
        
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 h-5 w-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
            {unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)}></div>
          
          <div className="absolute right-0 mt-2 w-80 bg-white rounded-md shadow-lg z-20 border max-h-96 overflow-y-auto">
            <div className="p-3 border-b">
              <h3 className="font-medium text-gray-900">Notifications</h3>
            </div>
            
            {notifications.length > 0 ? (
              <div className="divide-y">
                {notifications.map(notification => (
                  <NotificationItem key={notification.id} notification={notification} />
                ))}
              </div>
            ) : (
              <div className="p-4 text-center text-gray-500">
                No notifications
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

const NotificationItem = ({ notification }) => {
  const getTypeIcon = (type) => {
    const icons = {
      info: 'ℹ️',
      warning: '⚠️',
      success: '✅',
      error: '❌'
    };
    return icons[type] || 'ℹ️';
  };

  const timeAgo = (date) => {
    const minutes = Math.floor((new Date() - date) / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <div className={`p-3 hover:bg-gray-50 ${!notification.read ? 'bg-blue-50' : ''}`}>
      <div className="flex items-start gap-3">
        <span className="text-lg">{getTypeIcon(notification.type)}</span>
        
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-medium ${!notification.read ? 'text-gray-900' : 'text-gray-700'}`}>
            {notification.title}
          </div>
          <div className="text-sm text-gray-600">{notification.message}</div>
          <div className="text-xs text-gray-500 mt-1">{timeAgo(notification.timestamp)}</div>
        </div>

        {!notification.read && (
          <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
        )}
      </div>
    </div>
  );
};

const PlatformOverview = ({ stats }) => (
  <div className="text-center py-12">
    <div className="text-6xl mb-4">🚀</div>
    <h2 className="text-2xl font-bold text-gray-900 mb-2">Platform Overview</h2>
    <p className="text-gray-600 mb-8">
      Welcome to your multi-tenant SaaS platform control center
    </p>
    
    {stats && (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-2xl mx-auto">
        <div className="bg-white p-4 rounded-lg border">
          <div className="text-2xl font-bold text-blue-600">{stats.tenants?.length || 0}</div>
          <div className="text-sm text-gray-600">Organizations</div>
        </div>
        <div className="bg-white p-4 rounded-lg border">
          <div className="text-2xl font-bold text-green-600">
            {stats.tenants?.reduce((sum, t) => sum + (t.user_count || 0), 0) || 0}
          </div>
          <div className="text-sm text-gray-600">Total Users</div>
        </div>
        <div className="bg-white p-4 rounded-lg border">
          <div className="text-2xl font-bold text-purple-600">99.9%</div>
          <div className="text-sm text-gray-600">Uptime</div>
        </div>
        <div className="bg-white p-4 rounded-lg border">
          <div className="text-2xl font-bold text-orange-600">$12.4K</div>
          <div className="text-sm text-gray-600">MRR</div>
        </div>
      </div>
    )}
  </div>
);

const TenantManagement = () => {
  // This would be your existing SuperAdminDashboard component content
  // Import and use the original SuperAdminDashboard here
  return (
    <div className="text-center py-12">
      <div className="text-gray-600">
        Tenant management component - integrate your existing SuperAdminDashboard component here
      </div>
    </div>
  );
};

export default SuperAdminDashboardEnhanced;