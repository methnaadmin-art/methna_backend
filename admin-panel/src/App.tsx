import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from '@/contexts/auth-context'
import { ThemeProvider } from '@/contexts/theme-context'
import { ToastProvider } from '@/components/ui/toast'
import { AdminLayout } from '@/components/layout/admin-layout'
import LoginPage from '@/pages/login'
import DashboardPage from '@/pages/dashboard'
import UsersPage from '@/pages/users/index'
import UserDetailPage from '@/pages/users/user-detail'
import ReportsPage from '@/pages/reports'
import PhotosPage from '@/pages/photos'
import AnalyticsPage from '@/pages/analytics'
import TrustSafetyPage from '@/pages/trust-safety'
import SecurityPage from '@/pages/security'
import MatchingPage from '@/pages/matching'
import MonetizationPage from '@/pages/monetization'
import ChatPage from '@/pages/chat'
import NotificationsPage from '@/pages/notifications'
import SearchUsersPage from '@/pages/search-users'
import MatchesPage from '@/pages/matches'
import ActivityPage from '@/pages/activity'
import SupportPage from '@/pages/support'
import AdsPage from '@/pages/ads'
import SubscriptionsPage from '@/pages/subscriptions'
import SendNotificationsPage from '@/pages/send-notifications'
import VerificationPage from '@/pages/verification'
import AuditLogsPage from '@/pages/audit-logs'
import GuidePage from '@/pages/guide'
import CategoriesPage from '@/pages/categories'
import DailyInsightsPage from '@/pages/daily-insights'

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<AdminLayout />}>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/users" element={<UsersPage />} />
                <Route path="/users/:id" element={<UserDetailPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/photos" element={<PhotosPage />} />
                <Route path="/verification" element={<VerificationPage />} />
                <Route path="/matches" element={<MatchesPage />} />
                <Route path="/matching" element={<MatchingPage />} />
                <Route path="/chat" element={<ChatPage />} />
                <Route path="/notifications" element={<NotificationsPage />} />
                <Route path="/search" element={<SearchUsersPage />} />
                <Route path="/monetization" element={<MonetizationPage />} />
                <Route path="/activity" element={<ActivityPage />} />
                <Route path="/support" element={<SupportPage />} />
                <Route path="/ads" element={<AdsPage />} />
                <Route path="/subscriptions" element={<SubscriptionsPage />} />
                <Route path="/send-notifications" element={<SendNotificationsPage />} />
                <Route path="/analytics" element={<AnalyticsPage />} />
                <Route path="/trust-safety" element={<TrustSafetyPage />} />
                <Route path="/security" element={<SecurityPage />} />
                <Route path="/audit-logs" element={<AuditLogsPage />} />
                <Route path="/categories" element={<CategoriesPage />} />
                <Route path="/daily-insights" element={<DailyInsightsPage />} />
                <Route path="/guide" element={<GuidePage />} />
              </Route>
            </Routes>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}
