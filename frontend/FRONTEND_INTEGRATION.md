# Frontend Multi-Tenant Integration Guide

## Overview

This guide covers integrating the multi-tenant functionality into your React frontend application.

## What's Been Created

### 1. Context Providers
- **AuthContext** (`contexts/AuthContext.js`): Enhanced authentication with tenant support
- **TenantContext** (`contexts/TenantContext.js`): Tenant management and settings

### 2. Components
- **SuperAdminDashboard** (`components/SuperAdminDashboard.js`): Platform-wide tenant management
- **TenantUserManagement** (`components/TenantUserManagement.js`): Tenant-specific user management
- **TenantSettings** (`components/TenantSettings.js`): Organization branding and configuration
- **Login** (`components/Login.js`): Multi-tenant aware login system
- **AcceptInvitation** (`components/AcceptInvitation.js`): User invitation acceptance

### 3. Main Application
- **App-multi-tenant.js**: Complete multi-tenant application structure

## Integration Steps

### Step 1: Replace Existing App Component

```bash
cd frontend/src

# Backup your current App.js
cp App.js App-single-tenant.backup.js

# Use the new multi-tenant App
cp App-multi-tenant.js App.js
```

### Step 2: Update package.json Dependencies

Add these dependencies if not present:

```json
{
  "dependencies": {
    "react": "^18.0.0",
    "react-dom": "^18.0.0"
  }
}
```

### Step 3: Environment Configuration

Create or update `.env` file:

```env
REACT_APP_API_URL=http://localhost:3001/api
REACT_APP_APP_NAME=Smart DataRoom SaaS
REACT_APP_SUPPORT_EMAIL=support@yourdomain.com
```

### Step 4: Update Index.js

Ensure your `index.js` properly handles the new App:

```javascript
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
```

## Key Features Implemented

### 🔐 Multi-Tenant Authentication
- **Tenant-specific login**: Users login with organization context
- **Superadmin access**: Platform-wide administrative access
- **JWT with tenant context**: Tokens include tenant information
- **Role-based routing**: Different UIs for different roles

### 🏢 Tenant Management
- **Organization settings**: Custom branding per tenant
- **User management**: Invite and manage team members
- **Usage tracking**: Real-time limits and usage display
- **Feature gating**: Subscription-based feature access

### 🎨 Dynamic Branding
- **Custom colors**: Each tenant can set their theme
- **Logo upload**: Organization-specific logos
- **App title**: Custom application titles
- **Live preview**: See changes before saving

### 📊 Analytics Dashboard
- **Tenant-scoped metrics**: Analytics isolated per tenant
- **Superadmin overview**: Cross-tenant platform metrics
- **Usage visualization**: Charts and progress bars
- **Export functionality**: Data export capabilities

## URL Structure

The application supports multiple URL patterns:

### Subdomain-based Tenancy
```
https://acme.yourdataroom.com/login
https://acme.yourdataroom.com/
```

### Path-based Tenancy (fallback)
```
https://yourdataroom.com/t/acme/login
https://yourdataroom.com/t/acme/
```

### Superadmin Access
```
https://yourdataroom.com/login  (superadmin mode)
https://admin.yourdataroom.com/
```

### Invitation Links
```
https://yourdataroom.com/invite/abc123token
https://acme.yourdataroom.com/invite?token=abc123token
```

## Component Architecture

```
App (Multi-Tenant)
├── AuthProvider
│   └── TenantProvider
│       ├── Login (unauthenticated)
│       ├── AcceptInvitation (invitation flow)
│       ├── SuperAdminDashboard (superadmin only)
│       └── TenantApp (authenticated users)
│           ├── Documents Tab
│           ├── Analytics Tab (admin only)
│           ├── Team Tab (admin only)
│           └── Settings Tab (admin only)
```

## Role-Based Access Control

### Superadmin
- Access to all tenants
- Platform-wide analytics
- Tenant creation and management
- No access to tenant documents (privacy)

### Tenant Admin
- Full access to their organization
- User management and invitations
- Organization settings and branding
- Analytics for their tenant

### Tenant User
- Access to documents and Q&A
- Personal activity history
- Read-only access to most features

