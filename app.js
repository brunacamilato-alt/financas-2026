const STORAGE_KEY = "fluxo-caixa-local-v1";
const INVESTMENT_WITHDRAWAL_DATE = "2027-01-01";

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const dateFormat = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const monthFormat = new Intl.DateTimeFormat("pt-BR", {
  month: "short",
  year: "2-digit",
});

const monthOnlyFormat = new Intl.DateTimeFormat("pt-BR", {
  month: "short",
});

const DEFAULT_IMPORT_FILE = "Fluxo Caixa_Carga.xlsx";
const DEFAULT_IMPORT_URL = `./${encodeURIComponent(DEFAULT_IMPORT_FILE)}`;

const dom = {
  file: document.querySelector("#statementFile"),
  backupFile: document.querySelector("#backupFile"),
  importStatus: document.querySelector("#importStatus"),
  backupMeta: document.querySelector("#backupMeta"),
  baseBalance: document.querySelector("#baseBalanceInput"),
  baseDate: document.querySelector("#baseDateInput"),
  horizon: document.querySelector("#horizonInput"),
  futureForm: document.querySelector("#futureForm"),
  forecastRows: document.querySelector("#forecastRows"),
  forecastChart: document.querySelector("#forecastChart"),
  futureRows: document.querySelector("#futureRows"),
  importedRows: document.querySelector("#importedRows"),
  metricBase: document.querySelector("#metricBase"),
  metric30: document.querySelector("#metric30"),
  metricLow: document.querySelector("#metricLow"),
  metricProbable: document.querySelector("#metricProbable"),
  metricInvestment: document.querySelector("#metricInvestment"),
  metricRunway: document.querySelector("#metricRunway"),
  healthStatus: document.querySelector("#healthStatus"),
  healthText: document.querySelector("#healthText"),
  annualChart: document.querySelector("#annualChart"),
  annualSubtitle: document.querySelector("#annualSubtitle"),
  bridgeLegend: document.querySelector("#bridgeLegend"),
  bankBalanceCards: document.querySelector("#bankBalanceCards"),
  bankBalanceHint: document.querySelector("#bankBalanceHint"),
  drillRows: document.querySelector("#drillRows"),
  drillTotal: document.querySelector("#drillTotal"),
  drillSubtitle: document.querySelector("#drillSubtitle"),
  drillSearch: document.querySelector("#drillSearchInput"),
  drillMin: document.querySelector("#drillMinInput"),
  drillMax: document.querySelector("#drillMaxInput"),
  drillSource: document.querySelector("#drillSourceInput"),
  drillTabs: document.querySelectorAll(".drill-tabs [data-drill-type]"),
  metricDrills: document.querySelectorAll(".metric-drill[data-drill-type]"),
  entryFormHint: document.querySelector("#entryFormHint"),
  refresh: document.querySelector("#refreshButton"),
  exportBackup: document.querySelector("#exportBackupButton"),
  importBackup: document.querySelector("#importBackupButton"),
  submitEntry: document.querySelector("#submitEntryButton"),
  cancelEdit: document.querySelector("#cancelEditButton"),
  clearImported: document.querySelector("#clearImportedButton"),
  clearFutures: document.querySelector("#clearFuturesButton"),
  resetApp: document.querySelector("#resetAppButton"),
};

let stateLoadedFromStorage = false;
const state = loadState();
let editingEntry = null;
let activeDrillType = "all";

const drillLabels = {
  all: "Todos os lancamentos",
  real: "Caixa real",
  receivable: "A receber",
  payable: "A pagar",
  provision_credit: "A receber",
  provision_debit: "A pagar",
  investment_outflow: "Investimento / retirada futura",
  investment: "Investimento / aporte",
};

const trackedBanks = [
  {
    key: "santander",
    label: "Santander",
    search: "Santander",
    patterns: [/santander/],
  },
  {
    key: "c6",
    label: "C6",
    search: "C6",
    patterns: [/\bc6\b/, /banco c6/, /c 6/],
  },
  {
    key: "bb",
    label: "Banco do Brasil",
    search: "Banco do Brasil",
    patterns: [/banco do brasil/, /\bbb\b/, /brasil/],
  },
];

  void init();

  async function init() {
  dom.futureForm.elements.date.value = todayIso();
  if (ensurePublicIds()) saveState();
  bindEvents();
  syncControls();
  if (!stateLoadedFromStorage) {
    await bootstrapDefaultWorkbook();
  }
  render();
}

function bindEvents() {
  dom.file.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await importStatement(file);
    dom.file.value = "";
  });

  const dropZone = document.querySelector(".drop-zone");
  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.classList.add("is-dragging");
  });
  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("is-dragging");
  });
  dropZone.addEventListener("drop", async (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-dragging");
    const file = event.dataTransfer?.files?.[0];
    if (file) await importStatement(file);
  });

  dom.baseBalance.addEventListener("input", () => {
    state.settings.baseBalance = Number(dom.baseBalance.value || 0);
    persistAndRender();
  });

  dom.baseDate.addEventListener("input", () => {
    state.settings.baseDate = dom.baseDate.value || todayIso();
    persistAndRender();
  });

  dom.horizon.addEventListener("change", () => {
    state.settings.horizonMonths = Number(dom.horizon.value || 6);
    persistAndRender();
  });

  dom.refresh.addEventListener("click", () => {
    syncStateFromControls();
    saveState();
    render();
    pulseRefreshButton();
  });

  dom.futureForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(dom.futureForm);
    const amount = parseMoney(data.get("amount"));
    if (!amount || amount <= 0) return;

    const existingEditing =
      editingEntry?.collection === "imported"
        ? state.imported.find((item) => item.id === editingEntry.id)
        : state.futures.find((item) => item.id === editingEntry?.id);
    const entryDate = String(data.get("date"));
    const entryType = String(data.get("type"));
    let entryStatusValue = String(data.get("status") || "Previsto").trim();
    if (
      entryStatusValue === "Previsto" &&
      ["credit", "debit"].includes(entryType) &&
      entryDate <= (state.settings.baseDate || todayIso())
    ) {
      entryStatusValue = "Realizado";
    }
    const entry = {
      ...(existingEditing || {}),
      id: editingEntry?.id || crypto.randomUUID(),
      publicId: existingEditing?.publicId || nextPublicId(entryDate),
      date: entryDate,
      type: entryType,
      description: String(data.get("description")).trim(),
      amount,
      account: String(data.get("account") || "").trim(),
      category: String(data.get("category") || "").trim(),
      client: String(data.get("client") || "").trim(),
      quoteNumber: String(data.get("quoteNumber") || "").trim(),
      commitment: String(data.get("commitment") || "").trim(),
      status: entryStatusValue,
      source: editingEntry?.collection === "imported" ? "imported" : "manual",
    };

    if (editingEntry?.collection === "imported") {
      state.imported = state.imported.map((item) => (item.id === editingEntry.id ? entry : item));
      refreshImportMetaCount();
      stopEditing();
    } else if (editingEntry?.collection === "manual") {
      state.futures = state.futures.map((item) => (item.id === editingEntry.id ? entry : item));
      stopEditing();
    } else {
      state.futures.push(entry);
    }

    dom.futureForm.reset();
    dom.futureForm.elements.date.value = todayIso();
    dom.futureForm.elements.type.value = "credit";
    dom.futureForm.elements.account.value = "";
    dom.futureForm.elements.status.value = "Previsto";
    syncStateFromControls();
    persistAndRender();
  });

  dom.futureRows.addEventListener("click", (event) => {
    const realizeButton = event.target.closest("[data-realize-entry]");
    if (realizeButton) {
      markEntryAsRealized(realizeButton.dataset.realizeEntry, "manual");
      return;
    }

    const editButton = event.target.closest("[data-edit-entry]");
    if (editButton) {
      startEditing(editButton.dataset.editEntry, "manual");
      return;
    }

    const deleteButton = event.target.closest("[data-delete-future]");
    if (!deleteButton) return;
    if (editingEntry?.id === deleteButton.dataset.deleteFuture) stopEditing();
    state.futures = state.futures.filter((item) => item.id !== deleteButton.dataset.deleteFuture);
    persistAndRender();
  });

  dom.importedRows.addEventListener("click", (event) => {
    const realizeButton = event.target.closest("[data-realize-imported]");
    if (realizeButton) {
      markEntryAsRealized(realizeButton.dataset.realizeImported, "imported");
      return;
    }

    const editButton = event.target.closest("[data-edit-imported]");
    if (editButton) {
      startEditing(editButton.dataset.editImported, "imported");
      return;
    }

    const deleteButton = event.target.closest("[data-delete-imported]");
    if (!deleteButton) return;
    if (editingEntry?.id === deleteButton.dataset.deleteImported) stopEditing();
    state.imported = state.imported.filter((item) => item.id !== deleteButton.dataset.deleteImported);
    refreshImportMetaCount();
    persistAndRender();
  });

  dom.drillRows.addEventListener("click", (event) => {
    const realizeButton = event.target.closest("[data-drill-realize]");
    if (realizeButton) {
      markEntryAsRealized(realizeButton.dataset.drillRealize, realizeButton.dataset.drillCollection);
      return;
    }

    const editButton = event.target.closest("[data-drill-edit]");
    if (editButton) {
      startEditing(editButton.dataset.drillEdit, editButton.dataset.drillCollection);
      return;
    }

    const deleteButton = event.target.closest("[data-drill-delete]");
    if (!deleteButton) return;
    deleteEntry(deleteButton.dataset.drillDelete, deleteButton.dataset.drillCollection);
  });

  for (const tab of dom.drillTabs) {
    tab.addEventListener("click", () => setActiveDrill(tab.dataset.drillType || "all"));
  }

  for (const card of dom.metricDrills) {
    card.addEventListener("click", () => setActiveDrill(card.dataset.drillType || "all", true));
  }

  dom.bankBalanceCards.addEventListener("click", (event) => {
    const card = event.target.closest("[data-bank-search]");
    if (!card) return;
    dom.drillSearch.value = card.dataset.bankSearch || "";
    dom.drillSource.value = "all";
    setActiveDrill("real", true);
  });

  for (const filter of [dom.drillSearch, dom.drillMin, dom.drillMax, dom.drillSource]) {
    filter.addEventListener("input", () => renderDrillDown());
    filter.addEventListener("change", () => renderDrillDown());
  }

  dom.cancelEdit.addEventListener("click", () => {
    stopEditing();
    dom.futureForm.reset();
    dom.futureForm.elements.date.value = todayIso();
    dom.futureForm.elements.type.value = "credit";
    dom.futureForm.elements.account.value = "";
    dom.futureForm.elements.status.value = "Previsto";
  });

  dom.clearImported.addEventListener("click", () => {
    state.imported = [];
    state.snapshots = [];
    state.importMeta = null;
    persistAndRender();
  });

  dom.exportBackup.addEventListener("click", () => {
    exportBackup();
  });

  dom.importBackup.addEventListener("click", () => {
    dom.backupFile.click();
  });

  dom.backupFile.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await importBackup(file);
    dom.backupFile.value = "";
  });

  dom.clearFutures.addEventListener("click", () => {
    state.futures = [];
    stopEditing();
    persistAndRender();
  });

  dom.resetApp.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    state.imported = [];
    state.futures = [];
    state.snapshots = [];
    state.importMeta = null;
    state.backupMeta = null;
    state.settings = defaultSettings();
    stopEditing();
    syncControls();
    render();
  });
}

