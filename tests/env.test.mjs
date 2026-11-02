import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadServerEnv } from "../server/env.mjs";

test("server loads existing parent .env with host and application precedence", async () => {
  const root = await mkdtemp(join(tmpdir(), "formradar-env-"));
  const names = ["FOOTBALL_DATA_API_KEY", "FOOTBALL_DATA_BASE_URL", "FORMRADAR_ENV_TEST"];
  const original = names.map((name) => process.env[name]);
  try {
    names.forEach((name) => delete process.env[name]);
    const appFile = join(root, "app.env");
    const parentFile = join(root, "parent.env");
    await writeFile(appFile, 'FORMRADAR_ENV_TEST=app\n');
    await writeFile(parentFile, 'FOOTBALL_DATA_API_KEY="parent-test-token"\nFOOTBALL_DATA_BASE_URL=https://api.football-data.org/v4\nFORMRADAR_ENV_TEST=parent\n');
    loadServerEnv([join(root, "missing.env"), appFile, parentFile]);
    assert.equal(process.env.FOOTBALL_DATA_API_KEY, "parent-test-token");
    assert.equal(process.env.FOOTBALL_DATA_BASE_URL, "https://api.football-data.org/v4");
    assert.equal(process.env.FORMRADAR_ENV_TEST, "app");
    process.env.FOOTBALL_DATA_API_KEY = "host-test-token";
    loadServerEnv([parentFile]);
    assert.equal(process.env.FOOTBALL_DATA_API_KEY, "host-test-token");
  } finally {
    names.forEach((name, i) => {
      if (original[i] === undefined) delete process.env[name];
      else process.env[name] = original[i];
    });
    await rm(root, { recursive: true, force: true });
  }
});
