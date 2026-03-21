import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { matchesApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import type { Match } from '@/types'
import { formatDateTime } from '@/lib/utils'
import { Loader2, Heart, Unlink, Eye, Sparkles } from 'lucide-react'

export default function MatchesPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)
  const [discover, setDiscover] = useState<any>(null)

  const [unmatchDialog, setUnmatchDialog] = useState<{ open: boolean; match: Match | null }>({
    open: false, match: null,
  })

  useEffect(() => {
    const load = async () => {
      try {
        const [matchRes, discoverRes] = await Promise.allSettled([
          matchesApi.getAll(),
          matchesApi.getDiscover(),
        ])
        if (matchRes.status === 'fulfilled') {
          const d = matchRes.value.data
          setMatches(Array.isArray(d) ? d : d?.matches || [])
        }
        if (discoverRes.status === 'fulfilled') {
          setDiscover(discoverRes.value.data)
        }
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const handleUnmatch = async () => {
    if (!unmatchDialog.match) return
    try {
      await matchesApi.unmatch(unmatchDialog.match.id)
      setMatches(prev => prev.filter(m => m.id !== unmatchDialog.match!.id))
      setUnmatchDialog({ open: false, match: null })
    } catch (err) {
      console.error(err)
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('nav.matches')}</h1>
        <p className="text-muted-foreground">{t('matching.subtitle')}</p>
      </div>

      {/* Discovery Stats */}
      {discover && (
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { label: 'Nearby Users', count: discover.nearby?.length ?? discover.nearbyCount ?? 0, icon: Sparkles, color: 'bg-blue-50 text-blue-500' },
            { label: 'Compatible', count: discover.compatible?.length ?? discover.compatibleCount ?? 0, icon: Heart, color: 'bg-pink-50 text-pink-500' },
            { label: 'New Users', count: discover.new?.length ?? discover.newCount ?? 0, icon: Sparkles, color: 'bg-emerald-50 text-emerald-500' },
          ].map(({ label, count, icon: Icon, color }) => (
            <Card key={label}>
              <CardContent className="flex items-center gap-4 p-6">
                <div className={`rounded-lg p-3 ${color}`}>
                  <Icon className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{label}</p>
                  <p className="text-2xl font-bold">{count}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Matches List */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Heart className="h-5 w-5 text-pink-500" />
            {t('nav.matches')} ({matches.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {matches.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">{t('common.noData')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-3 pr-4 font-medium">User 1</th>
                    <th className="pb-3 pr-4 font-medium">User 2</th>
                    <th className="pb-3 pr-4 font-medium">Status</th>
                    <th className="pb-3 pr-4 font-medium">Matched At</th>
                    <th className="pb-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {matches.map((match) => (
                    <tr key={match.id} className="hover:bg-muted/50">
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="text-xs bg-pink-50 text-pink-600">
                              {match.user1?.firstName?.[0] || '?'}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium text-sm">
                            {match.user1 ? `${match.user1.firstName} ${match.user1.lastName}` : match.user1Id?.slice(0, 8)}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="text-xs bg-purple-50 text-purple-600">
                              {match.user2?.firstName?.[0] || '?'}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium text-sm">
                            {match.user2 ? `${match.user2.firstName} ${match.user2.lastName}` : match.user2Id?.slice(0, 8)}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <Badge variant={match.isActive ? 'success' : 'secondary'}>
                          {match.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground whitespace-nowrap">
                        {formatDateTime(match.matchedAt)}
                      </td>
                      <td className="py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {match.user1?.id && (
                            <Button size="icon" variant="ghost" onClick={() => navigate(`/users/${match.user1!.id}`)}>
                              <Eye className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-red-500 hover:text-red-600"
                            onClick={() => setUnmatchDialog({ open: true, match })}
                          >
                            <Unlink className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Unmatch Dialog */}
      <Dialog open={unmatchDialog.open} onOpenChange={(open) => setUnmatchDialog({ ...unmatchDialog, open })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('matches.unmatch')}</DialogTitle>
            <DialogDescription>
              {t('matches.unmatchConfirm')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnmatchDialog({ open: false, match: null })}>{t('common.cancel')}</Button>
            <Button variant="destructive" onClick={handleUnmatch}>{t('matches.unmatch')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