async function importStatement(file) {
  dom.importStatus.textContent = "Lendo arquivo...";
  try {
    const sheets = file.name.toLowerCase().endsWith(".xlsx")
      ? await parseXlsxFile(file)
      : [{ name: file.name, rows: parseCsv(await file.text()) }];
    applyImportedSheets({ fileName: file.name, sheets, source: "uploaded" });
  } catch (error) {
    console.error(error);
    dom.importStatus.textContent =
      error.message || "Nao consegui ler este arquivo. Tente salvar como CSV.";
  }
}

async function bootstrapDefaultWorkbook() {
  dom.importStatus.textContent = `Carregando carga base: ${DEFAULT_IMPORT_FILE}...`;
  try {
    const response = await fetch(DEFAULT_IMPORT_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`Nao consegui carregar ${DEFAULT_IMPORT_FILE}.`);
    const sheets = await parseXlsxBuffer(await response.arrayBuffer());
    applyImportedSheets({ fileName: DEFAULT_IMPORT_FILE, sheets, source: "default" });
    stateLoadedFromStorage = true;
  } catch (error) {
    console.warn(error);
    dom.importStatus.textContent =
      "Nao consegui carregar a carga base automaticamente. Use Importar arquivo para selecionar o Excel.";
  }
}

function applyImportedSheets({ fileName, sheets, source }) {
  const imported = [];
  const snapshots = [];
  let ignored = 0;

  for (const sheet of sheets) {
    const result = parseStatementRows(sheet.rows, sheet.name);
    imported.push(...result.transactions);
    snapshots.push(...result.snapshots);
    ignored += result.ignored;
  }

  state.imported = dedupeTransactions(imported);
  state.snapshots = snapshots;
  ensurePublicIds();
  const cashPosition = buildCashPosition(state.imported);
  const suggestedBalance = snapshots.length
    ? suggestBaseBalance(state.imported, snapshots)
    : cashPosition.realMovementNet;
  const suggestedDate = latestIso([
    ...state.imported.map((item) => item.date),
    ...snapshots.map((item) => item.date),
  ]);

  state.settings.baseBalance = suggestedBalance;
  state.settings.baseDate = suggestedDate || todayIso();
  state.importMeta = {
    fileName,
    importedAt: new Date().toISOString(),
    importedCount: state.imported.length,
    ignoredCount: ignored,
    sheetNames: sheets.map((sheet) => sheet.name),
    snapshotCount: snapshots.length,
    source,
  };

  syncControls();
  persistAndRender();
}

function parseStatementRows(rows, sheetName) {
  const conventional = parseConventionalRows(rows, sheetName);
  if (conventional.transactions.length >= 1) return conventional;
  return parseBlockRows(rows, sheetName);
}

function headerKey(value) {
  return normalize(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ç/g, "c");
}

function parseRowAmount(row, col) {
  const direct = col.amount >= 0 ? parseMoney(row[col.amount]) : null;
  if (direct !== null) {
    return {
      amount: direct,
      type: direct < 0 ? "debit" : "",
    };
  }

  const inflow = col.inflow >= 0 ? parseMoney(row[col.inflow]) : null;
  if (inflow !== null && inflow !== 0) {
    return { amount: Math.abs(inflow), type: "credit" };
  }

  const outflow = col.outflow >= 0 ? parseMoney(row[col.outflow]) : null;
  if (outflow !== null && outflow !== 0) {
    return { amount: Math.abs(outflow), type: "debit" };
  }

  return { amount: null, type: "" };
}

function parseConventionalRows(rows, sheetName) {
  const result = emptyImportResult();
  const headerIndex = rows.findIndex((row) => {
    const cells = row.map(headerKey);
    return (
      cells.some((cell) => /^(data|date)$/.test(cell)) &&
      cells.some((cell) => /valor|amount|vlr|entrada|saida|credito|debito/.test(cell)) &&
      cells.some((cell) => /descricao|transacao|historico|memo|detalhe|lancamento/.test(cell))
    );
  });

  if (headerIndex < 0) return result;

  const headers = rows[headerIndex].map(headerKey);
  const col = {
    date: headers.findIndex((cell) => /^(data|date)$/.test(cell)),
    description: headers.findIndex((cell) =>
      /^(descricao|transacao|historico|memo|detalhe|lancamento)$/.test(cell),
    ),
    amount: headers.findIndex((cell) => /valor|amount|vlr/.test(cell)),
    inflow: headers.findIndex((cell) => /entrada|receita|credito/.test(cell)),
    outflow: headers.findIndex((cell) => /saida|despesa|debito/.test(cell)),
    type: headers.findIndex((cell) => /tipo|c\/d|credito|debito|natureza|movimento/.test(cell)),
    account: headers.findIndex((cell) => /conta|banco|account/.test(cell)),
    category: headers.findIndex((cell) => /categoria|category|centro/.test(cell)),
    client: headers.findIndex((cell) => /cliente|fornecedor|pessoa|customer|supplier/.test(cell)),
    quoteNumber: headers.findIndex((cell) => /cotacao|orcamento|pedido|numero|num|no\b|n\b/.test(cell)),
    commitment: headers.findIndex((cell) => /compromisso|obrigacao|boleto|documento/.test(cell)),
    status: headers.findIndex((cell) => /status|situacao|etapa/.test(cell)),
    publicId: headers.findIndex((cell) => /^(id|codigo|cod|identificador)$/.test(cell)),
  };
  if (col.description < 0) {
    col.description = headers.findIndex((cell) =>
      /descricao|transacao|historico|memo|detalhe|lancamento/.test(cell) && !/^tipo\b/.test(cell),
    );
  }

  for (const row of rows.slice(headerIndex + 1)) {
    const date = parseDate(row[col.date]);
    const amountInfo = parseRowAmount(row, col);
    const amount = amountInfo.amount;
    const description = normalize(row[col.description]);
    let type = parseMovementType(row[col.type]) || amountInfo.type || inferType(description, amount);
    type = classifyEntryType(type, description, amount);
    if (!date || amount === null || !description || !type) {
      result.ignored += rowHasContent(row) ? 1 : 0;
      continue;
    }
    if (isBalanceDescription(description)) {
      result.snapshots.push({
        date,
        account: normalize(row[col.account]) || sheetName || "Conta",
        description,
        balance: signedAmount(amount, type),
      });
      continue;
    }
    result.transactions.push({
      id: makeId(date, normalize(row[col.account]) || sheetName, description, amount, type),
      publicId: normalize(row[col.publicId]),
      date,
      description,
      amount: Math.abs(amount),
      type,
      account: normalize(row[col.account]) || sheetName || "Conta",
      category: normalize(row[col.category]),
      client: normalize(row[col.client]),
      quoteNumber: normalize(row[col.quoteNumber]),
      commitment: normalize(row[col.commitment]),
      status: normalize(row[col.status]) || inferStatus(type, date),
      source: "imported",
    });
  }

  return result;
}

