import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://jordan-backend-production.up.railway.app/api/v1'

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
})

// Attach JWT token + CSRF token + security headers to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  const csrfToken = sessionStorage.getItem('csrf_token')
  if (csrfToken) {
    config.headers['X-CSRF-Token'] = csrfToken
  }
  config.headers['X-Requested-With'] = 'XMLHttpRequest'
  return config
})

// Unwrap backend's { success, data, timestamp } envelope
api.interceptors.response.use(
  (response) => {
    if (response.data && typeof response.data === 'object' && 'success' in response.data && 'data' in response.data) {
      response.data = response.data.data
    }
    return response
  },
)

// Handle 401 — attempt refresh or redirect to login
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true

      try {
        const refreshToken = localStorage.getItem('refresh_token')
        if (!refreshToken) throw new Error('No refresh token')

        const res = await axios.post(`${API_BASE_URL}/auth/refresh`, {
          refreshToken,
        })
        const payload = res.data?.data || res.data

        localStorage.setItem('access_token', payload.accessToken)
        if (payload.refreshToken) {
          localStorage.setItem('refresh_token', payload.refreshToken)
        }

        originalRequest.headers.Authorization = `Bearer ${payload.accessToken}`
        return api(originalRequest)
      } catch {
        localStorage.removeItem('access_token')
        localStorage.removeItem('refresh_token')
        window.location.href = '/login'
        return Promise.reject(error)
      }
    }

    return Promise.reject(error)
  }
)

export default api

// ── Auth ─────────────────────────────────────────────────────

export const authApi = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }),
  refresh: (refreshToken: string) =>
    api.post('/auth/refresh', { refreshToken }),
  logout: () => api.post('/auth/logout'),
}

// ── Admin ────────────────────────────────────────────────────

export const adminApi = {
  // Dashboard
  getStats: () => api.get('/admin/stats'),

  // Users
  getUsers: (page = 1, limit = 20, status?: string, search?: string, role?: string, plan?: string) =>
    api.get('/admin/users', { params: { page, limit, status, search, role, plan } }),
  createUser: (data: { email: string; password: string; firstName: string; lastName: string; role?: string; status?: string }) =>
    api.post('/admin/users', data),
  getUserDetail: (id: string) => api.get(`/admin/users/${id}`),
  getUserActivity: (id: string) => api.get(`/admin/users/${id}/activity`),
  updateUser: (id: string, data: Record<string, any>) =>
    api.put(`/admin/users/${id}`, data),
  updateUserStatus: (id: string, status: string) =>
    api.patch(`/admin/users/${id}/status`, { status }),
  deleteUser: (id: string) => api.delete(`/admin/users/${id}`),

  // Document Verification
  getPendingDocuments: () => api.get('/admin/documents/pending'),
  verifyDocument: (userId: string, approved: boolean, rejectionReason?: string) =>
    api.patch(`/admin/documents/${userId}/verify`, { approved, rejectionReason }),
  autoApproveDocuments: () => api.post('/admin/documents/auto-approve'),

  // Swipes / Activity
  getSwipes: (page = 1, limit = 20, type?: string) =>
    api.get('/admin/swipes', { params: { page, limit, type } }),

  // Matches
  getMatches: (page = 1, limit = 20) =>
    api.get('/admin/matches', { params: { page, limit } }),

  // Conversations
  getConversations: (page = 1, limit = 20) =>
    api.get('/admin/conversations', { params: { page, limit } }),
  getConversationMessages: (id: string, page = 1, limit = 50) =>
    api.get(`/admin/conversations/${id}/messages`, { params: { page, limit } }),

  // Reports
  getReports: (page = 1, limit = 20, status?: string) =>
    api.get('/admin/reports', { params: { page, limit, status } }),
  resolveReport: (id: string, status: string, moderatorNote?: string) =>
    api.patch(`/admin/reports/${id}`, { status, moderatorNote }),

  // Photos
  getPendingPhotos: (page = 1, limit = 20) =>
    api.get('/admin/photos/pending', { params: { page, limit } }),
  moderatePhoto: (id: string, status: string, moderationNote?: string) =>
    api.patch(`/admin/photos/${id}/moderate`, { status, moderationNote }),

  // Notifications
  sendNotification: (data: { userId?: string; title: string; body: string; type?: string; broadcast?: boolean }) =>
    api.post('/admin/notifications/send', data),

  // Support Tickets
  getTickets: (page = 1, limit = 20, status?: string) =>
    api.get('/admin/tickets', { params: { page, limit, status } }),
  replyToTicket: (id: string, reply: string, status?: string) =>
    api.patch(`/admin/tickets/${id}/reply`, { reply, status }),

  // Ads
  getAds: () => api.get('/admin/ads'),
  createAd: (data: Record<string, any>) => api.post('/admin/ads', data),
  updateAd: (id: string, data: Record<string, any>) => api.patch(`/admin/ads/${id}`, data),
  deleteAd: (id: string) => api.delete(`/admin/ads/${id}`),

  // Boosts
  getBoosts: (page = 1, limit = 20) =>
    api.get('/admin/boosts', { params: { page, limit } }),

  // Subscriptions
  getSubscriptions: (page = 1, limit = 20, plan?: string) =>
    api.get('/admin/subscriptions', { params: { page, limit, plan } }),
}

// ── Analytics ────────────────────────────────────────────────

export const analyticsApi = {
  getDashboard: () => api.get('/analytics/dashboard'),
  getDau: (date?: string) => api.get('/analytics/dau', { params: { date } }),
  getConversion: (days = 30) =>
    api.get('/analytics/conversion', { params: { days } }),
  getRetention: (cohortDays = 7) =>
    api.get('/analytics/retention', { params: { cohortDays } }),
  getMatchesOverTime: (days = 30) =>
    api.get('/analytics/matches-over-time', { params: { days } }),
}

