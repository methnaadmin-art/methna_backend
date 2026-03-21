import { useState } from 'react'
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
import { Loader2, Bell, Send, Users, User, CheckCircle2 } from 'lucide-react'

export default function SendNotificationsPage() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'single' | 'broadcast'>('single')
  const [userId, setUserId] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [type, setType] = useState('system')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)

  const handleSend = async () => {
    if (!title.trim() || !body.trim()) return
    if (mode === 'single' && !userId.trim()) return

    setLoading(true)
    setResult(null)
    try {
      const { data } = await adminApi.sendNotification({
        userId: mode === 'single' ? userId.trim() : undefined,
        title: title.trim(),
        body: body.trim(),
        type,
        broadcast: mode === 'broadcast',
      })
      setResult({
        success: true,
        message: `Notification sent to ${data.sent || 1} user(s)${data.broadcast ? ' (broadcast)' : ''}.`,
      })
      setTitle('')
      setBody('')
      setUserId('')
    } catch (err: any) {
      setResult({
        success: false,
        message: err.response?.data?.message || 'Failed to send notification',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('sendNotifications.title')}</h1>
        <p className="text-muted-foreground">{t('sendNotifications.subtitle')}</p>
      </div>

      {/* Mode Selection */}
      <div className="flex gap-3">
        <Card
          className={`flex-1 cursor-pointer transition-all ${mode === 'single' ? 'border-primary ring-2 ring-primary/20' : 'hover:border-primary/50'}`}
          onClick={() => setMode('single')}
        >
          <CardContent className="flex items-center gap-4 p-6">
            <div className={`rounded-lg p-3 ${mode === 'single' ? 'bg-primary/10' : 'bg-muted'}`}>
              <User className={`h-6 w-6 ${mode === 'single' ? 'text-primary' : 'text-muted-foreground'}`} />
            </div>
            <div>
              <p className="font-semibold">{t('sendNotifications.singleUser')}</p>
              <p className="text-xs text-muted-foreground">{t('sendNotifications.singleUserDesc')}</p>
            </div>
          </CardContent>
        </Card>
        <Card
          className={`flex-1 cursor-pointer transition-all ${mode === 'broadcast' ? 'border-primary ring-2 ring-primary/20' : 'hover:border-primary/50'}`}
          onClick={() => setMode('broadcast')}
        >
          <CardContent className="flex items-center gap-4 p-6">
            <div className={`rounded-lg p-3 ${mode === 'broadcast' ? 'bg-primary/10' : 'bg-muted'}`}>
              <Users className={`h-6 w-6 ${mode === 'broadcast' ? 'text-primary' : 'text-muted-foreground'}`} />
            </div>
            <div>
              <p className="font-semibold">{t('sendNotifications.broadcast')}</p>
              <p className="text-xs text-muted-foreground">{t('sendNotifications.broadcastDesc')}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Compose */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Bell className="h-5 w-5" />
            {t('sendNotifications.compose')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {mode === 'single' && (
            <div>
              <label className="text-sm font-medium">{t('sendNotifications.userId')} *</label>
              <Input
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder={t('sendNotifications.userIdPlaceholder')}
                className="mt-1"
              />
            </div>
          )}

          {mode === 'broadcast' && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm text-amber-800 font-medium">{t('sendNotifications.broadcast')}</p>
              <p className="text-xs text-amber-700">{t('sendNotifications.broadcastWarning')}</p>
            </div>
          )}

          <div>
            <label className="text-sm font-medium">{t('sendNotifications.type')}</label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">{t('sendNotifications.system')}</SelectItem>
                <SelectItem value="match">{t('sendNotifications.match')}</SelectItem>
                <SelectItem value="message">{t('sendNotifications.message')}</SelectItem>
                <SelectItem value="like">{t('sendNotifications.like')}</SelectItem>
                <SelectItem value="subscription">{t('sendNotifications.subscription')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium">{t('sendNotifications.titleField')} *</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('sendNotifications.titlePlaceholder')}
              className="mt-1"
            />
          </div>

          <div>
            <label className="text-sm font-medium">{t('sendNotifications.body')} *</label>
            <textarea
              className="w-full mt-1 rounded-md border px-3 py-2 text-sm min-h-[120px] resize-none focus:outline-none focus:ring-2 focus:ring-primary"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t('sendNotifications.bodyPlaceholder')}
            />
          </div>

          {/* Preview */}
          <div>
            <label className="text-sm font-medium text-muted-foreground">{t('sendNotifications.preview')}</label>
            <div className="mt-1 rounded-lg border bg-white shadow-sm p-4">
              <div className="flex items-start gap-3">
                <div className="rounded-full bg-primary/10 p-2 mt-0.5">
                  <Bell className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">{title || 'Notification Title'}</p>
                    <Badge variant="secondary" className="text-[10px] capitalize">{type}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">{body || 'Notification body text...'}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">Just now</p>
                </div>
              </div>
            </div>
          </div>

          {result && (
            <div className={`rounded-lg p-3 ${result.success ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
              <div className="flex items-center gap-2">
                {result.success && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                <p className={`text-sm font-medium ${result.success ? 'text-emerald-700' : 'text-red-700'}`}>
                  {result.message}
                </p>
              </div>
            </div>
          )}

          <Button
            onClick={handleSend}
            disabled={loading || !title.trim() || !body.trim() || (mode === 'single' && !userId.trim())}
            className="w-full gap-2"
            size="lg"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {mode === 'broadcast' ? t('sendNotifications.broadcastToAll') : t('sendNotifications.send')}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
