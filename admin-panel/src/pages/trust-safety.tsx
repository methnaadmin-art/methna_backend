import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trustSafetyApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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
import type { ContentFlag } from '@/types'
import { formatDateTime } from '@/lib/utils'
import { ChevronLeft, ChevronRight, Loader2, Shield, AlertTriangle, CheckCircle, Search } from 'lucide-react'

const flagTypeBadge = (type: string) => {
  const map: Record<string, { variant: any; label: string }> = {
    BAD_WORD: { variant: 'warning', label: 'Bad Word' },
    OFFENSIVE: { variant: 'destructive', label: 'Offensive' },
    SPAM: { variant: 'warning', label: 'Spam' },
    FAKE_PROFILE: { variant: 'destructive', label: 'Fake Profile' },
    INAPPROPRIATE_PHOTO: { variant: 'destructive', label: 'Inappropriate Photo' },
    HARASSMENT: { variant: 'destructive', label: 'Harassment' },
    SCAM: { variant: 'destructive', label: 'Scam' },
  }
  const info = map[type] || { variant: 'secondary', label: type }
  return <Badge variant={info.variant}>{info.label}</Badge>
}

const sourceBadge = (source: string) => {
  switch (source) {
    case 'AUTO_DETECTED': return <Badge variant="info">Auto</Badge>
    case 'USER_REPORT': return <Badge variant="secondary">User Report</Badge>
    case 'ADMIN_FLAG': return <Badge variant="outline">Admin</Badge>
    default: return <Badge variant="secondary">{source}</Badge>
  }
}

