import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { analyticsApi } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatsCard } from '@/components/stats-card'
import { Loader2, Users, TrendingUp, Heart, Repeat } from 'lucide-react'
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'

export default function AnalyticsPage() {
  const { t } = useTranslation()
  const [dashboard, setDashboard] = useState<any>(null)
  const [matchesData, setMatchesData] = useState<any[]>([])
  const [conversion, setConversion] = useState<any>(null)
  const [retention, setRetention] = useState<any>(null)
  const [dau, setDau] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const [dashRes, matchRes, convRes, retRes, dauRes] = await Promise.allSettled([
          analyticsApi.getDashboard(),
          analyticsApi.getMatchesOverTime(30),
          analyticsApi.getConversion(30),
          analyticsApi.getRetention(7),
          analyticsApi.getDau(),
        ])

        if (dashRes.status === 'fulfilled') setDashboard(dashRes.value.data)
        if (matchRes.status === 'fulfilled') {
          const raw = matchRes.value.data
          setMatchesData(Array.isArray(raw) ? raw : [])
        }
        if (convRes.status === 'fulfilled') setConversion(convRes.value.data)
        if (retRes.status === 'fulfilled') setRetention(retRes.value.data)
        if (dauRes.status === 'fulfilled') setDau(dauRes.value.data)
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title={t('dashboard.dau')}
          value={dau?.dau ?? dashboard?.dailyActiveUsers ?? '-'}
          icon={Users}
        />
        <StatsCard
          title={t('dashboard.conversionRate')}
          value={conversion?.conversionRate != null ? `${(conversion.conversionRate * 100).toFixed(1)}%` : dashboard?.conversionRate != null ? `${dashboard.conversionRate}%` : '-'}
          subtitle={t('analytics.likesToMatches')}
          icon={TrendingUp}
          iconColor="text-blue-500"
        />
        <StatsCard
          title={t('dashboard.retention')}
          value={retention?.retentionRate != null ? `${(retention.retentionRate * 100).toFixed(1)}%` : '-'}
          subtitle={t('analytics.sevenDayCohort')}
          icon={Repeat}
          iconColor="text-amber-500"
        />
        <StatsCard
          title={t('analytics.matchesToday')}
          value={dashboard?.matchesToday ?? '-'}
          icon={Heart}
          iconColor="text-pink-500"
        />
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Matches Over Time */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('dashboard.matchesOverTime')}</CardTitle>
          </CardHeader>
          <CardContent>
            {matchesData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={matchesData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis />
                  <Tooltip />
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke="#2D7A4F"
                    fill="#2D7A4F"
                    fillOpacity={0.15}
                    strokeWidth={2}
                    name="Matches"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-12 text-center text-muted-foreground">{t('common.noData')}</p>
            )}
          </CardContent>
        </Card>

        {/* Platform Stats */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('analytics.platformOverview')}</CardTitle>
          </CardHeader>
          <CardContent>
            {dashboard ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={[
                    { name: 'Users', value: dashboard.totalUsers || 0 },
                    { name: 'Matches', value: dashboard.totalMatches || 0 },
                    { name: 'Messages', value: dashboard.totalMessages || 0 },
                    { name: 'Premium', value: dashboard.premiumUsers || 0 },
                  ]}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="value" fill="#2D7A4F" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-12 text-center text-muted-foreground">{t('common.noData')}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Conversion & Retention Details */}
      <div className="grid gap-6 lg:grid-cols-2">
        {conversion && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t('analytics.likeToMatchConversion')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold">{conversion.totalLikes ?? '-'}</p>
                  <p className="text-xs text-muted-foreground">{t('dashboard.totalLikes')}</p>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold">{conversion.totalMatches ?? '-'}</p>
                  <p className="text-xs text-muted-foreground">{t('dashboard.totalMatches')}</p>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold text-primary">
                    {conversion.conversionRate != null ? `${(conversion.conversionRate * 100).toFixed(1)}%` : '-'}
                  </p>
                  <p className="text-xs text-muted-foreground">{t('dashboard.conversionRate')}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {retention && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t('analytics.userRetention')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold">{retention.cohortSize ?? '-'}</p>
                  <p className="text-xs text-muted-foreground">{t('analytics.cohortSize')}</p>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold">{retention.retainedUsers ?? '-'}</p>
                  <p className="text-xs text-muted-foreground">{t('analytics.retained')}</p>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-2xl font-bold text-primary">
                    {retention.retentionRate != null ? `${(retention.retentionRate * 100).toFixed(1)}%` : '-'}
                  </p>
                  <p className="text-xs text-muted-foreground">{t('dashboard.retention')}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
