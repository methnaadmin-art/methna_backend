import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { searchApi } from '@/lib/api'
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
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Loader2, Search, Eye, MapPin } from 'lucide-react'

export default function SearchUsersPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [results, setResults] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)

  // Filters
  const [gender, setGender] = useState<string>('all')
  const [minAge, setMinAge] = useState('')
  const [maxAge, setMaxAge] = useState('')
  const [city, setCity] = useState('')
  const [country, setCountry] = useState('')
  const [ethnicity, setEthnicity] = useState('')
  const [religiousLevel, setReligiousLevel] = useState('')

  const handleSearch = async () => {
    setLoading(true)
    try {
      const params: Record<string, any> = {}
      if (gender !== 'all') params.gender = gender
      if (minAge) params.minAge = parseInt(minAge)
      if (maxAge) params.maxAge = parseInt(maxAge)
      if (city.trim()) params.city = city.trim()
      if (country.trim()) params.country = country.trim()
      if (ethnicity.trim()) params.ethnicity = ethnicity.trim()
      if (religiousLevel.trim()) params.religiousLevel = religiousLevel.trim()

      const { data } = await searchApi.search(params)
      const list = Array.isArray(data) ? data : data?.profiles || data?.users || data?.results || []
      setResults(list)
      setTotal(data?.total ?? list.length)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('searchUsers.title')}</h1>
        <p className="text-muted-foreground">{t('searchUsers.subtitle')}</p>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Search className="h-5 w-5" /> {t('searchUsers.filters')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t('searchUsers.gender')}</label>
              <Select value={gender} onValueChange={setGender}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('common.all')}</SelectItem>
                  <SelectItem value="male">{t('searchUsers.male')}</SelectItem>
                  <SelectItem value="female">{t('searchUsers.female')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t('searchUsers.minAge')}</label>
              <Input type="number" placeholder="18" value={minAge} onChange={(e) => setMinAge(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t('searchUsers.maxAge')}</label>
              <Input type="number" placeholder="60" value={maxAge} onChange={(e) => setMaxAge(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t('searchUsers.city')}</label>
              <Input placeholder="Any city" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t('searchUsers.country')}</label>
              <Input placeholder="Any country" value={country} onChange={(e) => setCountry(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t('searchUsers.ethnicity')}</label>
              <Input placeholder="Any" value={ethnicity} onChange={(e) => setEthnicity(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t('searchUsers.religiousLevel')}</label>
              <Input placeholder="Any" value={religiousLevel} onChange={(e) => setReligiousLevel(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button onClick={handleSearch} disabled={loading} className="w-full gap-2">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                {t('searchUsers.search')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">{t('searchUsers.results')} ({total})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : results.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              {t('searchUsers.noResults')}
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {results.map((user: any, i: number) => (
                <div
                  key={user.id || user.userId || i}
                  className="flex items-start gap-3 rounded-lg border p-4 hover:bg-muted/50 transition-colors cursor-pointer"
                  onClick={() => navigate(`/users/${user.id || user.userId}`)}
                >
                  <Avatar className="h-12 w-12">
                    <AvatarFallback className="bg-primary/10 text-primary">
                      {(user.firstName || user.profile?.bio)?.[0] || '?'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium truncate">
                        {user.firstName ? `${user.firstName} ${user.lastName || ''}` : `User ${(user.id || '').slice(0, 8)}`}
                      </p>
                      {user.selfieVerified && <Badge variant="info" className="text-[10px]">Verified</Badge>}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                      {(user.profile?.city || user.city) && (
                        <>
                          <MapPin className="h-3 w-3" />
                          <span>{user.profile?.city || user.city}{user.profile?.country ? `, ${user.profile.country}` : ''}</span>
                        </>
                      )}
                    </div>
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {user.profile?.gender && <Badge variant="secondary" className="text-[10px] capitalize">{user.profile.gender}</Badge>}
                      {user.profile?.ethnicity && <Badge variant="outline" className="text-[10px]">{user.profile.ethnicity}</Badge>}
                      {user.profile?.religiousLevel && <Badge variant="outline" className="text-[10px]">{user.profile.religiousLevel}</Badge>}
                    </div>
                  </div>
                  <Button size="icon" variant="ghost">
                    <Eye className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
