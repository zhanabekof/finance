import type { AnalyticsOverview } from "./analytics";
import { formatPercent } from "./analytics";
import { buildGoalProgress, suggestedMonthlyContribution } from "./goals";
import { formatMoney } from "./money";

export type GoalReportInput = {
  title: string;
  currency: string;
  targetMinor: number;
  savedMinor: number;
  deadlineDate: string | null;
};

export type ReportMetric = {
  label: string;
  value: string;
  note: string;
};

export type ReportSection = {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
  rows?: { left: string; right: string; note?: string }[];
};

export type ConsultantReport = {
  title: string;
  subtitle: string;
  periodLabel: string;
  generatedAtLabel: string;
  currency: string;
  yearMonth: string;
  executiveSummary: string;
  health: {
    label: string;
    tone: "good" | "watch" | "risk";
    detail: string;
  };
  highlights: ReportMetric[];
  sections: ReportSection[];
  recommendations: string[];
  disclaimer: string;
};

function monthTitleRu(yearMonth: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) {
    return yearMonth;
  }
  const [year, month] = yearMonth.split("-").map(Number);
  return new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, (month ?? 1) - 1, 1)));
}

function money(amountMinor: number, currency: string): string {
  return formatMoney(amountMinor, currency);
}

function assessHealth(overview: AnalyticsOverview): ConsultantReport["health"] {
  const { month, monthBudget, alerts } = overview;
  const overCount = alerts.filter((row) => row.status === "over").length;
  const nearCount = alerts.filter((row) => row.status === "near").length;
  const savings = month.savingsRate;
  const budgetOver =
    monthBudget.allocatedMinor > 0 &&
    monthBudget.actualExpenseMinor > monthBudget.allocatedMinor;

  if (overCount > 0 || budgetOver || (savings != null && savings < 0)) {
    return {
      label: "Зона внимания",
      tone: "risk",
      detail:
        overCount > 0
          ? `По ${overCount} категори${overCount === 1 ? "и" : "ям"} лимит уже превышен — это сигнал пересмотреть приоритеты расходов.`
          : budgetOver
            ? "Факт расходов выше суммы лимитов месяца. Важно понять, какие траты необязательны."
            : "Расходы превысили доходы за период — капитал уменьшается.",
    };
  }

  if (nearCount > 0 || (savings != null && savings < 0.1)) {
    return {
      label: "Умеренный контроль",
      tone: "watch",
      detail:
        nearCount > 0
          ? `Близко к лимиту: ${nearCount} категори${nearCount === 1 ? "я" : "и"}. Небольшой запас — хороший момент усилить дисциплину.`
          : "Норма сбережений ниже 10%. Имеет смысл зафиксировать «плату себе» в начале месяца.",
    };
  }

  return {
    label: "Устойчивый темп",
    tone: "good",
    detail:
      savings == null
        ? "Доходов за период пока мало для оценки нормы сбережений, но бюджетных перерасходов нет."
        : `Норма сбережений ${formatPercent(savings)} — комфортный запас между доходом и расходами.`,
  };
}