// ── Trust & Safety ───────────────────────────────────────────

export const trustSafetyApi = {
  getFlags: (page = 1, limit = 20) =>
    api.get('/trust-safety/admin/flags', { params: { page, limit } }),
  resolveFlag: (id: string, status: string, note?: string) =>
    api.patch(`/trust-safety/admin/flags/${id}`, { status, note }),
  shadowBan: (userId: string) =>
    api.post(`/trust-safety/admin/shadow-ban/${userId}`),
  removeShadowBan: (userId: string) =>
    api.post(`/trust-safety/admin/remove-shadow-ban/${userId}`),
  detectSuspicious: (userId: string) =>
    api.post(`/trust-safety/admin/detect-suspicious/${userId}`),
}

// ── Security ─────────────────────────────────────────────────

export const securityApi = {
  getBlacklist: () => api.get('/security/admin/blacklist'),
  addToBlacklist: (domain: string, reason: string) =>
    api.post('/security/admin/blacklist', { domain, reason }),
  removeFromBlacklist: (domain: string) =>
    api.delete(`/security/admin/blacklist/${domain}`),
  getDevices: () => api.get('/security/devices'),
  revokeDevice: (id: string) => api.delete(`/security/devices/${id}`),
  getLoginHistory: () => api.get('/security/login-history'),
}

// ── Matching ────────────────────────────────────────────────

export const matchingApi = {
  getSmartSuggestions: () => api.get('/matching/smart-suggestions'),
  precomputeCompatibility: () => api.post('/matching/precompute-compatibility'),
  getCompatibility: (targetUserId: string) =>
    api.get(`/matching/compatibility/${targetUserId}`),
}

// ── Monetization ────────────────────────────────────────────

export const monetizationApi = {
  getStatus: () => api.get('/monetization/status'),
  getFeatures: () => api.get('/monetization/features'),
  getRemainingLikes: () => api.get('/monetization/remaining-likes'),
  subscribe: (plan: string) => api.post('/monetization/subscribe', { plan }),
  purchaseBoost: () => api.post('/monetization/boost'),
  getBoostStatus: () => api.get('/monetization/boost'),
}

// ── Subscriptions ───────────────────────────────────────────

export const subscriptionsApi = {
  getMe: () => api.get('/subscriptions/me'),
  create: (plan: string) => api.post('/subscriptions', { plan }),
  cancel: () => api.delete('/subscriptions'),
  getPlans: () => api.get('/subscriptions/plans'),
}

// ── Chat ────────────────────────────────────────────────────

export const chatApi = {
  getConversations: () => api.get('/chat/conversations'),
  getMessages: (conversationId: string) =>
    api.get(`/chat/conversations/${conversationId}/messages`),
  markRead: (conversationId: string) =>
    api.patch(`/chat/conversations/${conversationId}/read`),
  markDelivered: (conversationId: string) =>
    api.patch(`/chat/conversations/${conversationId}/delivered`),
  muteConversation: (conversationId: string) =>
    api.patch(`/chat/conversations/${conversationId}/mute`),
  getUnreadCount: () => api.get('/chat/unread'),
}

// ── Notifications ───────────────────────────────────────────

export const notificationsApi = {
  getAll: () => api.get('/notifications'),
  getUnreadCount: () => api.get('/notifications/unread-count'),
  markRead: (id: string) => api.patch(`/notifications/${id}/read`),
  markAllRead: () => api.patch('/notifications/read-all'),
  remove: (id: string) => api.delete(`/notifications/${id}`),
  getSettings: () => api.get('/notifications/settings'),
  updateSettings: (settings: Record<string, boolean>) =>
    api.patch('/notifications/settings', settings),
}

// ── Search ──────────────────────────────────────────────────

export const searchApi = {
  search: (params: Record<string, any>) =>
    api.get('/search', { params }),
}

// ── Matches ─────────────────────────────────────────────────

export const matchesApi = {
  getAll: () => api.get('/matches'),
  getSuggestions: () => api.get('/matches/suggestions'),
  getNearby: () => api.get('/matches/nearby'),
  getDiscover: () => api.get('/matches/discover'),
  unmatch: (id: string) => api.delete(`/matches/${id}`),
}

// ── Swipes ──────────────────────────────────────────────────

export const swipesApi = {
  swipe: (targetUserId: string, type: string, message?: string) =>
    api.post('/swipes', { targetUserId, type, message }),
  whoLikedMe: () => api.get('/swipes/who-liked-me'),
  getCompatibility: (targetUserId: string) =>
    api.get(`/swipes/compatibility/${targetUserId}`),
}

// ── Categories ─────────────────────────────────────────────

export const categoriesApi = {
  getAll: () => api.get('/categories'),
  getAllAdmin: () => api.get('/categories/admin/all'),
  getOne: (id: string) => api.get(`/categories/${id}`),
  getUsers: (id: string, page = 1, limit = 20) =>
    api.get(`/categories/${id}/users`, { params: { page, limit } }),
  create: (data: Record<string, any>) => api.post('/categories', data),
  update: (id: string, data: Record<string, any>) =>
    api.patch(`/categories/${id}`, data),
  remove: (id: string) => api.delete(`/categories/${id}`),
  rebuild: (id: string) => api.post(`/categories/${id}/rebuild`),
}

// ── Reports (user-facing) ───────────────────────────────────

export const userReportsApi = {
  create: (reportedId: string, reason: string, details?: string) =>
    api.post('/reports', { reportedId, reason, details }),
  block: (id: string) => api.post(`/reports/block/${id}`),
  unblock: (id: string) => api.delete(`/reports/block/${id}`),
  getBlocked: () => api.get('/reports/blocked'),
}
