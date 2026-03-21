import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { adminApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { formatDateTime } from '@/lib/utils'
import {
  Loader2,
  Crown,
  Star,
  Gift,
  Zap,
  ChevronLeft,
  ChevronRight,
  Eye,
  Rocket,
} from 'lucide-react'

export default function SubscriptionsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [subscriptions, setSubscriptions] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState({ free: 0, premium: 0, gold: 0 })
  const [page, setPage] = useState(1)
  const [limit] = useState(20)
  const [planFilter, setPlanFilter] = useState('all')
  const [loading, setLoading] = useState(true)

  const [boosts, setBoosts] = useState<any[]>([])
  const [boostsLoading, setBoostsLoading] = useState(false)
  const [showBoosts, setShowBoosts] = useState(false)

  const fetchSubscriptions = async () => {
    setLoading(true)
    try {
      const plan = planFilter === 'all' ? undefined : planFilter
      const { data } = await adminApi.getSubscriptions(page, limit, plan)
      setSubscriptions(data.subscriptions || data || [])
      setTotal(data.total || 0)
      if (data.counts) setCounts(data.counts)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const fetchBoosts = async () => {
    setBoostsLoading(true)
    try {
      const { data } = await adminApi.getBoosts()
      setBoosts(data.boosts || data || [])
    } catch (err) {
      console.error(err)
    } finally {
      setBoostsLoading(false)
    }
  }

  useEffect(() => { fetchSubscriptions() }, [page, planFilter])

  const totalPages = Math.ceil(total / limit)

  const planBadge = (plan: string) => {
    switch (plan) {
      case 'gold': return <Badge className="bg-amber-500 text-white">Gold</Badge>
      case 'premium': return <Badge className="bg-purple-500 text-white">Premium</Badge>
      default: return <Badge variant="secondary">Free</Badge>
    }
  }

  const statusBadge = (status: string) => {
    switch (status) {
      case 'active': return <Badge variant="success">Active</Badge>
      case 'cancelled': return <Badge variant="warning">Cancelled</Badge>
      case 'expired': return <Badge variant="secondary">Expired</Badge>
      default: return <Badge variant="outline">{status}</Badge>
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('subscriptions.title')}</h1>
        <p className="text-muted-foreground">{t('subscriptions.subtitle')}</p>
      </div>

      {/* Plan Breakdown */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => { setPlanFilter('free'); setPage(1) }}>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-lg bg-slate-100 p-3"><Gift className="h-6 w-6 text-slate-500" /></div>
            <div>
              <p className="text-sm text-muted-foreground">Free</p>
              <p className="text-2xl font-bold">{counts.free}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => { setPlanFilter('premium'); setPage(1) }}>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-lg bg-purple-100 p-3"><Star className="h-6 w-6 text-purple-500" /></div>
            <div>
              <p className="text-sm text-muted-foreground">Premium</p>
              <p className="text-2xl font-bold">{counts.premium}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => { setPlanFilter('gold'); setPage(1) }}>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-lg bg-amber-100 p-3"><Crown className="h-6 w-6 text-amber-500" /></div>
            <div>
              <p className="text-sm text-muted-foreground">Gold</p>
              <p className="text-2xl font-bold">{counts.gold}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => { setShowBoosts(!showBoosts); if (!showBoosts && boosts.length === 0) fetchBoosts() }}>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-lg bg-orange-100 p-3"><Rocket className="h-6 w-6 text-orange-500" /></div>
            <div>
              <p className="text-sm text-muted-foreground">Boosts</p>
              <p className="text-2xl font-bold">{boosts.length || '—'}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Boosts Section */}
      {showBoosts && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Rocket className="h-5 w-5 text-orange-500" /> Profile Boosts
            </CardTitle>
          </CardHeader>
          <CardContent>
            {boostsLoading ? (
              <div className="flex h-20 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : boosts.length === 0 ? (
              <p className="py-4 text-center text-muted-foreground">No boosts found.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 pr-4 font-medium">User</th>
                      <th className="pb-2 pr-4 font-medium">Type</th>
                      <th className="pb-2 pr-4 font-medium">Status</th>
                      <th className="pb-2 pr-4 font-medium">Views Gained</th>
                      <th className="pb-2 pr-4 font-medium">Expires</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {boosts.map((b: any) => (
                      <tr key={b.id} className="hover:bg-muted/50">
                        <td className="py-2 pr-4">
                          <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate(`/users/${b.userId}`)}>
                            <Avatar className="h-7 w-7">
                              <AvatarFallback className="text-[10px]">{b.user?.firstName?.[0] || '?'}</AvatarFallback>
                            </Avatar>
                            <span className="text-xs font-medium">{b.user ? `${b.user.firstName} ${b.user.lastName}` : b.userId?.slice(0, 8)}</span>
                          </div>
                        </td>
                        <td className="py-2 pr-4"><Badge variant="outline" className="text-[10px] capitalize">{b.type}</Badge></td>
                        <td className="py-2 pr-4">
                          <Badge variant={b.isActive ? 'success' : 'secondary'}>{b.isActive ? 'Active' : 'Expired'}</Badge>
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground">{b.profileViewsGained || 0}</td>
                        <td className="py-2 pr-4 text-muted-foreground text-xs">{b.expiresAt ? formatDateTime(b.expiresAt) : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Filter */}
      <div className="flex items-center gap-3">
        <Select value={planFilter} onValueChange={(v) => { setPlanFilter(v); setPage(1) }}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Filter by plan" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('users.allPlans')}</SelectItem>
            <SelectItem value="free">{t('users.free')}</SelectItem>
            <SelectItem value="premium">{t('users.premium')}</SelectItem>
            <SelectItem value="gold">{t('users.gold')}</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{total} {t('nav.subscriptions')}</span>
      </div>

      {/* Subscriptions Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">{t('nav.subscriptions')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : subscriptions.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">{t('subscriptions.noSubscriptions')}</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-3 pr-4 font-medium">User</th>
                      <th className="pb-3 pr-4 font-medium">Plan</th>
                      <th className="pb-3 pr-4 font-medium">Status</th>
                      <th className="pb-3 pr-4 font-medium">Start</th>
                      <th className="pb-3 pr-4 font-medium">End</th>
                      <th className="pb-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {subscriptions.map((sub: any) => (
                      <tr key={sub.id} className="hover:bg-muted/50">
                        <td className="py-3 pr-4">
                          <div className="flex items-center gap-2">
                            <Avatar className="h-8 w-8">
                              <AvatarFallback className="text-xs bg-primary/10 text-primary">
                                {sub.user?.firstName?.[0] || '?'}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-medium text-sm">
                                {sub.user ? `${sub.user.firstName} ${sub.user.lastName}` : sub.userId?.slice(0, 8)}
                              </p>
                              <p className="text-[10px] text-muted-foreground">{sub.user?.email || ''}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 pr-4">{planBadge(sub.plan)}</td>
                        <td className="py-3 pr-4">{statusBadge(sub.status)}</td>
                        <td className="py-3 pr-4 text-muted-foreground text-xs">{sub.startDate ? formatDateTime(sub.startDate) : '-'}</td>
                        <td className="py-3 pr-4 text-muted-foreground text-xs">{sub.endDate ? formatDateTime(sub.endDate) : '-'}</td>
                        <td className="py-3 text-right">
                          <Button size="icon" variant="ghost" onClick={() => navigate(`/users/${sub.userId}`)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between border-t pt-4">
                  <p className="text-sm text-muted-foreground">{t('common.page')} {page} {t('common.of')} {totalPages}</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
