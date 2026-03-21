import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { matchingApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Loader2, Zap, Search, Target, RefreshCw } from 'lucide-react'

export default function MatchingPage() {
  const { t } = useTranslation()
  const [compatUserId, setCompatUserId] = useState('')
  const [compatResult, setCompatResult] = useState<any>(null)
  const [compatLoading, setCompatLoading] = useState(false)

  const [precomputeLoading, setPrecomputeLoading] = useState(false)
  const [precomputeResult, setPrecomputeResult] = useState<string | null>(null)

  const [suggestions, setSuggestions] = useState<any[]>([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)

  const handleCompatibility = async () => {
    if (!compatUserId.trim()) return
    setCompatLoading(true)
    setCompatResult(null)
    try {
      const { data } = await matchingApi.getCompatibility(compatUserId.trim())
      setCompatResult(data)
    } catch (err: any) {
      setCompatResult({ error: err.response?.data?.message || 'Failed to get compatibility' })
    } finally {
      setCompatLoading(false)
    }
  }

  const handlePrecompute = async () => {
    setPrecomputeLoading(true)
    setPrecomputeResult(null)
    try {
      await matchingApi.precomputeCompatibility()
      setPrecomputeResult('Compatibility scores precomputed successfully!')
    } catch (err: any) {
      setPrecomputeResult(err.response?.data?.message || 'Failed to precompute')
    } finally {
      setPrecomputeLoading(false)
    }
  }

  const handleSuggestions = async () => {
    setSuggestionsLoading(true)
    try {
      const { data } = await matchingApi.getSmartSuggestions()
      setSuggestions(Array.isArray(data) ? data : data?.suggestions || [])
    } catch (err) {
      console.error(err)
    } finally {
      setSuggestionsLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('matching.title')}</h1>
        <p className="text-muted-foreground">{t('matching.subtitle')}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Precompute Compatibility */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-blue-500" />
              {t('matching.precompute')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              {t('matching.precomputeDesc')}
            </p>
            <Button onClick={handlePrecompute} disabled={precomputeLoading} className="gap-2">
              {precomputeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              {t('matching.runPrecompute')}
            </Button>
            {precomputeResult && (
              <p className={`mt-3 text-sm ${precomputeResult.includes('success') ? 'text-emerald-600' : 'text-red-600'}`}>
                {precomputeResult}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Compatibility Lookup */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Target className="h-5 w-5 text-purple-500" />
              {t('matching.compatLookup')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              {t('matching.compatLookupDesc')}
            </p>
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder={t('matching.targetUserId')}
                  value={compatUserId}
                  onChange={(e) => setCompatUserId(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Button onClick={handleCompatibility} disabled={compatLoading || !compatUserId.trim()}>
                {compatLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : t('matching.check')}
              </Button>
            </div>
            {compatResult && (
              <div className="mt-4 rounded-lg border p-4">
                {compatResult.error ? (
                  <p className="text-sm text-red-600">{compatResult.error}</p>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{t('matching.score')}:</span>
                      <Badge variant={compatResult.score > 70 ? 'success' : compatResult.score > 40 ? 'warning' : 'destructive'}>
                        {compatResult.score ?? 'N/A'}%
                      </Badge>
                    </div>
                    {compatResult.breakdown && (
                      <div className="space-y-1">
                        <span className="text-xs font-medium text-muted-foreground">{t('matching.breakdown')}:</span>
                        {Object.entries(compatResult.breakdown).map(([key, val]) => (
                          <div key={key} className="flex justify-between text-xs">
                            <span className="capitalize">{key.replace(/_/g, ' ')}</span>
                            <span className="font-mono">{String(val)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Smart Suggestions */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-lg">{t('matching.smartSuggestions')}</CardTitle>
          <Button size="sm" onClick={handleSuggestions} disabled={suggestionsLoading} className="gap-1">
            {suggestionsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            {t('matching.loadSuggestions')}
          </Button>
        </CardHeader>
        <CardContent>
          {suggestions.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              {t('matching.loadSuggestionsDesc')}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-3 pe-4 font-medium">{t('matching.user')}</th>
                    <th className="pb-3 pe-4 font-medium">{t('matching.score')}</th>
                    <th className="pb-3 pe-4 font-medium">{t('matching.reason')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {suggestions.map((s: any, i: number) => (
                    <tr key={i} className="hover:bg-muted/50">
                      <td className="py-3 pr-4 font-medium">{s.userId || s.user?.firstName || `User ${i + 1}`}</td>
                      <td className="py-3 pr-4">
                        <Badge variant={s.score > 70 ? 'success' : 'secondary'}>{s.score ?? '-'}</Badge>
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground">{s.reason || '-'}</td>
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