function parseBlockRows(rows, sheetName) {
  const result = emptyImportResult();
  const maxColumns = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const candidates = [];

  for (let start = 0; start <= maxColumns - 3; start += 1) {
    let score = 0;
    let markers = 0;
    let dated = 0;
    for (const row of rows) {
      const description = normalize(row[start + 1]);
      const amount = parseMoney(row[start + 2]);
      const type = parseMovementType(row[start + 3]);
      const date = parseDate(row[start]);
      if (description && amount !== null && (type || date)) {
        score += 1;
        if (type) markers += 1;
        if (date) dated += 1;
      }
    }
    if (score >= 3 && markers >= 2) {
      candidates.push({ start, score, markers, dated });
    }
  }

  const starts = pickIndependentStarts(candidates);
  if (!starts.length) return result;

  for (const start of starts) {
    const account = detectAccountName(rows, start) || sheetName || `Conta ${start + 1}`;
    let currentDate = null;

    for (const row of rows) {
      const parsedDate = parseDate(row[start]);
      if (parsedDate) currentDate = parsedDate;

      const description = normalize(row[start + 1]);
      const amount = parseMoney(row[start + 2]);
      let type = parseMovementType(row[start + 3]) || inferType(description, amount);
      type = classifyEntryType(type, description, amount);

      if (!description && amount === null) continue;
      if (!currentDate || amount === null || !description || !type) {
        result.ignored += rowHasContent(row) ? 1 : 0;
        continue;
      }

      if (isBalanceDescription(description)) {
        result.snapshots.push({
          date: currentDate,
          account,
          description,
          balance: signedAmount(amount, type),
        });
        continue;
      }

      result.transactions.push({
        id: makeId(currentDate, description, amount, type, account),
        date: currentDate,
        description,
        amount: Math.abs(amount),
        type,
        account,
        category: "",
        client: "",
        quoteNumber: "",
        commitment: "",
        status: inferStatus(type, currentDate),
        source: "imported",
      });
    }
  }

  return result;
}

function pickIndependentStarts(candidates) {
  const sorted = [...candidates].sort((a, b) => b.score - a.score || a.start - b.start);
  const picked = [];
  for (const candidate of sorted) {
    if (picked.every((item) => Math.abs(item.start - candidate.start) > 3)) {
      picked.push(candidate);
    }
  }
  return picked.sort((a, b) => a.start - b.start).map((item) => item.start);
}

function detectAccountName(rows, start) {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 8); rowIndex += 1) {
    const value = normalize(rows[rowIndex][start]);
    if (
      value &&
      value.length <= 42 &&
      !parseDate(value) &&
      parseMoney(value) === null &&
      !parseMovementType(value)
    ) {
      return value;
    }
  }
  return "";
}

function emptyImportResult() {
  return {
    transactions: [],
    snapshots: [],
    ignored: 0,
  };
}

function render() {
  const forecast = buildForecast();
  renderImportStatus();
  renderBackupMeta();
  renderMetrics(forecast);
  renderHealth(forecast);
  renderAnnualChart();
  renderBankBalances();
  renderForecastTable(forecast.rows);
  renderForecastChart(forecast.rows);
  renderFutures();
  renderImported();
  renderDrillDown();
}

function renderImportStatus() {
  if (!state.importMeta) {
    dom.importStatus.textContent = "Nenhum arquivo carregado.";
    return;
  }

  const meta = state.importMeta;
  const ignored = meta.ignoredCount ? `, ${meta.ignoredCount} linhas ignoradas` : "";
  const snapshots = meta.snapshotCount ? `, ${meta.snapshotCount} saldos lidos` : "";
  const sourceLabels = {
    default: " (carga base da aplicacao)",
    uploaded: " (arquivo importado)",
    backup: " (backup restaurado)",
  };
  const sourceLabel = sourceLabels[meta.source] || "";
  dom.importStatus.textContent = `${meta.fileName}${sourceLabel}: ${meta.importedCount} lancamentos${snapshots}${ignored}.`;
}

function renderBackupMeta() {
  const currentSourceLabels = {
    default: "carga base da aplicacao",
    uploaded: "arquivo importado",
    backup: "backup restaurado",
  };
  const source = state.importMeta?.source || (state.imported.length || state.futures.length || state.snapshots.length ? "local" : "vazio");
  const sourceLabel = currentSourceLabels[source] || "dados locais";
  const currentCounts = `${state.imported.length} importados, ${state.futures.length} manuais, ${state.snapshots.length} saldos`;
  const backupParts = [`Origem: ${sourceLabel}.`, `Contagem atual: ${currentCounts}.`];

  if (state.backupMeta?.lastExportedAt) {
    const lastExportFile = state.backupMeta.lastExportFile ? ` ${state.backupMeta.lastExportFile}` : "";
    backupParts.push(`Ultimo backup exportado em ${formatDateTime(state.backupMeta.lastExportedAt)}${lastExportFile}.`);
  }

  if (state.backupMeta?.lastImportedAt) {
    const lastImportFile = state.backupMeta.lastImportedFile ? ` ${state.backupMeta.lastImportedFile}` : "";
    backupParts.push(`Backup restaurado em ${formatDateTime(state.backupMeta.lastImportedAt)}${lastImportFile}.`);
  }

  dom.backupMeta.textContent = backupParts.join(" ");
}

function refreshImportMetaCount() {
  if (!state.importMeta) return;
  state.importMeta.importedCount = state.imported.length;
  state.importMeta.editedAt = new Date().toISOString();
}

function renderMetrics(forecast) {
  const cash = forecast.cashPosition;
  dom.metricBase.textContent = brl.format(cash.currentCash);
  dom.metricBase.className = cash.currentCash < 0 ? "negative" : "positive";
  dom.metric30.textContent = brl.format(cash.receivable);
  dom.metric30.className = cash.receivable < 0 ? "negative" : "positive";
  dom.metricLow.textContent = brl.format(cash.payable);
  dom.metricLow.className = cash.payable > 0 ? "negative" : "positive";
  dom.metricProbable.textContent = brl.format(cash.probableCash);
  dom.metricProbable.className = cash.probableCash < 0 ? "negative" : "positive";
  const investmentValue = Math.abs(cash.investmentWithdrawal);
  dom.metricInvestment.textContent = brl.format(investmentValue);
  dom.metricInvestment.className = investmentValue > 0 ? "negative" : "positive";
  dom.metricRunway.textContent = brl.format(cash.cashAfterInvestmentWithdrawal);
  dom.metricRunway.className = cash.cashAfterInvestmentWithdrawal < 0 ? "negative" : "positive";
}

function renderHealth(forecast) {
  const cash = forecast.cashPosition;
  const level =
    cash.cashAfterInvestmentWithdrawal < 0 || cash.probableCash < 0
      ? "critical"
      : cash.payable > cash.receivable
        ? "attention"
        : "healthy";
  const label = level === "critical" ? "Atencao" : level === "attention" ? "Monitorar" : "Saudavel";
  dom.healthStatus.textContent = label;
  dom.healthStatus.className = `health-status ${level}`;
  dom.healthText.textContent =
    `Hoje o caixa base esta em ${brl.format(cash.currentCash)}. ` +
    `Com ${brl.format(cash.receivable)} a receber e ${brl.format(cash.payable)} a pagar, ` +
    `o caixa provavel fica ${brl.format(cash.probableCash)}. ` +
    `Depois da retirada do investimento em Jan/2027, sobra ${brl.format(cash.cashAfterInvestmentWithdrawal)}.`;
}

function renderAnnualChart() {
  dom.annualSubtitle.textContent =
    "Caixa real + a receber - a pagar - investimento = sobra. Use os botoes dos cards acima para abrir os detalhes.";
  dom.bridgeLegend.innerHTML = "";
  dom.annualChart.innerHTML = "";
}

function renderBankBalances() {
  const rows = buildBankBalances();
  const total = rows.reduce((sum, item) => sum + item.balance, 0);
  const hasSnapshot = rows.some((item) => item.method === "saldo_lido");
  const hasOnlyMovements = rows.some((item) => item.method === "movimentacoes");
  dom.bankBalanceHint.textContent = hasSnapshot
    ? "Usei os saldos lidos no arquivo quando encontrei saldo por banco."
    : hasOnlyMovements
      ? "Nao encontrei saldo separado por banco; estou mostrando as movimentacoes realizadas por origem."
      : "Ainda nao encontrei saldo por banco. Ao importar arquivos com Conta/Origem, esta visao fica automatica.";
  dom.bankBalanceCards.innerHTML = "";

  for (const item of rows) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `bank-card ${item.balance < 0 ? "negative-bank" : ""}`;
    card.dataset.bankSearch = item.search;
    card.innerHTML = `
      <span>${escapeHtml(item.label)}</span>
      <strong class="${item.balance < 0 ? "negative" : "positive"}">${brl.format(item.balance)}</strong>
      <small>${escapeHtml(bankMethodLabel(item.method))}</small>
    `;
    dom.bankBalanceCards.append(card);
  }

  const totalCard = document.createElement("div");
  totalCard.className = `bank-card total-bank ${total < 0 ? "negative-bank" : ""}`;
  totalCard.innerHTML = `
    <span>Total visivel</span>
    <strong class="${total < 0 ? "negative" : "positive"}">${brl.format(total)}</strong>
    <small>Soma dos bancos acima</small>
  `;
  dom.bankBalanceCards.append(totalCard);
}

function buildBankBalances() {
  const latestSnapshots = latestSnapshotsByBank();
  const realizedByBank = new Map(trackedBanks.map((bank) => [bank.key, 0]));
  const entriesByBank = new Map(trackedBanks.map((bank) => [bank.key, 0]));
  const baseDate = state.settings.baseDate || todayIso();

  for (const entry of allEntries()) {
    const bank = bankForAccount(entry.account || entry.client || entry.description);
    if (!bank) continue;
    entriesByBank.set(bank.key, (entriesByBank.get(bank.key) || 0) + 1);
    if (isRealized(entry, baseDate)) {
      realizedByBank.set(bank.key, (realizedByBank.get(bank.key) || 0) + signedEntry(entry));
    }
  }

  const activeBanksWithoutSnapshot = trackedBanks.filter(
    (bank) => !latestSnapshots.has(bank.key) && entriesByBank.get(bank.key),
  );
  const canAllocateBaseToOnlyBank =
    !latestSnapshots.size && activeBanksWithoutSnapshot.length === 1 && Number(state.settings.baseBalance || 0) !== 0;

  return trackedBanks.map((bank) => {
    const snapshot = latestSnapshots.get(bank.key);
    if (snapshot) {
      return {
        ...bank,
        balance: snapshot.balance,
        method: "saldo_lido",
      };
    }
    if (canAllocateBaseToOnlyBank && activeBanksWithoutSnapshot[0].key === bank.key) {
      return {
        ...bank,
        balance: Number(state.settings.baseBalance || 0),
        method: "saldo_base",
      };
    }
    return {
      ...bank,
      balance: realizedByBank.get(bank.key) || 0,
      method: entriesByBank.get(bank.key) ? "movimentacoes" : "sem_dados",
    };
  });
}

