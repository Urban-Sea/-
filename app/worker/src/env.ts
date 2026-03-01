/** Worker 環境変数の型定義 */
export interface Env {
  // 既存
  ORIGIN: string;           // Backend URL (Railway / Cloud Run)
  ALLOWED_ORIGIN: string;   // 許可 Frontend URL (カンマ区切り)
  PROXY_SECRET: string;     // Backend との共有シークレット

  // CRUD 用 (新規)
  SUPABASE_URL: string;     // Supabase プロジェクト URL
  SUPABASE_KEY: string;     // service_role key (RLS バイパス)
  SUPABASE_JWT_SECRET: string; // JWT HMAC 検証用

  // Admin MFA (新規)
  MFA_ENCRYPTION_KEY: string; // AES-256-GCM key (hex 64文字)
  ADMIN_EMAILS: string;     // カンマ区切り Admin メール

  // フィーチャーフラグ
  CRUD_IN_WORKER: string;   // "true" で CRUD を Worker 内処理

  // Upstash Redis
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;

  // 環境
  ENVIRONMENT: string;      // "production" / "development"
}
