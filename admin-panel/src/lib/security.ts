import DOMPurify from 'dompurify'

// ── XSS Sanitization ────────────────────────────────────────
export function sanitizeInput(input: string): string {
  return DOMPurify.sanitize(input, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] })
}

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html)
}

// ── SQL Injection Prevention (client-side validation) ───────
const SQL_PATTERNS = [
  /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|FETCH|DECLARE|TRUNCATE)\b)/i,
  /(--|#|\/\*|\*\/)/,
  /(\b(OR|AND)\b\s+\d+\s*=\s*\d+)/i,
  /(;\s*(DROP|DELETE|INSERT|UPDATE))/i,
  /('(\s)*(OR|AND)(\s)*')/i,
  /(CHAR\s*\(|CONCAT\s*\(|0x[0-9a-f]+)/i,
]

export function containsSqlInjection(input: string): boolean {
  return SQL_PATTERNS.some((pattern) => pattern.test(input))
}

export function validateInput(input: string): { safe: boolean; sanitized: string } {
  const sanitized = sanitizeInput(input.trim())
  const hasSql = containsSqlInjection(sanitized)
  return { safe: !hasSql, sanitized: hasSql ? '' : sanitized }
}

// ── CSRF Token Management ───────────────────────────────────
let csrfToken: string | null = null

export function generateCsrfToken(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  csrfToken = Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('')
  sessionStorage.setItem('csrf_token', csrfToken)
  return csrfToken
}

export function getCsrfToken(): string {
  if (!csrfToken) {
    csrfToken = sessionStorage.getItem('csrf_token') || generateCsrfToken()
  }
  return csrfToken
}

// ── Session Security ────────────────────────────────────────
const SESSION_TIMEOUT = 30 * 60 * 1000 // 30 minutes
const ACTIVITY_KEY = 'last_activity'

export function updateActivity(): void {
  localStorage.setItem(ACTIVITY_KEY, Date.now().toString())
}

export function isSessionExpired(): boolean {
  const last = localStorage.getItem(ACTIVITY_KEY)
  if (!last) return false
  return Date.now() - parseInt(last, 10) > SESSION_TIMEOUT
}

export function clearSession(): void {
  localStorage.removeItem('access_token')
  localStorage.removeItem('refresh_token')
  localStorage.removeItem(ACTIVITY_KEY)
  sessionStorage.removeItem('csrf_token')
  csrfToken = null
}

// ── Content Security Policy helpers ─────────────────────────
export function addSecurityHeaders(): void {
  // Prevent clickjacking via meta tag
  const existingMeta = document.querySelector('meta[http-equiv="X-Frame-Options"]')
  if (!existingMeta) {
    const meta = document.createElement('meta')
    meta.httpEquiv = 'X-Frame-Options'
    meta.content = 'DENY'
    document.head.appendChild(meta)
  }

  // Prevent MIME sniffing
  const noSniff = document.querySelector('meta[http-equiv="X-Content-Type-Options"]')
  if (!noSniff) {
    const meta = document.createElement('meta')
    meta.httpEquiv = 'X-Content-Type-Options'
    meta.content = 'nosniff'
    document.head.appendChild(meta)
  }
}

// ── Rate Limiting (client-side) ─────────────────────────────
const requestCounts = new Map<string, { count: number; resetAt: number }>()

export function isRateLimited(action: string, maxPerMinute = 30): boolean {
  const now = Date.now()
  const entry = requestCounts.get(action)

  if (!entry || now > entry.resetAt) {
    requestCounts.set(action, { count: 1, resetAt: now + 60000 })
    return false
  }

  entry.count++
  return entry.count > maxPerMinute
}

// ── Secure Storage ──────────────────────────────────────────
export function secureGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function secureSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    console.warn('Failed to write to localStorage')
  }
}

// ── Password Strength ───────────────────────────────────────
export function getPasswordStrength(password: string): { score: number; label: string } {
  let score = 0
  if (password.length >= 8) score++
  if (password.length >= 12) score++
  if (/[A-Z]/.test(password)) score++
  if (/[a-z]/.test(password)) score++
  if (/[0-9]/.test(password)) score++
  if (/[^A-Za-z0-9]/.test(password)) score++

  const labels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong', 'Very Strong']
  return { score, label: labels[Math.min(score, labels.length - 1)] }
}

// ── Initialize Security ─────────────────────────────────────
export function initSecurity(): void {
  addSecurityHeaders()
  generateCsrfToken()
  updateActivity()

  // Track activity for session timeout
  const events = ['mousedown', 'keydown', 'scroll', 'touchstart']
  events.forEach((event) => {
    document.addEventListener(event, () => updateActivity(), { passive: true })
  })

  // Check session expiry periodically
  setInterval(() => {
    if (isSessionExpired()) {
      clearSession()
      window.location.href = '/login'
    }
  }, 60000)

  // Prevent right-click in production (optional anti-inspection)
  if (import.meta.env.PROD) {
    document.addEventListener('contextmenu', (e) => {
      e.preventDefault()
    })
  }
}
