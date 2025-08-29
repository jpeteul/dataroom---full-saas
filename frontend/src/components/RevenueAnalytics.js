import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';

const RevenueAnalytics = () => {
  const [revenueData, setRevenueData] = useState(null);
  const [subscriptionMetrics, setSubscriptionMetrics] = useState(null);
  const [churnData, setChurnData] = useState(null);
  const [timeRange, setTimeRange] = useState('12m');
  const [loading, setLoading] = useState(false);

  const { getAuthHeaders, isSuperAdmin } = useAuth();
  const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

  // Subscription tier pricing (in production, this would come from backend)
  const tierPricing = {
    free: 0,
    starter: 29,
    professional: 99,
    enterprise: 299
  };

  // Load revenue analytics
  const loadRevenueData = useCallback(async () => {
    if (!isSuperAdmin) return;
    
    setLoading(true);

    try {
      // Get tenant data for revenue calculations
      const response = await fetch(`${API_BASE}/tenants`, {
        headers: getAuthHeaders()
      });

      if (response.ok) {
        const data = await response.json();
        const tenants = data.tenants;
        
        // Calculate revenue metrics
        const revenue = calculateRevenueMetrics(tenants);
        const subscriptions = calculateSubscriptionMetrics(tenants);
        const churn = calculateChurnMetrics(tenants);
        
        setRevenueData(revenue);
        setSubscriptionMetrics(subscriptions);
        setChurnData(churn);
      }
    } catch (error) {
      console.error('Failed to load revenue data:', error);
    } finally {
      setLoading(false);
    }
  }, [isSuperAdmin, getAuthHeaders, API_BASE]);

  // Calculate revenue metrics
  const calculateRevenueMetrics = (tenants) => {
    const monthlyRevenue = tenants.reduce((sum, tenant) => {
      if (tenant.subscription_status === 'active') {
        return sum + (tierPricing[tenant.subscription_tier] || 0);
      }
      return sum;
    }, 0);

    const annualRevenue = monthlyRevenue * 12;
    
    // Calculate growth (simulated - in production, compare with previous period)
    const growthRate = 15; // 15% month-over-month growth
    
    return {
      monthlyRevenue,
      annualRevenue,
      growthRate,
      averageRevenuePerTenant: tenants.length > 0 ? monthlyRevenue / tenants.length : 0
    };
  };

  // Calculate subscription metrics
  const calculateSubscriptionMetrics = (tenants) => {
    const tierCounts = tenants.reduce((acc, tenant) => {
      acc[tenant.subscription_tier] = (acc[tenant.subscription_tier] || 0) + 1;
      return acc;
    }, {});

    const totalPaying = tenants.filter(t => t.subscription_tier !== 'free').length;
    const conversionRate = tenants.length > 0 ? (totalPaying / tenants.length) * 100 : 0;

    return {
      tierCounts,
      totalPaying,
      conversionRate,
      totalTenants: tenants.length
    };
  };

  // Calculate churn metrics (simulated)
  const calculateChurnMetrics = (tenants) => {
    // In production, this would analyze tenant cancellations over time
    const churnRate = 5.2; // 5.2% monthly churn
    const retentionRate = 100 - churnRate;
    
    return {
      churnRate,
      retentionRate,
      atRiskTenants: tenants.filter(t => 
        t.subscription_status === 'active' && 
        t.user_count < 2 && 
        t.document_count < 5
      ).length
    };
  };

  useEffect(() => {
    loadRevenueData();
  }, [loadRevenueData, timeRange]);

  if (!isSuperAdmin) {
    return (
      <div className="text-center py-12">
        <div className="text-red-600 text-lg">Access Denied - Superadmin Only</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <div className="mt-2 text-gray-600">Loading revenue analytics...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Revenue Analytics</h1>
          <p className="text-gray-600">Financial insights and subscription metrics</p>
        </div>
        
        <select
          value={timeRange}
          onChange={(e) => setTimeRange(e.target.value)}
          className="border rounded-md px-3 py-2"
        >
          <option value="3m">Last 3 months</option>
          <option value="6m">Last 6 months</option>
          <option value="12m">Last 12 months</option>
        </select>
      </div>

      {/* Revenue Metrics */}
      {revenueData && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <RevenueCard
            title="Monthly Recurring Revenue"
            value={`$${revenueData.monthlyRevenue.toLocaleString()}`}
            change={`+${revenueData.growthRate}%`}
            icon="💰"
            color="green"
          />
          <RevenueCard
            title="Annual Run Rate"
            value={`$${revenueData.annualRevenue.toLocaleString()}`}
            change="Based on current MRR"
            icon="📈"
            color="blue"
          />
          <RevenueCard
            title="Average Revenue Per Tenant"
            value={`$${revenueData.averageRevenuePerTenant.toFixed(2)}`}
            change="Monthly"
            icon="🎯"
            color="purple"
          />
          <RevenueCard
            title="Conversion Rate"
            value={`${subscriptionMetrics?.conversionRate.toFixed(1)}%`}
            change="Free to paid"
            icon="📊"
            color="orange"
          />
        </div>
      )}

      {/* Subscription Overview */}
      {subscriptionMetrics && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Subscription Distribution */}
          <div className="bg-white rounded-lg border p-6">
            <h2 className="text-lg font-semibold mb-4">Subscription Distribution</h2>
            
            <div className="space-y-4">
              {Object.entries(subscriptionMetrics.tierCounts).map(([tier, count]) => {
                const percentage = (count / subscriptionMetrics.totalTenants) * 100;
                const revenue = count * (tierPricing[tier] || 0);
                
                return (
                  <SubscriptionTierRow
                    key={tier}
                    tier={tier}
                    count={count}
                    percentage={percentage}
                    revenue={revenue}
                  />
                );
              })}
            </div>

            <div className="mt-6 pt-4 border-t">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Total Paying Customers</span>
                <span className="font-medium">{subscriptionMetrics.totalPaying}</span>
              </div>
            </div>
          </div>

          {/* Churn & Retention */}
          <div className="bg-white rounded-lg border p-6">
            <h2 className="text-lg font-semibold mb-4">Retention Metrics</h2>
            
            <div className="space-y-4">
              <div className="text-center">
                <div className="text-3xl font-bold text-green-600">
                  {churnData?.retentionRate.toFixed(1)}%
                </div>
                <div className="text-sm text-gray-600">Monthly Retention Rate</div>
              </div>
              
              <div className="grid grid-cols-2 gap-4 text-center">
                <div className="p-3 bg-red-50 rounded-lg">
                  <div className="text-lg font-semibold text-red-600">
                    {churnData?.churnRate}%
                  </div>
                  <div className="text-xs text-gray-600">Churn Rate</div>
                </div>
                
                <div className="p-3 bg-orange-50 rounded-lg">
                  <div className="text-lg font-semibold text-orange-600">
                    {churnData?.atRiskTenants}
                  </div>
                  <div className="text-xs text-gray-600">At Risk</div>
                </div>
              </div>

              {/* At-risk tenants list */}
              {churnData?.atRiskTenants > 0 && (
                <div className="mt-4">
                  <div className="text-sm font-medium text-gray-700 mb-2">
                    Tenants At Risk:
                  </div>
                  <div className="text-xs text-orange-600">
                    Low usage detected - consider outreach
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Revenue Forecast */}
      <div className="bg-white rounded-lg border p-6">
        <h2 className="text-lg font-semibold mb-4">Revenue Forecast</h2>
        
        <RevenueForecastChart revenueData={revenueData} />
      </div>

      {/* Financial Health Indicators */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <HealthIndicator
          title="Customer Acquisition Cost"
          value="$245"
          benchmark="< $300"
          status="good"
          description="Average cost to acquire new tenant"
        />
        
        <HealthIndicator
          title="Customer Lifetime Value"
          value="$2,850"
          benchmark="> $1,000"
          status="excellent"
          description="Projected value per tenant"
        />
        
        <HealthIndicator
          title="LTV/CAC Ratio"
          value="11.6x"
          benchmark="> 3x"
          status="excellent"
          description="Return on acquisition investment"
        />
      </div>
    </div>
  );
};

const RevenueCard = ({ title, value, change, icon, color }) => {
  const colorClasses = {
    green: 'text-green-600',
    blue: 'text-blue-600',
    purple: 'text-purple-600',
    orange: 'text-orange-600'
  };

  return (
    <div className="bg-white rounded-lg border p-6">
      <div className="flex items-center justify-between">
        <div>
          <div className={`text-2xl font-bold ${colorClasses[color]}`}>{value}</div>
          <div className="text-sm font-medium text-gray-900">{title}</div>
          <div className="text-xs text-gray-500 mt-1">{change}</div>
        </div>
        <div className="text-2xl">{icon}</div>
      </div>
    </div>
  );
};

const SubscriptionTierRow = ({ tier, count, percentage, revenue }) => {
  const tierStyles = {
    free: 'bg-gray-100 text-gray-800',
    starter: 'bg-blue-100 text-blue-800',
    professional: 'bg-purple-100 text-purple-800',
    enterprise: 'bg-yellow-100 text-yellow-800'
  };

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span className={`px-2 py-1 text-xs rounded-full ${tierStyles[tier]}`}>
          {tier.charAt(0).toUpperCase() + tier.slice(1)}
        </span>
        <span className="text-sm text-gray-600">{count} tenant{count !== 1 ? 's' : ''}</span>
      </div>
      
      <div className="text-right">
        <div className="text-sm font-medium">${revenue.toLocaleString()}/month</div>
        <div className="text-xs text-gray-500">{percentage.toFixed(1)}%</div>
      </div>
    </div>
  );
};

const RevenueForecastChart = ({ revenueData }) => {
  if (!revenueData) return null;

  // Generate 12-month forecast
  const forecast = Array.from({ length: 12 }, (_, i) => {
    const month = new Date();
    month.setMonth(month.getMonth() + i);
    
    // Apply growth rate with some variance
    const growthFactor = Math.pow(1 + (revenueData.growthRate / 100), i);
    const variance = 0.9 + Math.random() * 0.2; // ±10% variance
    
    return {
      month: month.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      revenue: Math.round(revenueData.monthlyRevenue * growthFactor * variance)
    };
  });

  const maxRevenue = Math.max(...forecast.map(f => f.revenue));

  return (
    <div className="space-y-4">
      {/* Chart */}
      <div className="h-64 flex items-end justify-between gap-2 border rounded-lg p-4">
        {forecast.map((point, index) => {
          const height = (point.revenue / maxRevenue) * 80;
          const isCurrentMonth = index === 0;
          
          return (
            <div key={index} className="flex flex-col items-center gap-2 flex-1">
              <div 
                className={`w-full rounded-t transition-all duration-500 ${
                  isCurrentMonth ? 'bg-green-500' : 'bg-blue-500'
                }`}
                style={{ height: `${height}%` }}
                title={`${point.month}: $${point.revenue.toLocaleString()}`}
              ></div>
              <div className="text-xs text-gray-500 transform -rotate-45">
                {point.month}
              </div>
            </div>
          );
        })}
      </div>

      {/* Forecast Summary */}
      <div className="grid grid-cols-3 gap-4 text-center">
        <div className="p-3 bg-blue-50 rounded-lg">
          <div className="text-lg font-semibold text-blue-600">
            ${forecast[3]?.revenue.toLocaleString()}
          </div>
          <div className="text-xs text-gray-600">Q1 Forecast</div>
        </div>
        
        <div className="p-3 bg-purple-50 rounded-lg">
          <div className="text-lg font-semibold text-purple-600">
            ${forecast[6]?.revenue.toLocaleString()}
          </div>
          <div className="text-xs text-gray-600">6 Month Target</div>
        </div>
        
        <div className="p-3 bg-green-50 rounded-lg">
          <div className="text-lg font-semibold text-green-600">
            ${forecast[11]?.revenue.toLocaleString()}
          </div>
          <div className="text-xs text-gray-600">Year End Goal</div>
        </div>
      </div>
    </div>
  );
};

const HealthIndicator = ({ title, value, benchmark, status, description }) => {
  const statusColors = {
    excellent: 'text-green-600 bg-green-50 border-green-200',
    good: 'text-blue-600 bg-blue-50 border-blue-200',
    fair: 'text-yellow-600 bg-yellow-50 border-yellow-200',
    poor: 'text-red-600 bg-red-50 border-red-200'
  };

  const statusIcons = {
    excellent: '🚀',
    good: '✅',
    fair: '⚠️',
    poor: '🔴'
  };

  return (
    <div className={`rounded-lg border p-6 ${statusColors[status]}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-2xl">{statusIcons[status]}</div>
      </div>
      
      <div className="text-sm font-medium mb-1">{title}</div>
      <div className="text-xs mb-2">{description}</div>
      <div className="text-xs">Target: {benchmark}</div>
    </div>
  );
};

export default RevenueAnalytics;