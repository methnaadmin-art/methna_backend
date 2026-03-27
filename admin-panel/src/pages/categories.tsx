import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { categoriesApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import * as icons from 'lucide-react'
import {
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Layers,
  Power,
  PowerOff,
  Hash,
  Palette,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'

interface RuleCondition {
  field: string
  operator: string
  value: string | number | boolean
}

interface Category {
  id: string
  name: string
  description: string
  icon: string
  status: 'active' | 'inactive'
  sortOrder: number
  rules: RuleCondition[]
  color: string
  userCount: number
  createdAt: string
  updatedAt: string
}

const PROFILE_FIELDS = [
  { value: 'gender', label: 'Gender', type: 'enum', options: ['male', 'female'] },
  { value: 'maritalStatus', label: 'Marital Status', type: 'enum', options: ['never_married', 'divorced', 'widowed', 'married'] },
  { value: 'religiousLevel', label: 'Religious Level', type: 'enum', options: ['very_practicing', 'practicing', 'moderate', 'liberal'] },
  { value: 'prayerFrequency', label: 'Prayer Frequency', type: 'enum', options: ['actively_practicing', 'occasionally', 'not_practicing'] },
  { value: 'sect', label: 'Sect', type: 'enum', options: ['sunni', 'shia', 'sufi', 'other'] },
  { value: 'education', label: 'Education', type: 'enum', options: ['high_school', 'bachelors', 'masters', 'doctorate', 'islamic_studies', 'other'] },
  { value: 'marriageIntention', label: 'Marriage Intention', type: 'enum', options: ['within_months', 'within_year', 'one_to_two_years', 'not_sure', 'just_exploring'] },
  { value: 'familyPlans', label: 'Family Plans', type: 'enum', options: ['wants_children', 'doesnt_want', 'open_to_it', 'has_and_wants_more', 'has_and_done'] },
  { value: 'willingToRelocate', label: 'Willing to Relocate', type: 'boolean' },
  { value: 'hasChildren', label: 'Has Children', type: 'boolean' },
  { value: 'wantsChildren', label: 'Wants Children', type: 'boolean' },
  { value: 'hijabStatus', label: 'Hijab Status', type: 'enum', options: ['covered', 'niqab', 'not_covered'] },
  { value: 'dietary', label: 'Dietary', type: 'enum', options: ['halal', 'non_strict'] },
  { value: 'height', label: 'Height (cm)', type: 'number' },
  { value: 'profileCompletionPercentage', label: 'Profile Completion %', type: 'number' },
  { value: 'activityScore', label: 'Activity Score', type: 'number' },
  { value: 'country', label: 'Country', type: 'string' },
  { value: 'city', label: 'City', type: 'string' },
]

const OPERATORS = [
  { value: '=', label: 'equals' },
  { value: '!=', label: 'not equals' },
  { value: '>', label: 'greater than' },
  { value: '<', label: 'less than' },
  { value: '>=', label: 'greater or equal' },
  { value: '<=', label: 'less or equal' },
  { value: 'includes', label: 'includes' },
  { value: 'not_includes', label: 'not includes' },
]

const emptyRule: RuleCondition = { field: '', operator: '=', value: '' }

export default function CategoriesPage() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [rebuilding, setRebuilding] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState({
    name: '',
    description: '',
    icon: '',
    status: 'active' as 'active' | 'inactive',
    sortOrder: 0,
    color: '#2d7a4f',
    rules: [{ ...emptyRule }] as RuleCondition[],
  })

  const fetchCategories = useCallback(async () => {
    try {
      setLoading(true)
      const res = await categoriesApi.getAllAdmin()
      setCategories(Array.isArray(res.data) ? res.data : [])
    } catch {
      setCategories([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchCategories() }, [fetchCategories])

  const resetForm = () => {
    setForm({ name: '', description: '', icon: '', status: 'active', sortOrder: 0, color: '#2d7a4f', rules: [{ ...emptyRule }] })
    setEditingId(null)
    setShowForm(false)
  }

  const openEdit = (cat: Category) => {
    setForm({
      name: cat.name,
      description: cat.description || '',
      icon: cat.icon || '',
      status: cat.status,
      sortOrder: cat.sortOrder,
      color: cat.color || '#2d7a4f',
      rules: cat.rules?.length ? cat.rules : [{ ...emptyRule }],
    })
    setEditingId(cat.id)
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      // Clean payload: strip empty optional fields to avoid DTO validation issues
      const validRules = form.rules.filter(r => r.field && r.operator)
      const payload: Record<string, any> = {
        name: form.name.trim(),
        status: form.status,
        sortOrder: form.sortOrder,
        color: form.color,
      }
      if (form.description.trim()) payload.description = form.description.trim()
      if (form.icon.trim()) payload.icon = form.icon.trim()
      if (validRules.length > 0) payload.rules = validRules

      if (editingId) {
        await categoriesApi.update(editingId, payload)
        toast({ title: 'Category Updated', variant: 'success' })
      } else {
        await categoriesApi.create(payload)
        toast({ title: 'Category Created', variant: 'success' })
      }
      resetForm()
      fetchCategories()
    } catch (err: any) {
      const msg = err?.response?.data?.message
      const description = Array.isArray(msg) ? msg.join(', ') : (msg || 'Failed to save category')
      toast({ title: 'Error', description, variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this category? This cannot be undone.')) return
    try {
      await categoriesApi.remove(id)
      toast({ title: 'Category Deleted', variant: 'warning' })
      fetchCategories()
    } catch (err: any) {
      toast({ title: 'Error', description: err?.response?.data?.message || 'Failed to delete', variant: 'error' })
    }
  }

  const handleRebuild = async (id: string) => {
    setRebuilding(id)
    try {
      const res = await categoriesApi.rebuild(id)
      toast({ title: 'Rebuild Successful', description: `Matched ${res.data?.userCount ?? 0} users`, variant: 'success' })
      fetchCategories()
    } catch (err: any) {
      toast({ title: 'Rebuild Failed', description: err?.response?.data?.message || 'Action failed', variant: 'error' })
    } finally {
      setRebuilding(null)
    }
  }

  const addRule = () => setForm(f => ({ ...f, rules: [...f.rules, { ...emptyRule }] }))
  const removeRule = (idx: number) => setForm(f => ({ ...f, rules: f.rules.filter((_, i) => i !== idx) }))
  const updateRule = (idx: number, key: keyof RuleCondition, val: any) => {
    setForm(f => ({
      ...f,
      rules: f.rules.map((r, i) => i === idx ? { ...r, [key]: val } : r),
    }))
  }

  const getFieldDef = (field: string) => PROFILE_FIELDS.find(f => f.value === field)

  const [iconSearch, setIconSearch] = useState('')

  const ICONS = {
    'heart': <icons.Heart />, 'star': <icons.Star />, 'crown': <icons.Crown />, 'zap': <icons.Zap />,
    'sparkles': <icons.Sparkles />, 'shield': <icons.Shield />, 'award': <icons.Award />, 'compass': <icons.Compass />,
    'gift': <icons.Gift />, 'coffee': <icons.Coffee />, 'music': <icons.Music />, 'camera': <icons.Camera />,
    'globe': <icons.Globe />, 'activity': <icons.Activity />, 'users': <icons.Users />, 'flame': <icons.Flame />,
    'moon': <icons.Moon />, 'sun': <icons.Sun />, 'cloud': <icons.Cloud />, 'briefcase': <icons.Briefcase />,
    'graduation-cap': <icons.GraduationCap />, 'landmark': <icons.Landmark />, 'palette': <icons.Palette />,
    'utensils': <icons.Utensils />, 'plane': <icons.Plane />, 'car': <icons.Car />, 'bike': <icons.Bike />,
    'medal': <icons.Medal />, 'trophy': <icons.Trophy />, 'target': <icons.Target />,
  }

  const filteredIcons = Object.keys(ICONS).filter(k => k.includes(iconSearch.toLowerCase()))

  return (
    <div className="space-y-6">
      {/* ... Header stays same ... */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Layers className="h-6 w-6 text-primary" />
            Categories
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Dynamic user categories with rule-based auto-assignment
          </p>
        </div>
        <Button onClick={() => { resetForm(); setShowForm(true) }} className="gap-2">
          <Plus className="h-4 w-4" /> New Category
        </Button>
      </div>

      {showForm && (
        <Card className="shadow-sm border-primary/20 bg-muted/5">
          <CardHeader>
            <CardTitle className="text-lg">{editingId ? 'Edit Category' : 'Create Category'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Name *</label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Active Users" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Icon Selector</label>
                <div className="flex items-center gap-2">
                  <Select value={form.icon} onValueChange={(v: any) => setForm(f => ({ ...f, icon: v }))}>
                    <SelectTrigger className="flex-1 capitalize">
                      <div className="flex items-center gap-2">
                        {form.icon && ICONS[form.icon as keyof typeof ICONS]}
                        <SelectValue placeholder="Select icon..." />
                      </div>
                    </SelectTrigger>
                    <SelectContent className="max-h-[300px]">
                      <div className="p-2 sticky top-0 bg-popover z-10">
                        <Input 
                          placeholder="Search icons..." 
                          value={iconSearch} 
                          onChange={e => setIconSearch(e.target.value)}
                          onClick={e => e.stopPropagation()}
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="grid grid-cols-5 gap-1 p-1">
                        {filteredIcons.map(iconKey => (
                          <SelectItem 
                            key={iconKey} 
                            value={iconKey}
                            className="p-2 cursor-pointer hover:bg-muted rounded-md flex items-center justify-center"
                          >
                            <div className="h-6 w-6 flex items-center justify-center">
                              {ICONS[iconKey as keyof typeof ICONS]}
                            </div>
                          </SelectItem>
                        ))}
                      </div>
                    </SelectContent>
                  </Select>
                  {form.icon && (
                    <Button variant="ghost" size="icon" onClick={() => setForm(f => ({ ...f, icon: '' }))} className="h-10 w-10 text-muted-foreground">
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
              <div className="md:col-span-2 space-y-1.5">
                <label className="text-sm font-medium">Description</label>
                <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} />
              </div>
              <div className="flex gap-4">
                <div className="flex-1 space-y-1.5">
                  <label className="text-sm font-medium">Status</label>
                  <Select value={form.status} onValueChange={(v: any) => setForm(f => ({ ...f, status: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-24 space-y-1.5">
                  <label className="text-sm font-medium">Order</label>
                  <Input type="number" value={form.sortOrder} onChange={e => setForm(f => ({ ...f, sortOrder: +e.target.value }))} />
                </div>
                <div className="w-24 space-y-1.5">
                  <label className="text-sm font-medium">Color</label>
                  <Input type="color" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} className="h-10 p-1 cursor-pointer" />
                </div>
              </div>
            </div>

            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">Rules (AND logic)</h3>
                <Button variant="ghost" size="sm" onClick={addRule} className="text-primary h-8"><Plus className="h-3 w-3 mr-1" /> Add condition</Button>
              </div>
              <div className="space-y-2">
                {form.rules.map((rule, idx) => {
                  const fieldDef = getFieldDef(rule.field)
                  return (
                    <div key={idx} className="flex items-center gap-2 rounded-lg border bg-muted/30 p-2">
                      <Select value={rule.field} onValueChange={v => updateRule(idx, 'field', v)}>
                        <SelectTrigger className="flex-1 h-9"><SelectValue placeholder="Field..." /></SelectTrigger>
                        <SelectContent>
                          {PROFILE_FIELDS.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Select value={rule.operator} onValueChange={v => updateRule(idx, 'operator', v)}>
                        <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {OPERATORS.map(op => <SelectItem key={op.value} value={op.value}>{op.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {fieldDef?.type === 'enum' ? (
                        <Select value={String(rule.value)} onValueChange={v => updateRule(idx, 'value', v)}>
                          <SelectTrigger className="flex-1 h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {fieldDef.options?.map(opt => <SelectItem key={opt} value={opt}>{opt.replace(/_/g, ' ')}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : fieldDef?.type === 'boolean' ? (
                        <Select value={String(rule.value)} onValueChange={v => updateRule(idx, 'value', v === 'true')}>
                          <SelectTrigger className="flex-1 h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="true">true</SelectItem>
                            <SelectItem value="false">false</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input className="flex-1 h-9" value={String(rule.value)} onChange={e => updateRule(idx, 'value', fieldDef?.type === 'number' ? +e.target.value : e.target.value)} type={fieldDef?.type === 'number' ? 'number' : 'text'} />
                      )}
                      <Button variant="ghost" size="icon" onClick={() => removeRule(idx)} className="text-red-500 h-9 w-9"><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <Button onClick={handleSave} disabled={saving || !form.name.trim()}>{saving ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : null} {editingId ? 'Update Category' : 'Create Category'}</Button>
              <Button variant="ghost" onClick={resetForm}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {loading ? [1, 2, 3].map(i => <div key={i} className="h-20 rounded-xl border bg-card animate-pulse" />) :
          categories.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground border rounded-xl bg-muted/5">
              <Layers className="h-12 w-12 mb-3 opacity-20" />
              <p className="text-sm">No categories yet.</p>
            </div>
          ) : categories.map(cat => (
            <Card key={cat.id} className="overflow-hidden">
              <div className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => setExpandedId(expandedId === cat.id ? null : cat.id)}>
                <div
                  className="h-3 w-3 rounded-full shrink-0"
                  style={{
                    backgroundColor: cat.color || '#2d7a4f',
                    boxShadow: `0 0 0 2px ${cat.color || '#2d7a4f'}33`,
                  }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold truncate">{cat.name}</h3>
                    <Badge variant={cat.status === 'active' ? 'success' : 'secondary'} className="text-[10px] h-5">
                      {cat.status === 'active' ? <Power className="h-2.5 w-2.5 mr-1" /> : <PowerOff className="h-2.5 w-2.5 mr-1" />}
                      {cat.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    {cat.icon && (
                      <div className="p-1 rounded bg-primary/5 text-primary">
                        {ICONS[cat.icon as keyof typeof ICONS] || <icons.Layers className="h-3 w-3" />}
                      </div>
                    )}
                    {cat.description && <p className="text-xs text-muted-foreground truncate">{cat.description}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-6 shrink-0">
                  <div className="text-center"><div className="text-lg font-bold">{cat.userCount}</div><div className="text-[10px] text-muted-foreground">users</div></div>
                  <div className="text-center"><div className="text-sm font-medium">{cat.rules?.length || 0}</div><div className="text-[10px] text-muted-foreground">rules</div></div>
                  <div className="flex items-center gap-1">
                    <Button size="icon" variant="ghost" onClick={e => { e.stopPropagation(); openEdit(cat) }}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" disabled={rebuilding === cat.id} onClick={e => { e.stopPropagation(); handleRebuild(cat.id) }}><RefreshCw className={cn('h-4 w-4', rebuilding === cat.id && 'animate-spin')} /></Button>
                    <Button size="icon" variant="ghost" className="text-red-500" onClick={e => { e.stopPropagation(); handleDelete(cat.id) }}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                  {expandedId === cat.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </div>
              </div>
              {expandedId === cat.id && (
                <div className="border-t bg-muted/20 px-5 py-4 space-y-3">
                  <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Rules</h4>
                  {(!cat.rules || cat.rules.length === 0) ? (
                    <p className="text-xs text-muted-foreground italic">No rules defined.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {cat.rules.map((rule, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs bg-background border rounded px-2 py-1">
                          <span className="font-mono text-primary">{rule.field}</span>
                          <span className="text-muted-foreground">{rule.operator}</span>
                          <span className="font-semibold">{String(rule.value)}</span>
                          {i < cat.rules.length - 1 && <span className="text-[10px] font-bold text-amber-600">AND</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 flex items-center gap-4 text-[10px] text-muted-foreground border-t pt-2">
                    <span className="flex items-center gap-1"><Hash className="h-3 w-3" /> Order: {cat.sortOrder}</span>
                    <span className="flex items-center gap-1"><Palette className="h-3 w-3" /> {cat.color || 'none'}</span>
                    <span className="ml-auto italic">Created: {new Date(cat.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              )}
            </Card>
          ))}
      </div>
    </div>
  )
}
