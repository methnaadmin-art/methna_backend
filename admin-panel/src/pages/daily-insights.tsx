import { useEffect, useState } from 'react'
import { adminApi } from '@/lib/api'
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Loader2,
  Plus,
  Pencil,
  Trash2,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Sprout,
} from 'lucide-react'

interface Insight {
  id: string
  content: string
  author: string | null
  category: string
  scheduledDate: string | null
  isActive: boolean
  displayCount: number
  createdAt: string
}

const categoryColors: Record<string, string> = {
  marriage: 'bg-pink-100 text-pink-700',
  patience: 'bg-blue-100 text-blue-700',
  love: 'bg-red-100 text-red-700',
  faith: 'bg-emerald-100 text-emerald-700',
  general: 'bg-gray-100 text-gray-700',
}

export default function DailyInsightsPage() {
  const [insights, setInsights] = useState<Insight[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [limit] = useState(20)
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingInsight, setEditingInsight] = useState<Insight | null>(null)
  const [seeding, setSeeding] = useState(false)

  // Form state
  const [formContent, setFormContent] = useState('')
  const [formAuthor, setFormAuthor] = useState('')
  const [formCategory, setFormCategory] = useState('general')
  const [formScheduledDate, setFormScheduledDate] = useState('')
  const [saving, setSaving] = useState(false)

  const fetchInsights = async () => {
    setLoading(true)
    try {
      const res = await adminApi.get('/daily-insights', { params: { page, limit } })
      const data = res.data
      setInsights(data.items || [])
      setTotal(data.total || 0)
    } catch (err) {
      console.error('Failed to fetch insights', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchInsights() }, [page])

  const openCreate = () => {
    setEditingInsight(null)
    setFormContent('')
    setFormAuthor('')
    setFormCategory('general')
    setFormScheduledDate('')
    setDialogOpen(true)
  }

  const openEdit = (insight: Insight) => {
    setEditingInsight(insight)
    setFormContent(insight.content)
    setFormAuthor(insight.author || '')
    setFormCategory(insight.category)
    setFormScheduledDate(insight.scheduledDate?.split('T')[0] || '')
    setDialogOpen(true)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const body: any = {
        content: formContent,
        author: formAuthor || undefined,
        category: formCategory,
        scheduledDate: formScheduledDate || undefined,
      }
      if (editingInsight) {
        await adminApi.put(`/daily-insights/${editingInsight.id}`, body)
      } else {
        await adminApi.post('/daily-insights', body)
      }
      setDialogOpen(false)
      fetchInsights()
    } catch (err) {
      console.error('Failed to save insight', err)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this insight?')) return
    try {
      await adminApi.delete(`/daily-insights/${id}`)
      fetchInsights()
    } catch (err) {
      console.error('Failed to delete insight', err)
    }
  }

  const handleToggleActive = async (insight: Insight) => {
    try {
      await adminApi.put(`/daily-insights/${insight.id}`, { isActive: !insight.isActive })
      fetchInsights()
    } catch (err) {
      console.error('Failed to toggle insight', err)
    }
  }

  const handleSeed = async () => {
    setSeeding(true)
    try {
      await adminApi.post('/daily-insights/seed')
      fetchInsights()
    } catch (err) {
      console.error('Failed to seed insights', err)
    } finally {
      setSeeding(false)
    }
  }

  const totalPages = Math.ceil(total / limit)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Daily Halal Insights</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage daily Islamic wisdom shown to users on the home screen
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSeed} disabled={seeding}>
            {seeding ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sprout className="w-4 h-4 mr-2" />}
            Seed Defaults
          </Button>
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4 mr-2" />
            Add Insight
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Insights</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600">
              {insights.filter(i => i.isActive).length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Scheduled</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {insights.filter(i => i.scheduledDate).length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* List */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : insights.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Sparkles className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>No insights yet. Click "Seed Defaults" to add initial content.</p>
            </div>
          ) : (
            <div className="divide-y">
              {insights.map((insight) => (
                <div key={insight.id} className="p-4 flex items-start gap-4 hover:bg-muted/30 transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm leading-relaxed">{insight.content}</p>
                    <div className="flex items-center gap-2 mt-2">
                      {insight.author && (
                        <span className="text-xs text-muted-foreground italic">— {insight.author}</span>
                      )}
                      <Badge variant="secondary" className={`text-xs ${categoryColors[insight.category] || categoryColors.general}`}>
                        {insight.category}
                      </Badge>
                      {insight.scheduledDate && (
                        <Badge variant="outline" className="text-xs">
                          Scheduled: {new Date(insight.scheduledDate).toLocaleDateString()}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        Shown {insight.displayCount}x
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggleActive(insight)}
                      className={insight.isActive ? 'text-emerald-600' : 'text-muted-foreground'}
                    >
                      {insight.isActive ? 'Active' : 'Inactive'}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => openEdit(insight)}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(insight.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingInsight ? 'Edit Insight' : 'New Insight'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Content *</label>
              <Textarea
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
                placeholder="Enter wisdom content..."
                rows={3}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Author / Source</label>
              <Input
                value={formAuthor}
                onChange={(e) => setFormAuthor(e.target.value)}
                placeholder='e.g. Prophet Muhammad (PBUH), Quran 30:21'
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Category</label>
                <Select value={formCategory} onValueChange={setFormCategory}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">General</SelectItem>
                    <SelectItem value="marriage">Marriage</SelectItem>
                    <SelectItem value="faith">Faith</SelectItem>
                    <SelectItem value="patience">Patience</SelectItem>
                    <SelectItem value="love">Love</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Scheduled Date</label>
                <Input
                  type="date"
                  value={formScheduledDate}
                  onChange={(e) => setFormScheduledDate(e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !formContent.trim()}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editingInsight ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
