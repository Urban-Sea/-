'use client';

import { useState, useMemo } from 'react';
import { useTheme } from 'next-themes';
import {
  useMe,
  useAdminUsers,
  useAdminStats,
  useAuditLogs,
  useBatchLogs,
  useFeatureFlags,
  updateUser,
  createFeatureFlag,
  updateFeatureFlag,
} from '@/lib/api';
import { GlassCard } from '@/components/shared/glass';
import { Button } from '@/components/ui/button';
import {
  Loader2, Shield, Users, Crown, Sun, Moon,
  Search, Activity, Clock, Flag, FileText,
  BarChart3, CheckCircle2, XCircle, AlertCircle,
  Plus, Power, RefreshCw,
} from 'lucide-react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { MfaGate } from '@/components/mfa/MfaGate';
import { clearMfaToken } from '@/lib/mfa-store';
import { logoutMfa } from '@/lib/api';
import { useUser } from '@/components/providers/UserProvider';

// ============================================================
// Constants
// ============================================================

const PLANS = ['free', 'pro_trial', 'pro', 'demo'] as const;

const PLAN_LABELS: Record<string, { label: string; color: string }> = {
  free: { label: 'Free', color: 'bg-zinc-500/20 text-zinc-400' },
  pro_trial: { label: 'Pro Trial', color: 'bg-emerald-500/20 text-emerald-400' },
  pro: { label: 'Pro', color: 'bg-blue-500/20 text-blue-400' },
  demo: { label: 'Demo', color: 'bg-amber-500/20 text-amber-400' },
};

const TABS = [
  { key: 'users', label: 'ユーザー', icon: Users },
  { key: 'stats', label: '統計', icon: BarChart3 },
  { key: 'audit', label: '監査ログ', icon: FileText },
  { key: 'batch', label: 'バッチログ', icon: Clock },
  { key: 'flags', label: '機能フラグ', icon: Flag },
] as const;

type TabKey = typeof TABS[number]['key'];