function latestSnapshotsByBank() {
  const latest = new Map();
  for (const snapshot of state.snapshots || []) {
    const bank = bankForAccount(snapshot.account || snapshot.description);
    if (!bank) continue;
    const current = latest.get(bank.key);
    if (!current || snapshot.date >= current.date) latest.set(bank.key, snapshot);
  }
  return latest;
}

function bankForAccount(value) {
  const text = headerKey(value);
  if (!text) return null;
  return trackedBanks.find((bank) => bank.patterns.some((pattern) => pattern.test(text))) || null;
}

function bankMethodLabel(method) {
  const labels = {
    saldo_lido: "Saldo lido no arquivo",
    saldo_base: "Saldo base atribuido a esta origem",
    movimentacoes: "Movimentacoes realizadas",
    sem_dados: "Sem dados nesta origem",
  };
  return labels[method] || "Conferir origem";
}

function renderAnnualChartOld() {
  const baseDate = state.settings.baseDate || todayIso();
  const year = Number(baseDate.slice(0, 4));
  const months = Array.from({ length: 12 }, (_, index) => {
    const key = `${year}-${pad(index + 1)}`;
    return {
      key,
      label: monthOnlyFormat.format(new Date(year, index, 1)).replace(".", ""),
      actual: 0,
      projected: 0,
      actualInflow: 0,
      actualOutflow: 0,
      projectedInflow: 0,
      projectedOutflow: 0,
    };
  });
  const byKey = new Map(months.map((month) => [month.key, month]));

  for (const item of allEntries()) {
    if (isCanceled(item)) continue;
    if (item.type === "investment_outflow") continue;
    const key = item.date.slice(0, 7);
    const month = byKey.get(key);
    if (!month) continue;
    const signed = signedEntry(item);
    const target = isRealized(item, baseDate) ? "actual" : "projected";
    month[target] += signed;
    if (signed >= 0) month[`${target}Inflow`] += signed;
    else month[`${target}Outflow`] += Math.abs(signed);
  }

  const withdrawalKey = INVESTMENT_WITHDRAWAL_DATE.slice(0, 7);
  const withdrawalMonth = byKey.get(withdrawalKey);
  const cash = buildCashPosition([...state.imported, ...state.futures]);
  if (withdrawalMonth && cash.investmentWithdrawal < 0) {
    withdrawalMonth.projected += cash.investmentWithdrawal;
    withdrawalMonth.projectedOutflow += Math.abs(cash.investmentWithdrawal);
  }

  const totals = months.reduce(
    (sum, month) => ({
      actualInflow: sum.actualInflow + month.actualInflow,
      actualOutflow: sum.actualOutflow + month.actualOutflow,
      projectedInflow: sum.projectedInflow + month.projectedInflow,
      projectedOutflow: sum.projectedOutflow + month.projectedOutflow,
      actualNet: sum.actualNet + month.actual,
      projectedNet: sum.projectedNet + month.projected,
    }),
    {
      actualInflow: 0,
      actualOutflow: 0,
      projectedInflow: 0,
      projectedOutflow: 0,
      actualNet: 0,
      projectedNet: 0,
    },
  );
  const max = Math.max(
    1,
    ...months.flatMap((month) => [Math.abs(month.actual), Math.abs(month.projected), Math.abs(month.actual + month.projected)]),
  );

  dom.annualSubtitle.textContent = `Ano calendario ${year}. Cada mes mostra o que ja aconteceu e o que ainda esta planejado.`;
  dom.annualChart.innerHTML = "";
  const summary = document.createElement("div");
  summary.className = "annual-summary-cards";
  summary.innerHTML = `
    <div class="annual-summary-card inflow-card">
      <span>Entrada (R$)</span>
      <strong>${brl.format(totals.actualInflow)}</strong>
      <small>Entrada prevista: ${brl.format(totals.projectedInflow)}</small>
    </div>
    <div class="annual-summary-card outflow-card">
      <span>Saida (R$)</span>
      <strong>${brl.format(totals.actualOutflow)}</strong>
      <small>Saida prevista: ${brl.format(totals.projectedOutflow)}</small>
    </div>
    <div class="annual-summary-card balance-card">
      <span>Saldo (R$)</span>
      <strong>${brl.format(totals.actualNet)}</strong>
      <small>Saldo previsto: ${brl.format(totals.actualNet + totals.projectedNet)}</small>
    </div>
  `;
  dom.annualChart.append(summary);
  const columns = document.createElement("div");
  columns.className = "annual-column-chart";
  for (const month of months) {
    const actualHeight = Math.max(4, Math.round((Math.abs(month.actual) / max) * 100));
    const projectedHeight = Math.max(4, Math.round((Math.abs(month.projected) / max) * 100));
    const net = month.actual + month.projected;
    const row = document.createElement("div");
    row.className = "annual-column";
    row.innerHTML = `
      <div class="annual-column-values">
        <span class="${month.actual < 0 ? "negative" : "positive"}">${compactMoney(month.actual)}</span>
        <span class="${month.projected < 0 ? "negative" : "positive"}">${compactMoney(month.projected)}</span>
      </div>
      <div class="annual-column-bars">
        <span class="annual-vbar actual ${month.actual < 0 ? "negative-bg" : ""}" style="height:${actualHeight}%"></span>
        <span class="annual-vbar projected ${month.projected < 0 ? "negative-bg" : ""}" style="height:${projectedHeight}%"></span>
      </div>
      <strong class="annual-month">${month.label}</strong>
      <small class="annual-net ${net < 0 ? "negative" : "positive"}">${compactMoney(net)}</small>
    `;
    columns.append(row);
  }
  dom.annualChart.append(columns);
}

function renderForecastTable(rows) {
  dom.forecastRows.innerHTML = "";
  if (!rows.length) {
    dom.forecastRows.append(emptyRow("Sem meses no horizonte.", 4));
    return;
  }

  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.label}</td>
      <td class="amount positive">${brl.format(row.inflow)}</td>
      <td class="amount negative">${brl.format(row.outflow)}</td>
      <td class="amount ${row.balance < 0 ? "negative" : "positive"}">${brl.format(row.balance)}</td>
    `;
    dom.forecastRows.append(tr);
  }
}

function renderForecastChart(rows) {
  dom.forecastChart.innerHTML = "";
  if (!rows.length) {
    dom.forecastChart.textContent = "Sem dados.";
    return;
  }

  const max = Math.max(...rows.map((row) => Math.abs(row.balance)), 1);
  for (const row of rows) {
    const width = Math.max(4, Math.round((Math.abs(row.balance) / max) * 100));
    const item = document.createElement("div");
    item.className = "bar-row";
    item.innerHTML = `
      <span class="bar-label">${row.label}</span>
      <span class="bar-track">
        <span class="bar-fill ${row.balance < 0 ? "negative" : ""}" style="width: ${width}%"></span>
      </span>
      <span class="bar-value ${row.balance < 0 ? "negative" : "positive"}">${brl.format(row.balance)}</span>
    `;
    dom.forecastChart.append(item);
  }
}

function renderFutures() {
  dom.futureRows.innerHTML = "";
  const baseDate = state.settings.baseDate || todayIso();
  const rows = state.futures
    .map(normalizeEntry)
    .sort((a, b) => displayDate(a).localeCompare(displayDate(b)));
  if (!rows.length) {
    dom.futureRows.append(emptyRow("Nenhum lancamento manual.", 9));
    return;
  }

  for (const item of rows) {
    const sign = signedEntry(item);
    const timing =
      item.type === "investment_outflow"
        ? "Retira Jan/27"
        : item.date < baseDate
          ? "Ajusta saldo"
          : "Forecast";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td data-label="ID" class="id-cell">${escapeHtml(entryPublicId(item))}</td>
      <td data-label="Data">${formatDate(displayDate(item))}</td>
      <td data-label="Grupo" class="type ${sign >= 0 ? "positive" : "negative"}">${entryGroupLabel(item)}</td>
      <td data-label="Descricao" class="description-cell">${entryDescriptionHtml(item)}</td>
      <td data-label="Pessoa/Empresa">${escapeHtml(personLabel(item))}</td>
      <td data-label="Conta/Origem">${escapeHtml(originLabel(item))}</td>
      <td data-label="Valor" class="amount ${sign >= 0 ? "positive" : "negative"}">${brl.format(item.amount)}</td>
      <td data-label="Status"><span class="status-pill">${escapeHtml(item.status || timing)}</span></td>
      <td data-label="Opcoes">${rowActionMenu("entry", item.id, "manual", item)}</td>
    `;
    dom.futureRows.append(tr);
  }
}

