/** Security limits in one place, so they are reviewed together. */
export const AUTH_POLICY = {
  /** Wrong passwords in a row before the account locks. */
  lockoutThreshold: 5,
  lockoutMinutes: 15,
  /** Failed sign-ins from one IP address within the window before it is throttled. */
  ipFailureLimit: 30,
  ipWindowMinutes: 15,
  /** A session ends after this long no matter how active it is. */
  sessionAbsoluteHours: 12,
  /** Fallback idle timeout if an organisation has no settings row. */
  defaultIdleMinutes: 30,
  /** Write last_seen_at at most this often, to avoid a database write per click. */
  touchIntervalSeconds: 60,
  setupLinkHours: 72,
  resetLinkHours: 24,
} as const;

/** Client info recorded with security events. */
export type RequestInfo = {
  ipAddress?: string;
  userAgent?: string;
};
