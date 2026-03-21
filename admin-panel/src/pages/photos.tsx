import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { adminApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { Photo } from '@/types'
import { formatDateTime } from '@/lib/utils'
import { CheckCircle, XCircle, ChevronLeft, ChevronRight, Loader2, ImageIcon } from 'lucide-react'

export default function PhotosPage() {
  const { t } = useTranslation()
  const [photos, setPhotos] = useState<Photo[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  const [moderateDialog, setModerateDialog] = useState<{
    open: boolean
    photo: Photo | null
    action: 'APPROVED' | 'REJECTED'
  }>({ open: false, photo: null, action: 'APPROVED' })
  const [moderationNote, setModerationNote] = useState('')

  const fetchPhotos = async () => {
    setLoading(true)
    try {
      const { data } = await adminApi.getPendingPhotos(page, 20)
      setPhotos(data.photos || data || [])
      setTotal(data.total || 0)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchPhotos() }, [page])

  const handleModerate = async () => {
    if (!moderateDialog.photo) return
    try {
      await adminApi.moderatePhoto(
        moderateDialog.photo.id,
        moderateDialog.action,
        moderationNote || undefined
      )
      setModerateDialog({ open: false, photo: null, action: 'APPROVED' })
      setModerationNote('')
      fetchPhotos()
    } catch (err) {
      console.error(err)
    }
  }

  const totalPages = Math.ceil(total / 20)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{total} {t('photos.pendingModeration')}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : photos.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <ImageIcon className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-lg font-medium text-muted-foreground">{t('photos.noPending')}</p>
            <p className="text-sm text-muted-foreground">{t('photos.allModerated')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {photos.map((photo) => (
            <Card key={photo.id} className="overflow-hidden">
              <div className="relative">
                <img
                  src={photo.url}
                  alt="Pending photo"
                  className="aspect-square w-full object-cover"
                />
                {photo.isMain && (
                  <Badge className="absolute top-2 left-2 text-[10px]">Main Photo</Badge>
                )}
                {photo.isSelfieVerification && (
                  <Badge variant="info" className="absolute top-2 right-2 text-[10px]">Selfie</Badge>
                )}
              </div>
              <CardContent className="p-4">
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    {photo.user?.firstName} {photo.user?.lastName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Uploaded: {formatDateTime(photo.createdAt)}
                  </p>
                  <div className="flex gap-2 pt-2">
                    <Button
                      size="sm"
                      className="flex-1 gap-1"
                      onClick={() => setModerateDialog({ open: true, photo, action: 'APPROVED' })}
                    >
                      <CheckCircle className="h-3.5 w-3.5" /> {t('photos.approve')}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="flex-1 gap-1"
                      onClick={() => setModerateDialog({ open: true, photo, action: 'REJECTED' })}
                    >
                      <XCircle className="h-3.5 w-3.5" /> {t('photos.reject')}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
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

      {/* Moderate Dialog */}
      <Dialog open={moderateDialog.open} onOpenChange={(open) => setModerateDialog({ ...moderateDialog, open })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {moderateDialog.action === 'APPROVED' ? t('photos.approve') : t('photos.reject')}
            </DialogTitle>
            <DialogDescription>
              {moderateDialog.action === 'APPROVED'
                ? 'This photo will be visible to all users.'
                : 'This photo will be hidden and the user will be notified.'}
            </DialogDescription>
          </DialogHeader>
          {moderateDialog.photo && (
            <img
              src={moderateDialog.photo.url}
              alt="Photo to moderate"
              className="max-h-64 w-full rounded-lg object-contain border"
            />
          )}
          <Textarea
            placeholder={moderateDialog.action === 'REJECTED' ? 'Reason for rejection...' : 'Note (optional)'}
            value={moderationNote}
            onChange={(e) => setModerationNote(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setModerateDialog({ open: false, photo: null, action: 'APPROVED' })}>
              {t('common.cancel')}
            </Button>
            <Button
              variant={moderateDialog.action === 'APPROVED' ? 'default' : 'destructive'}
              onClick={handleModerate}
            >
              {moderateDialog.action === 'APPROVED' ? t('photos.approve') : t('photos.reject')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
