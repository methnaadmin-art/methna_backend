import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { securityApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { EmailBlacklist } from '@/types'
import { formatDateTime } from '@/lib/utils'
import { Lock, Plus, Trash2, Loader2, ShieldAlert } from 'lucide-react'

export default function SecurityPage() {
  const { t } = useTranslation()
  const [blacklist, setBlacklist] = useState<EmailBlacklist[]>([])
  const [loading, setLoading] = useState(true)

  // Add dialog
  const [addDialog, setAddDialog] = useState(false)
  const [newDomain, setNewDomain] = useState('')
  const [newReason, setNewReason] = useState('')
  const [addLoading, setAddLoading] = useState(false)

  // Delete dialog
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; domain: string }>({
    open: false, domain: '',
  })

  const fetchBlacklist = async () => {
    setLoading(true)
    try {
      const { data } = await securityApi.getBlacklist()
      const list = data
      setBlacklist(Array.isArray(list) ? list : [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchBlacklist() }, [])

  const handleAdd = async () => {
    if (!newDomain.trim() || !newReason.trim()) return
    setAddLoading(true)
    try {
      await securityApi.addToBlacklist(newDomain.trim(), newReason.trim())
      setAddDialog(false)
      setNewDomain('')
      setNewReason('')
      fetchBlacklist()
    } catch (err) {
      console.error(err)
    } finally {
      setAddLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteDialog.domain) return
    try {
      await securityApi.removeFromBlacklist(deleteDialog.domain)
      setDeleteDialog({ open: false, domain: '' })
      fetchBlacklist()
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <div className="space-y-6">
      {/* Security Overview */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-lg bg-primary/10 p-3">
              <Lock className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('security.jwtExpiry')}</p>
              <p className="text-xl font-bold">15 min</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-lg bg-amber-50 p-3">
              <ShieldAlert className="h-6 w-6 text-amber-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('security.rateLimit')}</p>
              <p className="text-xl font-bold">100/min</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-lg bg-red-50 p-3">
              <ShieldAlert className="h-6 w-6 text-red-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('security.blacklistedDomains')}</p>
              <p className="text-xl font-bold">{blacklist.length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Email Blacklist */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-lg">{t('security.emailBlacklist')}</CardTitle>
          <Button size="sm" onClick={() => setAddDialog(true)} className="gap-1">
            <Plus className="h-4 w-4" /> {t('security.addDomain')}
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : blacklist.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              {t('security.noBlacklist')}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-3 pe-4 font-medium">{t('security.domain')}</th>
                    <th className="pb-3 pe-4 font-medium">{t('security.reason')}</th>
                    <th className="pb-3 pe-4 font-medium">{t('security.status')}</th>
                    <th className="pb-3 pe-4 font-medium">{t('security.added')}</th>
                    <th className="pb-3 font-medium text-end">{t('security.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {blacklist.map((item) => (
                    <tr key={item.id || item.domain} className="hover:bg-muted/50">
                      <td className="py-3 pr-4 font-mono font-medium">{item.domain}</td>
                      <td className="py-3 pr-4 text-muted-foreground">{item.reason}</td>
                      <td className="py-3 pr-4">
                        <Badge variant={item.isActive ? 'destructive' : 'secondary'}>
                          {item.isActive ? t('security.active') : t('security.inactive')}
                        </Badge>
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground whitespace-nowrap">
                        {formatDateTime(item.createdAt)}
                      </td>
                      <td className="py-3 text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-red-500 hover:text-red-600"
                          onClick={() => setDeleteDialog({ open: true, domain: item.domain })}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Dialog */}
      <Dialog open={addDialog} onOpenChange={setAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('security.addToBlacklist')}</DialogTitle>
            <DialogDescription>
              {t('security.addBlacklistDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">{t('security.domain')}</label>
              <Input
                placeholder={t('security.domainPlaceholder')}
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium">{t('security.reason')}</label>
              <Input
                placeholder={t('security.reasonPlaceholder')}
                value={newReason}
                onChange={(e) => setNewReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialog(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleAdd} disabled={addLoading || !newDomain.trim() || !newReason.trim()}>
              {addLoading ? <Loader2 className="h-4 w-4 animate-spin me-2" /> : null}
              {t('security.addDomain')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog({ ...deleteDialog, open })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('security.removeFromBlacklist')}</DialogTitle>
            <DialogDescription>
              <strong className="font-mono">{deleteDialog.domain}</strong> {t('security.removeConfirm')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog({ open: false, domain: '' })}>{t('common.cancel')}</Button>
            <Button variant="destructive" onClick={handleDelete}>{t('common.remove')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
