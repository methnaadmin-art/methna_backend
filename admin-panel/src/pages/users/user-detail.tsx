import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { adminApi, trustSafetyApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Progress } from '@/components/ui/progress'
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
import { useToast } from '@/components/ui/toast'
import type { UserDetail } from '@/types'
import { formatDate, formatDateTime } from '@/lib/utils'
import {
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  Shield,
  ShieldOff,
  Ban,
  UserCheck,
  Crown,
  Loader2,
  AlertTriangle,
  Heart,
  Sparkles,
  MessageCircleHeart,
  MessageSquare,
  HeartOff,
  Rocket,
  ShieldBan,
  BarChart3,
  Edit,
  Save,
  Camera,
  FileCheck,
  FileText,
  Eye,
  EyeOff,
  Trash2,
  CheckCircle2,
  XCircle,
  Clock,
  User,
  Settings,
  Globe,
  Calendar,
  Fingerprint,
  Activity,
  Send,
} from 'lucide-react'

export default function UserDetailPage() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [detail, setDetail] = useState<UserDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState('')
  const [activity, setActivity] = useState<any>(null)
  const [activityLoading, setActivityLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')

  // Edit mode
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState<Record<string, any>>({})
  const [editLoading, setEditLoading] = useState(false)

  // Suspicious detection
  const [suspicious, setSuspicious] = useState<any>(null)
  const [detectLoading, setDetectLoading] = useState(false)

  // Notification dialog
  const [notifDialog, setNotifDialog] = useState(false)
  const [notifForm, setNotifForm] = useState({ title: '', body: '', type: 'system' })
  const [notifLoading, setNotifLoading] = useState(false)

  // Normalize response: handle both { user, profile, photos, subscription } and flat user object
  const normalizeDetail = (data: any): UserDetail | null => {
    if (!data) return null
    // Standard shape: { user, profile, photos, subscription }
    if (data.user && typeof data.user === 'object' && data.user.id) {
      return data as UserDetail
    }
    // Flat shape: the data IS the user object directly
    if (data.id && data.email) {
      return { user: data, profile: data.profile || null, photos: data.photos || [], subscription: data.subscription || null }
    }
    // Nested: { data: { user, ... } } (double-wrapped)
    if (data.data && typeof data.data === 'object') {
      return normalizeDetail(data.data)
    }
    return null
  }

  const reload = async () => {
    if (!id) return
    try {
      const res = await adminApi.getUserDetail(id)
      const d = normalizeDetail(res.data)
      if (d) setDetail(d)
    } catch (err: any) {
      console.error('reload error', err)
    }
  }

  useEffect(() => {
    if (!id) return
    setLoading(true)
    adminApi.getUserDetail(id)
      .then((res) => {
        console.log('[UserDetail] API response:', res.data)
        const d = normalizeDetail(res.data)
        if (!d) {
          console.error('[UserDetail] Could not normalize response:', res.data)
          toast({ title: 'Error', description: 'Unexpected API response format', variant: 'error' })
          return
        }
        setDetail(d)
        const u = d.user
        setEditForm({
          firstName: u.firstName,
          lastName: u.lastName,
          email: u.email,
          phone: u.phone || '',
          role: u.role,
          status: u.status,
          trustScore: u.trustScore,
          notificationsEnabled: u.notificationsEnabled,
        })
      })
      .catch((err) => {
        console.error('[UserDetail] API error:', err)
        const msg = err.response?.data?.message || err.message || 'Failed to load user details'
        toast({ title: 'Error loading user', description: msg, variant: 'error' })
      })
      .finally(() => setLoading(false))

    setActivityLoading(true)
    adminApi.getUserActivity(id)
      .then((res) => setActivity(res.data))
      .catch((err) => console.error('[UserDetail] Activity error:', err))
      .finally(() => setActivityLoading(false))
  }, [id])

  const handleStatusChange = async (status: string) => {
    if (!id) return
    setActionLoading(status)
    try {
      await adminApi.updateUserStatus(id, status)
      await reload()
      toast({ title: 'Status Updated', description: `User status changed to ${status}`, variant: 'success' })
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to update status', variant: 'error' })
    } finally {
      setActionLoading('')
    }
  }

  const handleShadowBan = async () => {
    if (!id) return
    setActionLoading('shadowban')
    try {
      if (detail?.user.isShadowBanned) {
        await trustSafetyApi.removeShadowBan(id)
        toast({ title: 'Shadow Ban Removed', variant: 'success' })
      } else {
        await trustSafetyApi.shadowBan(id)
        toast({ title: 'User Shadow Banned', variant: 'warning' })
      }
      await reload()
    } catch (err) {
      toast({ title: 'Error', description: 'Failed to toggle shadow ban', variant: 'error' })
    } finally {
      setActionLoading('')
    }
  }

  const handleSaveEdit = async () => {
    if (!id) return
    setEditLoading(true)
    try {
      await adminApi.updateUser(id, editForm)
      await reload()
      setEditing(false)
      toast({ title: 'User Updated', description: 'Changes saved successfully', variant: 'success' })
    } catch (err: any) {
      toast({ title: 'Error', description: err.response?.data?.message || 'Failed to save', variant: 'error' })
    } finally {
      setEditLoading(false)
    }
  }

  const handleDetectSuspicious = async () => {
    if (!id) return
    setDetectLoading(true)
    try {
      const res = await trustSafetyApi.detectSuspicious(id)
      setSuspicious(res.data)
    } catch {
      toast({ title: 'Error', description: 'Failed to run detection', variant: 'error' })
    } finally {
      setDetectLoading(false)
    }
  }

  const handleSendNotification = async () => {
    if (!id) return
    setNotifLoading(true)
    try {
      await adminApi.sendNotification({ userId: id, ...notifForm })
      toast({ title: 'Notification Sent', variant: 'success' })
      setNotifDialog(false)
      setNotifForm({ title: '', body: '', type: 'system' })
    } catch {
      toast({ title: 'Error', description: 'Failed to send notification', variant: 'error' })
    } finally {
      setNotifLoading(false)
    }
  }

  const handleDeleteUser = async () => {
    if (!id) return
    if (!window.confirm('Are you sure you want to delete this user? This action is soft-delete.')) return
    setActionLoading('delete')
    try {
      await adminApi.deleteUser(id)
      toast({ title: 'User Deleted', variant: 'warning' })
      navigate('/users')
    } catch {
      toast({ title: 'Error', description: 'Failed to delete user', variant: 'error' })
    } finally {
      setActionLoading('')
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!detail) {
    return <div className="text-center text-muted-foreground">{t('userDetail.notFound')}</div>
  }

  const { user, profile, photos, subscription } = detail

  return (
    <div className="space-y-6">
      {/* Back */}
      <Button variant="ghost" onClick={() => navigate('/users')} className="gap-2">
        <ArrowLeft className="h-4 w-4" /> {t('userDetail.backToUsers')}
      </Button>

      {/* User Header Card */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <Avatar className="h-16 w-16">
              {photos?.[0]?.url ? <AvatarImage src={photos[0].url} /> : null}
              <AvatarFallback className="text-lg bg-primary/10 text-primary">
                {user.firstName?.[0]}{user.lastName?.[0]}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-bold">{user.firstName} {user.lastName}</h2>
                <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>{user.role?.toUpperCase()}</Badge>
                <Badge variant={user.status === 'active' ? 'success' : user.status === 'banned' ? 'destructive' : 'warning'}>{user.status}</Badge>
                {user.selfieVerified && <Badge variant="info">Selfie Verified</Badge>}
                {user.isShadowBanned && <Badge variant="destructive">Shadow Banned</Badge>}
                {user.emailVerified && <Badge variant="outline" className="text-emerald-600 border-emerald-200">Email Verified</Badge>}
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">{user.email}</p>
              <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                <span>ID: <code className="text-[10px] bg-muted px-1 rounded">{user.id}</code></span>
                <span>Joined {formatDate(user.createdAt)}</span>
                {user.lastLoginAt && <span>Last login {formatDateTime(user.lastLoginAt)}</span>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              <Button size="sm" variant="outline" onClick={() => setNotifDialog(true)} className="gap-1.5">
                <Send className="h-3.5 w-3.5" /> {t('userDetail.notify')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setEditing(true); setActiveTab('edit') }} className="gap-1.5">
                <Edit className="h-3.5 w-3.5" /> {t('common.edit')}
              </Button>
              <Button size="sm" variant="destructive" onClick={handleDeleteUser} disabled={actionLoading === 'delete'} className="gap-1.5">
                <Trash2 className="h-3.5 w-3.5" /> {t('common.delete')}
              </Button>
            </div>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t">
            {user.status !== 'active' && (
              <Button size="sm" variant="outline" onClick={() => handleStatusChange('active')} disabled={!!actionLoading} className="gap-1.5">
                <UserCheck className="h-3.5 w-3.5" /> {actionLoading === 'active' ? '...' : t('userDetail.activate')}
              </Button>
            )}
            {user.status !== 'suspended' && (
              <Button size="sm" variant="outline" onClick={() => handleStatusChange('suspended')} disabled={!!actionLoading} className="gap-1.5 text-amber-600 border-amber-200 hover:bg-amber-50">
                <AlertTriangle className="h-3.5 w-3.5" /> {actionLoading === 'suspended' ? '...' : t('userDetail.suspend')}
              </Button>
            )}
            {user.status !== 'banned' && (
              <Button size="sm" variant="outline" onClick={() => handleStatusChange('banned')} disabled={!!actionLoading} className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50">
                <Ban className="h-3.5 w-3.5" /> {actionLoading === 'banned' ? '...' : t('userDetail.ban')}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={handleShadowBan} disabled={!!actionLoading} className="gap-1.5">
              {user.isShadowBanned ? <Shield className="h-3.5 w-3.5" /> : <ShieldOff className="h-3.5 w-3.5" />}
              {actionLoading === 'shadowban' ? '...' : user.isShadowBanned ? t('userDetail.unShadowBan') : t('userDetail.shadowBan')}
            </Button>
            <Button size="sm" variant="outline" onClick={handleDetectSuspicious} disabled={detectLoading} className="gap-1.5">
              <Fingerprint className="h-3.5 w-3.5" /> {detectLoading ? t('userDetail.analyzing') : t('userDetail.detectSuspicious')}
            </Button>
          </div>

          {/* Suspicious results */}
          {suspicious && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-800 mb-1">{t('userDetail.suspiciousAnalysis')}</p>
              <pre className="text-xs text-amber-700 whitespace-pre-wrap">{JSON.stringify(suspicious, null, 2)}</pre>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tabbed Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="overview">{t('userDetail.overview')}</TabsTrigger>
          <TabsTrigger value="edit">{t('userDetail.editUser')}</TabsTrigger>
          <TabsTrigger value="activity">{t('userDetail.activity')}</TabsTrigger>
          <TabsTrigger value="photos">{t('userDetail.photos')} ({photos?.length || 0})</TabsTrigger>
          <TabsTrigger value="verification">{t('userDetail.verification')}</TabsTrigger>
        </TabsList>

        {/* OVERVIEW TAB */}
        <TabsContent value="overview">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Profile Details */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{t('userDetail.profileInfo')}</CardTitle>
              </CardHeader>
              <CardContent>
                {profile ? (
                  <div className="space-y-4">
                    <div className="grid gap-3 grid-cols-2">
                      <div><span className="text-[11px] text-muted-foreground uppercase tracking-wide">Gender</span><p className="font-medium capitalize text-sm">{profile.gender}</p></div>
                      <div><span className="text-[11px] text-muted-foreground uppercase tracking-wide">DOB</span><p className="font-medium text-sm">{formatDate(profile.dateOfBirth)}</p></div>
                      <div><span className="text-[11px] text-muted-foreground uppercase tracking-wide">Ethnicity</span><p className="font-medium text-sm">{profile.ethnicity}</p></div>
                      <div><span className="text-[11px] text-muted-foreground uppercase tracking-wide">Nationality</span><p className="font-medium text-sm">{profile.nationality}</p></div>
                      <div><span className="text-[11px] text-muted-foreground uppercase tracking-wide">Religious Level</span><p className="font-medium text-sm">{profile.religiousLevel}</p></div>
                      <div><span className="text-[11px] text-muted-foreground uppercase tracking-wide">Marriage Intention</span><p className="font-medium text-sm">{profile.marriageIntention}</p></div>
                    </div>
                    {profile.bio && (
                      <div className="border-t pt-3">
                        <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Bio</span>
                        <p className="mt-1 text-sm">{profile.bio}</p>
                      </div>
                    )}
                    {profile.interests?.length > 0 && (
                      <div className="border-t pt-3">
                        <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Interests</span>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {profile.interests.map((i: string) => <Badge key={i} variant="secondary" className="text-xs">{i}</Badge>)}
                        </div>
                      </div>
                    )}
                    {profile.languages?.length > 0 && (
                      <div className="border-t pt-3">
                        <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Languages</span>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {profile.languages.map((l: string) => <Badge key={l} variant="outline" className="text-xs">{l}</Badge>)}
                        </div>
                      </div>
                    )}
                    <div className="border-t pt-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs text-muted-foreground">Profile Completion</span>
                        <span className="text-xs font-bold">{profile.profileCompletionPercentage}%</span>
                      </div>
                      <Progress value={profile.profileCompletionPercentage} className="h-2" />
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{t('userDetail.noProfile')}</p>
                )}
              </CardContent>
            </Card>

            {/* Account & Security */}
            <div className="space-y-6">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{t('userDetail.accountDetails')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-3">
                    <Shield className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm flex-1">Trust Score</span>
                    <div className="flex items-center gap-2">
                      <Progress value={user.trustScore} className="w-20 h-2" />
                      <span className={`text-sm font-bold ${user.trustScore < 30 ? 'text-red-600' : user.trustScore < 60 ? 'text-amber-600' : 'text-emerald-600'}`}>{user.trustScore}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm flex-1">Email</span>
                    <Badge variant={user.emailVerified ? 'success' : 'warning'} className="text-[10px]">{user.emailVerified ? 'Verified' : 'Unverified'}</Badge>
                  </div>
                  {user.phone && (
                    <div className="flex items-center gap-3">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm flex-1">Phone</span>
                      <span className="text-sm text-muted-foreground">{user.phone}</span>
                    </div>
                  )}
                  {profile?.city && (
                    <div className="flex items-center gap-3">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm flex-1">Location</span>
                      <span className="text-sm text-muted-foreground">{profile.city}, {profile.country}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <Globe className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm flex-1">Last IP</span>
                    <code className="text-xs bg-muted px-2 py-0.5 rounded">{user.lastKnownIp || '—'}</code>
                  </div>
                  <div className="flex items-center gap-3">
                    <Settings className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm flex-1">Devices</span>
                    <span className="text-sm font-medium">{user.deviceCount}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm flex-1">Flag Count</span>
                    <span className={`text-sm font-medium ${user.flagCount > 0 ? 'text-red-600' : ''}`}>{user.flagCount}</span>
                  </div>
                </CardContent>
              </Card>

              {/* Subscription */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Crown className="h-4 w-4 text-amber-500" /> {t('userDetail.subscription')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {subscription ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Badge className={subscription.plan === 'GOLD' || subscription.plan === ('gold' as any) ? 'bg-amber-500 text-white' : subscription.plan === 'PREMIUM' || subscription.plan === ('premium' as any) ? 'bg-purple-500 text-white' : ''}>
                          {subscription.plan?.toUpperCase()}
                        </Badge>
                        <Badge variant={subscription.status === 'active' ? 'success' : 'secondary'}>{subscription.status}</Badge>
                      </div>
                      {subscription.startDate && <p className="text-xs text-muted-foreground">Started: {formatDate(subscription.startDate)}</p>}
                      {subscription.endDate && <p className="text-xs text-muted-foreground">Expires: {formatDate(subscription.endDate)}</p>}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t('userDetail.freePlan')}</p>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* EDIT TAB */}
        <TabsContent value="edit">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t('userDetail.editUser')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 max-w-2xl">
                <div>
                  <label className="text-xs font-medium">First Name</label>
                  <Input value={editForm.firstName || ''} onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })} className="mt-1" />
                </div>
                <div>
                  <label className="text-xs font-medium">Last Name</label>
                  <Input value={editForm.lastName || ''} onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })} className="mt-1" />
                </div>
                <div>
                  <label className="text-xs font-medium">Email</label>
                  <Input type="email" value={editForm.email || ''} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} className="mt-1" />
                </div>
                <div>
                  <label className="text-xs font-medium">Phone</label>
                  <Input value={editForm.phone || ''} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} className="mt-1" />
                </div>
                <div>
                  <label className="text-xs font-medium">Role</label>
                  <Select value={editForm.role} onValueChange={(v) => setEditForm({ ...editForm, role: v })}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="moderator">Moderator</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium">Status</label>
                  <Select value={editForm.status} onValueChange={(v) => setEditForm({ ...editForm, status: v })}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="suspended">Suspended</SelectItem>
                      <SelectItem value="banned">Banned</SelectItem>
                      <SelectItem value="deactivated">Deactivated</SelectItem>
                      <SelectItem value="pending_verification">Pending Verification</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium">Trust Score (0-100)</label>
                  <Input type="number" min={0} max={100} value={editForm.trustScore || 0} onChange={(e) => setEditForm({ ...editForm, trustScore: parseInt(e.target.value) || 0 })} className="mt-1" />
                </div>
              </div>
              <div className="mt-6 flex gap-2">
                <Button onClick={handleSaveEdit} disabled={editLoading} className="gap-2">
                  {editLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {t('common.save')}
                </Button>
                <Button variant="outline" onClick={() => setActiveTab('overview')}>{t('common.cancel')}</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ACTIVITY TAB */}
        <TabsContent value="activity">
          {activityLoading ? (
            <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : activity ? (
            <div className="space-y-6">
              {/* Swipe Stats */}
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
                <Card><CardContent className="p-4 text-center">
                  <Heart className="h-5 w-5 text-pink-500 mx-auto mb-1" />
                  <p className="text-xs text-muted-foreground">Likes</p>
                  <p className="text-lg font-bold">{activity.likes?.given ?? 0} / {activity.likes?.received ?? 0}</p>
                  <p className="text-[10px] text-muted-foreground">given / received</p>
                </CardContent></Card>
                <Card><CardContent className="p-4 text-center">
                  <Sparkles className="h-5 w-5 text-purple-500 mx-auto mb-1" />
                  <p className="text-xs text-muted-foreground">Super Likes</p>
                  <p className="text-lg font-bold">{activity.superLikes?.given ?? 0} / {activity.superLikes?.received ?? 0}</p>
                  <p className="text-[10px] text-muted-foreground">given / received</p>
                </CardContent></Card>
                <Card><CardContent className="p-4 text-center">
                  <MessageCircleHeart className="h-5 w-5 text-amber-500 mx-auto mb-1" />
                  <p className="text-xs text-muted-foreground">Compliments</p>
                  <p className="text-lg font-bold">{activity.compliments?.given ?? 0} / {activity.compliments?.received ?? 0}</p>
                  <p className="text-[10px] text-muted-foreground">given / received</p>
                </CardContent></Card>
                <Card><CardContent className="p-4 text-center">
                  <HeartOff className="h-5 w-5 text-gray-400 mx-auto mb-1" />
                  <p className="text-xs text-muted-foreground">Passes</p>
                  <p className="text-2xl font-bold">{activity.passes ?? 0}</p>
                </CardContent></Card>
              </div>

              {/* Engagement Stats */}
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-5">
                <Card className="bg-blue-50 border-blue-100"><CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold text-blue-600">{activity.matches ?? 0}</p>
                  <p className="text-xs text-blue-600/70">Matches</p>
                </CardContent></Card>
                <Card className="bg-green-50 border-green-100"><CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold text-green-600">{activity.messages ?? 0}</p>
                  <p className="text-xs text-green-600/70">Messages Sent</p>
                </CardContent></Card>
                <Card className="bg-orange-50 border-orange-100"><CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold text-orange-600">{activity.boosts ?? 0}</p>
                  <p className="text-xs text-orange-600/70">Boosts Used</p>
                </CardContent></Card>
                <Card className="bg-red-50 border-red-100"><CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold text-red-600">{activity.blocked ?? 0} / {activity.blockedBy ?? 0}</p>
                  <p className="text-xs text-red-600/70">Blocked / By</p>
                </CardContent></Card>
                <Card className="bg-amber-50 border-amber-100"><CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold text-amber-600">{activity.reports ?? 0}</p>
                  <p className="text-xs text-amber-600/70">Reports Against</p>
                </CardContent></Card>
              </div>

              {/* Active Boost */}
              {activity.activeBoost && (
                <Card className="border-orange-200 bg-orange-50">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2">
                      <Rocket className="h-5 w-5 text-orange-500" />
                      <div>
                        <p className="text-sm font-semibold text-orange-800">Active Boost</p>
                        <p className="text-xs text-orange-700">Type: {activity.activeBoost.type} | Views: {activity.activeBoost.profileViewsGained}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-8 text-center">Could not load activity data.</p>
          )}
        </TabsContent>

        {/* PHOTOS TAB */}
        <TabsContent value="photos">
          {photos && photos.length > 0 ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {photos.map((photo) => (
                <div key={photo.id} className="relative group rounded-xl overflow-hidden border">
                  <img src={photo.url} alt="User photo" className="aspect-square w-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="absolute top-2 right-2 flex gap-1">
                    <Badge
                      variant={photo.moderationStatus === 'APPROVED' ? 'success' : photo.moderationStatus === 'REJECTED' ? 'destructive' : 'warning'}
                      className="text-[9px]"
                    >
                      {photo.moderationStatus}
                    </Badge>
                  </div>
                  <div className="absolute bottom-2 left-2 flex gap-1">
                    {photo.isMain && <Badge className="text-[9px] bg-primary">Main</Badge>}
                    {photo.isSelfieVerification && <Badge className="text-[9px] bg-blue-500">Selfie</Badge>}
                  </div>
                  <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                    <Button size="icon" className="h-7 w-7 bg-emerald-500 hover:bg-emerald-600" onClick={() => adminApi.moderatePhoto(photo.id, 'approved').then(reload)}>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="destructive" className="h-7 w-7" onClick={() => adminApi.moderatePhoto(photo.id, 'rejected').then(reload)}>
                      <XCircle className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-16 text-muted-foreground">
              <Camera className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>{t('userDetail.noPhotos')}</p>
            </div>
          )}
        </TabsContent>

        {/* VERIFICATION TAB */}
        <TabsContent value="verification">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{t('userDetail.verificationStatus')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Email Verification</span>
                  </div>
                  {user.emailVerified ? (
                    <Badge variant="success" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Verified</Badge>
                  ) : (
                    <Badge variant="warning" className="gap-1"><Clock className="h-3 w-3" /> Pending</Badge>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Camera className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Selfie Verification</span>
                  </div>
                  {user.selfieVerified ? (
                    <Badge variant="success" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Verified</Badge>
                  ) : (
                    <Badge variant="warning" className="gap-1"><Clock className="h-3 w-3" /> Not Verified</Badge>
                  )}
                </div>
                {user.selfieUrl && (
                  <div className="border-t pt-3">
                    <p className="text-xs text-muted-foreground mb-2">Selfie Image</p>
                    <img src={user.selfieUrl} alt="Selfie" className="w-32 h-32 rounded-lg object-cover border" />
                  </div>
                )}
                <div className="flex items-center justify-between border-t pt-3">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">{t('verification.idDocuments')}</span>
                  </div>
                  {user.documentVerified ? (
                    <Badge variant="success" className="gap-1"><CheckCircle2 className="h-3 w-3" /> {t('verification.approved')}</Badge>
                  ) : user.documentUrl ? (
                    <Badge variant="warning" className="gap-1"><Clock className="h-3 w-3" /> {t('verification.pendingReview')}</Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1 text-muted-foreground">Not Uploaded</Badge>
                  )}
                </div>
                {user.documentUrl && (
                  <div className="border-t pt-3">
                    <p className="text-xs text-muted-foreground mb-1">{user.documentType ? user.documentType.replace('_', ' ') : t('verification.document')}</p>
                    <img src={user.documentUrl} alt="Document" className="w-40 h-28 rounded-lg object-cover border" />
                    {user.documentRejectionReason && (
                      <p className="text-xs text-red-500 mt-1">{t('verification.rejectionReason')}: {user.documentRejectionReason}</p>
                    )}
                    {user.documentVerifiedAt && (
                      <p className="text-xs text-muted-foreground mt-1">Verified: {new Date(user.documentVerifiedAt).toLocaleDateString()}</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{t('userDetail.trustSafetyScore')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-center">
                  <div className={`inline-flex items-center justify-center h-20 w-20 rounded-full border-4 ${user.trustScore >= 70 ? 'border-emerald-500' : user.trustScore >= 40 ? 'border-amber-500' : 'border-red-500'}`}>
                    <span className={`text-2xl font-bold ${user.trustScore >= 70 ? 'text-emerald-600' : user.trustScore >= 40 ? 'text-amber-600' : 'text-red-600'}`}>
                      {user.trustScore}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">out of 100</p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Flags received</span>
                    <span className="font-medium">{user.flagCount}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Shadow banned</span>
                    <span className="font-medium">{user.isShadowBanned ? 'Yes' : 'No'}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Device count</span>
                    <span className="font-medium">{user.deviceCount}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Send Notification Dialog */}
      <Dialog open={notifDialog} onOpenChange={setNotifDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('userDetail.sendNotifTo')} {user.firstName}</DialogTitle>
            <DialogDescription>{t('userDetail.sendNotifDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium">Title</label>
              <Input value={notifForm.title} onChange={(e) => setNotifForm({ ...notifForm, title: e.target.value })} placeholder="Notification title" />
            </div>
            <div>
              <label className="text-xs font-medium">Body</label>
              <Textarea value={notifForm.body} onChange={(e) => setNotifForm({ ...notifForm, body: e.target.value })} placeholder="Notification message..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNotifDialog(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleSendNotification} disabled={notifLoading || !notifForm.title || !notifForm.body}>
              {notifLoading ? <Loader2 className="h-4 w-4 animate-spin me-1" /> : <Send className="h-4 w-4 me-1" />}
              {t('common.send')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
