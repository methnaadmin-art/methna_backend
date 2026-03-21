import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { notificationsApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Notification, NotificationSettings } from '@/types'
import { formatDateTime } from '@/lib/utils'
import { Loader2, Bell, BellOff, CheckCheck, Trash2, Settings } from 'lucide-react'

export default function NotificationsPage() {
  const { t } = useTranslation()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [settings, setSettings] = useState<NotificationSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [settingsLoading, setSettingsLoading] = useState(false)

  const fetchAll = async () => {
    setLoading(true)
    try {
      const [notifsRes, countRes, settingsRes] = await Promise.allSettled([
        notificationsApi.getAll(),
        notificationsApi.getUnreadCount(),
        notificationsApi.getSettings(),
      ])
      if (notifsRes.status === 'fulfilled') {
        const d = notifsRes.value.data
        setNotifications(Array.isArray(d) ? d : d?.notifications || [])
      }
      if (countRes.status === 'fulfilled') {
        const d = countRes.value.data
        setUnreadCount(typeof d === 'number' ? d : d?.count ?? d?.unreadCount ?? 0)
      }
      if (settingsRes.status === 'fulfilled') {
        setSettings(settingsRes.value.data)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchAll() }, [])

  const handleMarkRead = async (id: string) => {
    try {
      await notificationsApi.markRead(id)
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n))
      setUnreadCount(prev => Math.max(0, prev - 1))
    } catch (err) {
      console.error(err)
    }
  }

  const handleMarkAllRead = async () => {
    try {
      await notificationsApi.markAllRead()
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })))
      setUnreadCount(0)
    } catch (err) {
      console.error(err)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await notificationsApi.remove(id)
      setNotifications(prev => prev.filter(n => n.id !== id))
    } catch (err) {
      console.error(err)
    }
  }

  const toggleSetting = async (key: keyof NotificationSettings) => {
    if (!settings) return
    setSettingsLoading(true)
    try {
      const updated = { ...settings, [key]: !settings[key] }
      await notificationsApi.updateSettings(updated)
      setSettings(updated)
    } catch (err) {
      console.error(err)
    } finally {
      setSettingsLoading(false)
    }
  }

  const typeBadge = (type: string) => {
    const map: Record<string, { variant: any; label: string }> = {
      MATCH: { variant: 'success', label: 'Match' },
      MESSAGE: { variant: 'info', label: 'Message' },
      LIKE: { variant: 'default', label: 'Like' },
      SUPER_LIKE: { variant: 'warning', label: 'Super Like' },
      SYSTEM: { variant: 'secondary', label: 'System' },
    }
    const info = map[type] || { variant: 'outline', label: type }
    return <Badge variant={info.variant}>{info.label}</Badge>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('notifications.title')}</h1>
        <p className="text-muted-foreground">{t('notifications.subtitle')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-lg bg-blue-50 p-3">
              <Bell className="h-6 w-6 text-blue-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('common.total')}</p>
              <p className="text-2xl font-bold">{notifications.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-lg bg-red-50 p-3">
              <BellOff className="h-6 w-6 text-red-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('notifications.unread')}</p>
              <p className="text-2xl font-bold">{unreadCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-lg bg-emerald-50 p-3">
              <Settings className="h-6 w-6 text-emerald-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Notifications</p>
              <p className="text-2xl font-bold">{settings?.notificationsEnabled ? 'ON' : 'OFF'}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Notification Settings */}
      {settings && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Settings className="h-5 w-5" />
              {t('notifications.settings')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { key: 'notificationsEnabled' as const, label: 'All Notifications' },
                { key: 'matchNotifications' as const, label: 'Match Notifications' },
                { key: 'messageNotifications' as const, label: 'Message Notifications' },
                { key: 'likeNotifications' as const, label: 'Like Notifications' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => toggleSetting(key)}
                  disabled={settingsLoading}
                  className={`flex items-center justify-between rounded-lg border p-4 transition-colors ${
                    settings[key] ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200 bg-gray-50'
                  }`}
                >
                  <span className="text-sm font-medium">{label}</span>
                  <Badge variant={settings[key] ? 'success' : 'secondary'}>
                    {settings[key] ? 'ON' : 'OFF'}
                  </Badge>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Notifications List */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-lg">{t('notifications.title')}</CardTitle>
          {unreadCount > 0 && (
            <Button size="sm" variant="outline" onClick={handleMarkAllRead} className="gap-1">
              <CheckCheck className="h-4 w-4" /> {t('notifications.markAllRead')}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : notifications.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">{t('notifications.noNotifications')}</p>
          ) : (
            <div className="space-y-2">
              {notifications.map((notif) => (
                <div
                  key={notif.id}
                  className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
                    notif.isRead ? 'bg-background' : 'bg-blue-50/50 border-blue-200'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {typeBadge(notif.type)}
                      <span className="text-sm font-medium">{notif.title}</span>
                      {!notif.isRead && <span className="h-2 w-2 rounded-full bg-blue-500" />}
                    </div>
                    <p className="text-sm text-muted-foreground">{notif.body}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">{formatDateTime(notif.createdAt)}</p>
                  </div>
                  <div className="flex gap-1">
                    {!notif.isRead && (
                      <Button size="icon" variant="ghost" onClick={() => handleMarkRead(notif.id)}>
                        <CheckCheck className="h-4 w-4" />
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" className="text-red-500" onClick={() => handleDelete(notif.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
