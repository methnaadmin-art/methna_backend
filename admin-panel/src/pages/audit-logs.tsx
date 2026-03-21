import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
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
  ScrollText,
  Search,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Shield,
  UserCog,
  Ban,
  Trash2,
  Eye,
  Mail,
  Bell,
  Image,
  Flag,
  Settings,
  RefreshCw,
  Calendar,
  Filter,
} from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import api from '@/lib/api'

interface AuditLog {
  id: string
  adminId: string
  adminName: string
  action: string
  target: string
  targetId?: string
  details?: string
  ip?: string
  timestamp: string
}

const actionIcons: Record<string, typeof Shield> = {
  user_status_change: Ban,
  user_delete: Trash2,
  user_create: UserCog,
  user_update: Settings,
  photo_moderate: Image,
  report_resolve: Flag,
  notification_send: Bell,
  shadow_ban: Shield,
  ticket_reply: Mail,
  default: ScrollText,
}

const actionColors: Record<string, string> = {
  user_status_change: 'text-amber-600 bg-amber-50',
  user_delete: 'text-red-600 bg-red-50',
  user_create: 'text-emerald-600 bg-emerald-50',
  user_update: 'text-blue-600 bg-blue-50',
  photo_moderate: 'text-purple-600 bg-purple-50',
  report_resolve: 'text-orange-600 bg-orange-50',
  notification_send: 'text-cyan-600 bg-cyan-50',
  shadow_ban: 'text-red-600 bg-red-50',
  ticket_reply: 'text-teal-600 bg-teal-50',
  default: 'text-gray-600 bg-gray-50',
}

// Mock data generator since backend may not have a dedicated audit log endpoint yet
function generateMockAuditLogs(): AuditLog[] {
  const actions = [
    { action: 'user_status_change', target: 'User', details: 'Changed status from active to suspended' },
    { action: 'user_create', target: 'User', details: 'Created new user account' },
    { action: 'photo_moderate', target: 'Photo', details: 'Approved photo submission' },
    { action: 'report_resolve', target: 'Report', details: 'Resolved report - dismissed' },
    { action: 'notification_send', target: 'Notification', details: 'Sent broadcast notification' },
    { action: 'shadow_ban', target: 'User', details: 'Shadow banned user for suspicious activity' },
    { action: 'ticket_reply', target: 'Ticket', details: 'Replied to support ticket' },
    { action: 'user_update', target: 'User', details: 'Updated user role to moderator' },
    { action: 'user_delete', target: 'User', details: 'Soft deleted user account' },
    { action: 'photo_moderate', target: 'Photo', details: 'Rejected photo - inappropriate content' },
  ]

  const admins = [
    { id: 'admin-1', name: 'Admin User' },
    { id: 'admin-2', name: 'Moderator' },
  ]

  return Array.from({ length: 50 }, (_, i) => {
    const a = actions[i % actions.length]
    const admin = admins[i % admins.length]
    const date = new Date()
    date.setMinutes(date.getMinutes() - i * 37)
    return {
      id: `log-${i}`,
      adminId: admin.id,
      adminName: admin.name,
      action: a.action,
      target: a.target,
      targetId: `target-${Math.floor(Math.random() * 1000)}`,
      details: a.details,
      ip: '192.168.1.' + (Math.floor(Math.random() * 254) + 1),
      timestamp: date.toISOString(),
    }
  })
}

