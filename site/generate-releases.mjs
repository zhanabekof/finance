#!/usr/bin/env node
/**
 * Fetch the latest GitHub release and write site/releases.json
 * for the Pages download landing.
 *
 * Env:
 *   GITHUB_REPOSITORY — owner/repo (set automatically in Actions)
 *   GITHUB_TOKEN — optional; required for private repos
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, "releases.json");

const repo = process.env.GITHUB_REPOSITORY || "zhanabekof/finance";
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

function classifyAsset(name) {
  const lower = name.toLowerCase();
  if (lower.includes("dsym") || lower.includes(".debug.")) {
    return null;
  }

  const isDmg = lower.endsWith(".dmg");
  const isMacArchive =
    lower.endsWith(".app.tar.gz") || lower.includes("darwin");
  const isMac = isDmg || isMacArchive;

  if (isMac && (lower.includes("aarch64") || lower.includes("arm64"))) {
    return {
      id: "mac-arm",
      label: "macOS",
      subtitle: "Apple Silicon (M1–M4)",
      kind: isDmg ? "DMG" : "архив",
    };
  }
  if (isMac && (lower.includes("x64") || lower.includes("x86_64"))) {
    return {
      id: "mac-intel",
      label: "macOS",
      subtitle: "Intel",
      kind: isDmg ? "DMG" : "архив",
    };
  }
  if (isDmg) {
    return { id: "mac", label: "macOS", subtitle: "Desktop", kind: "DMG" };
  }
  if (lower.endsWith(".msi")) {
    return { id: "win-msi", label: "Windows", subtitle: "Установщик MSI", kind: "MSI" };
  }
  if (lower.endsWith(".exe") || lower.includes("nsis") || lower.includes("setup")) {
    return { id: "win-exe", label: "Windows", subtitle: "Установщик EXE", kind: "EXE" };
  }
  if (lower.endsWith(".appimage")) {
    return { id: "linux-appimage", label: "Linux", subtitle: "AppImage", kind: "AppImage" };
  }
  if (lower.endsWith(".deb")) {
    return { id: "linux-deb", label: "Linux", subtitle: "Debian / Ubuntu (.deb)", kind: "DEB" };
  }
  if (lower.endsWith(".rpm")) {
    return { id: "linux-rpm", label: "Linux", subtitle: "RPM", kind: "RPM" };
  }
  return null;
}

function formatBytes(size) {
  if (!Number.isFinite(size) || size <= 0) {
    return "";
  }
  const mb = size / (1024 * 1024);
  if (mb >= 1) {
    return `${mb.toFixed(1)} МБ`;
  }
  return `${Math.round(size / 1024)} КБ`;
}

async function fetchLatestRelease() {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "finance-pages",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const url = `https://api.github.com/repos/${repo}/releases/latest`;
  const response = await fetch(url, { headers });
  if (response.status === 404) {
    // No published release yet — keep empty catalog.
    return null;
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status}: ${body.slice(0, 200)}`);
  }
  return response.json();
}

const release = await fetchLatestRelease();
if (!release) {
  const empty = {
    tag: null,
    name: null,
    htmlUrl: `https://github.com/${repo}/releases`,
    publishedAt: null,
    updatedAt: new Date().toISOString(),
    assets: [],
  };
  writeFileSync(outPath, `${JSON.stringify(empty, null, 2)}\n`);
  console.log("No latest release; wrote empty catalog");
  process.exit(0);
}

const assets = [];
for (const asset of release.assets || []) {
  const meta = classifyAsset(asset.name);
  if (!meta) {
    continue;
  }
  assets.push({
    ...meta,
    name: asset.name,
    url: asset.browser_download_url,
    size: asset.size,
    sizeLabel: formatBytes(asset.size),
  });
}

// Prefer primary installers first.
const order = [
  "mac-arm",
  "mac-intel",
  "mac",
  "win-msi",
  "win-exe",
  "linux-appimage",
  "linux-deb",
  "linux-rpm",
];
assets.sort((a, b) => {
  const ai = order.indexOf(a.id);
  const bi = order.indexOf(b.id);
  return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
});

const catalog = {
  tag: release.tag_name,
  name: release.name || release.tag_name,
  htmlUrl: release.html_url,
  publishedAt: release.published_at,
  updatedAt: new Date().toISOString(),
  assets,
};

writeFileSync(outPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Wrote ${assets.length} assets for ${catalog.tag} → ${outPath}`);