// ============================================================
// Helpers
// ============================================================

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('ja-JP', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('ja-JP', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ============================================================
// Main Page
// ============================================================

export default function AdminPage() {
  const { data: me, isLoading: meLoading } = useMe();
  const { theme, setTheme } = useTheme();
  const { signOut } = useUser();
  const [activeTab, setActiveTab] = useState<TabKey>('users');

  if (meLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!me?.is_admin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Shield className="w-12 h-12 text-muted-foreground/50" />
        <p className="text-muted-foreground">アクセス権限がありません</p>
        <Button variant="outline" onClick={signOut}>
          ログアウト
        </Button>
      </div>
    );
  }

  return (
    <MfaGate>
      <div className="w-full px-6 space-y-4">
        {/* Header */}
        <div className="plumb-animate-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Image src="/icon.png" alt="" width={28} height={28} className="rounded-md" />
              <h1 className="text-2xl font-bold tracking-tight">Open Regime Admin</h1>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground font-mono">{me.email}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              >
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { logoutMfa().catch(() => {}); clearMfaToken(); signOut(); }}
              >
                ログアウト
              </Button>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-1 border-b border-border pb-px overflow-x-auto">
          {TABS.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-md transition-colors whitespace-nowrap',
                  activeTab === tab.key
                    ? 'bg-muted text-foreground border-b-2 border-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        {activeTab === 'users' && <UsersTab />}
        {activeTab === 'stats' && <StatsTab />}
        {activeTab === 'audit' && <AuditLogTab />}
        {activeTab === 'batch' && <BatchLogTab />}
        {activeTab === 'flags' && <FeatureFlagsTab />}
      </div>
    </MfaGate>
  );
}

// ============================================================
// Users Tab
// ============================================================

function UsersTab() {
  const { data, isLoading, mutate } = useAdminUsers();
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState<string>('all');

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await mutate(); } finally { setRefreshing(false); }
  };

  const filteredUsers = useMemo(() => {
    if (!data?.users) return [];
    return data.users.filter(u => {
      const matchSearch = !search ||
        u.email.toLowerCase().includes(search.toLowerCase()) ||
        u.display_name?.toLowerCase().includes(search.toLowerCase());
      const matchPlan = planFilter === 'all' || u.plan === planFilter;
      return matchSearch && matchPlan;
    });
  }, [data?.users, search, planFilter]);

  const handlePlanChange = async (userId: string, newPlan: string) => {
    setUpdatingId(userId);
    try {
      await updateUser(userId, { plan: newPlan });
      await mutate();
    } catch { /* silent */ } finally {
      setUpdatingId(null);
    }
  };

  const handleToggleActive = async (userId: string, currentActive: boolean) => {
    setUpdatingId(userId);
    try {
      await updateUser(userId, { is_active: !currentActive });
      await mutate();
    } catch { /* silent */ } finally {
      setUpdatingId(null);
    }
  };

  // KPI cards from user data
  const users = data?.users || [];
  const planCounts = PLANS.reduce((acc, p) => {
    acc[p] = users.filter(u => u.plan === p).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="space-y-3">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <GlassCard stagger={1}>
          <div className="px-3 py-2">
            <div className="flex items-center gap-1.5 mb-1">
              <Users className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">総ユーザー</span>
            </div>
            <p className="text-xl font-bold font-mono tabular-nums">{data?.total || 0}</p>
          </div>
        </GlassCard>
        {(['pro', 'pro_trial', 'free'] as const).map((plan, i) => (
          <GlassCard key={plan} stagger={i + 2}>
            <div className="px-3 py-2">
              <div className="flex items-center gap-1.5 mb-1">
                <Crown className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {PLAN_LABELS[plan].label}
                </span>
              </div>
              <p className="text-xl font-bold font-mono tabular-nums">{planCounts[plan] || 0}</p>
            </div>
          </GlassCard>
        ))}
      </div>

      {/* Search & Filter */}
      <GlassCard stagger={5}>
        <div className="px-4 py-3">
          <div className="flex flex-col sm:flex-row gap-2 mb-3">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="メール・表示名で検索..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1 text-xs rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <select
              value={planFilter}
              onChange={e => setPlanFilter(e.target.value)}
              className="text-xs px-2 py-1 rounded border border-border bg-background cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="all">全プラン</option>
              {PLANS.map(p => (
                <option key={p} value={p}>{PLAN_LABELS[p].label}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                ユーザー管理
              </h2>
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                title="最新データを取得"
              >
                <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
              </button>
            </div>
            <span className="text-xs text-muted-foreground">{filteredUsers.length} 件</span>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">メール</th>
                    <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">表示名</th>
                    <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">プラン</th>
                    <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">状態</th>
                    <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">登録日</th>
                    <th className="pb-2 text-xs font-medium text-muted-foreground">最終ログイン</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map(user => (
                    <tr key={user.id} className="border-b border-border/50 last:border-0">
                      <td className="py-1.5 pr-4 text-xs font-mono truncate max-w-[200px]">
                        {user.email}
                      </td>
                      <td className="py-1.5 pr-4 text-xs text-muted-foreground">
                        {user.display_name || '-'}
                      </td>
                      <td className="py-1.5 pr-4">
                        <select
                          value={user.plan}
                          onChange={e => handlePlanChange(user.id, e.target.value)}
                          disabled={updatingId === user.id}
                          className={cn(
                            'text-xs font-medium px-1.5 py-0.5 rounded border border-border bg-background cursor-pointer',
                            'focus:outline-none focus:ring-1 focus:ring-ring',
                            updatingId === user.id && 'opacity-50',
                          )}
                        >
                          {PLANS.map(p => (
                            <option key={p} value={p}>{PLAN_LABELS[p].label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1.5 pr-4">
                        <button
                          onClick={() => handleToggleActive(user.id, user.is_active !== false)}
                          disabled={updatingId === user.id}
                          className={cn(
                            'flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium transition-colors',
                            user.is_active !== false
                              ? 'bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25'
                              : 'bg-red-500/15 text-red-500 hover:bg-red-500/25',
                            updatingId === user.id && 'opacity-50',
                          )}
                        >
                          {updatingId === user.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Power className="w-3 h-3" />
                          )}
                          {user.is_active !== false ? 'Active' : 'Frozen'}
                        </button>
                      </td>
                      <td className="py-1.5 pr-4 text-xs text-muted-foreground font-mono">
                        {formatDate(user.created_at)}
                      </td>
                      <td className="py-1.5 text-xs text-muted-foreground font-mono">
                        {formatDateTime(user.last_login_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </GlassCard>
    </div>
  );
}

// ============================================================
// Stats Tab
// ============================================================

function StatsTab() {
  const { data, isLoading } = useAdminStats();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) return null;

  const kpis = [
    { label: '総ユーザー', value: data.total_users, icon: Users },
    { label: '7日アクティブ', value: data.active_7d, icon: Activity },
    { label: '30日アクティブ', value: data.active_30d, icon: Activity },
    { label: '今月新規', value: data.new_this_month, icon: Plus },
  ];

  // Simple bar chart for daily signups
  const signups = data.daily_signups || [];
  const maxCount = Math.max(...signups.map(d => d.count), 1);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map((kpi, i) => {
          const Icon = kpi.icon;
          return (
            <GlassCard key={kpi.label} stagger={i + 1}>
              <div className="px-3 py-2">
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    {kpi.label}
                  </span>
                </div>
                <p className="text-xl font-bold font-mono tabular-nums">{kpi.value}</p>
              </div>
            </GlassCard>
          );
        })}
      </div>

      {signups.length > 0 && (
        <GlassCard stagger={5}>
          <div className="px-4 py-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
              日別新規登録 (過去30日)
            </h2>
            <div className="flex items-end gap-1 h-32">
              {signups.map(day => (
                <div
                  key={day.date}
                  className="flex-1 group relative"
                >
                  <div
                    className="bg-blue-500/60 hover:bg-blue-500/80 rounded-t transition-colors w-full"
                    style={{ height: `${(day.count / maxCount) * 100}%`, minHeight: day.count > 0 ? 4 : 0 }}
                  />
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 hidden group-hover:block bg-popover text-popover-foreground text-[10px] px-1.5 py-0.5 rounded shadow whitespace-nowrap">
                    {day.date}: {day.count}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-between mt-1 text-[10px] text-muted-foreground font-mono">
              <span>{signups[0]?.date}</span>
              <span>{signups[signups.length - 1]?.date}</span>
            </div>
          </div>
        </GlassCard>
      )}
    </div>
  );
}

// ============================================================
// Audit Log Tab
// ============================================================

function AuditLogTab() {
  const { data, isLoading } = useAuditLogs(100);

  return (
    <GlassCard stagger={1}>
      <div className="px-4 py-3">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            管理者操作ログ
          </h2>
          {data && (
            <span className="text-xs text-muted-foreground">{data.total} 件</span>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data?.logs.length ? (
          <p className="text-sm text-muted-foreground text-center py-6">ログがありません</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="pb-1.5 pr-4 text-xs font-medium text-muted-foreground">日時</th>
                  <th className="pb-1.5 pr-4 text-xs font-medium text-muted-foreground">管理者</th>
                  <th className="pb-1.5 pr-4 text-xs font-medium text-muted-foreground">アクション</th>
                  <th className="pb-1.5 pr-4 text-xs font-medium text-muted-foreground">対象</th>
                  <th className="pb-1.5 text-xs font-medium text-muted-foreground">変更内容</th>
                </tr>
              </thead>
              <tbody>
                {data.logs.map(log => (
                  <tr key={log.id} className="border-b border-border/50 last:border-0">
                    <td className="py-1.5 pr-4 text-xs text-muted-foreground font-mono whitespace-nowrap">
                      {formatDateTime(log.created_at)}
                    </td>
                    <td className="py-1.5 pr-4 text-xs font-mono truncate max-w-[160px]">
                      {log.admin_email}
                    </td>
                    <td className="py-1.5 pr-4">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-500 font-medium">
                        {log.action}
                      </span>
                    </td>
                    <td className="py-1.5 pr-4 text-xs text-muted-foreground font-mono">
                      {log.target_type && (
                        <span>{log.target_type}/{log.target_id?.slice(0, 8)}</span>
                      )}
                    </td>
                    <td className="py-1.5 text-xs text-muted-foreground">
                      {log.old_value && log.new_value && (() => {
                        const oldVal = typeof log.old_value === 'string' ? JSON.parse(log.old_value) : log.old_value;
                        const newVal = typeof log.new_value === 'string' ? JSON.parse(log.new_value) : log.new_value;
                        return (
                          <span className="font-mono">
                            {Object.entries(newVal).map(([k, v]) => (
                              <span key={k} className="mr-2">
                                {k}: {String(oldVal?.[k])} → {String(v)}
                              </span>
                            ))}
                          </span>
                        );
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </GlassCard>
  );
}

// ============================================================
// Batch Log Tab
// ============================================================

const BATCH_STATUS_STYLES: Record<string, { icon: typeof CheckCircle2; color: string }> = {
  success: { icon: CheckCircle2, color: 'text-emerald-500 bg-emerald-500/15' },
  running: { icon: Loader2, color: 'text-blue-500 bg-blue-500/15' },
  error: { icon: XCircle, color: 'text-red-500 bg-red-500/15' },
};

function BatchLogTab() {
  const { data, isLoading } = useBatchLogs(100);

  return (
    <GlassCard stagger={1}>
      <div className="px-4 py-3">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            バッチ実行ログ
          </h2>
          {data && (
            <span className="text-xs text-muted-foreground">{data.total} 件</span>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data?.logs.length ? (
          <p className="text-sm text-muted-foreground text-center py-6">ログがありません</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="pb-1.5 pr-4 text-xs font-medium text-muted-foreground">種別</th>
                  <th className="pb-1.5 pr-4 text-xs font-medium text-muted-foreground">ステータス</th>
                  <th className="pb-1.5 pr-4 text-xs font-medium text-muted-foreground">開始</th>
                  <th className="pb-1.5 pr-4 text-xs font-medium text-muted-foreground">所要時間</th>
                  <th className="pb-1.5 pr-4 text-xs font-medium text-muted-foreground">件数</th>
                  <th className="pb-1.5 text-xs font-medium text-muted-foreground">エラー</th>
                </tr>
              </thead>
              <tbody>
                {data.logs.map(log => {
                  const style = BATCH_STATUS_STYLES[log.status] || {
                    icon: AlertCircle,
                    color: 'text-yellow-500 bg-yellow-500/15',
                  };
                  const StatusIcon = style.icon;
                  return (
                    <tr key={log.id} className="border-b border-border/50 last:border-0">
                      <td className="py-1.5 pr-4">
                        <span className="text-xs font-mono font-medium px-1.5 py-0.5 rounded bg-muted">
                          {log.job_type}
                        </span>
                      </td>
                      <td className="py-1.5 pr-4">
                        <span className={cn('flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full w-fit', style.color)}>
                          <StatusIcon className={cn('w-3 h-3', log.status === 'running' && 'animate-spin')} />
                          {log.status}
                        </span>
                      </td>
                      <td className="py-1.5 pr-4 text-xs text-muted-foreground font-mono whitespace-nowrap">
                        {formatDateTime(log.started_at)}
                      </td>
                      <td className="py-1.5 pr-4 text-xs font-mono tabular-nums">
                        {log.duration_seconds != null ? `${log.duration_seconds}s` : '-'}
                      </td>
                      <td className="py-1.5 pr-4 text-xs font-mono tabular-nums">
                        {log.records_processed}
                      </td>
                      <td className="py-1.5 text-xs text-red-400 truncate max-w-[200px]">
                        {log.error_message || '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </GlassCard>
  );
}

// ============================================================
// Feature Flags Tab
// ============================================================

function FeatureFlagsTab() {
  const { data, isLoading, mutate } = useFeatureFlags();
  const [toggling, setToggling] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);

  const handleToggle = async (flagId: number, enabled: boolean) => {
    setToggling(flagId);
    try {
      await updateFeatureFlag(flagId, { enabled: !enabled });
      await mutate();
    } catch { /* silent */ } finally {
      setToggling(null);
    }
  };

  const handleCreate = async () => {
    if (!newKey.trim()) return;
    setCreating(true);
    try {
      await createFeatureFlag({ flag_key: newKey.trim(), description: newDesc.trim() || undefined });
      await mutate();
      setNewKey('');
      setNewDesc('');
      setShowCreate(false);
    } catch { /* silent */ } finally {
      setCreating(false);
    }
  };

  return (
    <GlassCard stagger={1}>
      <div className="px-4 py-3">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            機能フラグ
          </h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowCreate(!showCreate)}
            className="text-xs"
          >
            <Plus className="w-3 h-3 mr-1" />
            新規作成
          </Button>
        </div>

        {/* Create Form */}
        {showCreate && (
          <div className="mb-3 p-3 rounded border border-border bg-muted/30 space-y-2">
            <input
              type="text"
              placeholder="flag_key (例: enable_new_chart)"
              value={newKey}
              onChange={e => setNewKey(e.target.value)}
              className="w-full px-3 py-1.5 text-xs rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring font-mono"
            />
            <input
              type="text"
              placeholder="説明 (任意)"
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              className="w-full px-3 py-1.5 text-xs rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleCreate} disabled={creating || !newKey.trim()} className="text-xs">
                {creating ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                作成
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)} className="text-xs">
                キャンセル
              </Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data?.flags.length ? (
          <p className="text-sm text-muted-foreground text-center py-8">フラグがありません</p>
        ) : (
          <div className="space-y-1.5">
            {data.flags.map(flag => (
              <div
                key={flag.id}
                className="flex items-center justify-between px-3 py-2 rounded border border-border/50 hover:bg-muted/30 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-medium">{flag.flag_key}</span>
                    <span className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                      flag.enabled
                        ? 'bg-emerald-500/15 text-emerald-500'
                        : 'bg-zinc-500/15 text-zinc-400',
                    )}>
                      {flag.enabled ? 'ON' : 'OFF'}
                    </span>
                  </div>
                  {flag.description && (
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{flag.description}</p>
                  )}
                </div>
                <button
                  onClick={() => handleToggle(flag.id, flag.enabled)}
                  disabled={toggling === flag.id}
                  className={cn(
                    'relative w-10 h-5 rounded-full transition-colors',
                    flag.enabled ? 'bg-emerald-500' : 'bg-zinc-600',
                    toggling === flag.id && 'opacity-50',
                  )}
                >
                  <span className={cn(
                    'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow-sm',
                    flag.enabled ? 'left-5.5 translate-x-0' : 'left-0.5',
                  )} style={{ left: flag.enabled ? '22px' : '2px' }} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </GlassCard>
  );
}
