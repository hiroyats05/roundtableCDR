import "dotenv/config";

const livekitUrl = process.env.LIVEKIT_URL ?? "ws://localhost:7880";

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/saladereunioes",
  sessionSecret: process.env.SESSION_SECRET ?? "dev-session-secret-change-in-production",
  registerInviteCode: process.env.REGISTER_INVITE_CODE ?? "invite123",
  livekitUrl,
  livekitHttpUrl: livekitUrl.replace(/^ws/, "http"),
  livekitApiKey: process.env.LIVEKIT_API_KEY ?? "devkey",
  livekitApiSecret: process.env.LIVEKIT_API_SECRET ?? "secret",
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:5173",
  // Extra allowed CORS origins. Defaults cover the Tauri desktop app on macOS/Linux and Windows.
  extraCorsOrigins: (process.env.CORS_ORIGINS ?? "tauri://localhost,http://tauri.localhost")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  isProduction: process.env.NODE_ENV === "production",
};
