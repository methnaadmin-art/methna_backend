import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { adminApi, trustSafetyApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import {
  FileCheck,
  Camera,
  CreditCard,
  FileText,
  CheckCircle2,
  XCircle,
  Clock,
  Eye,
  Loader2,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Shield,
  ExternalLink,
} from 'lucide-react'

interface PendingPhoto {
  id: string
  userId: string
  url: string
  moderationStatus: string
  isSelfieVerification: boolean
  isMain: boolean
  createdAt: string
  user?: { id: string; firstName: string; lastName: string; email: string; selfieVerified: boolean }
}

interface PendingVerificationUser {
  id: string
  firstName: string
  lastName: string
  email: string
  selfieUrl: string
  selfieVerified: boolean
  status: string
  createdAt: string
}

interface PendingDocUser {
  id: string
  firstName: string
  lastName: string
  email: string
  documentUrl: string
  documentType: string
  documentVerified: boolean
  status: string
  createdAt: string
}

export default function VerificationPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [tab, setTab] = useState('selfies')
  const [photos, setPhotos] = useState<PendingPhoto[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  // Action dialog
  const [actionDialog, setActionDialog] = useState<{
    open: boolean
    photo: PendingPhoto | null
    action: string
    note: string
  }>({ open: false, photo: null, action: '', note: '' })
  const [actionLoading, setActionLoading] = useState(false)

  // Stats
  const [stats, setStats] = useState({ pending: 0, approved: 0, rejected: 0 })

  // Document verification users (selfie)
  const [docUsers, setDocUsers] = useState<PendingVerificationUser[]>([])
  const [docLoading, setDocLoading] = useState(false)
  const [docActionLoading, setDocActionLoading] = useState('')
  const [previewImg, setPreviewImg] = useState<string | null>(null)

  // Document (passport/ID) verification
  const [pendingDocs, setPendingDocs] = useState<PendingDocUser[]>([])
  const [pendingDocsLoading, setPendingDocsLoading] = useState(false)
  const [docVerifyLoading, setDocVerifyLoading] = useState('')
  const [autoApproveLoading, setAutoApproveLoading] = useState(false)
  const [rejectDialog, setRejectDialog] = useState<{ open: boolean; userId: string; reason: string }>({ open: false, userId: '', reason: '' })

  const fetchPhotos = async () => {
    setLoading(true)
    try {
      const { data } = await adminApi.getPendingPhotos(page, 20)
      const allPhotos: PendingPhoto[] = data.photos || data || []
      setPhotos(allPhotos)
      setTotal(data.total || 0)
      setStats((prev) => ({ ...prev, pending: data.total || 0 }))
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const fetchDocUsers = async () => {
    setDocLoading(true)
    try {
      const { data } = await adminApi.getUsers(1, 100, 'pending_verification')
      const users = (data.users || data || []).filter(
        (u: any) => u.selfieUrl && !u.selfieVerified
      )
      setDocUsers(users)
    } catch (err) {
      console.error(err)
    } finally {
      setDocLoading(false)
    }
  }

  const fetchPendingDocs = async () => {
    setPendingDocsLoading(true)
    try {
      const { data } = await adminApi.getPendingDocuments()
      const docs: PendingDocUser[] = Array.isArray(data) ? data : (data.users || data.documents || [])
      setPendingDocs(docs)
    } catch (err) {
      console.error(err)
    } finally {
      setPendingDocsLoading(false)
    }
  }

  useEffect(() => { fetchPhotos() }, [page])
  useEffect(() => { fetchDocUsers(); fetchPendingDocs() }, [])

  const selfiePhotos = photos.filter((p) => p.isSelfieVerification)
  const profilePhotos = photos.filter((p) => !p.isSelfieVerification)

  const handleDocAction = async (userId: string, approved: boolean) => {
    setDocActionLoading(userId)
    try {
      await adminApi.updateUser(userId, {
        selfieVerified: approved,
        status: approved ? 'active' : 'pending_verification',
      })
      toast({
        title: approved ? t('verification.approved') : t('verification.rejected'),
        description: approved
          ? t('verification.docApprovedDesc')
          : t('verification.docRejectedDesc'),
        variant: approved ? 'success' : 'warning',
      })
      fetchDocUsers()
    } catch (err) {
      toast({ title: t('common.error'), description: t('verification.moderationFailed'), variant: 'error' })
    } finally {
      setDocActionLoading('')
    }
  }

  const handleDocVerify = async (userId: string, approved: boolean, rejectionReason?: string) => {
    setDocVerifyLoading(userId)
    try {
      await adminApi.verifyDocument(userId, approved, rejectionReason)
      toast({
        title: approved ? t('verification.approved') : t('verification.rejected'),
        description: approved
          ? t('verification.docApprovedDesc')
          : t('verification.docRejectedDesc'),
        variant: approved ? 'success' : 'warning',
      })
      fetchPendingDocs()
    } catch (err) {
      toast({ title: t('common.error'), description: t('verification.moderationFailed'), variant: 'error' })
    } finally {
      setDocVerifyLoading('')
      setRejectDialog({ open: false, userId: '', reason: '' })
    }
  }

  const handleAutoApprove = async () => {
    setAutoApproveLoading(true)
    try {
      const { data } = await adminApi.autoApproveDocuments()
      toast({
        title: t('verification.approved'),
        description: `${data.approved || 0} ${t('verification.documentsAutoApproved')}`,
        variant: 'success',
      })
      fetchPendingDocs()
    } catch (err) {
      toast({ title: t('common.error'), description: t('verification.moderationFailed'), variant: 'error' })
    } finally {
      setAutoApproveLoading(false)
    }
  }

  const handleModerate = async () => {
    if (!actionDialog.photo) return
    setActionLoading(true)
    try {
      await adminApi.moderatePhoto(
        actionDialog.photo.id,
        actionDialog.action,
        actionDialog.note || undefined
      )
      toast({
        title: actionDialog.action === 'approved' ? t('verification.approved') : t('verification.rejected'),
        description: `${actionDialog.photo.user?.firstName || 'user'} - ${actionDialog.action}`,
        variant: actionDialog.action === 'approved' ? 'success' : 'warning',
      })
      setActionDialog({ open: false, photo: null, action: '', note: '' })
      fetchPhotos()
    } catch (err) {
      toast({ title: t('common.error'), description: t('verification.moderationFailed'), variant: 'error' })
    } finally {
      setActionLoading(false)
    }
  }

  const totalPages = Math.ceil(total / 20)

  const renderPhotoGrid = (items: PendingPhoto[]) => {
    if (items.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <CheckCircle2 className="h-12 w-12 mb-3 text-emerald-400" />
          <p className="text-lg font-medium">{t('verification.allCaughtUp')}</p>
          <p className="text-sm">{t('verification.noPending')}</p>
        </div>
      )
    }

    return (
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {items.map((photo) => (
          <Card key={photo.id} className="overflow-hidden group">
            <div className="relative aspect-square">
              <img
                src={photo.url}
                alt="Pending photo"
                className="h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="bg-emerald-500 hover:bg-emerald-600 text-white"
                    onClick={() => setActionDialog({
                      open: true,
                      photo,
                      action: 'approved',
                      note: '',
                    })}
                  >
                    <CheckCircle2 className="h-4 w-4 me-1" /> {t('photos.approve')}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setActionDialog({
                      open: true,
                      photo,
                      action: 'rejected',
                      note: '',
                    })}
                  >
                    <XCircle className="h-4 w-4 me-1" /> {t('photos.reject')}
                  </Button>
                </div>
              </div>
              {/* Badges */}
              <div className="absolute top-2 left-2 flex gap-1">
                {photo.isSelfieVerification && (
                  <Badge className="bg-blue-500 text-white text-[10px]">{t('verification.selfie')}</Badge>
                )}
                {photo.isMain && (
                  <Badge className="bg-primary text-white text-[10px]">{t('verification.main')}</Badge>
                )}
              </div>
              <div className="absolute top-2 right-2">
                <Badge variant="warning" className="text-[10px]">
                  <Clock className="h-3 w-3 me-1" /> {t('reports.pending')}
                </Badge>
              </div>
            </div>
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <Avatar className="h-6 w-6">
                    <AvatarFallback className="text-[9px] bg-primary/10 text-primary">
                      {photo.user?.firstName?.[0]}{photo.user?.lastName?.[0]}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">
                      {photo.user?.firstName} {photo.user?.lastName}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">{photo.user?.email}</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => navigate(`/users/${photo.userId}`)}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">{t('verification.title')}</h1>
        <p className="text-muted-foreground">{t('verification.subtitle')}</p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg bg-amber-50 p-2.5">
              <Clock className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{total}</p>
              <p className="text-xs text-muted-foreground">{t('verification.pendingReview')}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg bg-blue-50 p-2.5">
              <Camera className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{selfiePhotos.length}</p>
              <p className="text-xs text-muted-foreground">{t('verification.selfieVerifications')}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg bg-purple-50 p-2.5">
              <FileCheck className="h-5 w-5 text-purple-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{profilePhotos.length}</p>
              <p className="text-xs text-muted-foreground">{t('verification.profilePhotos')}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="idDocs" className="gap-1.5">
            <FileText className="h-4 w-4" /> {t('verification.idDocuments')}
            {pendingDocs.length > 0 && (
              <Badge variant="destructive" className="ml-1 h-5 px-1.5 text-[10px]">{pendingDocs.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="documents" className="gap-1.5">
            <CreditCard className="h-4 w-4" /> {t('verification.selfie')}
            {docUsers.length > 0 && (
              <Badge variant="destructive" className="ml-1 h-5 px-1.5 text-[10px]">{docUsers.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="selfies" className="gap-1.5">
            <Camera className="h-4 w-4" /> {t('verification.selfieVerifications')}
            {selfiePhotos.length > 0 && (
              <Badge variant="destructive" className="ml-1 h-5 px-1.5 text-[10px]">{selfiePhotos.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="photos" className="gap-1.5">
            <FileCheck className="h-4 w-4" /> {t('verification.profilePhotos')}
            {profilePhotos.length > 0 && (
              <Badge variant="destructive" className="ml-1 h-5 px-1.5 text-[10px]">{profilePhotos.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="all" className="gap-1.5">
            {t('verification.allPending')}
            {total > 0 && (
              <Badge variant="destructive" className="ml-1 h-5 px-1.5 text-[10px]">{total}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ID Documents Tab - Passport / National ID */}
        <TabsContent value="idDocs">
          <div className="space-y-4">
            {/* Auto-approve bar */}
            {pendingDocs.length > 0 && (
              <Card className="border-amber-200 bg-amber-50">
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <AlertTriangle className="h-5 w-5 text-amber-600" />
                    <div>
                      <p className="text-sm font-semibold text-amber-800">{pendingDocs.length} {t('verification.pendingDocuments')}</p>
                      <p className="text-xs text-amber-700">{t('verification.autoApproveHint')}</p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="bg-emerald-500 hover:bg-emerald-600 text-white gap-1.5"
                    disabled={autoApproveLoading}
                    onClick={handleAutoApprove}
                  >
                    {autoApproveLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    {t('verification.autoApproveAll')}
                  </Button>
                </CardContent>
              </Card>
            )}

            {pendingDocsLoading ? (
              <div className="flex h-64 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : pendingDocs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <CheckCircle2 className="h-12 w-12 mb-3 text-emerald-400" />
                <p className="text-lg font-medium">{t('verification.allCaughtUp')}</p>
                <p className="text-sm">{t('verification.noDocsPending')}</p>
              </div>
            ) : (
              <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                {pendingDocs.map((u) => (
                  <Card key={u.id} className="overflow-hidden">
                    <CardContent className="p-0">
                      <div
                        className="relative aspect-[4/3] cursor-pointer group"
                        onClick={() => setPreviewImg(u.documentUrl)}
                      >
                        <img
                          src={u.documentUrl}
                          alt={`${u.firstName} ${u.lastName} document`}
                          className="h-full w-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center">
                          <Eye className="h-8 w-8 text-white opacity-0 group-hover:opacity-80 transition-opacity" />
                        </div>
                        <div className="absolute top-2 left-2 flex gap-1">
                          <Badge variant="warning" className="text-[10px] gap-1">
                            <Clock className="h-3 w-3" /> {t('verification.pendingReview')}
                          </Badge>
                          {u.documentType && (
                            <Badge className="bg-blue-500 text-white text-[10px]">{u.documentType.replace('_', ' ')}</Badge>
                          )}
                        </div>
                      </div>

                      <div className="p-4 space-y-3">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-9 w-9">
                            <AvatarFallback className="text-xs bg-primary/10 text-primary">
                              {u.firstName?.[0]}{u.lastName?.[0]}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold truncate">{u.firstName} {u.lastName}</p>
                            <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            onClick={() => navigate(`/users/${u.id}`)}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </div>

                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <FileText className="h-3.5 w-3.5" />
                          <span>{u.documentType ? u.documentType.replace('_', ' ') : t('verification.document')}</span>
                          <span className="mx-1">&middot;</span>
                          <span>{new Date(u.createdAt).toLocaleDateString()}</span>
                        </div>

                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white gap-1.5"
                            disabled={docVerifyLoading === u.id}
                            onClick={() => handleDocVerify(u.id, true)}
                          >
                            {docVerifyLoading === u.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            )}
                            {t('verification.approve')}
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="flex-1 gap-1.5"
                            disabled={docVerifyLoading === u.id}
                            onClick={() => setRejectDialog({ open: true, userId: u.id, reason: '' })}
                          >
                            {docVerifyLoading === u.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <XCircle className="h-3.5 w-3.5" />
                            )}
                            {t('verification.reject')}
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* Selfie Verification Tab */}
        <TabsContent value="documents">
          {docLoading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : docUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <CheckCircle2 className="h-12 w-12 mb-3 text-emerald-400" />
              <p className="text-lg font-medium">{t('verification.allCaughtUp')}</p>
              <p className="text-sm">{t('verification.noDocsPending')}</p>
            </div>
          ) : (
            <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
              {docUsers.map((u) => (
                <Card key={u.id} className="overflow-hidden">
                  <CardContent className="p-0">
                    <div
                      className="relative aspect-[4/3] cursor-pointer group"
                      onClick={() => setPreviewImg(u.selfieUrl)}
                    >
                      <img
                        src={u.selfieUrl}
                        alt={`${u.firstName} ${u.lastName} selfie`}
                        className="h-full w-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center">
                        <Eye className="h-8 w-8 text-white opacity-0 group-hover:opacity-80 transition-opacity" />
                      </div>
                      <div className="absolute top-2 left-2">
                        <Badge variant="warning" className="text-[10px] gap-1">
                          <Clock className="h-3 w-3" /> {t('verification.pendingReview')}
                        </Badge>
                      </div>
                    </div>

                    <div className="p-4 space-y-3">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                          <AvatarFallback className="text-xs bg-primary/10 text-primary">
                            {u.firstName?.[0]}{u.lastName?.[0]}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold truncate">{u.firstName} {u.lastName}</p>
                          <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={() => navigate(`/users/${u.id}`)}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Shield className="h-3.5 w-3.5" />
                        <span>{t('verification.selfie')}</span>
                        <span className="mx-1">&middot;</span>
                        <span>{new Date(u.createdAt).toLocaleDateString()}</span>
                      </div>

                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white gap-1.5"
                          disabled={docActionLoading === u.id}
                          onClick={() => handleDocAction(u.id, true)}
                        >
                          {docActionLoading === u.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          )}
                          {t('verification.approve')}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="flex-1 gap-1.5"
                          disabled={docActionLoading === u.id}
                          onClick={() => handleDocAction(u.id, false)}
                        >
                          {docActionLoading === u.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <XCircle className="h-3.5 w-3.5" />
                          )}
                          {t('verification.reject')}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            <TabsContent value="selfies">{renderPhotoGrid(selfiePhotos)}</TabsContent>
            <TabsContent value="photos">{renderPhotoGrid(profilePhotos)}</TabsContent>
            <TabsContent value="all">{renderPhotoGrid(photos)}</TabsContent>
          </>
        )}
      </Tabs>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t pt-4">
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

      {/* Image Preview Dialog */}
      <Dialog open={!!previewImg} onOpenChange={() => setPreviewImg(null)}>
        <DialogContent className="max-w-2xl p-2">
          <DialogHeader className="sr-only">
            <DialogTitle>{t('verification.selfie')}</DialogTitle>
          </DialogHeader>
          {previewImg && (
            <img src={previewImg} alt="Document preview" className="w-full rounded-lg object-contain max-h-[80vh]" />
          )}
        </DialogContent>
      </Dialog>

      {/* Action Dialog */}
      <Dialog open={actionDialog.open} onOpenChange={(open) => setActionDialog({ ...actionDialog, open })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionDialog.action === 'approved' ? t('verification.approvePhoto') : t('verification.rejectPhoto')}
            </DialogTitle>
            <DialogDescription>
              {actionDialog.action === 'approved'
                ? t('verification.approveDesc')
                : t('verification.rejectDesc')}
            </DialogDescription>
          </DialogHeader>

          {actionDialog.photo && (
            <div className="flex items-center gap-3 rounded-lg border p-3">
              <img src={actionDialog.photo.url} alt="" className="h-16 w-16 rounded-lg object-cover" />
              <div>
                <p className="text-sm font-medium">{actionDialog.photo.user?.firstName} {actionDialog.photo.user?.lastName}</p>
                <p className="text-xs text-muted-foreground">{actionDialog.photo.user?.email}</p>
                <div className="mt-1 flex gap-1">
                  {actionDialog.photo.isSelfieVerification && <Badge variant="info" className="text-[10px]">{t('verification.selfie')}</Badge>}
                  {actionDialog.photo.isMain && <Badge className="text-[10px]">{t('verification.main')}</Badge>}
                </div>
              </div>
            </div>
          )}

          <div>
            <label className="text-sm font-medium">{t('reports.moderatorNote')}</label>
            <Textarea
              placeholder="Add a note about this decision..."
              value={actionDialog.note}
              onChange={(e) => setActionDialog({ ...actionDialog, note: e.target.value })}
              className="mt-1.5"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setActionDialog({ open: false, photo: null, action: '', note: '' })}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleModerate}
              disabled={actionLoading}
              className={actionDialog.action === 'approved' ? 'bg-emerald-500 hover:bg-emerald-600' : ''}
              variant={actionDialog.action === 'rejected' ? 'destructive' : 'default'}
            >
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {actionDialog.action === 'approved' ? t('photos.approve') : t('photos.reject')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Document Rejection Dialog */}
      <Dialog open={rejectDialog.open} onOpenChange={(open) => setRejectDialog({ ...rejectDialog, open })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('verification.rejectDocument')}</DialogTitle>
            <DialogDescription>{t('verification.rejectDocDesc')}</DialogDescription>
          </DialogHeader>
          <div>
            <label className="text-sm font-medium">{t('verification.rejectionReason')}</label>
            <Textarea
              placeholder={t('verification.rejectionReasonPlaceholder')}
              value={rejectDialog.reason}
              onChange={(e) => setRejectDialog({ ...rejectDialog, reason: e.target.value })}
              className="mt-1.5"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialog({ open: false, userId: '', reason: '' })}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleDocVerify(rejectDialog.userId, false, rejectDialog.reason)}
              disabled={docVerifyLoading === rejectDialog.userId}
            >
              {docVerifyLoading === rejectDialog.userId ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <XCircle className="h-4 w-4 mr-1" />}
              {t('verification.reject')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