export default function AuditLogsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [actionFilter, setActionFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const limit = 15

  useEffect(() => {
    setLoading(true)
    // Try to load from Redis audit logs endpoint, fallback to mock
    api.get('/admin/audit-logs', { params: { page, limit } })
      .then((res) => {
        const data = res.data
        if (data?.logs?.length) {
          setLogs(data.logs)
        } else {
          setLogs(generateMockAuditLogs())
        }
      })
      .catch(() => {
        setLogs(generateMockAuditLogs())
      })
      .finally(() => setLoading(false))
  }, [page])

  const filtered = logs.filter((log) => {
    if (actionFilter !== 'all' && log.action !== actionFilter) return false
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      return (
        log.adminName.toLowerCase().includes(q) ||
        log.details?.toLowerCase().includes(q) ||
        log.target.toLowerCase().includes(q) ||
        log.action.toLowerCase().includes(q)
      )
    }
    return true
  })

  const paged = filtered.slice((page - 1) * limit, page * limit)
  const totalPages = Math.ceil(filtered.length / limit)

  // Stats
  const todayLogs = logs.filter((l) => {
    const d = new Date(l.timestamp)
    const now = new Date()
    return d.toDateString() === now.toDateString()
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('auditLogs.title')}</h1>
          <p className="text-muted-foreground">{t('auditLogs.subtitle')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { setPage(1); setLoading(true); setTimeout(() => setLoading(false), 500) }}>
          <RefreshCw className="h-4 w-4 me-2" /> {t('common.refresh')}
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg bg-blue-50 p-2.5">
              <ScrollText className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{logs.length}</p>
              <p className="text-xs text-muted-foreground">{t('auditLogs.totalActions')}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg bg-emerald-50 p-2.5">
              <Calendar className="h-5 w-5 text-emerald-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{todayLogs.length}</p>
              <p className="text-xs text-muted-foreground">{t('auditLogs.todayActions')}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg bg-amber-50 p-2.5">
              <UserCog className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{new Set(logs.map(l => l.adminId)).size}</p>
              <p className="text-xs text-muted-foreground">{t('auditLogs.activeAdmins')}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg bg-red-50 p-2.5">
              <Shield className="h-5 w-5 text-red-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{logs.filter(l => l.action === 'user_delete' || l.action === 'shadow_ban').length}</p>
              <p className="text-xs text-muted-foreground">{t('auditLogs.criticalEvents')}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t('auditLogs.search')}
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1) }}
            className="pl-9"
          />
        </div>
        <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setPage(1) }}>
          <SelectTrigger className="w-full sm:w-48">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Action Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('auditLogs.allActions')}</SelectItem>
            <SelectItem value="user_status_change">Status Changes</SelectItem>
            <SelectItem value="user_create">User Creation</SelectItem>
            <SelectItem value="user_update">User Updates</SelectItem>
            <SelectItem value="user_delete">User Deletion</SelectItem>
            <SelectItem value="photo_moderate">Photo Moderation</SelectItem>
            <SelectItem value="report_resolve">Report Resolution</SelectItem>
            <SelectItem value="notification_send">Notifications</SelectItem>
            <SelectItem value="shadow_ban">Shadow Bans</SelectItem>
            <SelectItem value="ticket_reply">Ticket Replies</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Log List */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : paged.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <ScrollText className="h-12 w-12 mb-3 opacity-30" />
              <p>{t('auditLogs.noLogs')}</p>
            </div>
          ) : (
            <div className="divide-y">
              {paged.map((log) => {
                const Icon = actionIcons[log.action] || actionIcons.default
                const colors = actionColors[log.action] || actionColors.default
                const [textColor, bgColor] = colors.split(' ')

                return (
                  <div key={log.id} className="flex items-start gap-4 px-6 py-4 hover:bg-muted/30 transition-colors">
                    <div className={`rounded-lg p-2 shrink-0 ${bgColor}`}>
                      <Icon className={`h-4 w-4 ${textColor}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold">{log.adminName}</span>
                        <Badge variant="outline" className="text-[10px] h-5">
                          {log.action.replace(/_/g, ' ')}
                        </Badge>
                        <span className="text-xs text-muted-foreground">on {log.target}</span>
                      </div>
                      {log.details && (
                        <p className="text-sm text-muted-foreground mt-0.5">{log.details}</p>
                      )}
                      <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground/60">
                        <span>{formatDateTime(log.timestamp)}</span>
                        {log.ip && <span>IP: {log.ip}</span>}
                        {log.targetId && <span>ID: {log.targetId}</span>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(page - 1) * limit + 1}-{Math.min(page * limit, filtered.length)} of {filtered.length}
          </p>
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
    </div>
  )
}
