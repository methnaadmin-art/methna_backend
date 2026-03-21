import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { subscriptionsApi, adminApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, Crown, CreditCard, TrendingUp, Star, Zap, Gift } from 'lucide-react'
import type { DashboardStats } from '@/types'

export default function MonetizationPage() {
  const { t } = useTranslation()
  const [plans, setPlans] = useState<any[]>([])
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const [plansRes, statsRes] = await Promise.allSettled([
          subscriptionsApi.getPlans(),
          adminApi.getStats(),
        ])
        if (plansRes.status === 'fulfilled') {
          const d = plansRes.value.data
          setPlans(Array.isArray(d) ? d : d?.plans || [])
        }
        if (statsRes.status === 'fulfilled') setStats(statsRes.value.data)
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

  const planIcons: Record<string, any> = {
    FREE: Gift,
    PREMIUM: Star,
    GOLD: Crown,
  }

  const planColors: Record<string, string> = {
    FREE: 'bg-slate-100 text-slate-600',
    PREMIUM: 'bg-purple-100 text-purple-600',
    GOLD: 'bg-amber-100 text-amber-600',
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('monetization.title')}</h1>
        <p className="text-muted-foreground">{t('monetization.subtitle')}</p>
      </div>

      {/* Revenue Overview */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-lg bg-amber-50 p-3">
              <Crown className="h-6 w-6 text-amber-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('monetization.premiumUsers')}</p>
              <p className="text-2xl font-bold">{stats?.revenue?.premiumUsers ?? 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-lg bg-emerald-50 p-3">
              <TrendingUp className="h-6 w-6 text-emerald-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('monetization.conversionRate')}</p>
              <p className="text-2xl font-bold">{stats?.revenue?.conversionRate ?? '0%'}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-lg bg-blue-50 p-3">
              <CreditCard className="h-6 w-6 text-blue-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('monetization.totalUsers')}</p>
              <p className="text-2xl font-bold">{stats?.users?.total ?? 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-lg bg-purple-50 p-3">
              <Zap className="h-6 w-6 text-purple-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('monetization.activeUsers')}</p>
              <p className="text-2xl font-bold">{stats?.users?.active ?? 0}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Subscription Plans */}
      <div>
        <h2 className="text-lg font-semibold mb-4">{t('monetization.subscriptionPlans')}</h2>
        {plans.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              {t('monetization.noPlans')}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((plan: any, idx: number) => {
              const planKey = (plan.plan || plan.name || '').toUpperCase()
              const Icon = planIcons[planKey] || Star
              const colorClass = planColors[planKey] || 'bg-gray-100 text-gray-600'

              return (
                <Card key={idx} className="relative overflow-hidden">
                  {planKey === 'GOLD' && (
                    <div className="absolute top-0 right-0 bg-amber-500 text-white text-[10px] font-bold px-3 py-1 rounded-bl-lg">
                      POPULAR
                    </div>
                  )}
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-3">
                      <div className={`rounded-lg p-2.5 ${colorClass}`}>
                        <Icon className="h-6 w-6" />
                      </div>
                      <div>
                        <CardTitle className="text-lg">{plan.name || planKey}</CardTitle>
                        {plan.price != null && (
                          <p className="text-2xl font-bold mt-1">
                            ${plan.price}<span className="text-sm text-muted-foreground font-normal">/mo</span>
                          </p>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {plan.features && (
                      <ul className="space-y-2">
                        {(Array.isArray(plan.features) ? plan.features : Object.entries(plan.features)).map((feat: any, i: number) => {
                          const label = typeof feat === 'string' ? feat : `${feat[0]}: ${feat[1]}`
                          return (
                            <li key={i} className="flex items-start gap-2 text-sm">
                              <span className="text-emerald-500 mt-0.5">&#10003;</span>
                              <span>{label}</span>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* Conversion Funnel */}
      {stats && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('monetization.conversionFunnel')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div className="flex-1 text-center p-4 rounded-lg bg-muted">
                <p className="text-3xl font-bold">{stats.users.total}</p>
                <p className="text-xs text-muted-foreground mt-1">{t('monetization.totalUsers')}</p>
              </div>
              <div className="text-muted-foreground text-2xl">&rarr;</div>
              <div className="flex-1 text-center p-4 rounded-lg bg-muted">
                <p className="text-3xl font-bold">{stats.users.active}</p>
                <p className="text-xs text-muted-foreground mt-1">{t('monetization.activeUsers')}</p>
              </div>
              <div className="text-muted-foreground text-2xl">&rarr;</div>
              <div className="flex-1 text-center p-4 rounded-lg bg-amber-50">
                <p className="text-3xl font-bold text-amber-600">{stats.revenue.premiumUsers}</p>
                <p className="text-xs text-muted-foreground mt-1">{t('monetization.premiumUsers')}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
