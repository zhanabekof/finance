import { getFullAnalytics, listGoals } from "./db";
import {
  buildConsultantReport,
  reportPdfFileName,
  type ConsultantReport,
} from "./reportNarrative";

type JsPdfDoc = import("jspdf").jsPDF;

const FONT_FAMILY = "DejaVuSans";

let fontCache: { regular: string; bold: string } | null = null;

async function loadFontAsBase64(path: string): Promise<string> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error("Не удалось загрузить шрифт для PDF");
  }
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x2000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, Array.from(slice));
  }
  return btoa(binary);
}

async function ensureFonts(doc: JsPdfDoc): Promise<void> {
  if (!fontCache) {
    const [regular, bold] = await Promise.all([
      loadFontAsBase64("/fonts/DejaVuSans.ttf"),
      loadFontAsBase64("/fonts/DejaVuSans-Bold.ttf"),
    ]);
    fontCache = { regular, bold };
  }

  doc.addFileToVFS("DejaVuSans.ttf", fontCache.regular);
  doc.addFileToVFS("DejaVuSans-Bold.ttf", fontCache.bold);
  doc.addFont("DejaVuSans.ttf", FONT_FAMILY, "normal");
  doc.addFont("DejaVuSans-Bold.ttf", FONT_FAMILY, "bold");
}

function setFont(doc: JsPdfDoc, style: "normal" | "bold", size: number): void {
  doc.setFont(FONT_FAMILY, style);
  doc.setFontSize(size);
}

function wrapLines(doc: JsPdfDoc, text: string, maxWidth: number): string[] {
  return doc.splitTextToSize(text, maxWidth) as string[];
}

type Layout = {
  doc: JsPdfDoc;
  margin: number;
  width: number;
  y: number;
  pageHeight: number;
};

function ensureSpace(layout: Layout, needed: number): void {
  if (layout.y + needed <= layout.pageHeight - layout.margin) {
    return;
  }
  layout.doc.addPage();
  layout.y = layout.margin;
}

function addParagraph(layout: Layout, text: string, size = 10): void {
  setFont(layout.doc, "normal", size);
  layout.doc.setTextColor(35, 42, 52);
  const lines = wrapLines(layout.doc, text, layout.width);
  const lineHeight = size * 0.42;
  ensureSpace(layout, lines.length * lineHeight + 2);
  layout.doc.text(lines, layout.margin, layout.y);
  layout.y += lines.length * lineHeight + 3;
}

function addHeading(layout: Layout, text: string): void {
  ensureSpace(layout, 14);
  layout.y += 2;
  setFont(layout.doc, "bold", 13);
  layout.doc.setTextColor(18, 28, 40);
  layout.doc.text(text, layout.margin, layout.y);
  layout.y += 6;
  layout.doc.setDrawColor(196, 168, 120);
  layout.doc.setLineWidth(0.4);
  layout.doc.line(layout.margin, layout.y, layout.margin + 28, layout.y);
  layout.y += 6;
}

function addBullet(layout: Layout, text: string): void {
  setFont(layout.doc, "normal", 10);
  layout.doc.setTextColor(35, 42, 52);
  const bulletIndent = 5;
  const lines = wrapLines(layout.doc, text, layout.width - bulletIndent);
  const lineHeight = 4.2;
  ensureSpace(layout, lines.length * lineHeight + 2);
  layout.doc.text("•", layout.margin, layout.y);
  layout.doc.text(lines, layout.margin + bulletIndent, layout.y);
  layout.y += lines.length * lineHeight + 2.5;
}

function addRow(
  layout: Layout,
  left: string,
  right: string,
  note?: string,
): void {
  setFont(layout.doc, "normal", 9.5);
  layout.doc.setTextColor(35, 42, 52);
  const rightWidth = 42;
  const leftWidth = layout.width - rightWidth - 4;
  const leftLines = wrapLines(layout.doc, left, leftWidth);
  const rightLines = wrapLines(layout.doc, right, rightWidth);
  const noteLines = note ? wrapLines(layout.doc, note, layout.width) : [];
  const lineHeight = 4;
  const block =
    Math.max(leftLines.length, rightLines.length) * lineHeight +
    noteLines.length * 3.6 +
    3;
  ensureSpace(layout, block);
  layout.doc.text(leftLines, layout.margin, layout.y);
  layout.doc.text(rightLines, layout.margin + layout.width, layout.y, {
    align: "right",
  });
  layout.y += Math.max(leftLines.length, rightLines.length) * lineHeight;
  if (noteLines.length > 0) {
    setFont(layout.doc, "normal", 8.5);
    layout.doc.setTextColor(110, 118, 130);
    layout.doc.text(noteLines, layout.margin, layout.y + 0.5);
    layout.y += noteLines.length * 3.6 + 1;
  }
  layout.y += 2;
  layout.doc.setDrawColor(230, 226, 218);
  layout.doc.setLineWidth(0.2);
  layout.doc.line(layout.margin, layout.y, layout.margin + layout.width, layout.y);
  layout.y += 3.5;
}

