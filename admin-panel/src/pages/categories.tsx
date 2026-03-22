import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { categoriesApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  Users,
  ChevronDown,
  ChevronUp,
  Layers,
  Power,
  PowerOff,
  Hash,
  Palette,
} from 'lucide-react'

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
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [rebuilding, setRebuilding] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Form state
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
      const payload = {
        ...form,
        rules: form.rules.filter(r => r.field && r.operator),
      }
      if (editingId) {
        await categoriesApi.update(editingId, payload)
      } else {
        await categoriesApi.create(payload)
      }
      resetForm()
      fetchCategories()
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Failed to save category')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this category? This cannot be undone.')) return
    try {
      await categoriesApi.remove(id)
      fetchCategories()
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Failed to delete')
    }
  }

  const handleRebuild = async (id: string) => {
    setRebuilding(id)
    try {
      const res = await categoriesApi.rebuild(id)
      const data = res.data
      alert(`Rebuilt: ${data?.userCount ?? 0} users matched`)
      fetchCategories()
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Rebuild failed')
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

  return (
    <div className="space-y-6">
      {/* Header */}
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
        <button
          onClick={() => { resetForm(); setShowForm(true) }}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Category
        </button>
      </div>

      {/* Create/Edit Form */}
      {showForm && (
        <div className="rounded-xl border bg-card p-6 shadow-sm space-y-5">
          <h2 className="text-lg font-semibold">
            {editingId ? 'Edit Category' : 'Create Category'}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground">Name *</label>
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="e.g. Devout & Ready"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Icon Key</label>
              <input
                value={form.icon}
                onChange={e => setForm(f => ({ ...f, icon: e.target.value }))}
                className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="e.g. mosque, heart, star"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-sm font-medium text-muted-foreground">Description</label>
              <textarea
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                rows={2}
                placeholder="Short description of this category"
              />
            </div>
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="text-sm font-medium text-muted-foreground">Status</label>
                <select
                  value={form.status}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value as any }))}
                  className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
              <div className="w-24">
                <label className="text-sm font-medium text-muted-foreground">Order</label>
                <input
                  type="number"
                  value={form.sortOrder}
                  onChange={e => setForm(f => ({ ...f, sortOrder: +e.target.value }))}
                  className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div className="w-24">
                <label className="text-sm font-medium text-muted-foreground">Color</label>
                <input
                  type="color"
                  value={form.color}
                  onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                  className="mt-1 h-[38px] w-full rounded-lg border bg-background cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* Rules Engine */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Rules (AND logic — all must match)</h3>
              <button onClick={addRule} className="text-xs text-primary hover:underline flex items-center gap-1">
                <Plus className="h-3 w-3" /> Add condition
              </button>
            </div>
            <div className="space-y-2">
              {form.rules.map((rule, idx) => {
                const fieldDef = getFieldDef(rule.field)
                return (
                  <div key={idx} className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
                    <select
                      value={rule.field}
                      onChange={e => updateRule(idx, 'field', e.target.value)}
                      className="flex-1 rounded border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
                    >
                      <option value="">Select field...</option>
                      {PROFILE_FIELDS.map(f => (
                        <option key={f.value} value={f.value}>{f.label}</option>
                      ))}
                    </select>
                    <select
                      value={rule.operator}
                      onChange={e => updateRule(idx, 'operator', e.target.value)}
                      className="w-36 rounded border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
                    >
                      {OPERATORS.map(op => (
                        <option key={op.value} value={op.value}>{op.label}</option>
                      ))}
                    </select>
                    {fieldDef?.type === 'enum' ? (
                      <select
                        value={String(rule.value)}
                        onChange={e => updateRule(idx, 'value', e.target.value)}
                        className="flex-1 rounded border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
                      >
                        <option value="">Select value...</option>
                        {fieldDef.options?.map(opt => (
                          <option key={opt} value={opt}>{opt.replace(/_/g, ' ')}</option>
                        ))}
                      </select>
                    ) : fieldDef?.type === 'boolean' ? (
                      <select
                        value={String(rule.value)}
                        onChange={e => updateRule(idx, 'value', e.target.value === 'true')}
                        className="flex-1 rounded border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
                      >
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    ) : (
                      <input
                        value={String(rule.value)}
                        onChange={e => updateRule(idx, 'value', fieldDef?.type === 'number' ? +e.target.value : e.target.value)}
                        className="flex-1 rounded border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
                        placeholder="Value"
                        type={fieldDef?.type === 'number' ? 'number' : 'text'}
                      />
                    )}
                    <button onClick={() => removeRule(idx)} className="text-red-400 hover:text-red-500 p-1">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={saving || !form.name.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : editingId ? 'Update Category' : 'Create Category'}
            </button>
            <button onClick={resetForm} className="rounded-lg px-4 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Categories List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-20 rounded-xl border bg-card animate-pulse" />
          ))}
        </div>
      ) : categories.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Layers className="h-12 w-12 mb-3 opacity-30" />
          <p className="text-sm">No categories yet. Create your first one above.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {categories.map(cat => (
            <div key={cat.id} className="rounded-xl border bg-card shadow-sm overflow-hidden">
              <div
                className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => setExpandedId(expandedId === cat.id ? null : cat.id)}
              >
                {/* Color dot */}
                <div
                  className="h-3 w-3 rounded-full shrink-0 ring-2 ring-offset-2 ring-offset-card"
                  style={{ backgroundColor: cat.color || '#2d7a4f', ringColor: cat.color || '#2d7a4f' }}
                />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold truncate">{cat.name}</h3>
                    <span className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
                      cat.status === 'active'
                        ? 'bg-emerald-500/10 text-emerald-600'
                        : 'bg-zinc-500/10 text-zinc-500'
                    )}>
                      {cat.status === 'active' ? <Power className="h-2.5 w-2.5" /> : <PowerOff className="h-2.5 w-2.5" />}
                      {cat.status}
                    </span>
                  </div>
                  {cat.description && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{cat.description}</p>
                  )}
                </div>

                <div className="flex items-center gap-6 shrink-0">
                  <div className="text-center">
                    <div className="text-lg font-bold">{cat.userCount}</div>
                    <div className="text-[10px] text-muted-foreground">users</div>
                  </div>
                  <div className="text-center">
                    <div className="text-sm font-medium">{cat.rules?.length || 0}</div>
                    <div className="text-[10px] text-muted-foreground">rules</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={e => { e.stopPropagation(); openEdit(cat) }}
                      className="rounded-lg p-2 text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
                      title="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); handleRebuild(cat.id) }}
                      disabled={rebuilding === cat.id}
                      className="rounded-lg p-2 text-muted-foreground hover:bg-blue-500/10 hover:text-blue-500 transition-colors disabled:opacity-50"
                      title="Rebuild (re-evaluate all users)"
                    >
                      <RefreshCw className={cn('h-4 w-4', rebuilding === cat.id && 'animate-spin')} />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); handleDelete(cat.id) }}
                      className="rounded-lg p-2 text-muted-foreground hover:bg-red-500/10 hover:text-red-500 transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  {expandedId === cat.id ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </div>
              </div>

              {/* Expanded: show rules detail */}
              {expandedId === cat.id && (
                <div className="border-t bg-muted/20 px-5 py-4">
                  <h4 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Rules</h4>
                  {(!cat.rules || cat.rules.length === 0) ? (
                    <p className="text-xs text-muted-foreground italic">No rules defined — category is manual.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {cat.rules.map((rule, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <span className="rounded bg-primary/10 px-2 py-0.5 font-mono text-primary">{rule.field}</span>
                          <span className="text-muted-foreground font-medium">{rule.operator}</span>
                          <span className="rounded bg-muted px-2 py-0.5 font-mono">{String(rule.value)}</span>
                          {i < cat.rules.length - 1 && (
                            <span className="text-[10px] font-bold text-amber-500 uppercase">AND</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 flex items-center gap-4 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1"><Hash className="h-3 w-3" /> Order: {cat.sortOrder}</span>
                    <span className="flex items-center gap-1"><Palette className="h-3 w-3" /> {cat.color || 'none'}</span>
                    <span>Created: {new Date(cat.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