function renderImported() {
  dom.importedRows.innerHTML = "";
  const rows = state.imported
    .map(normalizeEntry)
    .sort((a, b) => displayDate(b).localeCompare(displayDate(a)));
  if (!rows.length) {
    dom.importedRows.append(emptyRow("Nenhum extrato importado.", 9));
    return;
  }

  for (const item of rows) {
    const sign = signedEntry(item);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td data-label="ID" class="id-cell">${escapeHtml(entryPublicId(item))}</td>
      <td data-label="Data">${formatDate(displayDate(item))}</td>
      <td data-label="Grupo" class="type ${sign >= 0 ? "positive" : "negative"}">${entryGroupLabel(item)}</td>
      <td data-label="Descricao" class="description-cell">${entryDescriptionHtml(item)}</td>
      <td data-label="Pessoa/Empresa">${escapeHtml(personLabel(item))}</td>
      <td data-label="Conta/Origem">${escapeHtml(originLabel(item))}</td>
      <td data-label="Valor" class="amount ${sign >= 0 ? "positive" : "negative"}">${brl.format(item.amount)}</td>
      <td data-label="Status"><span class="status-pill">${escapeHtml(entryStatus(item))}</span></td>
      <td data-label="Opcoes">${rowActionMenu("imported", item.id, "imported", item)}</td>
    `;
    dom.importedRows.append(tr);
  }
}

function personLabel(item) {
  if (item.client) return item.client;
  if (["credit", "provision_credit", "investment", "loan"].includes(item.type)) return item.account || "Cliente";
  return item.account || "Fornecedor";
}

function commitmentLabel(item) {
  return item.commitment || item.category || item.description || "-";
}

function originLabel(item) {
  return item.account || item.sourceLabel || (item.source === "manual" ? "Manual" : "Arquivo");
}

function entryGroupLabel(item) {
  if (drillTypeMatches(item, "receivable")) return "A receber";
  if (drillTypeMatches(item, "payable")) return "A pagar";
  if (["investment", "investment_outflow"].includes(item.type)) return "Investimento";
  return "Realizado";
}

function entryDescriptionHtml(item) {
  const details = [
    item.description || "-",
    item.commitment ? `Compromisso: ${item.commitment}` : "",
    item.quoteNumber ? `Cotacao/pedido: ${item.quoteNumber}` : "",
    item.category ? `Categoria: ${item.category}` : "",
  ].filter(Boolean);
  const [main, ...extra] = details;
  return `
    <strong>${escapeHtml(main)}</strong>
    ${extra.length ? `<small>${escapeHtml(extra.join(" | "))}</small>` : ""}
  `;
}

function displayDate(item) {
  return item.type === "investment_outflow" ? INVESTMENT_WITHDRAWAL_DATE : item.date;
}

function rowActionMenu(kind, id, collection = "", item = null) {
  const editAttr =
    kind === "entry"
      ? `data-edit-entry="${id}"`
      : kind === "imported"
        ? `data-edit-imported="${id}"`
        : `data-drill-edit="${id}" data-drill-collection="${collection}"`;
  const deleteAttr =
    kind === "entry"
      ? `data-delete-future="${id}"`
      : kind === "imported"
        ? `data-delete-imported="${id}"`
        : `data-drill-delete="${id}" data-drill-collection="${collection}"`;
  const realizeAttr =
    kind === "entry"
      ? `data-realize-entry="${id}"`
      : kind === "imported"
        ? `data-realize-imported="${id}"`
        : `data-drill-realize="${id}" data-drill-collection="${collection}"`;
  const canRealize = item && canMarkRealized(item);
  return `
    <details class="action-menu">
      <summary>Opcoes</summary>
      <div class="action-menu-list">
        ${canRealize ? `<button type="button" ${realizeAttr}>Marcar realizado</button>` : ""}
        <button type="button" ${editAttr}>Editar</button>
        <button type="button" class="danger-menu-button" ${deleteAttr}>Excluir</button>
      </div>
    </details>
  `;
}

function setActiveDrill(type, scrollToPanel = false) {
  activeDrillType = type || "all";
  renderDrillDown();
  if (scrollToPanel) {
    document.querySelector(".drill-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function renderDrillDown() {
  const rows = filteredDrillEntries();
  const total = rows.reduce((sum, item) => sum + signedEntry(item), 0);
  const label = drillLabels[activeDrillType] || drillLabels.all;

  for (const tab of dom.drillTabs) {
    tab.classList.toggle("active", tab.dataset.drillType === activeDrillType);
  }

  dom.drillSubtitle.textContent = `${label}. Entradas somam positivo; saidas somam negativo.`;
  dom.drillTotal.textContent = `${rows.length} transacoes - saldo ${brl.format(total)}`;
  dom.drillTotal.className = `drill-total ${total < 0 ? "negative" : "positive"}`;
  dom.drillRows.innerHTML = "";

  if (!rows.length) {
    dom.drillRows.append(emptyRow("Nenhum lancamento encontrado com estes filtros.", 9));
    return;
  }

  for (const item of rows) {
    const sign = signedEntry(item);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td data-label="ID" class="id-cell">${escapeHtml(entryPublicId(item))}</td>
      <td data-label="Data">${formatDate(displayDate(item))}</td>
      <td data-label="Grupo" class="type ${sign >= 0 ? "positive" : "negative"}">${entryGroupLabel(item)}</td>
      <td data-label="Descricao" class="description-cell">${entryDescriptionHtml(item)}</td>
      <td data-label="Pessoa/Empresa">${escapeHtml(personLabel(item))}</td>
      <td data-label="Conta/Origem">${escapeHtml(originLabel(item))}</td>
      <td data-label="Valor" class="amount ${sign >= 0 ? "positive" : "negative"}">${brl.format(item.amount)}</td>
      <td data-label="Status"><span class="status-pill">${escapeHtml(entryStatus(item))}</span></td>
      <td data-label="Opcoes">${rowActionMenu("drill", item.id, item.source, item)}</td>
    `;
    dom.drillRows.append(tr);
  }
}

function filteredDrillEntries() {
  const search = headerKey(dom.drillSearch.value || "");
  const min = Number(dom.drillMin.value || 0);
  const max = Number(dom.drillMax.value || 0);
  const source = dom.drillSource.value || "all";

  return allEntries()
    .filter((item) => drillTypeMatches(item, activeDrillType))
    .filter((item) => source === "all" || item.source === source)
    .filter((item) => !min || item.amount >= min)
    .filter((item) => !max || item.amount <= max)
    .filter((item) => {
      if (!search) return true;
      return headerKey(
        `${entryPublicId(item)} ${item.date} ${item.account || ""} ${item.client || ""} ${item.quoteNumber || ""} ` +
          `${item.commitment || ""} ${item.status || ""} ${item.description || ""} ${item.category || ""}`,
      ).includes(search);
    })
    .sort((a, b) => displayDate(b).localeCompare(displayDate(a)) || Math.abs(signedEntry(b)) - Math.abs(signedEntry(a)));
}

function allEntries() {
  return [
    ...state.futures.map((entry) => ({ ...normalizeEntry(entry), source: "manual" })),
    ...state.imported.map((entry) => ({ ...normalizeEntry(entry), source: "imported" })),
  ];
}

function drillTypeMatches(entry, type) {
  const baseDate = state.settings.baseDate || todayIso();
  if (type === "all") return true;
  if (type === "real") return ["credit", "debit", "investment", "loan"].includes(entry.type) && isRealized(entry, baseDate);
  if (type === "receivable" || type === "provision_credit") {
    if (entry.type === "provision_credit") return true;
    return ["credit", "loan", "investment"].includes(entry.type) && !isRealized(entry, baseDate);
  }
  if (type === "payable" || type === "provision_debit") {
    if (["provision_debit", "loan_payment"].includes(entry.type)) return true;
    return entry.type === "debit" && !isRealized(entry, baseDate);
  }
  if (type === "investment" || type === "investment_outflow") return ["investment", "investment_outflow"].includes(entry.type);
  return entry.type === type;
}

function canMarkRealized(item) {
  if (isCanceled(item)) return false;
  if (item.type === "investment_outflow") return false;
  return !isRealized(item, state.settings.baseDate || todayIso());
}

function entryStatus(item) {
  if (item.status) return item.status;
  if (isRealized(item, state.settings.baseDate || todayIso())) return "Realizado";
  if (item.date < todayIso() && ["provision_credit", "provision_debit", "loan_payment"].includes(item.type)) {
    return "Atrasado";
  }
  return "Previsto";
}

function isCanceled(item) {
  return headerKey(item.status || "") === "cancelado";
}

function isRealized(item, baseDate) {
  const status = headerKey(item.status || "");
  if (status === "realizado") return true;
  if (status === "cancelado") return false;
  if (["previsto", "confirmado", "atrasado"].includes(status)) return false;
  return ["credit", "debit"].includes(item.type) && item.date <= baseDate;
}

