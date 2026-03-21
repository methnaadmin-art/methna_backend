import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { adminApi, analyticsApi } from '@/lib/api'
import { StatsCard } from '@/components/stats-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import type { DashboardStats } from '@/types'
import {
  Users,
  UserCheck,
  Heart,
  MessageSquare,
  ImageIcon,
  Flag,
  Crown,
  TrendingUp,
  Activity,
  Loader2,
  ArrowRight,
  Eye,
  EyeOff,
  Shield,
  ShieldBan,
  Headphones,
  Bell,
  Camera,
  BarChart3,
  Zap,
  Sparkles,
  MessageCircleHeart,
} from 'lucide-react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  AreaChart,
  Area,
} from 'recharts'

const PIE_COLORS = ['#2D7A4F', '#f59e0b', '#ef4444', '#6b7280', '#8b5cf6']

export default function DashboardPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [analytics, setAnalytics] = useState<any>(null)
  const [matchesOverTime, setMatchesOverTime] = useState<{ date: string; count: number }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      adminApi.getStats().catch(() => ({ data: null })),
      analyticsApi.getDashboard().catch(() => ({ data: null })),
      analyticsApi.getMatchesOverTime(14).catch(() => ({ data: [] })),
    ])
      .then(([statsRes, analyticsRes, matchesRes]) => {
        setStats(statsRes.data)
        setAnalytics(analyticsRes.data)
        setMatchesOverTime(matchesRes.data || [])
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!stats) {
    return <div className="text-center text-muted-foreground">{t('common.noData')}</div>
  }

  const userStatusData = [
    { name: t('users.active'), value: stats.users.active },
    { name: t('users.suspended'), value: stats.users.suspended },
    { name: t('users.banned'), value: stats.users.banned },
    { name: t('common.other'), value: Math.max(0, stats.users.total - stats.users.active - stats.users.suspended - stats.users.banned) },
  ].filter(d => d.value > 0)

  const growthData = [
    { name: t('dashboard.thisWeek'), users: stats.users.newThisWeek },
    { name: t('dashboard.thisMonth'), users: stats.users.newThisMonth },
    { name: t('common.total'), users: stats.users.total },
  ]

  const conversionRate = parseFloat(stats.revenue.conversionRate) || 0

  const quickActions = [
    { label: t('dashboard.pendingReports'), value: stats.reports.pending, icon: Flag, color: 'text-red-500 bg-red-50 dark:bg-red-950', to: '/reports' },
    { label: t('dashboard.pendingPhotos'), value: stats.content.pendingPhotos, icon: Camera, color: 'text-amber-500 bg-amber-50 dark:bg-amber-950', to: '/verification' },
    { label: t('nav.supportTickets'), value: '—', icon: Headphones, color: 'text-blue-500 bg-blue-50 dark:bg-blue-950', to: '/support' },
    { label: t('nav.notifications'), value: '', icon: Bell, color: 'text-purple-500 bg-purple-50 dark:bg-purple-950', to: '/send-notifications' },
  ]

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="rounded-xl bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{t('dashboard.welcome')}</h1>
            <p className="text-muted-foreground mt-1">{t('dashboard.subtitle')}</p>
          </div>
          <div className="hidden sm:flex gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate('/analytics')} className="gap-2">
              <BarChart3 className="h-4 w-4" /> {t('nav.analytics')}
            </Button>
            <Button size="sm" onClick={() => navigate('/users')} className="gap-2">
              <Users className="h-4 w-4" /> {t('users.title')}
            </Button>
          </div>
        </div>
      </div>

      {/* Primary Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard title={t('dashboard.totalUsers')} value={stats.users.total.toLocaleString()} subtitle={`+${stats.users.newThisWeek}`} icon={Users} trend={{ value: stats.users.newThisWeek > 0 ? Math.round((stats.users.newThisWeek / Math.max(stats.users.total, 1)) * 100) : 0, label: t('dashboard.thisWeek') }} />
        <StatsCard title={t('dashboard.activeUsers')} value={stats.users.active.toLocaleString()} subtitle={`${((stats.users.active / Math.max(stats.users.total, 1)) * 100).toFixed(1)}%`} icon={UserCheck} iconColor="text-emerald-600" />
        <StatsCard title={t('dashboard.totalMatches')} value={stats.content.totalMatches.toLocaleString()} icon={Heart} iconColor="text-pink-500" />
        <StatsCard title={t('dashboard.totalMessages')} value={stats.content.totalMessages.toLocaleString()} icon={MessageSquare} iconColor="text-blue-500" />
      </div>

      {/* Secondary Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard title={t('dashboard.premiumUsers')} value={stats.revenue.premiumUsers} subtitle={`${stats.revenue.conversionRate}`} icon={Crown} iconColor="text-amber-500" />
        <StatsCard title={t('dashboard.totalPhotos')} value={stats.content.totalPhotos.toLocaleString()} subtitle={`${stats.content.pendingPhotos} pending`} icon={ImageIcon} iconColor="text-purple-500" />
        <StatsCard title={t('dashboard.profiles')} value={stats.content.totalProfiles.toLocaleString()} icon={Activity} iconColor="text-cyan-500" />
        <StatsCard title="Conversations" value={stats.content.totalConversations?.toLocaleString() ?? '0'} icon={MessageSquare} iconColor="text-teal-500" />
      </div>

      {/* Swipes & Engagement Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <StatsCard title="Likes" value={stats.swipes?.totalLikes?.toLocaleString() ?? '0'} icon={Heart} iconColor="text-pink-500" />
        <StatsCard title="Super Likes" value={stats.swipes?.totalSuperLikes?.toLocaleString() ?? '0'} icon={Sparkles} iconColor="text-purple-500" />
        <StatsCard title="Compliments" value={stats.swipes?.totalCompliments?.toLocaleString() ?? '0'} icon={MessageCircleHeart} iconColor="text-amber-500" />
        <StatsCard title="Passes" value={stats.swipes?.totalPasses?.toLocaleString() ?? '0'} icon={EyeOff} iconColor="text-gray-400" />
        <StatsCard title="Boosts" value={stats.engagement?.totalBoosts?.toLocaleString() ?? '0'} icon={Zap} iconColor="text-orange-500" />
        <StatsCard title="Blocks" value={stats.engagement?.totalBlocks?.toLocaleString() ?? '0'} icon={ShieldBan} iconColor="text-red-500" />
      </div>

      {/* Charts Row */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base font-semibold">{t('dashboard.matchesOverTime')}</CardTitle>
          </CardHeader>
          <CardContent>
            {matchesOverTime.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={matchesOverTime}>
                  <defs>
                    <linearGradient id="matchGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ec4899" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#ec4899" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Area type="monotone" dataKey="count" stroke="#ec4899" fill="url(#matchGradient)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-60 items-center justify-center text-muted-foreground text-sm">{t('common.noData')}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">{t('dashboard.userGrowth')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={userStatusData} cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={4} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                  {userStatusData.map((_, index) => (
                    <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Engagement & Revenue Row */}
      <div className="grid gap-6 lg:grid-cols-3">
        {analytics && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-500" /> {t('dashboard.engagement')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{t('dashboard.dau')}</span>
                <span className="text-lg font-bold">{analytics.engagement?.dau?.toLocaleString() ?? '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{t('dashboard.wau')}</span>
                <span className="text-lg font-bold">{analytics.engagement?.wau?.toLocaleString() ?? '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{t('dashboard.mau')}</span>
                <span className="text-lg font-bold">{analytics.engagement?.mau?.toLocaleString() ?? '—'}</span>
              </div>
              {analytics.retention && (
                <div className="border-t pt-3">
                  <p className="text-xs font-semibold text-muted-foreground mb-2">{t('dashboard.retention')}</p>
                  <div className="space-y-2">
                    {[
                      { label: 'Day 1', value: analytics.retention.day1 },
                      { label: 'Day 3', value: analytics.retention.day3 },
                      { label: 'Day 7', value: analytics.retention.day7 },
                      { label: 'Day 30', value: analytics.retention.day30 },
                    ].map((r) => (
                      <div key={r.label} className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground w-12">{r.label}</span>
                        <Progress value={parseFloat(r.value) || 0} className="flex-1 h-1.5" />
                        <span className="text-xs font-semibold w-10 text-end">{r.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Crown className="h-4 w-4 text-amber-500" /> {t('dashboard.revenue')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 border border-amber-200 dark:border-amber-800 p-4 text-center">
              <p className="text-3xl font-bold text-amber-600">{stats.revenue.premiumUsers}</p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">{t('dashboard.premiumUsers')}</p>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm text-muted-foreground">{t('dashboard.conversionRate')}</span>
                <span className="text-sm font-bold">{stats.revenue.conversionRate}</span>
              </div>
              <Progress value={conversionRate} className="h-2" />
            </div>
            <Button variant="outline" size="sm" className="w-full" onClick={() => navigate('/subscriptions')}>
              {t('nav.subscriptions')} <ArrowRight className="h-3 w-3 ms-1" />
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">{t('dashboard.newRegistrations')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={growthData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="users" fill="#2D7A4F" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-lg border p-3 text-center">
                <p className="text-lg font-bold text-emerald-600">+{stats.users.newThisWeek}</p>
                <p className="text-[10px] text-muted-foreground">{t('dashboard.thisWeek')}</p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <p className="text-lg font-bold text-blue-600">+{stats.users.newThisMonth}</p>
                <p className="text-[10px] text-muted-foreground">{t('dashboard.thisMonth')}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-base font-semibold mb-3">{t('dashboard.quickActions')}</h2>
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {quickActions.map((action) => {
            const [textColor, bgColor] = action.color.split(' ')
            return (
              <button key={action.to} onClick={() => navigate(action.to)} className="flex items-center gap-3 rounded-xl border p-4 text-start hover:shadow-md hover:border-primary/20 transition-all group">
                <div className={`rounded-lg p-2.5 ${bgColor} group-hover:scale-110 transition-transform`}>
                  <action.icon className={`h-5 w-5 ${textColor}`} />
                </div>
                <div>
                  {action.value !== '' && action.value !== '—' && <p className="text-xl font-bold">{action.value}</p>}
                  {action.value === '—' && <p className="text-xl font-bold">—</p>}
                  <p className="text-xs text-muted-foreground">{action.label}</p>
                </div>
                <ArrowRight className="h-4 w-4 ms-auto text-muted-foreground/30 group-hover:text-primary transition-colors" />
              </button>
            )
          })}
        </div>
      </div>

      {/* Platform Health */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Shield className="h-4 w-4 text-emerald-500" /> {t('dashboard.platformHealth')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">{t('users.banned')}</p>
              <p className="text-xl font-bold text-red-600">{stats.users.banned}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">{t('users.suspended')}</p>
              <p className="text-xl font-bold text-amber-600">{stats.users.suspended}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">{t('dashboard.pendingReports')}</p>
              <p className="text-xl font-bold text-red-500">{stats.reports.pending}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">{t('dashboard.pendingPhotos')}</p>
              <p className="text-xl font-bold text-amber-500">{stats.content.pendingPhotos}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Pending Verification</p>
              <p className="text-xl font-bold text-blue-500">{stats.users.pendingVerification ?? 0}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">{t('dashboard.activeRate')}</p>
              <p className="text-xl font-bold text-emerald-600">
                {((stats.users.active / Math.max(stats.users.total, 1)) * 100).toFixed(1)}%
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
