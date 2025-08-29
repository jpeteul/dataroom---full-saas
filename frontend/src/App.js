import React, { useState, useRef, useEffect, createContext, useContext, useCallback } from 'react';

// Add CSS animation for loading spinner
const spinKeyframes = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;

// Inject the CSS
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = spinKeyframes;
  document.head.appendChild(style);
}

// Add this near your AuthContext
const SettingsContext = createContext();

const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
};

const SettingsProvider = ({ children }) => {
  const [settings, setSettings] = useState({
    company_name: 'Data Room Analyzer',
    logo_url: null,
    primary_color: '#2563eb',
    app_title: 'Data Room Analyzer'
  });

  const { getAuthHeaders } = useAuth();
  const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

  const loadSettings = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/settings`, {
        headers: getAuthHeaders()
      });
      if (response.ok) {
        const data = await response.json();
        setSettings(data.settings);
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const updateSettings = async (newSettings) => {
    try {
      const response = await fetch(`${API_BASE}/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({ settings: newSettings })
      });
      
      if (response.ok) {
        setSettings(prev => ({ ...prev, ...newSettings }));
        return { success: true };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  };

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, loadSettings }}>
      {children}
    </SettingsContext.Provider>
  );
};

// Authentication Context
const AuthContext = createContext();

const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

 useEffect(() => {
  checkAuth();
}, []);

  const checkAuth = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/auth/me`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
      } else {
        localStorage.removeItem('token');
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      localStorage.removeItem('token');
    } finally {
      setLoading(false);
  }
}, [API_BASE]);

  const login = async (email, password) => {
    try {
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (data.success) {
        localStorage.setItem('token', data.token);
        setUser(data.user);
        return { success: true };
      } else {
        return { success: false, error: data.error };
      }
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, error: 'Connection failed. Please check if the server is running.' };
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
  };

  const getAuthHeaders = () => {
    const token = localStorage.getItem('token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  };

  return (
    <AuthContext.Provider value={{
      user,
      login,
      logout,
      loading,
      getAuthHeaders,
      isAdmin: user?.role === 'admin',
      isAuthenticated: !!user
    }}>
      {children}
    </AuthContext.Provider>
  );
};

const SettingsManagement = () => {
  const { settings, updateSettings } = useSettings();
  const [localSettings, setLocalSettings] = useState(settings);
  const [logoFile, setLogoFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const { getAuthHeaders } = useAuth();

useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);
  
  const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

  const handleLogoUpload = async () => {
    if (!logoFile) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('logo', logoFile);

    try {
      const response = await fetch(`${API_BASE}/settings/logo`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData
      });

      if (response.ok) {
        const data = await response.json();
        setLocalSettings(prev => ({ ...prev, logo_url: data.logoUrl }));
        setLogoFile(null);
      }
    } catch (error) {
      alert('Logo upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleSaveSettings = async () => {
    const result = await updateSettings(localSettings);
    if (result.success) {
      alert('Settings saved successfully!');
    } else {
      alert('Failed to save settings');
    }
  };

  return (
    <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1.5rem' }}>
      <h2 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '1.5rem' }}>App Settings</h2>
      
      {/* Logo Upload */}
      <div style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: '500', marginBottom: '1rem' }}>Company Logo</h3>
        
        {localSettings.logo_url && (
          <div style={{ marginBottom: '1rem' }}>
            <img 
              src={localSettings.logo_url} 
              alt="Current Logo" 
              style={{ height: '60px', maxWidth: '200px', objectFit: 'contain' }}
            />
          </div>
        )}
        
        <input
          type="file"
          accept=".png,.jpg,.jpeg,.svg"
          onChange={(e) => setLogoFile(e.target.files[0])}
          style={{ marginBottom: '0.5rem' }}
        />
        
        <button
          onClick={handleLogoUpload}
          disabled={!logoFile || uploading}
          style={{
            padding: '0.5rem 1rem',
            backgroundColor: '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: '0.375rem',
            cursor: 'pointer',
            opacity: (!logoFile || uploading) ? 0.5 : 1
          }}
        >
          {uploading ? 'Uploading...' : 'Upload Logo'}
        </button>
      </div>

      {/* Other Settings */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', marginBottom: '0.25rem' }}>
            Company Name
          </label>
          <input
            type="text"
            value={localSettings.company_name || ''}
            onChange={(e) => setLocalSettings(prev => ({ ...prev, company_name: e.target.value }))}
            style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', boxSizing: 'border-box' }}
          />
        </div>
        
        <div>
          <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', marginBottom: '0.25rem' }}>
            App Title
          </label>
          <input
            type="text"
            value={localSettings.app_title || ''}
            onChange={(e) => setLocalSettings(prev => ({ ...prev, app_title: e.target.value }))}
            style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', boxSizing: 'border-box' }}
          />
        </div>
      </div>

      <button
        onClick={handleSaveSettings}
        style={{
          padding: '0.75rem 1.5rem',
          backgroundColor: '#059669',
          color: 'white',
          border: 'none',
          borderRadius: '0.375rem',
          cursor: 'pointer',
          fontSize: '0.875rem',
          fontWeight: '500'
        }}
      >
        Save Settings
      </button>
    </div>
  );
};

// Analytics Dashboard Component
const AnalyticsDashboard = () => {
  const [analytics, setAnalytics] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState('dashboard');
  const { getAuthHeaders } = useAuth();

  const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

  useEffect(() => {
  loadAnalytics();
}, []);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/analytics/dashboard`, {
        headers: getAuthHeaders()
      });
      if (response.ok) {
        const data = await response.json();
        setAnalytics(data.analytics);
      }
    } catch (error) {
      console.error('Failed to load analytics:', error);
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  const loadQuestions = async () => {
    try {
      const response = await fetch(`${API_BASE}/analytics/questions?limit=100`, {
        headers: getAuthHeaders()
      });
      if (response.ok) {
        const data = await response.json();
        setQuestions(data.questions);
      }
    } catch (error) {
      console.error('Failed to load questions:', error);
    }
  };

  const loadSessions = async () => {
    try {
      const response = await fetch(`${API_BASE}/analytics/sessions?limit=50`, {
        headers: getAuthHeaders()
      });
      if (response.ok) {
        const data = await response.json();
        setSessions(data.sessions);
      }
    } catch (error) {
      console.error('Failed to load sessions:', error);
    }
  };

  const exportData = async (type) => {
    try {
      const response = await fetch(`${API_BASE}/analytics/export?type=${type}`, {
        headers: getAuthHeaders()
      });
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${type}-analytics.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('Export failed:', error);
      alert('Export failed');
    }
  };

  if (loading) {
    return (
      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '2rem', textAlign: 'center' }}>
        <div style={{ 
          width: '40px', 
          height: '40px', 
          border: '4px solid #e5e7eb', 
          borderTop: '4px solid #2563eb', 
          borderRadius: '50%', 
          animation: 'spin 1s linear infinite',
          margin: '0 auto 1rem auto'
        }}></div>
        <p style={{ color: '#6b7280', margin: '0' }}>Loading analytics...</p>
      </div>
    );
  }

  if (!analytics) {
    return (
      <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: '#6b7280', margin: '0' }}>Failed to load analytics data</p>
      </div>
    );
  }

  return (
    <div>
      {/* Analytics Navigation */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ backgroundColor: '#f3f4f6', padding: '0.25rem', borderRadius: '0.5rem', display: 'inline-flex' }}>
          {[
            { id: 'dashboard', label: 'Overview' },
            { id: 'questions', label: 'Questions' },
            { id: 'sessions', label: 'Sessions' },
            { id: 'export', label: 'Export' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveView(tab.id);
                if (tab.id === 'questions') loadQuestions();
                if (tab.id === 'sessions') loadSessions();
              }}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '0.375rem',
                fontWeight: '500',
                border: 'none',
                cursor: 'pointer',
                backgroundColor: activeView === tab.id ? 'white' : 'transparent',
                color: activeView === tab.id ? '#2563eb' : '#6b7280'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Dashboard Overview */}
      {activeView === 'dashboard' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
          {/* Summary Stats */}
          <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1.5rem' }}>
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.125rem', fontWeight: '600' }}>Overview</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <p style={{ margin: '0', fontSize: '2rem', fontWeight: 'bold', color: '#2563eb' }}>
                  {analytics.summary.totalQuestions}
                </p>
                <p style={{ margin: '0', fontSize: '0.875rem', color: '#6b7280' }}>Total Questions</p>
              </div>
              <div>
                <p style={{ margin: '0', fontSize: '2rem', fontWeight: 'bold', color: '#059669' }}>
                  {analytics.summary.totalUsers}
                </p>
                <p style={{ margin: '0', fontSize: '0.875rem', color: '#6b7280' }}>Investors</p>
              </div>
              <div>
                <p style={{ margin: '0', fontSize: '2rem', fontWeight: 'bold', color: '#dc2626' }}>
                  {analytics.recentActivity.questionsLast7Days}
                </p>
                <p style={{ margin: '0', fontSize: '0.875rem', color: '#6b7280' }}>Questions (7 days)</p>
              </div>
              <div>
                <p style={{ margin: '0', fontSize: '2rem', fontWeight: 'bold', color: '#7c3aed' }}>
                  {analytics.recentActivity.sessionsLast7Days}
                </p>
                <p style={{ margin: '0', fontSize: '0.875rem', color: '#6b7280' }}>Logins (7 days)</p>
              </div>
            </div>
          </div>

          {/* Most Active Users */}
          <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1.5rem' }}>
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.125rem', fontWeight: '600' }}>Most Active Users</h3>
            <div>
              {analytics.userEngagement.mostActiveUsers.slice(0, 5).map((user, index) => (
                <div key={user.userId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderBottom: index < 4 ? '1px solid #f3f4f6' : 'none' }}>
                  <div>
                    <p style={{ margin: '0', fontWeight: '500', fontSize: '0.875rem' }}>{user.name}</p>
                    <p style={{ margin: '0', fontSize: '0.75rem', color: '#6b7280' }}>{user.email}</p>
                  </div>
                  <span style={{ 
                    padding: '0.25rem 0.5rem', 
                    backgroundColor: '#dbeafe', 
                    color: '#1d4ed8', 
                    borderRadius: '0.25rem', 
                    fontSize: '0.75rem', 
                    fontWeight: '500' 
                  }}>
                    {user.questionCount} questions
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Popular Documents */}
          <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1.5rem' }}>
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.125rem', fontWeight: '600' }}>Popular Documents</h3>
            <div>
              {analytics.documentInsights.popularDocuments.slice(0, 5).map((doc, index) => (
                <div key={index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderBottom: index < 4 ? '1px solid #f3f4f6' : 'none' }}>
                  <p style={{ margin: '0', fontSize: '0.875rem', fontWeight: '500', flex: 1, paddingRight: '1rem' }}>
                    {doc.name.length > 30 ? doc.name.substring(0, 30) + '...' : doc.name}
                  </p>
                  <span style={{ 
                    padding: '0.25rem 0.5rem', 
                    backgroundColor: '#f3e8ff', 
                    color: '#7c3aed', 
                    borderRadius: '0.25rem', 
                    fontSize: '0.75rem', 
                    fontWeight: '500' 
                  }}>
                    {doc.views} views
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Top Questions */}
          <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1.5rem', gridColumn: 'span 2' }}>
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.125rem', fontWeight: '600' }}>Frequently Asked Questions</h3>
            <div>
              {analytics.summary.topQuestions.slice(0, 8).map((item, index) => (
                <div key={index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', backgroundColor: '#f9fafb', borderRadius: '0.375rem', marginBottom: '0.75rem' }}>
                  <p style={{ margin: '0', fontSize: '0.875rem', flex: 1, paddingRight: '1rem' }}>
                    {item.question.length > 80 ? item.question.substring(0, 80) + '...' : item.question}
                  </p>
                  <span style={{ 
                    padding: '0.25rem 0.5rem', 
                    backgroundColor: '#dcfce7', 
                    color: '#166534', 
                    borderRadius: '0.25rem', 
                    fontSize: '0.75rem', 
                    fontWeight: '500' 
                  }}>
                    {item.count}x
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Questions Detail View */}
      {activeView === 'questions' && (
        <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '0.5rem' }}>
          <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #e5e7eb', backgroundColor: '#f9fafb' }}>
            <h3 style={{ margin: '0', fontWeight: '600' }}>Recent Questions ({questions.length})</h3>
          </div>
          <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
            {questions.map(q => (
              <div key={q.id} style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #e5e7eb' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: '0 0 0.25rem 0', fontWeight: '500', fontSize: '0.875rem' }}>{q.question}</p>
                    <p style={{ margin: '0', fontSize: '0.75rem', color: '#6b7280' }}>
                      Asked by {q.userName} ({q.userEmail}) • {new Date(q.timestamp).toLocaleString()}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0, marginLeft: '1rem' }}>
                    <span style={{ 
                      padding: '0.25rem 0.5rem', 
                      backgroundColor: '#e0f2fe', 
                      color: '#0277bd', 
                      borderRadius: '0.25rem', 
                      fontSize: '0.75rem' 
                    }}>
                      {q.answerLength} chars
                    </span>
                    <span style={{ 
                      padding: '0.25rem 0.5rem', 
                      backgroundColor: '#f3e8ff', 
                      color: '#7c3aed', 
                      borderRadius: '0.25rem', 
                      fontSize: '0.75rem' 
                    }}>
                      {q.sourcesUsed.length} sources
                    </span>
                    {q.processingTime && (
                      <span style={{ 
                        padding: '0.25rem 0.5rem', 
                        backgroundColor: '#fef3c7', 
                        color: '#92400e', 
                        borderRadius: '0.25rem', 
                        fontSize: '0.75rem' 
                      }}>
                        {Math.round(q.processingTime / 1000)}s
                      </span>
                    )}
                  </div>
                </div>
                {q.sourcesUsed.length > 0 && (
                  <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.75rem', color: '#6b7280' }}>
                    <strong>Sources:</strong> {q.sourcesUsed.join(', ')}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sessions Detail View */}
      {activeView === 'sessions' && (
        <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '0.5rem' }}>
          <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #e5e7eb', backgroundColor: '#f9fafb' }}>
            <h3 style={{ margin: '0', fontWeight: '600' }}>Recent Login Sessions ({sessions.length})</h3>
          </div>
          <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
            {sessions.map(s => (
              <div key={s.id} style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #e5e7eb' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <p style={{ margin: '0 0 0.25rem 0', fontWeight: '500', fontSize: '0.875rem' }}>
                      {s.userName} ({s.userRole})
                    </p>
                    <p style={{ margin: '0', fontSize: '0.75rem', color: '#6b7280' }}>
                      {s.email} • {new Date(s.loginTime).toLocaleString()}
                    </p>
                    {s.userAgent && (
                      <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.75rem', color: '#9ca3af' }}>
                        {s.userAgent.length > 60 ? s.userAgent.substring(0, 60) + '...' : s.userAgent}
                      </p>
                    )}
                  </div>
                  <span style={{ 
                    padding: '0.25rem 0.5rem', 
                    backgroundColor: s.userRole === 'admin' ? '#dbeafe' : '#f3e8ff', 
                    color: s.userRole === 'admin' ? '#1d4ed8' : '#7c3aed', 
                    borderRadius: '0.25rem', 
                    fontSize: '0.75rem', 
                    fontWeight: '500' 
                  }}>
                    {s.userRole}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Export View */}
      {activeView === 'export' && (
        <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1.5rem' }}>
          <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.125rem', fontWeight: '600' }}>Export Analytics Data</h3>
          <p style={{ margin: '0 0 1.5rem 0', color: '#6b7280', fontSize: '0.875rem' }}>
            Download analytics data in CSV format for further analysis.
          </p>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            <div style={{ padding: '1rem', border: '1px solid #e5e7eb', borderRadius: '0.5rem' }}>
              <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem', fontWeight: '500' }}>Questions Data</h4>
              <p style={{ margin: '0 0 1rem 0', fontSize: '0.875rem', color: '#6b7280' }}>
                All questions asked by investors with timestamps, processing times, and sources.
              </p>
              <button
                onClick={() => exportData('questions')}
                style={{
                  padding: '0.5rem 1rem',
                  backgroundColor: '#2563eb',
                  color: 'white',
                  border: 'none',
                  borderRadius: '0.375rem',
                  cursor: 'pointer',
                  fontSize: '0.875rem'
                }}
              >
                Export Questions
              </button>
            </div>

            <div style={{ padding: '1rem', border: '1px solid #e5e7eb', borderRadius: '0.5rem' }}>
              <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem', fontWeight: '500' }}>Session Data</h4>
              <p style={{ margin: '0 0 1rem 0', fontSize: '0.875rem', color: '#6b7280' }}>
                Login sessions with user information, timestamps, and browser details.
              </p>
              <button
                onClick={() => exportData('sessions')}
                style={{
                  padding: '0.5rem 1rem',
                  backgroundColor: '#059669',
                  color: 'white',
                  border: 'none',
                  borderRadius: '0.375rem',
                  cursor: 'pointer',
                  fontSize: '0.875rem'
                }}
              >
                Export Sessions
              </button>
            </div>

            <div style={{ padding: '1rem', border: '1px solid #e5e7eb', borderRadius: '0.5rem' }}>
              <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem', fontWeight: '500' }}>Document Activity</h4>
              <p style={{ margin: '0 0 1rem 0', fontSize: '0.875rem', color: '#6b7280' }}>
                Document views and downloads with user activity tracking.
              </p>
              <button
                onClick={() => exportData('documents')}
                style={{
                  padding: '0.5rem 1rem',
                  backgroundColor: '#7c3aed',
                  color: 'white',
                  border: 'none',
                  borderRadius: '0.375rem',
                  cursor: 'pointer',
                  fontSize: '0.875rem'
                }}
              >
                Export Documents
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// User Management Component
const UserManagement = () => {
  const [users, setUsers] = useState([]);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'investor' });
  const { getAuthHeaders } = useAuth();

  const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

  useEffect(() => {
  loadUsers();
}, []);

  const loadUsers = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/auth/users`, {
        headers: getAuthHeaders()
      });
      if (response.ok) {
        const data = await response.json();
        setUsers(data.users);
      }
    } catch (error) {
      console.error('Failed to load users:', error);
    }
  }, [getAuthHeaders]);

  const handleAddUser = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify(newUser)
      });

      if (response.ok) {
        setNewUser({ name: '', email: '', password: '', role: 'investor' });
        setShowAddUser(false);
        loadUsers();
      } else {
        const data = await response.json();
        alert(`Error: ${data.error}`);
      }
    } catch (error) {
      console.error('Failed to add user:', error);
      alert('Failed to add user');
    }
  };

  const toggleUserStatus = async (userId) => {
    try {
      const response = await fetch(`${API_BASE}/auth/users/${userId}/toggle`, {
        method: 'PUT',
        headers: getAuthHeaders()
      });

      if (response.ok) {
        loadUsers();
      }
    } catch (error) {
      console.error('Failed to toggle user status:', error);
    }
  };

  return (
    <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: '600', margin: '0' }}>User Management</h2>
        <button
          onClick={() => setShowAddUser(!showAddUser)}
          style={{
            backgroundColor: '#2563eb',
            color: 'white',
            padding: '0.5rem 1rem',
            border: 'none',
            borderRadius: '0.375rem',
            cursor: 'pointer'
          }}
        >
          Add Investor
        </button>
      </div>

      {showAddUser && (
        <div style={{ marginBottom: '1.5rem', padding: '1rem', backgroundColor: '#f9fafb', borderRadius: '0.375rem' }}>
          <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: '500' }}>Add New Investor</h3>
          <form onSubmit={handleAddUser}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', marginBottom: '0.25rem' }}>Name</label>
                <input
                  type="text"
                  value={newUser.name}
                  onChange={(e) => setNewUser(prev => ({ ...prev, name: e.target.value }))}
                  required
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', marginBottom: '0.25rem' }}>Email</label>
                <input
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser(prev => ({ ...prev, email: e.target.value }))}
                  required
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', boxSizing: 'border-box' }}
                />
              </div>
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', marginBottom: '0.25rem' }}>Password</label>
              <input
                type="password"
                value={newUser.password}
                onChange={(e) => setNewUser(prev => ({ ...prev, password: e.target.value }))}
                required
                style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="submit"
                style={{
                  backgroundColor: '#059669',
                  color: 'white',
                  padding: '0.5rem 1rem',
                  border: 'none',
                  borderRadius: '0.375rem',
                  cursor: 'pointer'
                }}
              >
                Add User
              </button>
              <button
                type="button"
                onClick={() => setShowAddUser(false)}
                style={{
                  backgroundColor: '#6b7280',
                  color: 'white',
                  padding: '0.5rem 1rem',
                  border: 'none',
                  borderRadius: '0.375rem',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div style={{ border: '1px solid #e5e7eb', borderRadius: '0.375rem' }}>
        <div style={{ padding: '0.75rem 1rem', backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 1fr 1fr', gap: '1rem', fontWeight: '500', fontSize: '0.875rem' }}>
            <div>Name</div>
            <div>Email</div>
            <div>Role</div>
            <div>Status</div>
            <div>Actions</div>
          </div>
        </div>
        {users.map(user => (
          <div key={user.id} style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e5e7eb' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 1fr 1fr', gap: '1rem', alignItems: 'center', fontSize: '0.875rem' }}>
              <div style={{ fontWeight: '500' }}>{user.name}</div>
              <div style={{ color: '#6b7280' }}>{user.email}</div>
              <div>
                <span style={{
                  padding: '0.25rem 0.5rem',
                  borderRadius: '0.25rem',
                  fontSize: '0.75rem',
                  fontWeight: '500',
                  backgroundColor: user.role === 'admin' ? '#dbeafe' : '#f3e8ff',
                  color: user.role === 'admin' ? '#1d4ed8' : '#7c3aed'
                }}>
                  {user.role}
                </span>
              </div>
              <div>
                <span style={{
                  padding: '0.25rem 0.5rem',
                  borderRadius: '0.25rem',
                  fontSize: '0.75rem',
                  fontWeight: '500',
                  backgroundColor: user.isActive ? '#dcfce7' : '#fee2e2',
                  color: user.isActive ? '#166534' : '#dc2626'
                }}>
                  {user.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div>
                {user.role !== 'admin' && (
                  <button
                    onClick={() => toggleUserStatus(user.id)}
                    style={{
                      padding: '0.25rem 0.5rem',
                      fontSize: '0.75rem',
                      border: '1px solid #d1d5db',
                      borderRadius: '0.25rem',
                      backgroundColor: 'white',
                      cursor: 'pointer'
                    }}
                  >
                    {user.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Main Data Room Component
const DataRoomAnalyzer = () => {
  const [activeTab, setActiveTab] = useState('analyze');
  const [documents, setDocuments] = useState([]);
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [questions, setQuestions] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef(null);
  const { user, logout, getAuthHeaders, isAdmin } = useAuth();
  const [isAnyTagBeingEdited, setIsAnyTagBeingEdited] = useState(false);
  const { settings } = useSettings();
  
  const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';


  
  useEffect(() => {
  loadDocuments();
  const interval = setInterval(() => {
    if (!isAnyTagBeingEdited) {
      loadDocuments();
    }
  }, 3000);
  return () => clearInterval(interval);
}, [isAnyTagBeingEdited]);

  const loadDocuments = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/documents`, {
        headers: getAuthHeaders()
      });
      if (response.ok) {
        const docs = await response.json();
        setDocuments(docs);
      }
    } catch (error) {
      console.error('Failed to load documents:', error);
    }
  }, [getAuthHeaders]);

  const deleteDocument = async (documentId, documentName) => {
    if (!window.confirm(`Are you sure you want to delete "${documentName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/documents/${documentId}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });

      const result = await response.json();

      if (result.success) {
        // Remove document from local state
        setDocuments(prev => prev.filter(doc => doc.id !== documentId));
        
        // Show success message (you could add a toast notification here)
        console.log(`Document "${documentName}" deleted successfully`);
      } else {
        alert(`Failed to delete document: ${result.error}`);
      }
    } catch (error) {
      console.error('Delete error:', error);
      alert('Failed to delete document');
    }
  };

  const deleteFailedDocuments = async () => {
    const failedDocs = documents.filter(doc => doc.status === 'error');
    
    if (failedDocs.length === 0) {
      alert('No failed documents to delete');
      return;
    }

    if (!window.confirm(`Delete all ${failedDocs.length} failed documents? This action cannot be undone.`)) {
      return;
    }

    try {
      const deletePromises = failedDocs.map(doc => 
        fetch(`${API_BASE}/documents/${doc.id}`, {
          method: 'DELETE',
          headers: getAuthHeaders()
        })
      );

      await Promise.all(deletePromises);
      
      // Reload documents to refresh the list
      await loadDocuments();
      
      alert(`Successfully deleted ${failedDocs.length} failed documents`);
    } catch (error) {
      console.error('Bulk delete error:', error);
      alert('Some documents could not be deleted');
    }
  };

  const updateDocumentTags = async (documentId, newTags) => {
    try {
      const response = await fetch(`${API_BASE}/documents/${documentId}/tags`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({ tags: newTags })
      });

      if (response.ok) {
        const result = await response.json();
        // Update local state
        setDocuments(prev => prev.map(doc => 
          doc.id === documentId ? result.document : doc
        ));
        console.log('Tags updated successfully');
      } else {
        const data = await response.json();
        alert(`Failed to update tags: ${data.error}`);
      }
    } catch (error) {
      console.error('Update tags error:', error);
      alert('Failed to update tags');
    }
  };

  const handleFileUpload = async (event) => {
    if (!isAdmin) {
      alert('Only admins can upload documents');
      return;
    }

    const files = Array.from(event.target.files);
    if (files.length === 0) return;
    
    const formData = new FormData();
    files.forEach(file => formData.append('documents', file));
    
    try {
      const response = await fetch(`${API_BASE}/documents/upload`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData
      });
      
      if (response.ok) {
        await loadDocuments();
      } else {
        const data = await response.json();
        alert(`Upload failed: ${data.error}`);
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('Upload failed');
    }
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleQuestionSubmit = async () => {
    if (!currentQuestion.trim()) return;

    const completedDocs = documents.filter(d => d.status === 'completed');
    if (completedDocs.length === 0) {
      alert('Please wait for documents to be analyzed.');
      return;
    }

    const startTime = Date.now();
    const newQuestion = {
      id: Date.now(),
      question: currentQuestion,
      answer: null,
      timestamp: new Date().toISOString(),
      status: 'processing'
    };

    setQuestions(prev => [...prev, newQuestion]);
    setCurrentQuestion('');
    setIsProcessing(true);

    try {
      const response = await fetch(`${API_BASE}/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({ question: newQuestion.question })
      });
      
      const result = await response.json();
      
      if (result.success) {
        const processingTime = Date.now() - startTime;
        setQuestions(prev => prev.map(q =>
          q.id === newQuestion.id
            ? { 
                ...q, 
                answer: result.answer, 
                status: 'completed', 
                sourcesUsed: result.sourcesUsed,
                processingTime 
              }
            : q
        ));
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      setQuestions(prev => prev.map(q =>
        q.id === newQuestion.id
          ? { ...q, answer: `Error: ${error.message}`, status: 'error' }
          : q
      ));
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadDocument = async (documentId, filename) => {
  try {
    console.log(`📥 Starting download for document: ${filename}`);
    
    const response = await fetch(`${API_BASE}/documents/${documentId}/download`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Download failed' }));
      throw new Error(errorData.error || 'Download failed');
    }

    // Parse the JSON response to get the pre-signed URL
    const downloadData = await response.json();
    
    if (!downloadData.success || !downloadData.downloadUrl) {
      throw new Error(downloadData.error || 'Download URL not provided');
    }

    console.log(`🔗 Received S3 pre-signed URL: ${downloadData.method || 'unknown method'}`);

    // Method 1: Fetch the file and create a blob download (recommended for better UX)
    try {
      const fileResponse = await fetch(downloadData.downloadUrl);
      
      if (!fileResponse.ok) {
        throw new Error('Failed to download file from S3');
      }

      const blob = await fileResponse.blob();
      
      // Create download link
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = downloadData.fileName || filename;
      
      // Add to DOM temporarily and click
      document.body.appendChild(link);
      link.click();
      
      // Cleanup
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
      
      console.log(`✅ Download completed via blob: ${downloadData.fileName || filename}`);
      
    } catch (fetchError) {
      // Fallback: Direct browser redirect if blob method fails
      console.log(`⚠️ Blob download failed, using direct redirect: ${fetchError.message}`);
      window.open(downloadData.downloadUrl, '_blank');
      console.log(`✅ Download initiated via redirect: ${downloadData.fileName || filename}`);
    }
    
  } catch (error) {
    console.error('Download error:', error);
    alert(`Download failed: ${error.message}`);
  }
};

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed': return '#16a34a';
      case 'processing': return '#ea580c';
      case 'error': return '#dc2626';
      default: return '#6b7280';
    }
  };

  // DocumentRow Component
    const DocumentRow = ({ doc, isAdmin, onDelete, onDownload, onTagsUpdate, getStatusColor, setGlobalEditingState }) => {
    const [isEditingTags, setIsEditingTags] = useState(false);
    const [editedTags, setEditedTags] = useState(doc.tags || []);
    const [newTag, setNewTag] = useState('');
useEffect(() => {
    if (!isEditingTags) {
      setEditedTags(doc.tags || []);
    }
  }, [doc.tags, isEditingTags]);

    const availableTags = ['LEGAL', 'FINANCIAL', 'BUSINESS', 'PRODUCT', 'TEAM', 'OPERATIONS', 'MARKET'];

    const handleSaveTags = () => {
  onTagsUpdate(editedTags);
  setGlobalEditingState(false); // Resume global refresh
  setIsEditingTags(false);      // End local editing
};

    const handleCancelEdit = () => {
  setEditedTags(doc.tags || []);
  setNewTag('');
  setGlobalEditingState(false); // Resume global refresh
  setIsEditingTags(false);      // End local editing
};

    const addTag = (tag) => {
      if (!editedTags.includes(tag)) {
        setEditedTags([...editedTags, tag]);
      }
    };

    const removeTag = (tagToRemove) => {
      setEditedTags(editedTags.filter(tag => tag !== tagToRemove));
    };

    const addCustomTag = () => {
      if (newTag && !editedTags.includes(newTag.toUpperCase())) {
        setEditedTags([...editedTags, newTag.toUpperCase()]);
        setNewTag('');
      }
    };

    return (
      <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <p style={{ margin: '0', fontWeight: '500' }}>{doc.originalName}</p>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.25rem' }}>
              <p style={{ margin: '0', fontSize: '0.875rem', color: '#6b7280' }}>
                {Math.round(doc.size / 1024)} KB
              </p>
              
              {/* Tags Section */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                {!isEditingTags ? (
                  <>
                    {/* Display Tags */}
                    {editedTags && editedTags.length > 0 ? (
                      editedTags.slice(0, 3).map(tag => (
                        <span
                          key={tag}
                          style={{
                            fontSize: '0.75rem',
                            padding: '0.125rem 0.375rem',
                            backgroundColor: '#dbeafe',
                            color: '#1e40af',
                            borderRadius: '0.25rem'
                          }}
                        >
                          {tag}
                        </span>
                      ))
                    ) : (
                      <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>No tags</span>
                    )}
                    
                    {editedTags && editedTags.length > 3 && (
                      <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                        +{editedTags.length - 3} more
                      </span>
                    )}
                    
                    {/* Edit Button */}
                    {isAdmin && (
                      <button
                        onClick={() => {
                          setGlobalEditingState(true); // Pause global refresh
                          setIsEditingTags(true);      // Start local editing
                        }}
                        style={{
                          fontSize: '0.75rem',
                          padding: '0.125rem 0.375rem',
                          backgroundColor: 'transparent',
                          color: '#6b7280',
                          border: '1px solid #d1d5db',
                          borderRadius: '0.25rem',
                          cursor: 'pointer'
                        }}
                      >
                        ✏️ Edit
                      </button>
                    )}
                  </>
                ) : (
                  /* Tag Editing Interface */
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '300px' }}>
                    {/* Current Tags */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                      {editedTags.map(tag => (
                        <span
                          key={tag}
                          style={{
                            fontSize: '0.75rem',
                            padding: '0.125rem 0.375rem',
                            backgroundColor: '#dbeafe',
                            color: '#1e40af',
                            borderRadius: '0.25rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.25rem'
                          }}
                        >
                          {tag}
                          <button
                            onClick={() => removeTag(tag)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#dc2626',
                              cursor: 'pointer',
                              fontSize: '0.75rem',
                              padding: '0'
                            }}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                    
                    {/* Available Tags */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                      {availableTags
                        .filter(tag => !editedTags.includes(tag))
                        .map(tag => (
                          <button
                            key={tag}
                            onClick={() => addTag(tag)}
                            style={{
                              fontSize: '0.75rem',
                              padding: '0.125rem 0.375rem',
                              backgroundColor: '#f3f4f6',
                              color: '#374151',
                              border: '1px solid #d1d5db',
                              borderRadius: '0.25rem',
                              cursor: 'pointer'
                            }}
                          >
                            + {tag}
                          </button>
                        ))}
                    </div>
                    
                    {/* Add Custom Tag */}
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      <input
                        type="text"
                        value={newTag}
                        onChange={(e) => setNewTag(e.target.value)}
                        placeholder="Custom tag"
                        style={{
                          fontSize: '0.75rem',
                          padding: '0.25rem',
                          border: '1px solid #d1d5db',
                          borderRadius: '0.25rem',
                          width: '100px'
                        }}
                        onKeyPress={(e) => e.key === 'Enter' && addCustomTag()}
                      />
                      <button
                        onClick={addCustomTag}
                        style={{
                          fontSize: '0.75rem',
                          padding: '0.25rem 0.5rem',
                          backgroundColor: '#059669',
                          color: 'white',
                          border: 'none',
                          borderRadius: '0.25rem',
                          cursor: 'pointer'
                        }}
                      >
                        Add
                      </button>
                    </div>
                    
                    {/* Save/Cancel Buttons */}
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      <button
                        onClick={handleSaveTags}
                        style={{
                          fontSize: '0.75rem',
                          padding: '0.25rem 0.5rem',
                          backgroundColor: '#2563eb',
                          color: 'white',
                          border: 'none',
                          borderRadius: '0.25rem',
                          cursor: 'pointer'
                        }}
                      >
                        Save
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        style={{
                          fontSize: '0.75rem',
                          padding: '0.25rem 0.5rem',
                          backgroundColor: '#6b7280',
                          color: 'white',
                          border: 'none',
                          borderRadius: '0.25rem',
                          cursor: 'pointer'
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            {doc.error && (
              <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.875rem', color: '#dc2626' }}>
                Error: {doc.error}
              </p>
            )}
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0, marginLeft: '1rem' }}>
            {/* Status indicator */}
            <span style={{ 
              fontSize: '0.875rem', 
              fontWeight: '500', 
              textTransform: 'capitalize',
              color: getStatusColor(doc.status),
              padding: '0.25rem 0.5rem',
              backgroundColor: doc.status === 'completed' ? '#dcfce7' : doc.status === 'error' ? '#fee2e2' : '#fef3c7',
              borderRadius: '0.25rem'
            }}>
              {doc.status}
            </span>
            
            {/* Action buttons */}
            {doc.status === 'completed' && (
              <button
                onClick={onDownload}
                style={{
                  padding: '0.25rem 0.75rem',
                  backgroundColor: '#2563eb',
                  color: 'white',
                  border: 'none',
                  borderRadius: '0.25rem',
                  cursor: 'pointer',
                  fontSize: '0.75rem'
                }}
              >
                Download
              </button>
            )}
            
            {/* Delete button (admin only) */}
            {isAdmin && (
              <button
                onClick={onDelete}
                style={{
                  padding: '0.25rem 0.75rem',
                  backgroundColor: '#dc2626',
                  color: 'white',
                  border: 'none',
                  borderRadius: '0.25rem',
                  cursor: 'pointer',
                  fontSize: '0.75rem'
                }}
                title="Delete document"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb', fontFamily: 'Arial, sans-serif' }}>
      {/* Header */}
      <div style={{ backgroundColor: 'white', borderBottom: '1px solid #e5e7eb', padding: '1rem 0' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
         <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
  {settings.logo_url && (
    <img 
      src={settings.logo_url || '/default-logo.png'} 
      alt="Company Logo" 
      style={{ 
        height: '40px',
        maxWidth: '120px',
        objectFit: 'contain'
      }} 
    />
  )}
  <div>
    <h1 style={{ fontSize: '1.875rem', fontWeight: 'bold', color: '#111827', margin: '0' }}>
      {settings.app_title}
    </h1>
    <p style={{ color: '#6b7280', margin: '0.25rem 0 0 0', fontSize: '0.875rem' }}>
      {documents.filter(d => d.status === 'completed').length} of {documents.length} documents analyzed
    </p>
  </div>
</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ textAlign: 'right' }}>
              <p style={{ margin: '0', fontSize: '0.875rem', fontWeight: '500' }}>{user.name}</p>
              <p style={{ margin: '0', fontSize: '0.75rem', color: '#6b7280' }}>{user.role}</p>
            </div>
            <button
              onClick={logout}
              style={{
                padding: '0.5rem 1rem',
                backgroundColor: '#6b7280',
                color: 'white',
                border: 'none',
                borderRadius: '0.375rem',
                cursor: 'pointer',
                fontSize: '0.875rem'
              }}
            >
              Logout
            </button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem 1.5rem' }}>
        {/* Tabs */}
        <div style={{ marginBottom: '2rem' }}>
          <div style={{ backgroundColor: '#f3f4f6', padding: '0.25rem', borderRadius: '0.5rem', display: 'inline-flex' }}>
            {[
              { id: 'upload', label: 'Documents' },
              { id: 'analyze', label: 'Ask Questions' },
              ...(isAdmin ? [
                { id: 'users', label: 'User Management' },
                { id: 'analytics', label: 'Analytics' },
                { id: 'settings', label: 'Settings' } 
              ] : [])
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '0.375rem',
                  fontWeight: '500',
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: activeTab === tab.id ? 'white' : 'transparent',
                  color: activeTab === tab.id ? '#2563eb' : '#6b7280'
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Upload Tab */}
        {activeTab === 'upload' && (
          <div>
            {isAdmin && (
              <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1.5rem', marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h2 style={{ fontSize: '1.25rem', fontWeight: '600', margin: '0' }}>Upload Documents</h2>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      onClick={loadDocuments}
                      style={{
                        padding: '0.5rem 1rem',
                        backgroundColor: '#6b7280',
                        color: 'white',
                        border: 'none',
                        borderRadius: '0.375rem',
                        cursor: 'pointer'
                      }}
                    >
                      Refresh
                    </button>
                    {documents.some(doc => doc.status === 'error') && (
                      <button
                        onClick={deleteFailedDocuments}
                        style={{
                          padding: '0.5rem 1rem',
                          backgroundColor: '#dc2626',
                          color: 'white',
                          border: 'none',
                          borderRadius: '0.375rem',
                          cursor: 'pointer',
                          fontSize: '0.875rem'
                        }}
                      >
                        Delete All Failed ({documents.filter(doc => doc.status === 'error').length})
                      </button>
                    )}
                  </div>
                </div>
                
                <div
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: '2px dashed #d1d5db',
                    borderRadius: '0.5rem',
                    padding: '2rem',
                    textAlign: 'center',
                    cursor: 'pointer',
                    backgroundColor: '#fafafa'
                  }}
                >
                  <p style={{ margin: '0', fontWeight: '500' }}>Click to upload documents</p>
                  <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.875rem', color: '#6b7280' }}>
                    PDF files and images accepted
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".pdf,.png,.jpg,.jpeg"
                    onChange={handleFileUpload}
                    style={{ display: 'none' }}
                  />
                </div>
              </div>
            )}

            {/* Document List */}
            {documents.length > 0 && (
              <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '0.5rem' }}>
                <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #e5e7eb', backgroundColor: '#f9fafb' }}>
                  <h3 style={{ margin: '0', fontWeight: '600' }}>Documents ({documents.length})</h3>
                </div>
                {documents.map(doc => (
                  <DocumentRow 
                    key={doc.id} 
                    doc={doc} 
                    isAdmin={isAdmin}
                    onDelete={() => deleteDocument(doc.id, doc.originalName)}
                    onDownload={() => downloadDocument(doc.id, doc.originalName)}
                    onTagsUpdate={(newTags) => updateDocumentTags(doc.id, newTags)}
                    getStatusColor={getStatusColor}
                    setGlobalEditingState={setIsAnyTagBeingEdited}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Q&A Tab */}
        {activeTab === 'analyze' && (
          <div>
            <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1.5rem', marginBottom: '1.5rem' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: '600', margin: '0 0 1rem 0' }}>Ask Questions</h2>
<p style={{ margin: '0 0 1.5rem 0', fontSize: '0.875rem', color: '#6b7280', lineHeight: '1.5' }}>
  Ask anything about the business, financials, team, strategy, or any documents in the data room. 
  Our AI will analyze the available documents and provide you with detailed, sourced answers.
</p>
              
              <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
                <input
                  type="text"
                  value={currentQuestion}
                  onChange={(e) => setCurrentQuestion(e.target.value)}
                  placeholder="What would you like to know?"
                  onKeyPress={(e) => e.key === 'Enter' && handleQuestionSubmit()}
                  disabled={isProcessing}
                  style={{
                    flex: '1',
                    padding: '0.75rem',
                    border: '1px solid #d1d5db',
                    borderRadius: '0.375rem',
                    fontSize: '1rem'
                  }}
                />
                <button
                  onClick={handleQuestionSubmit}
                  disabled={!currentQuestion.trim() || isProcessing}
                  style={{
                    padding: '0.75rem 1.5rem',
                    backgroundColor: '#2563eb',
                    color: 'white',
                    border: 'none',
                    borderRadius: '0.375rem',
                    cursor: 'pointer',
                    opacity: (!currentQuestion.trim() || isProcessing) ? 0.5 : 1
                  }}
                >
                  {isProcessing ? 'Processing...' : 'Ask'}
                </button>
              </div>
              
              <p style={{ margin: '0', fontSize: '0.875rem', color: '#6b7280' }}>
                {documents.filter(d => d.status === 'completed').length} analyzed documents available
              </p>
            </div>

            {/* Q&A History */}
            {questions.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {questions.slice().reverse().map(qa => (
                  <div key={qa.id} style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1.5rem' }}>
                    <div style={{ marginBottom: '1rem' }}>
                      <p style={{ margin: '0', fontWeight: '500', color: '#111827' }}>{qa.question}</p>
                      <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.875rem', color: '#6b7280' }}>
                        {new Date(qa.timestamp).toLocaleString()}
                        {qa.processingTime && ` • ${Math.round(qa.processingTime / 1000)}s`}
                      </p>
                    </div>
                    
                    {qa.answer && (
                      <div style={{ marginLeft: '0' }}>
                        <div style={{ padding: '1rem', backgroundColor: '#f9fafb', borderRadius: '0.375rem', marginBottom: '0.75rem' }}>
                          <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6', color: '#111827' }}>
                            {qa.answer}
                          </div>
                        </div>
                        {qa.sourcesUsed && qa.sourcesUsed.length > 0 && (
                          <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                            <strong>Sources:</strong> {qa.sourcesUsed.join(', ')}
                          </div>
                        )}
                      </div>
                    )}
                    
                    {qa.status === 'processing' && (
                      <div style={{ color: '#6b7280', fontStyle: 'italic' }}>
                        Analyzing documents...
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {questions.length === 0 && (
              <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '3rem', textAlign: 'center' }}>
                <p style={{ margin: '0', color: '#6b7280' }}>No questions yet. Start asking questions about the analyzed documents!</p>
              </div>
            )}
          </div>
        )}

        {/* User Management Tab (Admin only) */}
        {activeTab === 'users' && isAdmin && (
          <UserManagement />
        )}

        {/* Analytics Tab (Admin only) */}
        {activeTab === 'analytics' && isAdmin && (
          <AnalyticsDashboard />
        )}
          {/* Settings Tab (Admin only) */}
{activeTab === 'settings' && isAdmin && (
  <SettingsManagement />
)}
      </div>
    </div>
  );
};

// Main App Component
const App = () => {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
};

const AppContent = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ /* loading spinner */ }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ /* spinner styles */ }}></div>
          <p style={{ color: '#6b7280', margin: '0' }}>Loading...</p>
        </div>
      </div>
    );
  }

  // This should ONLY render SettingsProvider when user exists
  return user ? (
    <SettingsProvider>
      <DataRoomAnalyzer />
    </SettingsProvider>
  ) : (
    <SimpleLoginForm />
  );
};

// Simple Login Component with public branding
const SimpleLoginForm = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [publicSettings, setPublicSettings] = useState({
    company_name: 'Data Room Analyzer',
    logo_url: null,
    app_title: 'Data Room Analyzer'
  });
  const { login } = useAuth();

  const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

  // Load public settings on component mount
  useEffect(() => {
    const loadPublicSettings = async () => {
      try {
        const response = await fetch(`${API_BASE}/settings/public`);
        if (response.ok) {
          const data = await response.json();
          setPublicSettings(data.settings);
        }
      } catch (error) {
        console.error('Failed to load public settings:', error);
        // Keep defaults if loading fails
      }
    };

    loadPublicSettings();
  }, [API_BASE]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    const result = await login(email, password);
    
    if (!result.success) {
      setError(result.error);
    }
    
    setIsLoading(false);
  };

  return (
    <div style={{ 
      minHeight: '100vh', 
      backgroundColor: '#f9fafb', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center',
      fontFamily: 'Arial, sans-serif'
    }}>
      <div style={{
        backgroundColor: 'white',
        padding: '2rem',
        borderRadius: '0.5rem',
        border: '1px solid #e5e7eb',
        width: '100%',
        maxWidth: '400px'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          {publicSettings.logo_url && (
            <img 
              src={publicSettings.logo_url} 
              alt="Company Logo" 
              style={{ 
                height: '60px', 
                marginBottom: '1rem',
                maxWidth: '200px',
                objectFit: 'contain'
              }} 
            />
          )}
          <h1 style={{ fontSize: '1.875rem', fontWeight: 'bold', color: '#111827', margin: '0 0 0.5rem 0' }}>
            {publicSettings.app_title}
          </h1>
          <p style={{ color: '#6b7280', margin: '0' }}>Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#374151', marginBottom: '0.5rem' }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '1px solid #d1d5db',
                borderRadius: '0.375rem',
                fontSize: '1rem',
                boxSizing: 'border-box'
              }}
              placeholder="Enter your email"
            />
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: '#374151', marginBottom: '0.5rem' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '1px solid #d1d5db',
                borderRadius: '0.375rem',
                fontSize: '1rem',
                boxSizing: 'border-box'
              }}
              placeholder="Enter your password"
            />
          </div>

          {error && (
            <div style={{ 
              backgroundColor: '#fef2f2', 
              border: '1px solid #fecaca', 
              color: '#dc2626', 
              padding: '0.75rem', 
              borderRadius: '0.375rem', 
              marginBottom: '1rem',
              fontSize: '0.875rem'
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            style={{
              width: '100%',
              backgroundColor: '#2563eb',
              color: 'white',
              padding: '0.75rem',
              border: 'none',
              borderRadius: '0.375rem',
              fontSize: '1rem',
              fontWeight: '500',
              cursor: 'pointer',
              opacity: isLoading ? 0.5 : 1
            }}
          >
            {isLoading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
};


export default App;
