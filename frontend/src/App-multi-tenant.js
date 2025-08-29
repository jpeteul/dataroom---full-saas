import React, { useState, useEffect } from 'react';
import { AuthProvider } from './contexts/AuthContext';
import { TenantProvider } from './contexts/TenantContext';
import { useAuth } from './contexts/AuthContext';
import { useTenant } from './contexts/TenantContext';

// Import components
import Login from './components/Login';
import AcceptInvitation from './components/AcceptInvitation';
import SuperAdminDashboard from './components/SuperAdminDashboard';
import TenantUserManagement from './components/TenantUserManagement';
import TenantSettings from './components/TenantSettings';

// Import your existing components (assuming they exist)
// import DataRoomAnalyzer from './components/DataRoomAnalyzer';
// import AnalyticsDashboard from './components/AnalyticsDashboard';

// CSS animations
const spinKeyframes = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;

// Inject CSS
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = spinKeyframes;
  document.head.appendChild(style);
}

// Main App Component
const AppContent = () => {
  const { user, loading: authLoading, isAuthenticated, isSuperAdmin } = useAuth();
  const { tenant, tenantSettings, loading: tenantLoading } = useTenant();
  const [activeTab, setActiveTab] = useState('documents');
  const [currentRoute, setCurrentRoute] = useState('app');

  // Handle routing based on URL
  useEffect(() => {
    const path = window.location.pathname;
    
    if (path.includes('/invite')) {
      setCurrentRoute('invite');
    } else if (path.includes('/login')) {
      setCurrentRoute('login');
    } else {
      setCurrentRoute('app');
    }
  }, []);

  // Show loading state
  if (authLoading || (isAuthenticated && tenantLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <div className="mt-4 text-gray-600">Loading your workspace...</div>
        </div>
      </div>
    );
  }

  // Handle invitation route
  if (currentRoute === 'invite') {
    return <AcceptInvitation />;
  }

  // Show login if not authenticated
  if (!isAuthenticated) {
    return <Login />;
  }

  // Apply tenant branding
  const primaryColor = tenantSettings?.primary_color || '#4F46E5';
  const appTitle = tenantSettings?.app_title || 'Smart DataRoom';
  const companyName = tenantSettings?.company_name || tenant?.name || 'DataRoom';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation Header */}
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            {/* Logo and Title */}
            <div className="flex items-center">
              {tenantSettings?.logo_url ? (
                <img
                  src={tenantSettings.logo_url}
                  alt={companyName}
                  className="h-8 w-auto mr-3"
                />
              ) : (
                <div 
                  className="w-8 h-8 rounded mr-3 flex items-center justify-center text-white text-sm font-bold"
                  style={{ backgroundColor: primaryColor }}
                >
                  {companyName.charAt(0).toUpperCase()}
                </div>
              )}
              <div>
                <h1 className="text-xl font-semibold text-gray-900">{appTitle}</h1>
                {!isSuperAdmin && (
                  <div className="text-xs text-gray-500">{companyName}</div>
                )}
              </div>
            </div>

            {/* User Menu */}
            <div className="flex items-center gap-4">
              {/* Tenant/Role Badge */}
              <div className="text-sm">
                <span className={`px-2 py-1 rounded-full text-xs ${
                  isSuperAdmin 
                    ? 'bg-purple-100 text-purple-800' 
                    : user.tenant_role === 'admin'
                    ? 'bg-blue-100 text-blue-800'
                    : 'bg-gray-100 text-gray-800'
                }`}>
                  {isSuperAdmin ? 'Platform Admin' : user.tenant_role}
                </span>
              </div>

              {/* User Profile */}
              <UserDropdown />
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      {isSuperAdmin ? (
        <SuperAdminDashboard />
      ) : (
        <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
          {/* Tenant Tabs */}
          <div className="mb-6">
            <div className="border-b border-gray-200">
              <nav className="-mb-px flex space-x-8">
                <TabButton
                  active={activeTab === 'documents'}
                  onClick={() => setActiveTab('documents')}
                  icon="📄"
                >
                  Documents
                </TabButton>
                
                <TabButton
                  active={activeTab === 'analytics'}
                  onClick={() => setActiveTab('analytics')}
                  icon="📊"
                  disabled={!user || user.tenant_role !== 'admin'}
                >
                  Analytics
                </TabButton>
                
                <TabButton
                  active={activeTab === 'users'}
                  onClick={() => setActiveTab('users')}
                  icon="👥"
                  disabled={!user || user.tenant_role !== 'admin'}
                >
                  Team
                </TabButton>
                
                <TabButton
                  active={activeTab === 'settings'}
                  onClick={() => setActiveTab('settings')}
                  icon="⚙️"
                  disabled={!user || user.tenant_role !== 'admin'}
                >
                  Settings
                </TabButton>
              </nav>
            </div>
          </div>

          {/* Tab Content */}
          <div className="bg-white rounded-lg border min-h-96">
            {activeTab === 'documents' && (
              <div className="p-6">
                {/* Your existing DataRoomAnalyzer component would go here */}
                <div className="text-center py-12 text-gray-500">
                  Documents component - integrate your existing DataRoomAnalyzer here
                </div>
              </div>
            )}
            
            {activeTab === 'analytics' && user.tenant_role === 'admin' && (
              <div className="p-6">
                {/* Your existing AnalyticsDashboard component would go here */}
                <div className="text-center py-12 text-gray-500">
                  Analytics component - integrate your existing AnalyticsDashboard here
                </div>
              </div>
            )}
            
            {activeTab === 'users' && user.tenant_role === 'admin' && (
              <div className="p-6">
                <TenantUserManagement />
              </div>
            )}
            
            {activeTab === 'settings' && user.tenant_role === 'admin' && (
              <div className="p-6">
                <TenantSettings />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const TabButton = ({ active, onClick, children, icon, disabled = false }) => {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm flex items-center gap-2 ${
        active
          ? 'border-blue-500 text-blue-600'
          : disabled
          ? 'border-transparent text-gray-400 cursor-not-allowed'
          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
      }`}
    >
      <span>{icon}</span>
      {children}
    </button>
  );
};

const UserDropdown = () => {
  const [isOpen, setIsOpen] = useState(false);
  const { user, logout } = useAuth();

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-gray-700 hover:bg-gray-100"
      >
        <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center">
          {user?.name?.charAt(0).toUpperCase() || 'U'}
        </div>
        <span className="hidden md:block">{user?.name}</span>
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>

      {isOpen && (
        <>
          <div 
            className="fixed inset-0 z-10" 
            onClick={() => setIsOpen(false)}
          ></div>
          
          <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 z-20 border">
            <div className="px-4 py-2 text-sm text-gray-500 border-b">
              <div className="font-medium">{user?.name}</div>
              <div className="text-xs">{user?.email}</div>
            </div>
            
            <button
              onClick={() => {
                setIsOpen(false);
                // Add profile modal or navigation
              }}
              className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
            >
              Profile Settings
            </button>
            
            <button
              onClick={() => {
                setIsOpen(false);
                logout();
              }}
              className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
            >
              Sign Out
            </button>
          </div>
        </>
      )}
    </div>
  );
};

// Root App Component with Providers
const App = () => {
  return (
    <AuthProvider>
      <TenantProvider>
        <AppContent />
      </TenantProvider>
    </AuthProvider>
  );
};

export default App;