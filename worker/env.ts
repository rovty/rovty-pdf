export interface Identity {
  user_id: string;
  session_id: string;
  email: string;
  expires: number;
}
export interface Env {
  ASSETS: Fetcher;
  CLOUD: DurableObjectNamespace;
  FILES?: R2Bucket;
  PDF_WORKER_SECRET?: string;
  DASHBOARD_ORIGIN: string;
  CLOUD_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}
