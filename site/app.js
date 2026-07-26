const versionLine = document.getElementById("version-line");
const primary = document.getElementById("download-primary");
const grid = document.getElementById("download-grid");
const empty = document.getElementById("download-empty");
const allReleases = document.getElementById("all-releases");
const otherOsBtn = document.getElementById("other-os-btn");

const ICONS = {
  apple: `<svg class="os-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.37 12.27c.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.71-3.18-1.73-1.35-.14-2.64.8-3.33.8-.69 0-1.75-.78-2.88-.76-1.48.02-2.85.87-3.61 2.2-1.55 2.68-.4 6.64 1.11 8.81.74 1.06 1.61 2.25 2.76 2.21 1.11-.05 1.53-.71 2.87-.71 1.34 0 1.72.71 2.89.69 1.2-.02 1.95-1.07 2.68-2.14.84-1.23 1.19-2.42 1.21-2.48-.03-.01-2.31-.89-2.34-3.52zM14.4 5.98c.6-.74 1.01-1.76.9-2.78-.87.04-1.93.59-2.56 1.33-.56.65-1.05 1.7-.92 2.7.97.07 1.97-.49 2.58-1.25z"/></svg>`,
  windows: `<svg class="os-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 5.5 11.2 4.3v7.1H3V5.5zm8.8 7.2v7.1L3 18.6v-5.9h8.8zM12.7 4.1 21 3v8.4h-8.3V4.1zm8.3 8.5V21l-8.3-1.2v-7.2H21z"/></svg>`,
  linux: `<svg class="os-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12.1 2.1c-.8 0-1.5.7-1.7 1.7-.1.5-.1 1.2.1 2.1-.9.4-1.6 1.2-1.9 2.2-.4 1.3-.1 2.6.7 3.5-.5.8-.7 1.8-.5 2.8.3 1.4 1.3 2.5 2.6 2.9-.2.6-.2 1.3.1 1.9.4.8 1.2 1.3 2.1 1.3.5 0 1-.2 1.4-.5.4.3.9.5 1.4.5.9 0 1.7-.5 2.1-1.3.3-.6.3-1.3.1-1.9 1.3-.4 2.3-1.5 2.6-2.9.2-1 0-2-.5-2.8.8-.9 1.1-2.2.7-3.5-.3-1-1-1.8-1.9-2.2.2-.9.2-1.6.1-2.1-.2-1-.9-1.7-1.7-1.7-.5 0-1 .2-1.3.7-.3-.5-.8-.7-1.3-.7zm-1.4 5.1c.4 0 .8.2 1 .5.2-.3.6-.5 1-.5s.8.2 1 .5c.2-.3.6-.5 1-.5.6 0 1.1.5 1.1 1.2 0 .9-.7 1.5-1.5 1.8-.3.1-.5.4-.5.7v.4c0 .3-.3.6-.6.6s-.6-.3-.6-.6v-.4c0-.3-.2-.6-.5-.7-.8-.3-1.5-.9-1.5-1.8 0-.7.5-1.2 1.1-1.2z"/></svg>`,
};

