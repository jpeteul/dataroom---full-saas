import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTenant } from '../contexts/TenantContext';

const TenantUserManagement = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [error, setError] = useState('');

  const { getTenantUsers, updateUser, createInvitation, hasPermission, isAdmin } = useAuth();
  const { tenant, usage, limits, isApproachingLimit } = useTenant();

  // Load users
  const loadUsers = useCallback(async () => {
    if (!isAdmin) return;
    
    setLoading(true);
    try {
      const result = await getTenantUsers();
      if (result.success) {
        setUsers(result.users);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError('Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [isAdmin, getTenantUsers]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  if (!isAdmin) {
    return (
      <div className="text-center py-8">
        <div className="text-gray-600">
          You don't have permission to manage users.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Usage Stats */}
      <div className="bg-white rounded-lg border p-4">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Team Management</h2>
            <p className="text-gray-600">Manage users in your organization</p>
          </div>
          
          <div className="text-right">
            <div className="text-sm text-gray-600">
              Users: {usage.userCount || 0} / {limits.users?.limit || '∞'}
            </div>
            {isApproachingLimit('users') && (
              <div className="text-xs text-orange-600 mt-1">
                Approaching user limit
              </div>
            )}
          </div>
        </div>
        
        {/* Usage Bar */}
        {limits.users && (
          <div className="mt-4">
            <div className="flex justify-between text-sm text-gray-600 mb-1">
              <span>User Limit</span>
              <span>{usage.userCount || 0} / {limits.users.limit}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className={`h-2 rounded-full transition-all duration-300 ${
                  isApproachingLimit('users') ? 'bg-orange-500' : 'bg-blue-500'
                }`}
                style={{ 
                  width: `${Math.min(((usage.userCount || 0) / limits.users.limit) * 100, 100)}%` 
                }}
              ></div>
            </div>
          </div>
        )}
      </div>

      {/* Actions Bar */}
      <div className="flex justify-between items-center">
        <div className="text-sm text-gray-600">
          {users.length} user{users.length !== 1 ? 's' : ''} in {tenant?.name || 'your organization'}
        </div>
        
        <button
          onClick={() => setShowInviteModal(true)}
          disabled={limits.users?.exceeded}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Invite User
        </button>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Active</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {users.map(user => (
                <UserRow 
                  key={user.id} 
                  user={user} 
                  onEdit={() => {
                    setSelectedUser(user);
                    setShowEditModal(true);
                  }}
                  onUpdate={loadUsers}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invite Modal */}
      {showInviteModal && (
        <InviteUserModal
          onClose={() => setShowInviteModal(false)}
          onInvite={loadUsers}
        />
      )}

      {/* Edit User Modal */}
      {showEditModal && selectedUser && (
        <EditUserModal
          user={selectedUser}
          onClose={() => {
            setShowEditModal(false);
            setSelectedUser(null);
          }}
          onUpdate={loadUsers}
        />
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}
    </div>
  );
};

const UserRow = ({ user, onEdit, onUpdate }) => {
  const { updateUser, user: currentUser } = useAuth();

  const toggleStatus = async () => {
    const result = await updateUser(user.id, {
      is_active: !user.is_active
    });
    
    if (result.success) {
      onUpdate();
    }
  };

  const getRoleBadge = (role) => {
    const styles = {
      admin: 'bg-purple-100 text-purple-800',
      user: 'bg-blue-100 text-blue-800',
      investor: 'bg-green-100 text-green-800'
    };

    return (
      <span className={`px-2 py-1 text-xs rounded-full ${styles[role] || 'bg-gray-100 text-gray-800'}`}>
        {role}
      </span>
    );
  };

  const getStatusBadge = (isActive) => {
    return (
      <span className={`px-2 py-1 text-xs rounded-full ${
        isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
      }`}>
        {isActive ? 'Active' : 'Inactive'}
      </span>
    );
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleDateString();
  };

  const canModify = currentUser.global_role === 'superadmin' || 
                   (user.id !== currentUser.id && user.tenant_role !== 'admin');

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-3">
        <div>
          <div className="font-medium text-gray-900">{user.name}</div>
          <div className="text-sm text-gray-500">{user.email}</div>
        </div>
      </td>
      <td className="px-4 py-3">
        {getRoleBadge(user.tenant_role)}
      </td>
      <td className="px-4 py-3">
        {getStatusBadge(user.is_active)}
      </td>
      <td className="px-4 py-3 text-sm text-gray-600">
        {formatDate(user.last_login)}
      </td>
      <td className="px-4 py-3">
        <div className="flex gap-2">
          <button
            onClick={onEdit}
            disabled={!canModify}
            className="text-blue-600 hover:text-blue-800 text-sm disabled:text-gray-400 disabled:cursor-not-allowed"
          >
            Edit
          </button>
          {user.id !== currentUser.id && (
            <button
              onClick={toggleStatus}
              disabled={!canModify}
              className={`text-sm disabled:text-gray-400 disabled:cursor-not-allowed ${
                user.is_active 
                  ? 'text-red-600 hover:text-red-800' 
                  : 'text-green-600 hover:text-green-800'
              }`}
            >
              {user.is_active ? 'Deactivate' : 'Activate'}
            </button>
          )}
        </div>
      </td>
    </tr>
  );
};

const InviteUserModal = ({ onClose, onInvite }) => {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('user');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const { createInvitation } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const result = await createInvitation(email, role);
      
      if (result.success) {
        setSuccess(`Invitation sent to ${email}`);
        setTimeout(() => {
          onInvite();
          onClose();
        }, 2000);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError('Failed to send invitation');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg max-w-md w-full p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">Invite User</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border rounded-md"
              placeholder="user@example.com"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Role
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full px-3 py-2 border rounded-md"
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">
              {role === 'admin' ? 'Can manage users and settings' : 'Can view documents and ask questions'}
            </p>
          </div>

          {error && (
            <div className="text-red-600 text-sm">{error}</div>
          )}
          
          {success && (
            <div className="text-green-600 text-sm">{success}</div>
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
              {loading ? 'Sending...' : 'Send Invitation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const EditUserModal = ({ user, onClose, onUpdate }) => {
  const [formData, setFormData] = useState({
    name: user.name,
    role: user.tenant_role,
    is_active: user.is_active
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const { updateUser: updateUserApi, user: currentUser } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const result = await updateUserApi(user.id, formData);
      
      if (result.success) {
        onUpdate();
        onClose();
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError('Failed to update user');
    } finally {
      setLoading(false);
    }
  };

  const canChangeRole = currentUser.global_role === 'superadmin';
  const canDeactivate = user.id !== currentUser.id && user.tenant_role !== 'admin';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg max-w-md w-full p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">Edit User</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              className="w-full px-3 py-2 border rounded-md"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              type="email"
              value={user.email}
              className="w-full px-3 py-2 border rounded-md bg-gray-50"
              disabled
            />
            <p className="text-xs text-gray-500 mt-1">Email cannot be changed</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Role
            </label>
            <select
              value={formData.role}
              onChange={(e) => setFormData(prev => ({ ...prev, role: e.target.value }))}
              className="w-full px-3 py-2 border rounded-md"
              disabled={!canChangeRole}
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
            {!canChangeRole && (
              <p className="text-xs text-gray-500 mt-1">Only superadmin can change roles</p>
            )}
          </div>

          <div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.is_active}
                onChange={(e) => setFormData(prev => ({ ...prev, is_active: e.target.checked }))}
                disabled={!canDeactivate}
                className="rounded"
              />
              <span className="text-sm text-gray-700">Active</span>
            </label>
            {!canDeactivate && (
              <p className="text-xs text-gray-500 mt-1">Cannot deactivate yourself or other admins</p>
            )}
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
              {loading ? 'Updating...' : 'Update User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default TenantUserManagement;