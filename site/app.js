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
    ? `${catalog.tag} · опубликован ${when}`
    : catalog.tag;

  empty.hidden = true;
  const fragment = document.createDocumentFragment();
  for (const asset of catalog.assets) {
    const card = document.createElement("a");
    card.className = "download-card";
    card.href = asset.url;
    card.rel = "noopener";
    card.setAttribute("role", "listitem");
    card.innerHTML = `
      <span class="platform">${asset.label}</span>
      <span class="subtitle">${asset.subtitle}</span>
      <span class="meta">
        <b>${asset.kind}</b>
        ${asset.sizeLabel ? `<span>${asset.sizeLabel}</span>` : ""}
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
    "Откройте страницу релизов на GitHub или обновите сайт после следующей сборки.";
  console.error(error);
}