function buildForecast() {
  const baseDate = state.settings.baseDate || todayIso();
  const horizon = Number(state.settings.horizonMonths || 6);
  const manualEntries = state.futures.map(normalizeEntry);
  const cashPosition = buildCashPosition(allEntries());
  const importedForecastEntries = state.imported
    .map(normalizeEntry)
    .filter((item) => item.date > baseDate);
  const baseAdjustment = cashPosition.manualPastAdjustment;
  const adjustedBase = cashPosition.currentCash;
  const rows = monthKeys(baseDate, horizon).map((key) => ({
    key,
    label: formatMonthKey(key),
    inflow: 0,
    outflow: 0,
    balance: adjustedBase,
  }));

  const rowByKey = new Map(rows.map((row) => [row.key, row]));
  const forecastEntries = [
    ...manualEntries.filter((item) => item.date >= baseDate),
    ...importedForecastEntries,
  ].filter((item) => item.type !== "investment_outflow" && !isRealized(item, baseDate));

  for (const item of forecastEntries) {
    const key = item.date.slice(0, 7);
    const row = rowByKey.get(key);
    if (!row) continue;
    const signed = signedEntry(item);
    if (signed >= 0) row.inflow += signed;
    else row.outflow += Math.abs(signed);
  }

  const investmentWithdrawalKey = INVESTMENT_WITHDRAWAL_DATE.slice(0, 7);
  const investmentWithdrawalRow = rowByKey.get(investmentWithdrawalKey);
  if (investmentWithdrawalRow && cashPosition.investmentWithdrawal < 0) {
    investmentWithdrawalRow.outflow += Math.abs(cashPosition.investmentWithdrawal);
  }

  let running = adjustedBase;
  for (const row of rows) {
    running += row.inflow - row.outflow;
    row.balance = running;
  }

  const thirtyDays = addDays(baseDate, 30);
  const net30 = forecastEntries
    .filter((item) => item.date <= thirtyDays)
    .reduce((sum, item) => sum + signedEntry(item), 0);

  const balances = [adjustedBase, ...rows.map((row) => row.balance)];
  const lowestBalance = Math.min(...balances);
  const firstNegative = rows.find((row) => row.balance < 0);
  const firstThreeRows = rows.slice(0, 3);
  const threeMonthInflow = firstThreeRows.reduce((sum, row) => sum + row.inflow, 0);
  const threeMonthOutflow = firstThreeRows.reduce((sum, row) => sum + row.outflow, 0);
  const threeMonthNet = threeMonthInflow - threeMonthOutflow;
  const threeMonthBalance = firstThreeRows.at(-1)?.balance ?? adjustedBase;
  const health = buildHealthSummary({
    adjustedBase,
    threeMonthBalance,
    threeMonthNet,
    lowestBalance: Math.min(adjustedBase, ...firstThreeRows.map((row) => row.balance)),
  });

  return {
    rows,
    net30,
    lowestBalance,
    adjustedBase,
    baseAdjustment,
    threeMonthInflow,
    threeMonthOutflow,
    threeMonthNet,
    threeMonthBalance,
    cashPosition,
    health,
    runway: firstNegative ? firstNegative.label : `${horizon}+ meses`,
  };
}

function syncControls() {
  dom.baseBalance.value = Number(state.settings.baseBalance || 0).toFixed(2);
  dom.baseDate.value = state.settings.baseDate || todayIso();
  dom.horizon.value = String(state.settings.horizonMonths || 6);
}

function buildHealthSummary({ adjustedBase, threeMonthBalance, threeMonthNet, lowestBalance }) {
  if (lowestBalance < 0) {
    return {
      level: "critical",
      label: "Critico",
      text:
        "O caixa fica negativo em algum momento dos proximos 3 meses. Priorize recebimentos, renegocie saidas ou revise aportes.",
    };
  }

  if (threeMonthNet < 0) {
    return {
      level: "attention",
      label: "Atencao",
      text:
        "O caixa continua positivo, mas o trimestre consome dinheiro. Vale revisar despesas e confirmar receitas previstas.",
    };
  }

  if (adjustedBase <= 0) {
    return {
      level: "attention",
      label: "Atencao",
      text:
        "O trimestre melhora, mas o ponto de partida ainda esta apertado. Confira saldo base e entradas de curto prazo.",
    };
  }

  return {
    level: "healthy",
    label: "Saudavel",
    text:
      threeMonthBalance > adjustedBase
        ? "O caixa cresce nos proximos 3 meses e nao entra no negativo."
        : "O caixa se mantem positivo nos proximos 3 meses.",
  };
}

function buildCashPosition(entries) {
  const normalized = entries.map(normalizeEntry);
  const baseDate = state.settings.baseDate || todayIso();
  const statementBalance = Number(state.settings.baseBalance || 0);
  const totals = {
    realMovementNet: 0,
    manualPastAdjustment: 0,
    provisionCredit: 0,
    provisionDebit: 0,
    investmentNet: 0,
    investmentWithdrawal: 0,
    loanInflow: 0,
    loanPayment: 0,
    otherForecastNet: 0,
    receivable: 0,
    payable: 0,
  };

  for (const entry of normalized) {
    if (isCanceled(entry)) continue;
    const signed = signedEntry(entry);
    const realized = isRealized(entry, baseDate);
    const source = entry.source || "";

    if (["credit", "debit"].includes(entry.type) && realized) {
      totals.realMovementNet += signed;
      if (source === "manual" && entry.date <= baseDate) totals.manualPastAdjustment += signed;
    } else if (entry.type === "credit") {
      totals.receivable += Math.abs(signed);
    } else if (entry.type === "debit") {
      totals.payable += Math.abs(signed);
    } else if (entry.type === "provision_credit") {
      totals.provisionCredit += signed;
      totals.receivable += Math.abs(signed);
    } else if (entry.type === "provision_debit") {
      totals.provisionDebit += signed;
      totals.payable += Math.abs(signed);
    } else if (entry.type === "investment") {
      totals.investmentNet += signed;
      if (realized) {
        totals.realMovementNet += signed;
        if (source === "manual" && entry.date <= baseDate) totals.manualPastAdjustment += signed;
      } else {
        totals.receivable += Math.abs(signed);
      }
    } else if (entry.type === "investment_outflow") {
      totals.investmentWithdrawal -= entry.amount;
    } else if (entry.type === "loan") {
      totals.loanInflow += signed;
      if (realized) {
        totals.realMovementNet += signed;
        if (source === "manual" && entry.date <= baseDate) totals.manualPastAdjustment += signed;
      } else {
        totals.receivable += Math.abs(signed);
      }
    } else if (entry.type === "loan_payment") {
      totals.loanPayment += signed;
      totals.payable += Math.abs(signed);
    } else {
      totals.otherForecastNet += signed;
      if (signed >= 0) totals.receivable += signed;
      else totals.payable += Math.abs(signed);
    }
  }

  const currentCash =
    statementBalance !== 0
      ? statementBalance + totals.manualPastAdjustment
      : totals.realMovementNet;
  const probableCash = currentCash + totals.receivable - totals.payable;
  const cashWithAllProvisions = probableCash;
  const cashAfterInvestmentWithdrawal = cashWithAllProvisions + totals.investmentWithdrawal;

  return {
    ...totals,
    statementBalance,
    currentCash,
    probableCash,
    cashWithAllProvisions,
    cashAfterInvestmentWithdrawal,
  };
}

function syncStateFromControls() {
  state.settings.baseBalance = Number(dom.baseBalance.value || 0);
  state.settings.baseDate = dom.baseDate.value || todayIso();
  state.settings.horizonMonths = Number(dom.horizon.value || 6);
}

function startEditing(id, collection = "manual") {
  const source = collection === "imported" ? state.imported : state.futures;
  const stored = source.find((entry) => entry.id === id);
  if (!stored) return;
  const item = normalizeEntry(stored);

  editingEntry = { id, collection };
  dom.futureForm.elements.date.value = item.date;
  dom.futureForm.elements.type.value = item.type;
  dom.futureForm.elements.description.value = item.description;
  dom.futureForm.elements.amount.value = Number(item.amount || 0).toFixed(2).replace(".", ",");
  dom.futureForm.elements.account.value = item.account || "";
  dom.futureForm.elements.category.value = item.category || "";
  dom.futureForm.elements.client.value = item.client || "";
  dom.futureForm.elements.quoteNumber.value = item.quoteNumber || "";
  dom.futureForm.elements.commitment.value = item.commitment || "";
  dom.futureForm.elements.status.value = entryStatus(item);
  dom.submitEntry.textContent = "Salvar";
  dom.cancelEdit.classList.remove("hidden");
  dom.entryFormHint.textContent =
    collection === "imported"
      ? "Editando lancamento importado do arquivo."
      : "Editando lancamento manual.";
  dom.futureForm.scrollIntoView({ behavior: "smooth", block: "center" });
}

function stopEditing() {
  editingEntry = null;
  dom.submitEntry.textContent = "Adicionar";
  dom.cancelEdit.classList.add("hidden");
  dom.entryFormHint.textContent = "Registre receitas, despesas e capital.";
}

function deleteEntry(id, collection) {
  if (editingEntry?.id === id) stopEditing();
  if (collection === "imported") {
    state.imported = state.imported.filter((item) => item.id !== id);
    refreshImportMetaCount();
  } else {
    state.futures = state.futures.filter((item) => item.id !== id);
  }
  persistAndRender();
}

function markEntryAsRealized(id, collection = "manual") {
  const source = collection === "imported" ? state.imported : state.futures;
  const convertType = (type) => {
    if (type === "provision_credit") return "credit";
    if (type === "provision_debit") return "debit";
    if (type === "loan_payment") return "debit";
    return type;
  };
  const next = source.map((entry) => {
    if (entry.id !== id) return entry;
    return {
      ...entry,
      type: convertType(entry.type),
      status: "Realizado",
    };
  });
  if (collection === "imported") {
    state.imported = next;
    refreshImportMetaCount();
  } else {
    state.futures = next;
  }
  persistAndRender();
}

function pulseRefreshButton() {
  const original = "Atualizar";
  dom.refresh.textContent = "Atualizado";
  window.setTimeout(() => {
    dom.refresh.textContent = original;
  }, 900);
}

