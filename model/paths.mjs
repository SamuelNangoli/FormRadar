import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
export const PROJECT = fileURLToPath(new URL("..", import.meta.url));
export const PRIVATE = resolve(PROJECT, ".formradar-model");
export const VENV = resolve(process.env.FORMRADAR_MODEL_VENV || resolve(PROJECT, ".venv-model"));