function cashflowCommentary(overview: AnalyticsOverview): string[] {
  const { month, currency } = overview;
  const paragraphs: string[] = [];

  if (month.incomeMinor === 0 && month.expenseMinor === 0) {
    paragraphs.push(
      "За выбранный месяц операций почти нет. Отчёт строится на доступных данных: имеет смысл выбрать месяц с активностью или дождаться новых записей.",
    );
    return paragraphs;
  }

  paragraphs.push(
    `За период доход составил ${money(month.incomeMinor, currency)}, расход — ${money(
      month.expenseMinor,
      currency,
    )}. Чистый итог: ${money(month.netMinor, currency)}.`,
  );

  if (month.savingsRate != null) {
    paragraphs.push(
      `Норма сбережений ${formatPercent(month.savingsRate)} показывает, какая доля дохода осталась после расходов. Ориентир здорового личного бюджета — держать запас не ниже 10–20%, если нет долгового давления.`,
    );
  } else {
    paragraphs.push(
      "Доход за месяц нулевой или не зафиксирован — норму сбережений посчитать нельзя. Проверьте, что поступления записаны на нужные даты.",
    );
  }

  const essentialShare =
    month.expenseMinor > 0 ? month.essentialExpenseMinor / month.expenseMinor : 0;
  paragraphs.push(
    `Обязательные расходы — ${money(month.essentialExpenseMinor, currency)} (${formatPercent(
      essentialShare,
    )} от расходов), необязательные — ${money(
      month.discretionaryExpenseMinor,
      currency,
    )}. Чем выше доля обязательных, тем меньше гибкости при снижении дохода.`,
  );

  if (month.uncategorizedExpenseMinor > 0) {
    paragraphs.push(
      `Без категории ушло ${money(
        month.uncategorizedExpenseMinor,
        currency,
      )}. Без классификации трудно управлять лимитами — полезно разметить эти операции.`,
    );
  }

  if (month.avgDailyExpenseMinor > 0 && month.daysElapsed > 0) {
    paragraphs.push(
      `Средний темп расходов: ${money(
        month.avgDailyExpenseMinor,
        currency,
      )} в день (за ${month.daysElapsed} из ${month.daysInMonth} дн.). При сохранении темпа месяц может закрыться около ${money(
        month.avgDailyExpenseMinor * month.daysInMonth,
        currency,
      )}.`,
    );
  }

  return paragraphs;
}

function budgetCommentary(overview: AnalyticsOverview): ReportSection {
  const { monthBudget, currency } = overview;
  const paragraphs: string[] = [];
  const rows: ReportSection["rows"] = [];

  const hasPlan =
    monthBudget.plannedIncomeMinor > 0 || monthBudget.allocatedMinor > 0;

  if (!hasPlan) {
    return {
      heading: "Бюджет: план и факт",
      paragraphs: [
        "На этот месяц план не задан. Без лимитов отчёт показывает только факт операций. Рекомендую задать плановый доход и лимиты по ключевым категориям — тогда сравнение «план / факт» станет рабочим инструментом.",
      ],
    };
  }

  paragraphs.push(
    `Плановый доход ${money(monthBudget.plannedIncomeMinor, currency)}, лимиты расходов ${money(
      monthBudget.allocatedMinor,
      currency,
    )}, свободные (нераспределённые) средства ${money(
      monthBudget.freeMinor,
      currency,
    )}.`,
  );
  paragraphs.push(
    `Факт: доход ${money(monthBudget.actualIncomeMinor, currency)}, расход ${money(
      monthBudget.actualExpenseMinor,
      currency,
    )}. Отклонение расхода от лимитов: ${money(
      monthBudget.actualExpenseMinor - monthBudget.allocatedMinor,
      currency,
    )}.`,
  );

  const focus = [...monthBudget.categories]
    .filter((row) => row.kind === "expense" && row.planMinor > 0)
    .sort((a, b) => b.usageRatio - a.usageRatio)
    .slice(0, 8);

  for (const row of focus) {
    const statusLabel =
      row.status === "over"
        ? "перерасход"
        : row.status === "near"
          ? "близко к лимиту"
          : "в рамках";
    rows.push({
      left: row.categoryName,
      right: `${money(row.actualMinor, currency)} / ${money(row.planMinor, currency)}`,
      note: `${statusLabel} · остаток ${money(row.remainingMinor, currency)}`,
    });
  }

  return {
    heading: "Бюджет: план и факт",
    paragraphs,
    rows,
  };
}

function categoryCommentary(overview: AnalyticsOverview): ReportSection {
  const { month, currency } = overview;
  const top = month.expenseCategories.slice(0, 5);
  if (top.length === 0) {
    return {
      heading: "Структура расходов",
      paragraphs: [
        "Расходных категорий за период нет. После появления операций здесь будет разбор крупнейших статей.",
      ],
    };
  }

  const leader = top[0]!;
  const paragraphs = [
    `Крупнейшая статья — «${leader.categoryName}»: ${money(
      leader.amountMinor,
      currency,
    )} (${formatPercent(leader.shareRatio)} расходов). Именно сюда обычно смотрят в первую очередь при оптимизации.`,
  ];

  return {
    heading: "Структура расходов",
    paragraphs,
    rows: top.map((row) => ({
      left: `${row.categoryName}${row.isEssential ? " · обязательно" : ""}`,
      right: money(row.amountMinor, currency),
      note: formatPercent(row.shareRatio),
    })),
  };
}