function formatDate(iso) {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function familyOf(assetId) {
  if (assetId.startsWith("mac")) {
    return "mac";
  }
  if (assetId.startsWith("win")) {
    return "windows";
  }
  if (assetId.startsWith("linux")) {
    return "linux";
  }
  return "other";
}

function iconForFamily(family) {
  if (family === "mac") {
    return ICONS.apple;
  }
  if (family === "windows") {
    return ICONS.windows;
  }
  if (family === "linux") {
    return ICONS.linux;
  }
  return "";
}

function familyLabel(family) {
  if (family === "mac") {
    return "macOS";
  }
  if (family === "windows") {
    return "Windows";
  }
  if (family === "linux") {
    return "Linux";
  }
  return "Другая ОС";
}

/** Prefer MSI over EXE, AppImage over deb, arm dmg over intel on Apple Silicon. */
function rankAsset(asset, detected) {
  let score = 0;
  if (detected?.id && asset.id === detected.id) {
    score += 100;
  }
  if (detected?.family && familyOf(asset.id) === detected.family) {
    score += 40;
  }
  if (asset.id === "win-msi" || asset.id === "linux-appimage" || asset.id === "mac-arm") {
    score += 10;
  }
  if (asset.kind === "DMG" || asset.kind === "MSI" || asset.kind === "AppImage") {
    score += 5;
  }
  return score;
}

async function detectOS() {
  const ua = navigator.userAgent.toLowerCase();
  const platform = (navigator.platform || "").toLowerCase();
  const uaData = navigator.userAgentData;

  let family = null;
  let id = null;
  let detail = "";

  const platformHint = (uaData?.platform || platform || ua).toLowerCase();

  if (
    platformHint.includes("mac") ||
    ua.includes("mac os") ||
    ua.includes("macintosh")
  ) {
    family = "mac";
    let arch = null;
    try {
      if (uaData?.getHighEntropyValues) {
        const values = await uaData.getHighEntropyValues(["architecture", "bitness"]);
        arch = String(values.architecture || "").toLowerCase();
      }
    } catch {
      // ignore — fall back below
    }
    if (!arch && (ua.includes("arm64") || ua.includes("aarch64"))) {
      arch = "arm";
    }
    // Modern Macs are mostly Apple Silicon; MacIntel UA is common on both.
    if (arch === "arm" || arch === "arm64") {
      id = "mac-arm";
      detail = "Apple Silicon";
    } else if (arch === "x86" || arch === "x86_64") {
      id = "mac-intel";
      detail = "Intel";
    } else {
      id = "mac-arm";
      detail = "Apple Silicon (определено по умолчанию)";
    }
  } else if (platformHint.includes("win") || ua.includes("windows")) {
    family = "windows";
    id = "win-msi";
    detail = "x64";
  } else if (platformHint.includes("linux") || ua.includes("linux")) {
    family = "linux";
    id = "linux-appimage";
    detail = "x64";
  }

  return family
    ? { family, id, detail, label: familyLabel(family) }
    : { family: null, id: null, detail: "", label: null };
}

function createCard(asset, { preferred = false } = {}) {
  const family = familyOf(asset.id);
  const card = document.createElement("a");
  card.className = preferred ? "download-card primary-card" : "download-card";
  card.href = asset.url;
  card.rel = "noopener";
  card.setAttribute("role", "listitem");
  card.innerHTML = `
    <span class="card-icon">${iconForFamily(family)}</span>
    <span class="platform">${asset.label}</span>
    <span class="subtitle">${asset.subtitle}</span>
    <span class="meta">
      <b>${asset.kind}</b>
      ${asset.sizeLabel ? `<span>${asset.sizeLabel}</span>` : ""}
    </span>
  `;
  return card;
}

function render(catalog, detected) {
  if (catalog.htmlUrl) {
    allReleases.href = catalog.htmlUrl;
  }

  primary.replaceChildren();
  grid.replaceChildren();
  otherOsBtn.hidden = true;
  grid.hidden = true;
  otherOsBtn.setAttribute("aria-expanded", "false");
  otherOsBtn.textContent = "Другие ОС";

  if (!catalog.tag || !catalog.assets?.length) {
    versionLine.textContent = "Сборки ещё не опубликованы";
    empty.hidden = false;
    return;
  }

  const when = formatDate(catalog.publishedAt);
  versionLine.textContent = when
    ? `Актуальная версия ${catalog.tag} · ${when}`
    : `Актуальная версия ${catalog.tag}`;

  empty.hidden = true;

  const sorted = [...catalog.assets].sort(
    (a, b) => rankAsset(b, detected) - rankAsset(a, detected),
  );

  let primaryAsset = null;
  if (detected.family) {
    primaryAsset =
      sorted.find((asset) => familyOf(asset.id) === detected.family) ?? null;
  }
  if (!primaryAsset) {
    primaryAsset = sorted[0] ?? null;
  }

  const others = sorted.filter((asset) => asset !== primaryAsset);

  if (primaryAsset) {
    const family = familyOf(primaryAsset.id);
    const block = document.createElement("div");
    block.className = "primary-download";
    block.innerHTML = `
      <div class="primary-copy">
        <p class="detected">
          ${iconForFamily(detected.family || family)}
          <span>Обнаружена система: <strong>${detected.label || familyLabel(family)}</strong>${
            detected.detail ? ` · ${detected.detail}` : ""
          }</span>
        </p>
      </div>
    `;
    const cta = document.createElement("a");
    cta.className = "btn primary download-cta";
    cta.href = primaryAsset.url;
    cta.rel = "noopener";
    cta.innerHTML = `
      ${iconForFamily(family)}
      <span>
        <strong>Скачать для ${primaryAsset.label}</strong>
        <small>${primaryAsset.subtitle} · ${primaryAsset.kind}${
          primaryAsset.sizeLabel ? ` · ${primaryAsset.sizeLabel}` : ""
        }</small>
      </span>
    `;
    block.appendChild(cta);
    primary.appendChild(block);
  }

  if (others.length > 0) {
    otherOsBtn.hidden = false;
    for (const asset of others) {
      grid.appendChild(createCard(asset));
    }
  }
}

otherOsBtn.addEventListener("click", () => {
  const open = grid.hidden;
  grid.hidden = !open;
  otherOsBtn.setAttribute("aria-expanded", open ? "true" : "false");
  otherOsBtn.textContent = open ? "Скрыть другие ОС" : "Другие ОС";
});

try {
  const [response, detected] = await Promise.all([
    fetch("./releases.json", { cache: "no-cache" }),
    detectOS(),
  ]);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  render(await response.json(), detected);
} catch (error) {
  versionLine.textContent = "Не удалось загрузить список сборок";
  empty.hidden = false;
  empty.textContent =
    "Откройте релизы на GitHub или обновите страницу после следующей сборки Pages.";
  console.error(error);
}
