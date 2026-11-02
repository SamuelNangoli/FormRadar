import { loadServerEnv } from "./env.mjs";
import { fileURLToPath } from "node:url";
import { createApp, listen } from "./app.mjs";
import { ApiError } from "./data.mjs";

try {
  loadServerEnv();
  const app = createApp({
    distDir: fileURLToPath(new URL("../dist", import.meta.url)),
  });
  const host = process.env.HOST || "127.0.0.1";
  const port = Number(process.env.PORT || 3000);
  const server = await listen(app, { port, host });
  console.log(
    `FormRadar: http://${host}:${port} • football API ${app.configured ? "configured" : "needs a token in .env"}`,
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => server.close(() => process.exit(0)));
} catch (error) {
  console.error(
    error instanceof ApiError
      ? error.message
      : error.code === "EADDRINUSE"
      ? "That port is already in use. Set a different PORT in .env."
      : "FormRadar could not start. Check the server configuration.",
  );
  process.exit(1);
}
