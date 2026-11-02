import { spawnSync } from "node:child_process";
import { writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { PROJECT, VENV } from "./paths.mjs";

const PIP_VERSION = "26.2.2";
function run(command, args, quiet = false) {
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (/^(PIP_|FOOTBALL_DATA_)/.test(key)) delete env[key];
  env.PIP_CONFIG_FILE = "/dev/null";
  const result = spawnSync(command, args, { cwd: PROJECT, env, stdio: quiet ? "pipe" : "inherit" });
  if (result.error || result.status !== 0)
    throw new Error("Python setup did not finish. Check the preceding setup message and rerun model:setup; no system packages were installed.");
}
try {
  process.umask(0o077);
  const python = process.env.FORMRADAR_PYTHON || "python3";
  run(python, ["-c", "import sys,venv; assert (3,12)<=sys.version_info[:2]<=(3,14), 'Use Python 3.12–3.14 with the venv module'"]);
  // Ubuntu's Python may have venv but no ensurepip. Bootstrap only inside this venv.
  run(python, ["-m", "venv", "--without-pip", VENV]);
  const executable = join(VENV, "bin/python3");
  const pipPresent = spawnSync(executable, ["-m", "pip", "--version"], { stdio: "pipe" });
  if (pipPresent.status !== 0) {
    const response = await fetch(`https://pypi.org/pypi/pip/${PIP_VERSION}/json`, { signal: AbortSignal.timeout(30_000), redirect: "error" });
    if (!response.ok) throw new Error("Could not read the pinned pip release from PyPI. Retry setup when connected.");
    const metadata = await response.json();
    const wheel = metadata.urls.find((item) => item.filename === `pip-${PIP_VERSION}-py3-none-any.whl`);
    const url = new URL(wheel?.url);
    if (url.origin !== "https://files.pythonhosted.org" || !/^[a-f0-9]{64}$/.test(wheel.digests.sha256))
      throw new Error("The PyPI bootstrap metadata was invalid.");
    const download = await fetch(url, { signal: AbortSignal.timeout(60_000), redirect: "error" });
    if (!download.ok || Number(download.headers.get("content-length")) > 20_000_000)
      throw new Error("Could not download the pinned pip wheel.");
    const bytes = Buffer.from(await download.arrayBuffer());
    if (bytes.length > 20_000_000 || createHash("sha256").update(bytes).digest("hex") !== wheel.digests.sha256)
      throw new Error("The pip wheel checksum did not match PyPI.");
    const wheelPath = join(VENV, "pip-bootstrap.whl");
    await writeFile(wheelPath, bytes, { mode: 0o600 });
    run(executable, ["-c", "import sys,sysconfig,zipfile,pathlib; z=zipfile.ZipFile(sys.argv[1]); assert all(not pathlib.PurePosixPath(n).is_absolute() and '..' not in pathlib.PurePosixPath(n).parts for n in z.namelist()); z.extractall(sysconfig.get_paths()['purelib'])", wheelPath]);
    await rm(wheelPath);
  }
  run(executable, ["-m", "pip", "--isolated", "--disable-pip-version-check", "--no-cache-dir", "install", "--index-url", "https://pypi.org/simple", "--only-binary=:all:", "--no-deps", "-r", join(PROJECT, "model/requirements.txt")]);
  run(executable, ["-c", "import sys,numpy,scipy; print('Ready: Python',sys.version.split()[0], 'NumPy',numpy.__version__,'SciPy',scipy.__version__)"]);
  console.log(`Project Python environment: ${VENV}\nNo football data was fetched. Next: npm run model:test`);
} catch (error) {
  console.error(error.message?.startsWith("Python") || /PyPI|pip wheel|pinned pip/.test(error.message || "")
    ? error.message : "Model setup failed. Check your connection and Python 3.12–3.14 with venv, then rerun model:setup.");
  process.exitCode = 1;
}
