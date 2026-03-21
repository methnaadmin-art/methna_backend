import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { adminApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
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
import type { Report, ReportStatus } from '@/types'
import { formatDateTime } from '@/lib/utils'
import { ChevronLeft, ChevronRight, Loader2, CheckCircle, XCircle, Eye } from 'lucide-react'

const statusBadge = (status: string) => {
  switch (status) {
    case 'PENDING': return <Badge variant="warning">Pending</Badge>
    case 'REVIEWED': return <Badge variant="info">Reviewed</Badge>
    case 'RESOLVED': return <Badge variant="success">Resolved</Badge>
    case 'DISMISSED': return <Badge variant="secondary">Dismissed</Badge>
    default: return <Badge>{status}</Badge>
  }
}

const reasonBadge = (reason: string) => {
  switch (reason) {
    case 'FAKE_PROFILE': return <Badge variant="destructive">Fake Profile</Badge>
    case 'HARASSMENT': return <Badge variant="destructive">Harassment</Badge>
    case 'SCAM': return <Badge variant="destructive">Scam</Badge>
    case 'SPAM': return <Badge variant="warning">Spam</Badge>
    case 'INAPPROPRIATE_CONTENT': return <Badge variant="warning">Inappropriate</Badge>
    default: return <Badge variant="secondary">{reason}</Badge>
  }
}

export default function ReportsPage() {
  const { t } = useTranslation()
  const [reports, setReports] = useState<Report[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('all')
  const [loading, setLoading] = useState(true)

  const [resolveDialog, setResolveDialog] = useState<{ open: boolean; report: Report | null }>({
    open: false, report: null,
  })
  const [resolveStatus, setResolveStatus] = useState('RESOLVED')
  const [moderatorNote, setModeratorNote] = useState('')

  const fetchReports = async () => {
    setLoading(true)
    try {
      const status = statusFilter === 'all' ? undefined : statusFilter
      const res = await adminApi.getReports(page, 20, status)
      const payload = res.data
      const list = Array.isArray(payload) ? payload : (payload?.reports || [])
      setReports(list)
      setTotal(Array.isArray(payload) ? list.length : (payload?.total || list.length))
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchReports() }, [page, statusFilter])

  const handleResolve = async () => {
    if (!resolveDialog.report) return
    try {
      await adminApi.resolveReport(resolveDialog.report.id, resolveStatus, moderatorNote || undefined)
      setResolveDialog({ open: false, report: null })
      setModeratorNote('')
      fetchReports()
    } catch (err) {
      console.error(err)
    }
  }

  const totalPages = Math.ceil(total / 20)

  return (
    <div className="space-y-6">
      {/* Filter */}
      <div className="flex items-center gap-4">
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1) }}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Filter status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('reports.allReports')}</SelectItem>
            <SelectItem value="PENDING">{t('reports.pending')}</SelectItem>
            <SelectItem value="REVIEWED">{t('reports.reviewed')}</SelectItem>
            <SelectItem value="RESOLVED">{t('reports.resolved')}</SelectItem>
            <SelectItem value="DISMISSED">{t('reports.dismissed')}</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{total} {t('nav.reports')}</span>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">{t('nav.reports')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-3 pe-4 font-medium">{t('reports.reporter')}</th>
                    <th className="pb-3 pe-4 font-medium">{t('reports.reported')}</th>
                    <th className="pb-3 pe-4 font-medium">{t('reports.reason')}</th>
                    <th className="pb-3 pe-4 font-medium">{t('users.status')}</th>
                    <th className="pb-3 pe-4 font-medium">{t('reports.date')}</th>
                    <th className="pb-3 font-medium text-end">{t('users.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {reports.map((report) => (
                    <tr key={report.id} className="hover:bg-muted/50">
                      <td className="py-3 pr-4">
                        <p className="font-medium">{report.reporter?.firstName} {report.reporter?.lastName}</p>
                        <p className="text-xs text-muted-foreground">{report.reporter?.email}</p>
                      </td>
                      <td className="py-3 pr-4">
                        <p className="font-medium">{report.reported?.firstName} {report.reported?.lastName}</p>
                        <p className="text-xs text-muted-foreground">{report.reported?.email}</p>
                      </td>
                      <td className="py-3 pr-4">{reasonBadge(report.reason)}</td>
                      <td className="py-3 pr-4">{statusBadge(report.status)}</td>
                      <td className="py-3 pr-4 text-muted-foreground whitespace-nowrap">
                        {formatDateTime(report.createdAt)}
                      </td>
                      <td className="py-3 text-right">
                        {report.status === 'PENDING' ? (
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1 text-emerald-600"
                              onClick={() => {
                                setResolveDialog({ open: true, report })
                                setResolveStatus('RESOLVED')
                              }}
                            >
                              <CheckCircle className="h-3.5 w-3.5" /> {t('reports.resolve')}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1"
                              onClick={() => {
                                setResolveDialog({ open: true, report })
                                setResolveStatus('DISMISSED')
                              }}
                            >
                              <XCircle className="h-3.5 w-3.5" /> {t('reports.dismiss')}
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setResolveDialog({ open: true, report })}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {reports.length === 0 && (
                <p className="py-8 text-center text-muted-foreground">{t('reports.noReports')}</p>
              )}
            </div>
          )}

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
        </CardContent>
      </Card>

      {/* Resolve Dialog */}
      <Dialog open={resolveDialog.open} onOpenChange={(open) => setResolveDialog({ ...resolveDialog, open })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('reports.resolve')}</DialogTitle>
            <DialogDescription>
              Report against <strong>{resolveDialog.report?.reported?.firstName} {resolveDialog.report?.reported?.lastName}</strong> for <strong>{resolveDialog.report?.reason}</strong>
            </DialogDescription>
          </DialogHeader>
          {resolveDialog.report?.details && (
            <div className="rounded-lg bg-muted p-3 text-sm">
              <p className="text-xs font-medium text-muted-foreground mb-1">Details:</p>
              {resolveDialog.report.details}
            </div>
          )}
          <Select value={resolveStatus} onValueChange={setResolveStatus}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="RESOLVED">{t('reports.resolved')}</SelectItem>
              <SelectItem value="DISMISSED">{t('reports.dismissed')}</SelectItem>
              <SelectItem value="REVIEWED">{t('reports.reviewed')}</SelectItem>
            </SelectContent>
          </Select>
          <Textarea
            placeholder={t('reports.moderatorNote')}
            value={moderatorNote}
            onChange={(e) => setModeratorNote(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveDialog({ open: false, report: null })}>{t('common.cancel')}</Button>
            <Button onClick={handleResolve}>{t('common.submit')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
