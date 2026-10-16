/**
 * Test utilities for TikTok API tests
 */

// Mock cookies for testing (non-production values)
export const MOCK_COOKIES = {
  sessionid: 'test_session_id_value',
  msToken: 'test_ms_token_value',
  ttCsrfToken: 'test_csrf_token',
  uid: 'test_user_id',
  sidGuard: 'test_sid_guard',
  sid_tt: 'test_sid_tt',
  passportCsrfToken: 'test_passport_csrf',
}

// Build test cookie string
export function buildTestCookieString(overrides?: Record<string, string>): string {
  const cookies = { ...MOCK_COOKIES, ...overrides }
  return Object.entries(cookies)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ')
}

// Test video IDs
export const TEST_VIDEO_ID = '7549372214987246879'
export const TEST_USER_SEC_UID = 'MS4wLjABAAAA' // example prefix

// Wait helper for async operations
export const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
