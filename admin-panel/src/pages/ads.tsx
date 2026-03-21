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
import { formatDateTime } from '@/lib/utils'
import {
  Loader2,
  Plus,
  Pencil,
  Trash2,
  Megaphone,
  Eye,
  MousePointerClick,
  Image,
} from 'lucide-react'

interface Ad {
  id: string
  title: string
  description?: string
  imageUrl?: string
  buttonText?: string
  buttonLink?: string
  placement: string
  status: string
  startDate?: string
  endDate?: string
  impressions: number
  clicks: number
  targetGender?: string
  targetPlan?: string
  createdAt: string
}

const emptyForm = {
  title: '', description: '', imageUrl: '', buttonText: '', buttonLink: '',
  placement: 'banner', status: 'draft', targetGender: '', targetPlan: '',
}

export default function AdsPage() {
  const { t } = useTranslation()
  const [ads, setAds] = useState<Ad[]>([])
  const [loading, setLoading] = useState(true)

  const [formDialog, setFormDialog] = useState(false)
  const [editingAd, setEditingAd] = useState<Ad | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [formLoading, setFormLoading] = useState(false)

  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; ad: Ad | null }>({ open: false, ad: null })

  const fetchAds = async () => {
    setLoading(true)
    try {
      const { data } = await adminApi.getAds()
      setAds(Array.isArray(data) ? data : data?.ads || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchAds() }, [])

  const openCreate = () => {
    setEditingAd(null)
    setForm(emptyForm)
    setFormDialog(true)
  }

  const openEdit = (ad: Ad) => {
    setEditingAd(ad)
    setForm({
      title: ad.title || '',
      description: ad.description || '',
      imageUrl: ad.imageUrl || '',
      buttonText: ad.buttonText || '',
      buttonLink: ad.buttonLink || '',
      placement: ad.placement || 'banner',
      status: ad.status || 'draft',
      targetGender: ad.targetGender || '',
      targetPlan: ad.targetPlan || '',
    })
    setFormDialog(true)
  }

  const handleSave = async () => {
    setFormLoading(true)
    try {
      if (editingAd) {
        await adminApi.updateAd(editingAd.id, form)
      } else {
        await adminApi.createAd(form)
      }
      setFormDialog(false)
      fetchAds()
    } catch (err) {
      console.error(err)
    } finally {
      setFormLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteDialog.ad) return
    try {
      await adminApi.deleteAd(deleteDialog.ad.id)
      setDeleteDialog({ open: false, ad: null })
      fetchAds()
    } catch (err) {
      console.error(err)
    }
  }

  const statusBadge = (status: string) => {
    switch (status) {
      case 'active': return <Badge variant="success">Active</Badge>
      case 'paused': return <Badge variant="warning">Paused</Badge>
      case 'expired': return <Badge variant="secondary">Expired</Badge>
      default: return <Badge variant="outline">Draft</Badge>
    }
  }

  const totalImpressions = ads.reduce((a, b) => a + (b.impressions || 0), 0)
  const totalClicks = ads.reduce((a, b) => a + (b.clicks || 0), 0)
  const avgCtr = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : '0'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('ads.title')}</h1>
          <p className="text-muted-foreground">{t('ads.subtitle')}</p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" /> {t('ads.createAd')}
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-lg bg-blue-50 p-3"><Megaphone className="h-6 w-6 text-blue-500" /></div>
            <div>
              <p className="text-sm text-muted-foreground">{t('ads.totalAds')}</p>
              <p className="text-2xl font-bold">{ads.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-lg bg-emerald-50 p-3"><Eye className="h-6 w-6 text-emerald-500" /></div>
            <div>
              <p className="text-sm text-muted-foreground">{t('ads.totalImpressions')}</p>
              <p className="text-2xl font-bold">{totalImpressions.toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-lg bg-purple-50 p-3"><MousePointerClick className="h-6 w-6 text-purple-500" /></div>
            <div>
              <p className="text-sm text-muted-foreground">{t('ads.totalClicks')}</p>
              <p className="text-2xl font-bold">{totalClicks.toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-lg bg-amber-50 p-3"><Image className="h-6 w-6 text-amber-500" /></div>
            <div>
              <p className="text-sm text-muted-foreground">{t('ads.avgCtr')}</p>
              <p className="text-2xl font-bold">{avgCtr}%</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Ads List */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">{t('ads.allAds')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : ads.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">{t('ads.noAds')}</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {ads.map((ad) => (
                <div key={ad.id} className="rounded-lg border overflow-hidden hover:shadow-md transition-shadow">
                  {/* Image preview */}
                  {ad.imageUrl ? (
                    <div className="h-40 bg-muted">
                      <img src={ad.imageUrl} alt={ad.title} className="h-full w-full object-cover" />
                    </div>
                  ) : (
                    <div className="h-40 bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center">
                      <Megaphone className="h-12 w-12 text-muted-foreground/30" />
                    </div>
                  )}

                  <div className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-semibold text-sm">{ad.title}</h3>
                      {statusBadge(ad.status)}
                    </div>

                    {ad.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{ad.description}</p>
                    )}

                    {ad.buttonText && (
                      <div className="mb-2">
                        <span className="inline-block rounded bg-primary px-3 py-1 text-xs text-white font-medium">
                          {ad.buttonText}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground mb-3">
                      <span className="capitalize">{ad.placement}</span>
                      <span>{ad.impressions} views</span>
                      <span>{ad.clicks} clicks</span>
                      {ad.impressions > 0 && (
                        <span>{((ad.clicks / ad.impressions) * 100).toFixed(1)}% CTR</span>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => openEdit(ad)}>
                        <Pencil className="h-3.5 w-3.5" /> {t('ads.edit')}
                      </Button>
                      <Button size="sm" variant="outline" className="text-red-500 hover:text-red-600" onClick={() => setDeleteDialog({ open: true, ad })}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={formDialog} onOpenChange={setFormDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingAd ? t('ads.editAd') : t('ads.createNew')}</DialogTitle>
            <DialogDescription>{t('ads.configure')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            <div>
              <label className="text-xs font-medium">Title *</label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ad title" />
            </div>
            <div>
              <label className="text-xs font-medium">Description</label>
              <textarea
                className="w-full rounded-md border px-3 py-2 text-sm min-h-[80px] resize-none focus:outline-none focus:ring-2 focus:ring-primary"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Optional description..."
              />
            </div>
            <div>
              <label className="text-xs font-medium">Image URL</label>
              <Input value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} placeholder="https://..." />
              {form.imageUrl && (
                <div className="mt-2 rounded-lg overflow-hidden border h-32">
                  <img src={form.imageUrl} alt="Preview" className="h-full w-full object-cover" />
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium">Button Text</label>
                <Input value={form.buttonText} onChange={(e) => setForm({ ...form, buttonText: e.target.value })} placeholder="Learn More" />
              </div>
              <div>
                <label className="text-xs font-medium">Button Link</label>
                <Input value={form.buttonLink} onChange={(e) => setForm({ ...form, buttonLink: e.target.value })} placeholder="https://..." />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium">Placement</label>
                <Select value={form.placement} onValueChange={(v) => setForm({ ...form, placement: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="banner">Banner</SelectItem>
                    <SelectItem value="interstitial">Interstitial</SelectItem>
                    <SelectItem value="feed">In-Feed</SelectItem>
                    <SelectItem value="popup">Popup</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium">Status</label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="paused">Paused</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium">Target Gender</label>
                <Select value={form.targetGender || 'all'} onValueChange={(v) => setForm({ ...form, targetGender: v === 'all' ? '' : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium">Target Plan</label>
                <Select value={form.targetPlan || 'all'} onValueChange={(v) => setForm({ ...form, targetPlan: v === 'all' ? '' : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Plans</SelectItem>
                    <SelectItem value="free">Free Only</SelectItem>
                    <SelectItem value="premium">Premium Only</SelectItem>
                    <SelectItem value="gold">Gold Only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormDialog(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleSave} disabled={formLoading || !form.title}>
              {formLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : editingAd ? t('common.update') : t('ads.createAd')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog({ ...deleteDialog, open })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('ads.deleteAd')}</DialogTitle>
            <DialogDescription>
              {t('ads.deleteConfirm')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog({ open: false, ad: null })}>{t('common.cancel')}</Button>
            <Button variant="destructive" onClick={handleDelete}>{t('common.delete')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
