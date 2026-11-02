import { loadServerEnv } from "../server/env.mjs";
import { createServer } from "vite";
import { createApp, listen } from "../server/app.mjs";
import { ApiError } from "../server/data.mjs";

let apiServer;
let frontend;
try {
  loadServerEnv();
  const app = createApp();
  const host = process.env.HOST || "127.0.0.1";
  const apiPort = Number(process.env.API_PORT || 3001);
  const devPort = Number(process.env.DEV_PORT || 5173);
  const proxyHost =
    host === "0.0.0.0"
      ? "127.0.0.1"
      : host.includes(":")
        ? `[${host === "::" ? "::1" : host}]`
        : host;
  apiServer = await listen(app, { port: apiPort, host });
  frontend = await createServer({
    configFile: false,
    server: {
      host,
      port: devPort,
      strictPort: true,
      proxy: {
        "/api": {
          target: `http://${proxyHost}:${apiPort}`,
          changeOrigin: true,
        },
      },
      // .env remains server-only, even if requested directly in development.
      fs: {
        deny: [
          ".env",
          ".env.*",
          "*.{crt,pem}",
          "**/.git/**",
          "**/server/**",
          "**/tests/**",
          "**/.formradar-model/**",
          "**/.venv-model/**",
        ],
      },
    },
  });
  await frontend.listen();
  frontend.printUrls();
  console.log(
    `Football API ${app.configured ? "configured" : "not configured — add your token to .env and restart"}. Experimental estimates require model:prepare-current.`,
  );
} catch (error) {
  if (frontend) await frontend.close();
  if (apiServer) apiServer.close();
  console.error(
    error instanceof ApiError
      ? error.message
      : error.code === "EADDRINUSE" || /already in use/.test(error.message)
      ? "A FormRadar port is already in use. Stop the previous instance or change DEV_PORT / API_PORT in .env."
      : "Could not start FormRadar. Check DEV_PORT, API_PORT and the .env format.",
  );
  process.exit(1);
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await frontend?.close();
    apiServer?.close(() => process.exit(0));
  });