function persistAndRender() {
  saveState();
  render();
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      stateLoadedFromStorage = false;
      return {
        imported: [],
        futures: [],
        snapshots: [],
        importMeta: null,
        backupMeta: null,
        settings: defaultSettings(),
      };
    }
    const saved = raw ? JSON.parse(raw) : null;
    if (saved && typeof saved === "object") {
      stateLoadedFromStorage = true;
      return {
        imported: Array.isArray(saved.imported) ? saved.imported : [],
        futures: Array.isArray(saved.futures) ? saved.futures : [],
        snapshots: Array.isArray(saved.snapshots) ? saved.snapshots : [],
        importMeta: saved.importMeta || null,
        backupMeta: saved.backupMeta || null,
        settings: { ...defaultSettings(), ...(saved.settings || {}) },
      };
    }
  } catch (error) {
    console.warn(error);
  }

  stateLoadedFromStorage = false;

  return {
    imported: [],
    futures: [],
    snapshots: [],
    importMeta: null,
    backupMeta: null,
    settings: defaultSettings(),
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function snapshotState() {
  return JSON.parse(
    JSON.stringify({
      imported: state.imported,
      futures: state.futures,
      snapshots: state.snapshots,
      importMeta: state.importMeta,
      backupMeta: state.backupMeta,
      settings: state.settings,
    }),
  );
}

function restoreState(snapshot) {
  state.imported = Array.isArray(snapshot.imported) ? snapshot.imported : [];
  state.futures = Array.isArray(snapshot.futures) ? snapshot.futures : [];
  state.snapshots = Array.isArray(snapshot.snapshots) ? snapshot.snapshots : [];
  state.importMeta = snapshot.importMeta && typeof snapshot.importMeta === "object" ? snapshot.importMeta : null;
  state.backupMeta = snapshot.backupMeta && typeof snapshot.backupMeta === "object" ? snapshot.backupMeta : null;
  state.settings = { ...defaultSettings(), ...(snapshot.settings || {}) };
}

function buildBackupPayload() {
  const snapshot = snapshotState();
  return {
    version: 1,
    appName: document.title || "Fluxo de Caixa Local",
    exportedAt: new Date().toISOString(),
    imported: snapshot.imported,
    futures: snapshot.futures,
    snapshots: snapshot.snapshots,
    importMeta: snapshot.importMeta,
    settings: snapshot.settings,
  };
}

function formatBackupFilename(date = new Date()) {
  return `fluxo-caixa-backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}.json`;
}

function formatDateTime(iso) {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return `${dateFormat.format(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function downloadBackupJson(payload, fileName) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function validateBackupPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Backup invalido.");
  }

  if (!Array.isArray(payload.imported) || !Array.isArray(payload.futures) || !Array.isArray(payload.snapshots)) {
    throw new Error("Backup invalido: faltam listas principais.");
  }

  if (payload.settings && (typeof payload.settings !== "object" || Array.isArray(payload.settings))) {
    throw new Error("Backup invalido: configuracao corrompida.");
  }

  for (const [label, list] of [
    ["lancamentos importados", payload.imported],
    ["lancamentos manuais", payload.futures],
    ["saldos lidos", payload.snapshots],
  ]) {
    for (const [index, item] of list.entries()) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error(`Backup invalido: item ${index + 1} em ${label}.`);
      }
    }
  }

  return {
    imported: JSON.parse(JSON.stringify(payload.imported)),
    futures: JSON.parse(JSON.stringify(payload.futures)),
    snapshots: JSON.parse(JSON.stringify(payload.snapshots)),
    importMeta:
      payload.importMeta && typeof payload.importMeta === "object" && !Array.isArray(payload.importMeta)
        ? JSON.parse(JSON.stringify(payload.importMeta))
        : null,
    settings: { ...defaultSettings(), ...(payload.settings || {}) },
    version: payload.version ?? null,
    appName: normalize(payload.appName) || "Fluxo de Caixa Local",
    exportedAt: normalize(payload.exportedAt) || "",
  };
}

function exportBackup() {
  const payload = buildBackupPayload();
  const fileName = formatBackupFilename(new Date(payload.exportedAt));
  downloadBackupJson(payload, fileName);
  state.backupMeta = {
    ...(state.backupMeta || {}),
    lastExportedAt: payload.exportedAt,
    lastExportFile: fileName,
    lastExportedCounts: {
      imported: state.imported.length,
      futures: state.futures.length,
      snapshots: state.snapshots.length,
    },
  };
  saveState();
  render();
}

async function importBackup(file) {
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    await restoreBackupSafely(payload, file.name);
  } catch (error) {
    console.error(error);
    window.alert(error.message || "Nao consegui ler esse backup.");
  }
}

function restoreBackupSafely(payload, fileName) {
  const previous = snapshotState();
  try {
    const validated = validateBackupPayload(payload);
    const confirmText =
      `Restaurar o backup ${fileName}?\n\n` +
      "Isso vai substituir os dados atuais desta aplicacao por esse arquivo.";
    if (!window.confirm(confirmText)) return false;

    restoreState(validated);
    ensurePublicIds();
    state.importMeta = {
      ...(validated.importMeta || {}),
      fileName,
      importedAt: new Date().toISOString(),
      importedCount: state.imported.length,
      ignoredCount: Number(validated.importMeta?.ignoredCount || 0),
      snapshotCount: state.snapshots.length,
      source: "backup",
    };
    state.backupMeta = {
      ...(previous.backupMeta || {}),
      lastImportedAt: new Date().toISOString(),
      lastImportedFile: fileName,
      lastImportedCounts: {
        imported: state.imported.length,
        futures: state.futures.length,
        snapshots: state.snapshots.length,
      },
    };
    stateLoadedFromStorage = true;
    stopEditing();
    syncControls();
    persistAndRender();
    return true;
  } catch (error) {
    restoreState(previous);
    saveState();
    render();
    throw error;
  }
}

function defaultSettings() {
  return {
    baseBalance: 0,
    baseDate: todayIso(),
    horizonMonths: 6,
  };
}

function ensurePublicIds() {
  const used = new Set();
  let changed = false;
  const entries = [...state.imported, ...state.futures].sort(
    (a, b) => displayDate(normalizeEntry(a)).localeCompare(displayDate(normalizeEntry(b))) || makeId(a.id).localeCompare(makeId(b.id)),
  );

  for (const entry of entries) {
    const current = normalize(entry.publicId).trim();
    if (current && !used.has(current)) {
      used.add(current);
      continue;
    }
    entry.publicId = nextPublicId(displayDate(normalizeEntry(entry)), used);
    used.add(entry.publicId);
    changed = true;
  }
  return changed;
}

function nextPublicId(date = todayIso(), reserved = new Set()) {
  const year = (isIsoDate(date) ? date : todayIso()).slice(0, 4);
  const usedNumbers = [...state.imported, ...state.futures, ...reserved].map((item) => {
    const id = typeof item === "string" ? item : normalize(item.publicId);
    const match = id.match(new RegExp(`^CX-${year}-(\\d{4})$`, "i"));
    return match ? Number(match[1]) : 0;
  });
  const next = Math.max(0, ...usedNumbers) + 1;
  return `CX-${year}-${String(next).padStart(4, "0")}`;
}

function entryPublicId(item) {
  return item.publicId || makeId("CX", displayDate(item), item.id).slice(0, 18).toUpperCase();
}

async function parseXlsxFile(file) {
  return parseXlsxBuffer(await file.arrayBuffer());
}

async function parseXlsxBuffer(buffer) {
  const entries = await unzip(buffer);
  const workbook = parseXml(readZipText(entries, "xl/workbook.xml"));
  const rels = parseXml(readZipText(entries, "xl/_rels/workbook.xml.rels"));
  const shared = parseSharedStrings(entries);
  const relMap = new Map(
    elements(rels, "Relationship").map((rel) => [rel.getAttribute("Id"), rel.getAttribute("Target")]),
  );

  return elements(workbook, "sheet").map((sheet) => {
    const name = sheet.getAttribute("name") || "Planilha";
    const rid =
      sheet.getAttribute("r:id") ||
      sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const target = normalizeWorkbookTarget(relMap.get(rid));
    const xml = parseXml(readZipText(entries, target));
    return {
      name,
      rows: parseSheetRows(xml, shared),
    };
  });
}

function parseSharedStrings(entries) {
  if (!entries.has("xl/sharedStrings.xml")) return [];
  const xml = parseXml(readZipText(entries, "xl/sharedStrings.xml"));
  return elements(xml, "si").map((node) =>
    elements(node, "t")
      .map((textNode) => textNode.textContent || "")
      .join(""),
  );
}

function parseSheetRows(xml, shared) {
  return elements(xml, "row").map((row) => {
    const values = [];
    for (const cell of elements(row, "c")) {
      const ref = cell.getAttribute("r") || "";
      const colIndex = columnIndex(ref);
      values[colIndex] = cellValue(cell, shared);
    }
    return values.map((value) => value ?? "");
  });
}

function cellValue(cell, shared) {
  const type = cell.getAttribute("t");
  if (type === "inlineStr") {
    return elements(cell, "t")
      .map((node) => node.textContent || "")
      .join("");
  }

  const value = firstElement(cell, "v")?.textContent ?? "";
  if (!value) return "";
  if (type === "s") return shared[Number(value)] ?? "";
  if (type === "b") return value === "1" ? "TRUE" : "FALSE";
  return value;
}

async function unzip(buffer) {
  const view = new DataView(buffer);
  const eocd = findEndOfCentralDirectory(view);
  const totalEntries = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder("utf-8");
  const files = new Map();
  let cursor = centralOffset;

  for (let i = 0; i < totalEntries; i += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error("XLSX invalido.");
    const compression = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const nameBytes = new Uint8Array(buffer, cursor + 46, nameLength);
    const fileName = decoder.decode(nameBytes);

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = new Uint8Array(buffer, dataStart, compressedSize);
    let bytes;

    if (compression === 0) bytes = compressed;
    else if (compression === 8) bytes = await inflateRaw(compressed);
    else throw new Error("Compactacao XLSX nao suportada.");

    files.set(fileName, bytes);
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return files;
}

function findEndOfCentralDirectory(view) {
  for (let i = view.byteLength - 22; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) return i;
  }
  throw new Error("Arquivo XLSX invalido.");
}

async function inflateRaw(bytes) {
  if (!("DecompressionStream" in window)) {
    throw new Error("Seu navegador nao consegue ler XLSX localmente. Salve o extrato como CSV.");
  }

  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (error) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
}

function readZipText(entries, path) {
  const bytes = entries.get(path);
  if (!bytes) throw new Error(`Arquivo interno nao encontrado: ${path}`);
  return new TextDecoder("utf-8").decode(bytes);
}

function parseXml(text) {
  const xml = new DOMParser().parseFromString(text, "application/xml");
  if (xml.querySelector("parsererror")) throw new Error("XML invalido dentro do XLSX.");
  return xml;
}

function elements(node, name) {
  return Array.from(node.getElementsByTagNameNS("*", name));
}

function firstElement(node, name) {
  return elements(node, name)[0] || null;
}

function normalizeWorkbookTarget(target) {
  if (!target) throw new Error("Aba sem referencia interna.");
  if (target.startsWith("/")) return target.slice(1);
  if (target.startsWith("xl/")) return target;
  return `xl/${target}`;
}

function columnIndex(ref) {
  const letters = String(ref).match(/[A-Z]+/i)?.[0] || "A";
  let value = 0;
  for (const letter of letters.toUpperCase()) {
    value = value * 26 + letter.charCodeAt(0) - 64;
  }
  return value - 1;
}

function parseCsv(text) {
  const delimiter = detectDelimiter(text);
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((item) => normalize(item))) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((item) => normalize(item))) rows.push(row);
  return rows;
}

function detectDelimiter(text) {
  const sample = text.split(/\r?\n/).slice(0, 5).join("\n");
  const options = [";", ",", "\t", "|"];
  return options
    .map((delimiter) => ({
      delimiter,
      count: (sample.match(new RegExp(escapeRegex(delimiter), "g")) || []).length,
    }))
    .sort((a, b) => b.count - a.count)[0].delimiter;
}

function parseMoney(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;

  let text = normalize(value);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(text)) return null;

  const negative = /^\(.*\)$/.test(text) || /^-/.test(text);
  text = text
    .replace(/R\$/gi, "")
    .replace(/\s/g, "")
    .replace(/[()]/g, "")
    .replace(/[^\d,.-]/g, "");

  if (!text || text === "-" || text === "," || text === ".") return null;

  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    text = lastComma > lastDot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else if (lastComma >= 0) {
    text = text.replace(",", ".");
  }

  const number = Number(text);
  if (!Number.isFinite(number)) return null;
  return negative && number > 0 ? -number : number;
}

function parseDate(value) {
  if (value === null || value === undefined) return "";
  const text = normalize(value);
  if (!text) return "";

  if (/^\d+(\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (serial >= 20000 && serial <= 60000) return excelSerialToIso(serial);
  }

  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) return toIso(Number(match[1]), Number(match[2]), Number(match[3]));

  match = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (match) {
    let year = match[3];
    if (year.length === 2) year = `20${year}`;
    if (year.length === 3 && year.startsWith("20")) year = `202${year.slice(2)}`;
    return toIso(Number(year), Number(match[2]), Number(match[1]));
  }

  return "";
}

function excelSerialToIso(serial) {
  const utc = Math.round((serial - 25569) * 86400000);
  const date = new Date(utc);
  return toIso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function toIso(year, month, day) {
  if (!year || !month || !day || month > 12 || day > 31 || year < 2000) return "";
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return "";
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}

function parseMovementType(value) {
  const text = headerKey(value);
  if (!text) return "";
  if (/provisao (credito|receita)/.test(text)) return "provision_credit";
  if (/provisao debito/.test(text)) return "provision_debit";
  if (/^(c|cr|cred)$/.test(text) || /credito|receita|entrada|provisao credito/.test(text)) {
    return "credit";
  }
  if (/^(d|db|deb)$/.test(text) || /debito|despesa|saida|provisao debito/.test(text)) {
    return "debit";
  }
  return "";
}

function classifyEntryType(type, description, amount) {
  const text = headerKey(description);
  if (/investimento|aplicacao|aplicação/.test(text) && amount < 0) return "investment_outflow";
  if (/investimento|aporte/.test(text) && amount > 0) return "investment";
  return type;
}

function inferType(description, amount) {
  if (amount === null) return "";
  if (amount < 0) return "debit";
  const text = headerKey(description);
  if (/debito|pagamento|compra|das|frete|boleto|tarifa|saida/.test(text)) {
    return "debit";
  }
  if (/credito|pix recebido|recebido|resgate|aporte|entrada|venda/.test(text)) {
    return "credit";
  }
  return amount > 0 ? "credit" : "";
}

function inferStatus(type, date) {
  if (["credit", "debit"].includes(type) && date <= (state.settings?.baseDate || todayIso())) {
    return "Realizado";
  }
  return "Previsto";
}

function isBalanceDescription(description) {
  return /^saldo\b/i.test(normalize(description));
}

function signedAmount(amount, type) {
  const value = Math.abs(Number(amount || 0));
  return type === "debit" ? -value : value;
}

function signedEntry(entry) {
  if (isCanceled(entry)) return 0;
  const amount = Number(entry.amount || 0);
  if (["debit", "loan_payment", "provision_debit", "investment_outflow"].includes(entry.type)) {
    return -amount;
  }
  return amount;
}

function normalizeEntry(entry) {
  return {
    ...entry,
    type: entry.type || "credit",
    amount: Math.abs(Number(entry.amount || 0)),
    date: isIsoDate(entry.date) ? entry.date : todayIso(),
    account: entry.account || "",
    category: entry.category || "",
    client: entry.client || "",
    quoteNumber: entry.quoteNumber || "",
    commitment: entry.commitment || "",
    status: entry.status || "",
    publicId: entry.publicId || "",
    source: entry.source || "",
  };
}

function entryTypeLabel(type, short = false) {
  const labels = {
    credit: "Receita",
    debit: "Despesa",
    provision_credit: short ? "Prov. receita" : "Provisao receita",
    provision_debit: short ? "Prov. debito" : "Provisao debito",
    investment: short ? "Aporte" : "Investimento/Aporte",
    investment_outflow: short ? "Retirada inv." : "Retirada investimento Jan/2027",
    loan: short ? "Emprestimo" : "Emprestimo de terceiros",
    loan_payment: short ? "Pgto. emprest." : "Pagamento de emprestimo",
  };
  return labels[type] || "Receita";
}

function suggestBaseBalance(transactions, snapshots) {
  if (snapshots.length) {
    const latestByAccount = new Map();
    for (const snapshot of snapshots) {
      const current = latestByAccount.get(snapshot.account);
      if (!current || snapshot.date >= current.date) latestByAccount.set(snapshot.account, snapshot);
    }
    return Array.from(latestByAccount.values()).reduce((sum, item) => sum + item.balance, 0);
  }

  return transactions.reduce((sum, item) => sum + signedEntry(item), 0);
}

function dedupeTransactions(transactions) {
  const seen = new Set();
  return transactions.filter((item) => {
    const key = [item.date, item.account, item.description, item.amount, item.type].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function monthKeys(baseDate, count) {
  const date = parseIsoDate(baseDate);
  const keys = [];
  for (let i = 0; i < count; i += 1) {
    const monthDate = new Date(date.getFullYear(), date.getMonth() + i, 1);
    keys.push(`${monthDate.getFullYear()}-${pad(monthDate.getMonth() + 1)}`);
  }
  return keys;
}

function formatMonthKey(key) {
  const [year, month] = key.split("-").map(Number);
  return monthFormat.format(new Date(year, month - 1, 1)).replace(".", "");
}

function compactMoney(value) {
  const abs = Math.abs(Number(value || 0));
  const sign = value < 0 ? "-" : "";
  if (abs >= 1000000) return `${sign}R$ ${(abs / 1000000).toFixed(1).replace(".", ",")} mi`;
  if (abs >= 10000) return `${sign}R$ ${(abs / 1000).toFixed(0).replace(".", ",")} mil`;
  return brl.format(value);
}

function latestIso(values) {
  return values.filter(Boolean).sort().at(-1) || "";
}

function addDays(iso, days) {
  const date = parseIsoDate(iso);
  date.setDate(date.getDate() + days);
  return toLocalIso(date);
}

function parseIsoDate(iso) {
  const [year, month, day] = String(iso || todayIso()).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(iso) {
  if (!isIsoDate(iso)) return normalize(iso) || "-";
  return dateFormat.format(parseIsoDate(iso));
}

function todayIso() {
  return toLocalIso(new Date());
}

function toLocalIso(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const [year, month, day] = String(value).split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() + 1 === month &&
    date.getDate() === day
  );
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function normalize(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function rowHasContent(row) {
  return row.some((cell) => normalize(cell));
}

function makeId(...parts) {
  return parts.map((part) => normalize(part).toLowerCase()).join("|");
}

function emptyRow(message, colspan) {
  const row = document.createElement("tr");
  row.innerHTML = `<td class="empty-row" colspan="${colspan}">${message}</td>`;
  return row;
}

function escapeHtml(value) {
  return normalize(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