function goalsSection(goals: GoalReportInput[]): ReportSection {
  if (goals.length === 0) {
    return {
      heading: "Цели накоплений",
      paragraphs: [
        "Активных целей нет. Цель с дедлайном превращает «лишние» деньги в понятный ежемесячный взнос и снижает риск потратить остаток импульсивно.",
      ],
    };
  }

  const bullets: string[] = [];
  for (const goal of goals.slice(0, 6)) {
    try {
      const progress = buildGoalProgress({
        targetMinor: goal.targetMinor,
        savedMinor: goal.savedMinor,
        deadlineDate: goal.deadlineDate,
      });
      const status =
        progress.status === "done"
          ? "достигнута"
          : progress.status === "near"
            ? "почти достигнута"
            : "в работе";
      let line = `«${goal.title}»: ${money(goal.savedMinor, goal.currency)} из ${money(
        goal.targetMinor,
        goal.currency,
      )} (${formatPercent(progress.usageRatio)}, ${status})`;
      if (progress.daysLeft != null && progress.status !== "done") {
        const monthly = suggestedMonthlyContribution(
          progress.remainingMinor,
          progress.daysLeft,
        );
        line +=
          progress.daysLeft < 0
            ? `. Срок прошёл — осталось ${money(progress.remainingMinor, goal.currency)}.`
            : `. До срока ${progress.daysLeft} дн.; ориентир взноса ~${money(
                monthly,
                goal.currency,
              )} в месяц.`;
      }
      bullets.push(line);
    } catch {
      bullets.push(`«${goal.title}»: данные цели требуют проверки.`);
    }
  }

  return {
    heading: "Цели накоплений",
    paragraphs: [
      "Цели ниже — это «назначение» свободных денег. Регулярный перевод на цель важнее разовых крупных взносов.",
    ],
    bullets,
  };
}

function buildRecommendations(
  overview: AnalyticsOverview,
  goals: GoalReportInput[],
): string[] {
  const tips: string[] = [];
  const { month, monthBudget, alerts, currency } = overview;

  for (const alert of alerts.filter((row) => row.status === "over").slice(0, 3)) {
    tips.push(
      `Категория «${alert.categoryName}»: перерасход ${money(
        Math.abs(alert.remainingMinor),
        currency,
      )}. На оставшиеся дни месяца зафиксируйте потолок или перенесите необязательные покупки.`,
    );
  }

  if (
    monthBudget.allocatedMinor > 0 &&
    monthBudget.actualExpenseMinor > monthBudget.allocatedMinor
  ) {
    tips.push(
      "Суммарный факт расходов выше лимитов. Пересмотрите необязательные категории до конца месяца, а не общий «бюджет на всё».",
    );
  }

  if (month.uncategorizedExpenseMinor > 0) {
    tips.push(
      "Разметьте операции без категории — иначе лимиты и прогноз будут неточными.",
    );
  }

  if (month.savingsRate != null && month.savingsRate < 0.1 && month.incomeMinor > 0) {
    tips.push(
      "Норма сбережений ниже 10%. Автоматизируйте перевод на цель или отдельный счёт в день поступления дохода.",
    );
  }

  if (monthBudget.freeMinor < 0) {
    tips.push(
      "Лимиты расходов превышают плановый доход. Либо увеличьте план дохода, либо сократите лимиты — иначе бюджет заведомо невыполним.",
    );
  }

  if (goals.length === 0) {
    tips.push(
      "Создайте одну конкретную цель с суммой и сроком — это якорь для свободных средств.",
    );
  } else {
    const open = goals.find((goal) => goal.savedMinor < goal.targetMinor);
    if (open) {
      tips.push(
        `Сделайте пополнение «${open.title}» регулярным действием после записи дохода, а не остатком «если останется».`,
      );
    }
  }

  if (tips.length === 0) {
    tips.push(
      "Сохраняйте текущий темп: фиксируйте операции в день траты и раз в месяц сверяйте план с фактом.",
    );
    tips.push(
      "Раз в квартал пересматривайте обязательные категории — часть подписок и сервисов обычно устаревает незаметно.",
    );
  }

  return tips.slice(0, 6);
}