## Integration with Existing Components

### Documents Component
Update your existing document components to use tenant context:

```javascript
import { useTenant } from '../contexts/TenantContext';

const DocumentsComponent = () => {
  const { tenant, isAdmin } = useTenant();
  const { getAuthHeaders } = useAuth();
  
  // Your existing logic, but with tenant headers
  const uploadDocument = async (file) => {
    const formData = new FormData();
    formData.append('files', file);
    
    const response = await fetch('/api/documents/upload', {
      method: 'POST',
      headers: getAuthHeaders(), // Includes tenant context
      body: formData
    });
    
    // Handle response
  };
  
  return (
    // Your existing JSX
  );
};
```

### Analytics Component
Update analytics to use tenant-scoped data:

```javascript
import { useTenant } from '../contexts/TenantContext';

const AnalyticsComponent = () => {
  const { isAdmin } = useTenant();
  const { getAuthHeaders } = useAuth();
  
  // All API calls automatically scoped to tenant
  const loadAnalytics = async () => {
    const response = await fetch('/api/analytics/dashboard', {
      headers: getAuthHeaders()
    });
    // Data is automatically filtered to tenant
  };
  
  return (
    // Your existing analytics JSX
  );
};
```

## Styling and Theming

### CSS Variables
The application uses CSS variables for dynamic theming:

```css
:root {
  --primary-color: #4F46E5;
  --secondary-color: #10B981;
}

.btn-primary {
  background-color: var(--primary-color);
}

.text-primary {
  color: var(--primary-color);
}
```

### Responsive Design
All components are built mobile-first with Tailwind CSS:

```javascript
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
  {/* Responsive grid */}
</div>
```

## Error Handling

### Network Errors
```javascript
const handleApiCall = async () => {
  try {
    const response = await fetch('/api/endpoint', {
      headers: getAuthHeaders()
    });
    
    if (response.status === 401) {
      // Token expired, redirect to login
      logout();
      return;
    }
    
    if (response.status === 403) {
      // Insufficient permissions
      setError('Access denied');
      return;
    }
    
    const data = await response.json();
    // Handle success
  } catch (error) {
    setError('Network error occurred');
  }
};
```

### Tenant Context Errors
The app automatically handles tenant context issues:
- Invalid tenant access → Force re-login
- Tenant limits exceeded → Show upgrade prompts
- Missing permissions → Show appropriate messages

## Testing Multi-Tenancy

### Development Setup
1. Create multiple test tenants
2. Test user isolation between tenants
3. Verify branding applies correctly
4. Test permission boundaries

### Test Scenarios
- Login as different tenant users
- Verify data isolation (no cross-tenant access)
- Test admin vs user permissions
- Verify superadmin can see all tenants
- Test invitation flow end-to-end

## Performance Optimizations

### Context Optimization
- Tenant settings cached in context
- Usage data auto-refreshed every 5 minutes for admins
- Lazy loading of tenant data

### Bundle Optimization
- Code splitting for admin components
- Lazy loading of heavy components
- Efficient re-renders with React.memo where needed

## Security Considerations

### Client-Side Security
- JWT tokens include tenant context
- All API calls include tenant headers
- No sensitive data stored in localStorage
- Automatic token refresh handling

### Access Control
- Role-based component rendering
- Permission-based feature access
- Tenant boundary enforcement in UI

## Next Steps

1. **Integrate Existing Components**: Update your current components to use the new contexts
2. **Test Multi-Tenancy**: Create test tenants and verify isolation
3. **Customize Styling**: Adjust components to match your design system
4. **Add Error Boundaries**: Implement error boundaries for better UX
5. **Performance Testing**: Test with multiple tenants under load

## Troubleshooting

### Common Issues

**Tenant Context Not Loading**
- Check if user has tenant_id in profile
- Verify backend returns tenant information
- Check network requests in browser dev tools

**Permissions Not Working**
- Verify JWT includes correct roles
- Check middleware in backend routes
- Validate role mappings in frontend

**Branding Not Applied**
- Check if CSS variables are set
- Verify tenant settings are loaded
- Look for console errors in browser

The frontend is now fully multi-tenant aware and ready for enterprise deployment!