function renderCover(layout: Layout, report: ConsultantReport): void {
  const { doc, margin, width } = layout;

  doc.setFillColor(18, 28, 40);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 52, "F");
  doc.setFillColor(196, 168, 120);
  doc.rect(0, 52, doc.internal.pageSize.getWidth(), 1.2, "F");

  setFont(doc, "normal", 10);
  doc.setTextColor(196, 168, 120);
  doc.text("FINANCE · ЛОКАЛЬНЫЙ ОТЧЁТ", margin, 18);

  setFont(doc, "bold", 22);
  doc.setTextColor(248, 250, 252);
  doc.text(report.title, margin, 30);

  setFont(doc, "normal", 11);
  doc.setTextColor(210, 216, 224);
  doc.text(wrapLines(doc, report.subtitle, width), margin, 38);

  layout.y = 64;
  setFont(doc, "bold", 14);
  doc.setTextColor(18, 28, 40);
  doc.text(report.periodLabel, margin, layout.y);
  layout.y += 7;
  setFont(doc, "normal", 9);
  doc.setTextColor(110, 118, 130);
  doc.text(`Сформирован: ${report.generatedAtLabel}`, margin, layout.y);
  layout.y += 10;

  const toneFill =
    report.health.tone === "good"
      ? ([232, 245, 236] as const)
      : report.health.tone === "watch"
        ? ([255, 245, 230] as const)
        : ([252, 235, 232] as const);
  const toneText =
    report.health.tone === "good"
      ? ([28, 110, 60] as const)
      : report.health.tone === "watch"
        ? ([150, 90, 20] as const)
        : ([150, 45, 35] as const);

  ensureSpace(layout, 28);
  doc.setFillColor(toneFill[0], toneFill[1], toneFill[2]);
  doc.roundedRect(margin, layout.y, width, 24, 2, 2, "F");
  setFont(doc, "bold", 11);
  doc.setTextColor(toneText[0], toneText[1], toneText[2]);
  doc.text(report.health.label, margin + 4, layout.y + 7);
  setFont(doc, "normal", 9.5);
  doc.setTextColor(35, 42, 52);
  doc.text(wrapLines(doc, report.health.detail, width - 8).slice(0, 3), margin + 4, layout.y + 13);
  layout.y += 30;

  addHeading(layout, "Краткий вывод");
  addParagraph(layout, report.executiveSummary, 10.5);

  addHeading(layout, "Ключевые цифры");
  const colW = (width - 6) / 2;
  let col = 0;
  let rowY = layout.y;
  for (const metric of report.highlights) {
    const x = margin + col * (colW + 6);
    ensureSpace(layout, 22);
    if (col === 0) {
      rowY = layout.y;
    }
    doc.setFillColor(246, 244, 239);
    doc.roundedRect(x, rowY, colW, 20, 1.5, 1.5, "F");
    setFont(doc, "normal", 8);
    doc.setTextColor(110, 118, 130);
    doc.text(metric.label, x + 3, rowY + 5);
    setFont(doc, "bold", 12);
    doc.setTextColor(18, 28, 40);
    doc.text(metric.value, x + 3, rowY + 11);
    setFont(doc, "normal", 7.5);
    doc.setTextColor(110, 118, 130);
    doc.text(wrapLines(doc, metric.note, colW - 6).slice(0, 2), x + 3, rowY + 15.5);
    col += 1;
    if (col === 2) {
      col = 0;
      layout.y = rowY + 24;
    }
  }
  if (col === 1) {
    layout.y = rowY + 24;
  }
}

function renderReport(doc: JsPdfDoc, report: ConsultantReport): void {
  const layout: Layout = {
    doc,
    margin: 16,
    width: doc.internal.pageSize.getWidth() - 32,
    y: 16,
    pageHeight: doc.internal.pageSize.getHeight(),
  };

  renderCover(layout, report);

  for (const section of report.sections) {
    addHeading(layout, section.heading);
    for (const paragraph of section.paragraphs) {
      addParagraph(layout, paragraph);
    }
    if (section.rows) {
      for (const row of section.rows) {
        addRow(layout, row.left, row.right, row.note);
      }
    }
    if (section.bullets) {
      for (const bullet of section.bullets) {
        addBullet(layout, bullet);
      }
    }
  }

  addHeading(layout, "Рекомендации консультанта");
  addParagraph(
    layout,
    "Ниже — практические шаги на ближайшие недели. Они не блокируют операции в приложении, а помогают вернуть контроль над планом.",
    9.5,
  );
  for (const tip of report.recommendations) {
    addBullet(layout, tip);
  }

  ensureSpace(layout, 18);
  layout.y += 4;
  setFont(doc, "normal", 8);
  doc.setTextColor(130, 136, 146);
  doc.text(wrapLines(doc, report.disclaimer, layout.width), layout.margin, layout.y);

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    setFont(doc, "normal", 8);
    doc.setTextColor(150, 155, 162);
    doc.text(
      `Finance · ${report.periodLabel} · стр. ${page} из ${pageCount}`,
      layout.margin,
      layout.pageHeight - 8,
    );
  }
}

export async function buildConsultantReportPdf(
  yearMonth: string,
  currency: string,
): Promise<{ doc: JsPdfDoc; filename: string; report: ConsultantReport }> {
  const [{ jsPDF }, overview, goals] = await Promise.all([
    import("jspdf"),
    getFullAnalytics(currency, yearMonth),
    listGoals(false),
  ]);
  const report = buildConsultantReport(
    overview,
    goals.map((goal) => ({
      title: goal.title,
      currency: goal.currency,
      targetMinor: goal.target_minor,
      savedMinor: goal.saved_minor,
      deadlineDate: goal.deadline_date,
    })),
  );

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  await ensureFonts(doc);
  renderReport(doc, report);
  return {
    doc,
    filename: reportPdfFileName(yearMonth),
    report,
  };
}

export function downloadPdf(doc: JsPdfDoc, filename: string): void {
  doc.save(filename);
}

export async function exportConsultantReportPdf(
  yearMonth: string,
  currency: string,
): Promise<string> {
  const { doc, filename } = await buildConsultantReportPdf(yearMonth, currency);
  downloadPdf(doc, filename);
  return filename;
}