/** Build a financial-consultant style report from analytics (no IO). */
export function buildConsultantReport(
  overview: AnalyticsOverview,
  goals: GoalReportInput[] = [],
  generatedAt = new Date(),
): ConsultantReport {
  const periodLabel = monthTitleRu(overview.yearMonth);
  const health = assessHealth(overview);
  const { month, currency, accounts } = overview;

  const highlights: ReportMetric[] = [
    {
      label: "Баланс счетов",
      value: money(overview.balanceMinor, currency),
      note:
        accounts.length > 1
          ? `${accounts.length} активных счетов в основной валюте отчёта`
          : "Сумма по счетам в валюте отчёта",
    },
    {
      label: "Доход месяца",
      value: money(month.incomeMinor, currency),
      note: "Фактические поступления за период",
    },
    {
      label: "Расход месяца",
      value: money(month.expenseMinor, currency),
      note: "Фактические списания за период",
    },
    {
      label: "Чистый итог",
      value: money(month.netMinor, currency),
      note:
        month.savingsRate == null
          ? "Доход − расход"
          : `Норма сбережений ${formatPercent(month.savingsRate)}`,
    },
  ];

  const accountRows = accounts.map((account) => ({
    left: `${account.name} · ${account.currency}`,
    right: money(account.balanceMinor, account.currency),
  }));

  const yearFlow = overview.yearFlow;
  const yearParagraphs = [
    `С начала ${overview.year} года: доход ${money(
      yearFlow.incomeMinor,
      currency,
    )}, расход ${money(yearFlow.expenseMinor, currency)}, итог ${money(
      yearFlow.netMinor,
      currency,
    )}${
      yearFlow.savingsRate == null
        ? "."
        : `, норма сбережений ${formatPercent(yearFlow.savingsRate)}.`
    }`,
  ];

  const activeMonths = yearFlow.months.filter(
    (row) => row.incomeMinor > 0 || row.expenseMinor > 0,
  );
  if (activeMonths.length > 0) {
    const busiest = [...activeMonths].sort(
      (a, b) => b.expenseMinor - a.expenseMinor,
    )[0]!;
    yearParagraphs.push(
      `Самый затратный месяц из заполненных — ${monthTitleRu(
        busiest.yearMonth,
      )} (${money(busiest.expenseMinor, currency)} расходов). Сравнивайте соседние месяцы, чтобы отличать разовые всплески от системного роста.`,
    );
  }

  return {
    title: "Личный финансовый отчёт",
    subtitle: "Разбор в формате консультанта: цифры, смысл и следующие шаги",
    periodLabel,
    generatedAtLabel: new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(generatedAt),
    currency,
    yearMonth: overview.yearMonth,
    executiveSummary: `${health.label}. ${health.detail} Ниже — разбор денежного потока, бюджета и целей за ${periodLabel}.`,
    health,
    highlights,
    sections: [
      {
        heading: "Денежный поток месяца",
        paragraphs: cashflowCommentary(overview),
      },
      budgetCommentary(overview),
      categoryCommentary(overview),
      {
        heading: "Счета",
        paragraphs: [
          "Балансы считаются из истории операций. Расхождения между «ожидаемым» и фактом обычно означают пропущенные или задним числом записанные операции.",
        ],
        rows: accountRows,
      },
      {
        heading: `Год ${overview.year} — контекст`,
        paragraphs: yearParagraphs,
      },
      goalsSection(goals),
    ],
    recommendations: buildRecommendations(overview, goals),
    disclaimer:
      "Отчёт сформирован локально из ваших данных в Finance. Это информационный разбор, а не индивидуальная инвестиционная рекомендация. Перед крупными решениями сверяйте цифры с первичными операциями.",
  };
}

export function reportPdfFileName(yearMonth: string, at = new Date()): string {
  const stamp = at.toISOString().slice(0, 10);
  return `finance-report-${yearMonth}-${stamp}.pdf`;
}
