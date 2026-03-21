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
  Heart,
  HeartOff,
  Sparkles,
  MessageCircleHeart,
  ChevronLeft,
  ChevronRight,
  Eye,
  ArrowRight,
} from 'lucide-react'

const typeConfig: Record<string, { label: string; color: string; icon: any }> = {
  like: { label: 'Like', color: 'bg-pink-100 text-pink-700', icon: Heart },
  super_like: { label: 'Super Like', color: 'bg-purple-100 text-purple-700', icon: Sparkles },
  compliment: { label: 'Compliment', color: 'bg-amber-100 text-amber-700', icon: MessageCircleHeart },
  pass: { label: 'Pass', color: 'bg-gray-100 text-gray-700', icon: HeartOff },
}

export default function ActivityPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [swipes, setSwipes] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [limit] = useState(30)
  const [typeFilter, setTypeFilter] = useState('all')
  const [loading, setLoading] = useState(true)

  const fetchSwipes = async () => {
    setLoading(true)
    try {
      const type = typeFilter === 'all' ? undefined : typeFilter
      const { data } = await adminApi.getSwipes(page, limit, type)
      setSwipes(data.swipes || data || [])
      setTotal(data.total || 0)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchSwipes() }, [page, typeFilter])

  const totalPages = Math.ceil(total / limit)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('activity.title')}</h1>
        <p className="text-muted-foreground">{t('activity.subtitle')}</p>
      </div>

      {/* Quick Stats */}
      <div className="grid gap-4 sm:grid-cols-4">
        {Object.entries(typeConfig).map(([key, cfg]) => {
          const Icon = cfg.icon
          return (
            <Card key={key} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => { setTypeFilter(key); setPage(1) }}>
              <CardContent className="flex items-center gap-3 p-4">
                <div className={`rounded-lg p-2.5 ${cfg.color}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{cfg.label}s</p>
                  <p className="text-lg font-bold">{typeFilter === key ? total : '—'}</p>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3">
        <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(1) }}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filter by type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('common.all')}</SelectItem>
            <SelectItem value="like">Likes</SelectItem>
            <SelectItem value="super_like">Super Likes</SelectItem>
            <SelectItem value="compliment">Compliments</SelectItem>
            <SelectItem value="pass">Passes</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{total} {t('common.total')}</span>
      </div>

      {/* Activity List */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">{t('activity.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : swipes.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">{t('common.noData')}</p>
          ) : (
            <>
              <div className="space-y-2">
                {swipes.map((swipe: any) => {
                  const cfg = typeConfig[swipe.type] || typeConfig.like
                  const Icon = cfg.icon
                  return (
                    <div key={swipe.id} className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors">
                      {/* Liker */}
                      <div
                        className="flex items-center gap-2 min-w-[140px] cursor-pointer"
                        onClick={() => navigate(`/users/${swipe.likerId}`)}
                      >
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="text-xs bg-pink-50 text-pink-600">
                            {swipe.liker?.firstName?.[0] || '?'}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-sm font-medium truncate">
                          {swipe.liker ? `${swipe.liker.firstName} ${swipe.liker.lastName}` : swipe.likerId?.slice(0, 8)}
                        </span>
                      </div>

                      {/* Action */}
                      <div className="flex items-center gap-2">
                        <div className={`flex items-center gap-1 rounded-full px-2.5 py-1 ${cfg.color}`}>
                          <Icon className="h-3.5 w-3.5" />
                          <span className="text-xs font-medium">{cfg.label}</span>
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </div>

                      {/* Liked */}
                      <div
                        className="flex items-center gap-2 min-w-[140px] cursor-pointer"
                        onClick={() => navigate(`/users/${swipe.likedId}`)}
                      >
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="text-xs bg-purple-50 text-purple-600">
                            {swipe.liked?.firstName?.[0] || '?'}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-sm font-medium truncate">
                          {swipe.liked ? `${swipe.liked.firstName} ${swipe.liked.lastName}` : swipe.likedId?.slice(0, 8)}
                        </span>
                      </div>

                      {/* Compliment message */}
                      {swipe.complimentMessage && (
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-muted-foreground italic truncate">"{swipe.complimentMessage}"</p>
                        </div>
                      )}

                      {/* Timestamp */}
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap ml-auto">
                        {formatDateTime(swipe.createdAt)}
                      </span>
                    </div>
                  )
                })}
              </div>

              {/* Pagination */}
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
