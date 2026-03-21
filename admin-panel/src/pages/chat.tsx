import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { chatApi } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { Conversation, Message } from '@/types'
import { formatDateTime } from '@/lib/utils'
import { Loader2, MessageSquare, Eye, ArrowLeft, VolumeX, Volume2 } from 'lucide-react'

export default function ChatPage() {
  const { t } = useTranslation()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedConvo, setSelectedConvo] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await chatApi.getConversations()
        setConversations(Array.isArray(data) ? data : data?.conversations || [])
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const viewMessages = async (conversationId: string) => {
    setSelectedConvo(conversationId)
    setMessagesLoading(true)
    try {
      const { data } = await chatApi.getMessages(conversationId)
      setMessages(Array.isArray(data) ? data : data?.messages || [])
    } catch (err) {
      console.error(err)
    } finally {
      setMessagesLoading(false)
    }
  }

  const handleMute = async (conversationId: string) => {
    try {
      await chatApi.muteConversation(conversationId)
      setConversations(prev =>
        prev.map(c => c.id === conversationId ? { ...c, isMuted: !c.isMuted } : c)
      )
    } catch (err) {
      console.error(err)
    }
  }

  if (selectedConvo) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => { setSelectedConvo(null); setMessages([]) }} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> {t('chat.backToConversations')}
        </Button>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">{t('chat.messages')}</CardTitle>
          </CardHeader>
          <CardContent>
            {messagesLoading ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : messages.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">{t('chat.noMessages')}</p>
            ) : (
              <div className="space-y-3 max-h-[600px] overflow-y-auto">
                {messages.map((msg) => (
                  <div key={msg.id} className="flex gap-3 rounded-lg border p-3 hover:bg-muted/50">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium">
                          {msg.sender ? `${msg.sender.firstName} ${msg.sender.lastName}` : msg.senderId.slice(0, 8)}
                        </span>
                        <Badge variant="secondary" className="text-[10px]">{msg.type || 'text'}</Badge>
                        {msg.isRead && <Badge variant="info" className="text-[10px]">Read</Badge>}
                        {msg.isDelivered && !msg.isRead && <Badge variant="outline" className="text-[10px]">Delivered</Badge>}
                      </div>
                      <p className="text-sm">{msg.content}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">{formatDateTime(msg.createdAt)}</p>
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('chat.title')}</h1>
        <p className="text-muted-foreground">{t('chat.subtitle')}</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            {t('chat.conversations')} ({conversations.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : conversations.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">{t('chat.noConversations')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-3 pe-4 font-medium">{t('chat.participants')}</th>
                    <th className="pb-3 pe-4 font-medium">{t('chat.lastMessage')}</th>
                    <th className="pb-3 pe-4 font-medium">{t('users.status')}</th>
                    <th className="pb-3 pe-4 font-medium">{t('chat.lastActivity')}</th>
                    <th className="pb-3 font-medium text-end">{t('users.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {conversations.map((convo) => (
                    <tr key={convo.id} className="hover:bg-muted/50">
                      <td className="py-3 pr-4">
                        <div className="flex flex-col">
                          <span className="font-medium text-xs">
                            {convo.participant1 ? `${convo.participant1.firstName} ${convo.participant1.lastName}` : convo.participant1Id?.slice(0, 8)}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            vs {convo.participant2 ? `${convo.participant2.firstName} ${convo.participant2.lastName}` : convo.participant2Id?.slice(0, 8)}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 pr-4 max-w-[200px] truncate text-muted-foreground">
                        {convo.lastMessage?.content || '-'}
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex gap-1">
                          {convo.isMuted && <Badge variant="warning">Muted</Badge>}
                          {(convo.unreadCount ?? 0) > 0 && (
                            <Badge variant="destructive">{convo.unreadCount} unread</Badge>
                          )}
                          {!convo.isMuted && (convo.unreadCount ?? 0) === 0 && (
                            <Badge variant="secondary">Active</Badge>
                          )}
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground whitespace-nowrap">
                        {convo.lastMessageAt ? formatDateTime(convo.lastMessageAt) : formatDateTime(convo.createdAt)}
                      </td>
                      <td className="py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="icon" variant="ghost" onClick={() => viewMessages(convo.id)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => handleMute(convo.id)}>
                            {convo.isMuted ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
