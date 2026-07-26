const versionLine = document.getElementById("version-line");
const grid = document.getElementById("download-grid");
const empty = document.getElementById("download-empty");
const allReleases = document.getElementById("all-releases");

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

function detectPreferredPlatform() {
  const ua = navigator.userAgent.toLowerCase();
  const platform = (navigator.platform || "").toLowerCase();
  if (platform.includes("mac") || ua.includes("mac os")) {
    return ua.includes("arm") || ua.includes("aarch64") ? "mac-arm" : "mac-intel";
  }
  if (platform.includes("win") || ua.includes("windows")) {
    return "win-msi";
  }
  if (platform.includes("linux") || ua.includes("linux")) {
    return "linux-appimage";
  }
  return null;
}

function render(catalog) {
  if (catalog.htmlUrl) {
    allReleases.href = catalog.htmlUrl;
  }

  if (!catalog.tag || !catalog.assets?.length) {
    versionLine.textContent = "Сборки ещё не опубликованы";
    empty.hidden = false;
    grid.replaceChildren();
    return;
  }

  const when = formatDate(catalog.publishedAt);
  versionLine.textContent = when
    ? `Актуальная версия ${catalog.tag} · ${when}`
    : `Актуальная версия ${catalog.tag}`;

  empty.hidden = true;
  const preferred = detectPreferredPlatform();
  const fragment = document.createDocumentFragment();

  for (const asset of catalog.assets) {
    const card = document.createElement("a");
    card.className = "download-card";
    card.href = asset.url;
    card.rel = "noopener";
    card.setAttribute("role", "listitem");
    if (preferred && asset.id === preferred) {
      card.dataset.preferred = "true";
      card.style.borderColor = "color-mix(in srgb, var(--teal) 55%, var(--line))";
    }
    card.innerHTML = `
      <span class="platform">${asset.label}</span>
      <span class="subtitle">${asset.subtitle}</span>
      <span class="meta">
        <b>${asset.kind}</b>
        ${asset.sizeLabel ? `<span>${asset.sizeLabel}</span>` : ""}
        ${preferred && asset.id === preferred ? "<span>для этого устройства</span>" : ""}
      </span>
    `;
    fragment.appendChild(card);
  }
  grid.replaceChildren(fragment);
}

try {
  const response = await fetch("./releases.json", { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  render(await response.json());
} catch (error) {
  versionLine.textContent = "Не удалось загрузить список сборок";
  empty.hidden = false;
  empty.textContent =
    "Откройте релизы на GitHub или обновите страницу после следующей сборки Pages.";
  console.error(error);
}
