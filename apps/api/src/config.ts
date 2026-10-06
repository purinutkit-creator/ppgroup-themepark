import 'dotenv/config';

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Missing required env var ${name}`);
  return v;
}

const env = process.env.NODE_ENV ?? 'development';
const isProd = env === 'production';

export const config = {
  env,
  isProd,
  isTest: env === 'test',
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: req('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/themepark'),
  jwtSecret: req('JWT_SECRET', isProd ? undefined : 'dev-only-jwt-secret-change-me'),
  qrSecret: req('QR_SIGNING_SECRET', isProd ? undefined : 'dev-only-qr-secret-change-me'),
  corsOrigin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',').map((s) => s.trim()),
  uploadDir: process.env.UPLOAD_DIR ?? './uploads',
  paymentProvider: process.env.PAYMENT_PROVIDER ?? 'simulator',
  promptpayId: process.env.PROMPTPAY_ID ?? '0812345678',
  hardwareMode: (process.env.HARDWARE_MODE ?? 'simulator') as 'simulator' | 'real',
  staffSessionHours: Number(process.env.STAFF_SESSION_HOURS ?? 14),
  memberSessionDays: Number(process.env.MEMBER_SESSION_DAYS ?? 30),
};

if (isProd && (config.jwtSecret.length < 32 || config.qrSecret.length < 32)) {
  throw new Error('JWT_SECRET and QR_SIGNING_SECRET must be at least 32 characters in production');
}