export default function TrustSafetyPage() {
  const { t } = useTranslation()
  const [flags, setFlags] = useState<ContentFlag[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  // Resolve dialog
  const [resolveDialog, setResolveDialog] = useState<{ open: boolean; flag: ContentFlag | null }>({
    open: false, flag: null,
  })
  const [resolveStatus, setResolveStatus] = useState('ACTION_TAKEN')
  const [reviewNote, setReviewNote] = useState('')

  // Suspicious detection
  const [detectUserId, setDetectUserId] = useState('')
  const [detectResult, setDetectResult] = useState<any>(null)
  const [detectLoading, setDetectLoading] = useState(false)

  const fetchFlags = async () => {
    setLoading(true)
    try {
      const { data } = await trustSafetyApi.getFlags(page, 20)
      setFlags(data.flags || data || [])
      setTotal(data.total || 0)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchFlags() }, [page])

  const handleResolve = async () => {
    if (!resolveDialog.flag) return
    try {
      await trustSafetyApi.resolveFlag(resolveDialog.flag.id, resolveStatus, reviewNote || undefined)
      setResolveDialog({ open: false, flag: null })
      setReviewNote('')
      fetchFlags()
    } catch (err) {
      console.error(err)
    }
  }

  const handleDetect = async () => {
    if (!detectUserId.trim()) return
    setDetectLoading(true)
    setDetectResult(null)
    try {
      const { data } = await trustSafetyApi.detectSuspicious(detectUserId.trim())
      setDetectResult(data)
    } catch (err: any) {
      setDetectResult({ error: err.response?.data?.message || 'Detection failed' })
    } finally {
      setDetectLoading(false)
    }
  }

  const totalPages = Math.ceil(total / 20)

  return (
    <div className="space-y-6">
      {/* Suspicious Behavior Detection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            {t('trustSafety.suspiciousDetection')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t('trustSafety.enterUserId')}
                value={detectUserId}
                onChange={(e) => setDetectUserId(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button onClick={handleDetect} disabled={detectLoading || !detectUserId.trim()}>
              {detectLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Shield className="h-4 w-4 mr-2" />}
              {t('trustSafety.analyze')}
            </Button>
          </div>

          {detectResult && (
            <div className="mt-4 rounded-lg border p-4">
              {detectResult.error ? (
                <p className="text-sm text-red-600">{detectResult.error}</p>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{t('trustSafety.suspicious')}:</span>
                    <Badge variant={detectResult.isSuspicious ? 'destructive' : 'success'}>
                      {detectResult.isSuspicious ? t('trustSafety.yes') : t('trustSafety.no')}
                    </Badge>
                  </div>
                  {detectResult.reasons?.length > 0 && (
                    <div>
                      <span className="text-sm font-medium">{t('trustSafety.reasons')}:</span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {detectResult.reasons.map((r: string, i: number) => (
                          <Badge key={i} variant="warning">{r}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {detectResult.trustScore != null && (
                    <p className="text-sm">{t('trustSafety.trustScore')}: <strong>{detectResult.trustScore}</strong></p>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Content Flags Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">{t('trustSafety.contentFlags')} ({total})</CardTitle>
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
                    <th className="pb-3 pe-4 font-medium">{t('trustSafety.type')}</th>
                    <th className="pb-3 pe-4 font-medium">{t('trustSafety.source')}</th>
                    <th className="pb-3 pe-4 font-medium">{t('trustSafety.entity')}</th>
                    <th className="pb-3 pe-4 font-medium">{t('trustSafety.content')}</th>
                    <th className="pb-3 pe-4 font-medium">{t('trustSafety.confidence')}</th>
                    <th className="pb-3 pe-4 font-medium">{t('trustSafety.date')}</th>
                    <th className="pb-3 font-medium text-end">{t('trustSafety.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {flags.map((flag) => (
                    <tr key={flag.id} className="hover:bg-muted/50">
                      <td className="py-3 pr-4">{flagTypeBadge(flag.type)}</td>
                      <td className="py-3 pr-4">{sourceBadge(flag.source)}</td>
                      <td className="py-3 pr-4">
                        <span className="text-xs text-muted-foreground">{flag.entityType}</span>
                      </td>
                      <td className="py-3 pr-4 max-w-[200px] truncate">
                        {flag.content || '-'}
                      </td>
                      <td className="py-3 pr-4">
                        {flag.confidenceScore != null ? (
                          <span className={flag.confidenceScore > 0.8 ? 'text-red-600 font-bold' : flag.confidenceScore > 0.5 ? 'text-amber-600' : ''}>
                            {(flag.confidenceScore * 100).toFixed(0)}%
                          </span>
                        ) : '-'}
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground whitespace-nowrap">
                        {formatDateTime(flag.createdAt)}
                      </td>
                      <td className="py-3 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1"
                          onClick={() => {
                            setResolveDialog({ open: true, flag })
                            setResolveStatus('ACTION_TAKEN')
                          }}
                        >
                          <CheckCircle className="h-3.5 w-3.5" /> {t('trustSafety.resolve')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {flags.length === 0 && (
                <p className="py-8 text-center text-muted-foreground">{t('trustSafety.noFlags')}</p>
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
            <DialogTitle>{t('trustSafety.resolveFlag')}</DialogTitle>
            <DialogDescription>
              Flag type: <strong>{resolveDialog.flag?.type}</strong> on {resolveDialog.flag?.entityType}
            </DialogDescription>
          </DialogHeader>
          {resolveDialog.flag?.content && (
            <div className="rounded-lg bg-muted p-3 text-sm">
              <p className="text-xs font-medium text-muted-foreground mb-1">Flagged content:</p>
              {resolveDialog.flag.content}
            </div>
          )}
          <Select value={resolveStatus} onValueChange={setResolveStatus}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ACTION_TAKEN">{t('trustSafety.actionTaken')}</SelectItem>
              <SelectItem value="REVIEWED">{t('trustSafety.reviewedNoAction')}</SelectItem>
              <SelectItem value="DISMISSED">{t('trustSafety.dismissed')}</SelectItem>
            </SelectContent>
          </Select>
          <Textarea
            placeholder={t('trustSafety.reviewNote')}
            value={reviewNote}
            onChange={(e) => setReviewNote(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveDialog({ open: false, flag: null })}>{t('common.cancel')}</Button>
            <Button onClick={handleResolve}>{t('common.submit')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
