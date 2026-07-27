import { mkdirSync, copyFileSync, chmodSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const hostTriple = execSync("rustc -vV", { encoding: "utf8" })
  .split("\n")
  .find((line) => line.startsWith("host:"))
  ?.slice(6)
  .trim();

const triple =
  process.env.TAURI_ENV_TARGET_TRIPLE ||
  process.env.CARGO_BUILD_TARGET ||
  hostTriple;

if (!triple) {
  console.error("Не удалось определить Rust target triple");
  process.exit(1);
}

const isWindows = triple.includes("windows");
const binName = isWindows ? "finance-telegramd.exe" : "finance-telegramd";

const candidates = [
  join(root, "target", triple, "release", binName),
  join(root, "target", "release", binName),
  join(root, "target", "debug", binName),
];

const source = candidates.find((path) => existsSync(path));
if (!source) {
  console.error(
    "finance-telegramd не найден. Сначала: cargo build -p finance-telegramd --release",
  );
  process.exit(1);
}

const binariesDir = join(root, "src-tauri", "binaries");
mkdirSync(binariesDir, { recursive: true });

// Tauri externalBin expects: name-TARGET_TRIPLE[.exe]
const sidecar = join(
  binariesDir,
  isWindows
    ? `finance-telegramd-${triple}.exe`
    : `finance-telegramd-${triple}`,
);
copyFileSync(source, sidecar);
try {
  chmodSync(sidecar, 0o755);
} catch {
  // ignore
}

console.log(`Copied ${source} → ${sidecar}`);
