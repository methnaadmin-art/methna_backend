import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  BookOpen,
  LayoutDashboard,
  Users,
  ImageIcon,
  Flag,
  MessageSquare,
  CreditCard,
  Shield,
  UserCheck,
  AlertTriangle,
  CheckCircle2,
  Info,
} from 'lucide-react'

export default function GuidePage() {
  const { t } = useTranslation()

  const sections = [
    {
      icon: LayoutDashboard,
      color: 'text-blue-500 bg-blue-500/10',
      titleKey: 'guide.dashboardSection',
      descKey: 'guide.dashboardDesc',
    },
    {
      icon: Users,
      color: 'text-emerald-500 bg-emerald-500/10',
      titleKey: 'guide.userMgmt',
      descKey: 'guide.userMgmtDesc',
      tips: ['guide.userMgmtTip1', 'guide.userMgmtTip2', 'guide.userMgmtTip3', 'guide.userMgmtTip4'],
    },
    {
      icon: ImageIcon,
      color: 'text-purple-500 bg-purple-500/10',
      titleKey: 'guide.contentMod',
      descKey: 'guide.contentModDesc',
      tips: ['guide.contentModTip1', 'guide.contentModTip2', 'guide.contentModTip3'],
    },
    {
      icon: Flag,
      color: 'text-red-500 bg-red-500/10',
      titleKey: 'guide.reportsSection',
      descKey: 'guide.reportsDesc',
      tips: ['guide.reportsTip1', 'guide.reportsTip2', 'guide.reportsTip3'],
    },
    {
      icon: MessageSquare,
      color: 'text-sky-500 bg-sky-500/10',
      titleKey: 'guide.chatSection',
      descKey: 'guide.chatDesc',
    },
    {
      icon: CreditCard,
      color: 'text-amber-500 bg-amber-500/10',
      titleKey: 'guide.revenueSection',
      descKey: 'guide.revenueDesc',
    },
    {
      icon: Shield,
      color: 'text-orange-500 bg-orange-500/10',
      titleKey: 'guide.securitySection',
      descKey: 'guide.securityDesc',
      tips: ['guide.securityTip1', 'guide.securityTip2', 'guide.securityTip3'],
    },
  ]

  const bestPractices = [
    'guide.bestPractice1',
    'guide.bestPractice2',
    'guide.bestPractice3',
    'guide.bestPractice4',
    'guide.bestPractice5',
    'guide.bestPractice6',
    'guide.bestPractice7',
  ]

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      {/* Welcome Banner */}
      <div className="rounded-2xl bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border p-8">
        <div className="flex items-start gap-4">
          <div className="rounded-xl bg-primary/10 p-3">
            <BookOpen className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{t('guide.welcome')}</h1>
            <p className="text-muted-foreground mt-2 leading-relaxed">{t('guide.welcomeDesc')}</p>
          </div>
        </div>
      </div>

      {/* Getting Started */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Info className="h-5 w-5 text-blue-500" />
            {t('guide.gettingStarted')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground leading-relaxed">{t('guide.gettingStartedDesc')}</p>
        </CardContent>
      </Card>

      {/* Sections */}
      <div className="space-y-4">
        {sections.map((section, idx) => (
          <Card key={idx}>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-3">
                <div className={`rounded-lg p-2 ${section.color}`}>
                  <section.icon className="h-5 w-5" />
                </div>
                {t(section.titleKey)}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground leading-relaxed">{t(section.descKey)}</p>
              {section.tips && (
                <div className="rounded-lg bg-muted/50 p-4 space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('guide.userMgmtTips')}</p>
                  <ul className="space-y-1.5">
                    {section.tips.map((tipKey, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                        <span>{t(tipKey)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Roles & Permissions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <UserCheck className="h-5 w-5 text-indigo-500" />
            {t('guide.rolesSection')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('guide.rolesDesc')}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Badge className="bg-red-500 text-white">{t('guide.adminRole')}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">{t('guide.adminRoleDesc')}</p>
            </div>
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Badge className="bg-blue-500 text-white">{t('guide.moderatorRole')}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">{t('guide.moderatorRoleDesc')}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Best Practices */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            {t('guide.bestPractices')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            {bestPractices.map((key, i) => (
              <div key={i} className="flex items-start gap-3 rounded-lg p-3 hover:bg-muted/50 transition-colors">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
                  {i + 1}
                </div>
                <p className="text-sm leading-relaxed">{t(key)}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Need Help */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-6">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <p className="font-semibold">{t('guide.needHelp')}</p>
              <p className="text-sm text-muted-foreground mt-1">{t('guide.needHelpDesc')}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
