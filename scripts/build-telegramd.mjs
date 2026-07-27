import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const hostTriple = execSync("rustc -vV", { encoding: "utf8" })
  .split("\n")
  .find((line) => line.startsWith("host:"))
  ?.slice(6)
  .trim();

const triple = process.env.TAURI_ENV_TARGET_TRIPLE || process.env.CARGO_BUILD_TARGET;

const args = ["build", "-p", "finance-telegramd", "--release"];
if (triple && triple !== hostTriple) {
  args.push("--target", triple);
}

const build = spawnSync("cargo", args, {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const copy = spawnSync("node", [join(root, "scripts", "copy-telegramd.mjs")], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
process.exit(copy.status ?? 1);
