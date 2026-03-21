import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { adminApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { formatDateTime } from '@/lib/utils'
import {
  Loader2,
  Headphones,
  MessageSquare,
  Clock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Send,
} from 'lucide-react'

const statusConfig: Record<string, { label: string; variant: any; icon: any }> = {
  open: { label: 'Open', variant: 'destructive', icon: Clock },
  in_progress: { label: 'In Progress', variant: 'warning', icon: MessageSquare },
  resolved: { label: 'Resolved', variant: 'success', icon: CheckCircle2 },
  closed: { label: 'Closed', variant: 'secondary', icon: CheckCircle2 },
}

export default function SupportPage() {
  const { t } = useTranslation()
  const [tickets, setTickets] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [limit] = useState(20)
  const [statusFilter, setStatusFilter] = useState('all')
  const [loading, setLoading] = useState(true)

  const [replyDialog, setReplyDialog] = useState<{ open: boolean; ticket: any }>({ open: false, ticket: null })
  const [replyText, setReplyText] = useState('')
  const [replyStatus, setReplyStatus] = useState('resolved')
  const [replyLoading, setReplyLoading] = useState(false)

  const fetchTickets = async () => {
    setLoading(true)
    try {
      const status = statusFilter === 'all' ? undefined : statusFilter
      const { data } = await adminApi.getTickets(page, limit, status)
      setTickets(data.tickets || data || [])
      setTotal(data.total || 0)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchTickets() }, [page, statusFilter])

  const handleReply = async () => {
    if (!replyDialog.ticket || !replyText.trim()) return
    setReplyLoading(true)
    try {
      await adminApi.replyToTicket(replyDialog.ticket.id, replyText, replyStatus)
      setReplyDialog({ open: false, ticket: null })
      setReplyText('')
      fetchTickets()
    } catch (err) {
      console.error(err)
    } finally {
      setReplyLoading(false)
    }
  }

  const totalPages = Math.ceil(total / limit)

  // Count stats
  const openCount = tickets.filter(t => t.status === 'open').length
  const inProgressCount = tickets.filter(t => t.status === 'in_progress').length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('support.title')}</h1>
        <p className="text-muted-foreground">{t('support.subtitle')}</p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-lg bg-blue-50 p-3">
              <Headphones className="h-6 w-6 text-blue-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('support.totalTickets')}</p>
              <p className="text-2xl font-bold">{total}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-lg bg-red-50 p-3">
              <Clock className="h-6 w-6 text-red-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('support.open')}</p>
              <p className="text-2xl font-bold">{openCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-lg bg-amber-50 p-3">
              <MessageSquare className="h-6 w-6 text-amber-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('support.inProgress')}</p>
              <p className="text-2xl font-bold">{inProgressCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-lg bg-emerald-50 p-3">
              <CheckCircle2 className="h-6 w-6 text-emerald-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('reports.resolved')}</p>
              <p className="text-2xl font-bold">{total - openCount - inProgressCount}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter */}
      <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1) }}>
        <SelectTrigger className="w-48">
          <SelectValue placeholder="Filter by status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('support.allTickets')}</SelectItem>
          <SelectItem value="open">{t('support.open')}</SelectItem>
          <SelectItem value="in_progress">{t('support.inProgress')}</SelectItem>
          <SelectItem value="resolved">{t('reports.resolved')}</SelectItem>
          <SelectItem value="closed">{t('support.closed')}</SelectItem>
        </SelectContent>
      </Select>

      {/* Tickets List */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">{t('nav.supportTickets')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : tickets.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">{t('support.noTickets')}</p>
          ) : (
            <>
              <div className="space-y-3">
                {tickets.map((ticket: any) => {
                  const cfg = statusConfig[ticket.status] || statusConfig.open
                  return (
                    <div key={ticket.id} className="rounded-lg border p-4 hover:bg-muted/50 transition-colors">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant={cfg.variant}>{cfg.label}</Badge>
                            <span className="text-sm font-semibold">{ticket.subject}</span>
                            {ticket.priority && (
                              <Badge variant={ticket.priority === 'urgent' ? 'destructive' : ticket.priority === 'high' ? 'warning' : 'outline'} className="text-[10px]">
                                {ticket.priority}
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground line-clamp-2">{ticket.message}</p>

                          <div className="flex items-center gap-4 mt-2">
                            <div className="flex items-center gap-1.5">
                              <Avatar className="h-5 w-5">
                                <AvatarFallback className="text-[8px] bg-primary/10 text-primary">
                                  {ticket.user?.firstName?.[0] || '?'}
                                </AvatarFallback>
                              </Avatar>
                              <span className="text-xs text-muted-foreground">
                                {ticket.user ? `${ticket.user.firstName} ${ticket.user.lastName}` : ticket.userId?.slice(0, 8)}
                              </span>
                            </div>
                            <span className="text-[10px] text-muted-foreground">{formatDateTime(ticket.createdAt)}</span>
                          </div>

                          {ticket.adminReply && (
                            <div className="mt-3 rounded-lg bg-emerald-50 border border-emerald-200 p-3">
                              <p className="text-xs font-medium text-emerald-700 mb-1">Admin Reply:</p>
                              <p className="text-sm text-emerald-900">{ticket.adminReply}</p>
                              {ticket.repliedAt && (
                                <p className="text-[10px] text-emerald-600 mt-1">{formatDateTime(ticket.repliedAt)}</p>
                              )}
                            </div>
                          )}
                        </div>

                        <Button
                          size="sm"
                          variant={ticket.adminReply ? 'outline' : 'default'}
                          className="gap-1 shrink-0"
                          onClick={() => {
                            setReplyDialog({ open: true, ticket })
                            setReplyText(ticket.adminReply || '')
                            setReplyStatus(ticket.status === 'open' ? 'resolved' : ticket.status)
                          }}
                        >
                          <Send className="h-3.5 w-3.5" />
                          {ticket.adminReply ? t('support.update') : t('support.reply')}
                        </Button>
                      </div>
                    </div>
                  )
                })}
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

      {/* Reply Dialog */}
      <Dialog open={replyDialog.open} onOpenChange={(open) => setReplyDialog({ ...replyDialog, open })}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('support.replyToTicket')}</DialogTitle>
            <DialogDescription>
              <strong>{replyDialog.ticket?.subject}</strong>
              <br />
              <span className="text-muted-foreground">{replyDialog.ticket?.message}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium">{t('support.yourReply')}</label>
              <textarea
                className="w-full rounded-md border px-3 py-2 text-sm min-h-[120px] resize-none focus:outline-none focus:ring-2 focus:ring-primary"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Write your reply to help the user..."
              />
            </div>
            <div>
              <label className="text-xs font-medium">{t('users.status')}</label>
              <Select value={replyStatus} onValueChange={setReplyStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="in_progress">{t('support.inProgress')}</SelectItem>
                  <SelectItem value="resolved">{t('reports.resolved')}</SelectItem>
                  <SelectItem value="closed">{t('support.closed')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReplyDialog({ open: false, ticket: null })}>{t('common.cancel')}</Button>
            <Button onClick={handleReply} disabled={replyLoading || !replyText.trim()} className="gap-1">
              {replyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {t('support.sendReply')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
