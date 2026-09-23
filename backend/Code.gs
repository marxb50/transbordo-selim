/**
 * SELIM Transbordo — banco operacional separado dos formulários originais.
 * Implantar como aplicativo da Web: executar como proprietário, acesso por link.
 * As abas históricas copiadas são SOMENTE LIDAS; toda escrita ocorre nas abas
 * estruturadas da cópia em marxb50.
 */
const TRANSBORDO = Object.freeze({
  spreadsheetId: '1zrrpnGf05A_7aAhvTis9DKYZZqlad5onXpwSSvAZyOM',
  coletoresHistoricoId: '1EwM6Cqf30MMbPTtTlfz2dwNFUppT_Y9HHPRuNzluUCU',
  legadoTab: 'Respostas ao formulário 1',
  viagensTab: 'Viagens_Carretas',
  coletoresTab: 'Registros_Coletores',
  timezone: 'America/Fortaleza',
  maxPesoKg: 100000,
  pageSize: 25
});

const VIAGEM_HEADERS = [
  'id', 'saidaEm', 'placaCarreta', 'manifesto', 'fiscalSaida',
  'observacoesSaida', 'status', 'retornoEm', 'pesoKg', 'ticket',
  'fiscalRetorno', 'observacoesRetorno', 'criadoEm', 'atualizadoEm',
  'saidaRequestId', 'retornoRequestId'
];
const COLETOR_HEADERS = [
  'id', 'registradoEm', 'placaColetor', 'bairro', 'fiscal',
  'placaCarreta', 'viagemId', 'observacoes', 'criadoEm', 'clientRequestId'
];

const OPTIONS = Object.freeze({
  carretasPlates: [
    'JAS2D61', 'TSY2H92', 'RVG1I40', 'JAS2F62', 'JAS2F88',
    'JAS2G73', 'IVX2B560', 'JAY7C40', 'RVG1140', 'IYX2156',
    'JAZ7I36', 'RVW5E95', 'SLS4B99', 'OWG7E81', 'LYX2156'
  ],
  collectorPlates: [
    'JCX2A75', 'JCH2B55', 'TTG7C92', 'TTG9H76', 'TTG9H77',
    'TTG9H78', 'TTH9G80', 'TUS1D08', 'TTQ1D28', 'TUA1D16',
    'TUA1D18', 'TTH9G79', 'ELU1B42'
  ],
  neighborhoods: [
    'Abel Cabral', 'Água Vermelha', 'Bairro Marilia', 'Bela Parnamirim',
    'Bosque', 'Cajupiranga', 'Caminho do Sol', 'Cidade Verde',
    'Centro de Parnamirim', 'Cohabinal', 'Coopabi', 'Emaús',
    'Jardim Planalto', 'Jiqui', 'Jockey Clubi', 'Liberdade',
    'Monte Castelo', 'Nova Esperança', 'Nova Parnamirim',
    'Parnamirim II', 'Parque das Árvores', 'Parque das Orquídeas',
    'Parque Industrial', 'Parque Verde', 'Passagem de Areia',
    'Pirangi / Pirangi Praia', 'Planalto ,Ceduc', 'Primavera',
    'Rosa dos ventos', 'Santa Cecília', 'Santa Júlia', 'Santa Teresa',
    'Santos Reis', 'Toca da Raposa', 'Vale do Sol', 'Vida Nova'
  ],
  fiscals: [
    'José Domingos de Oliveira', 'Luis Paulo Silva de Souza',
    'Rodrigo Marinho de Santana'
  ]
});

function doGet(e) {
  const template = HtmlService.createTemplateFromFile('Index');
  template.bridgeSession = String((e && e.parameter && e.parameter.bridgeSession) || '');
  return template.evaluate()
    .setTitle('SELIM Transbordo — conexão de dados')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function setupTransbordo() {
  return withWriteLock_(function () {
    ensureTabs_();
    return { success: true, spreadsheetId: TRANSBORDO.spreadsheetId };
  });
}

function getBootstrap() {
  const tabs = ensureTabs_();
  const openTrips = rowsAsObjects_(tabs.viagens, VIAGEM_HEADERS)
    .filter(row => row.status === 'EM_VIAGEM')
    .map(publicTrip_)
    .reverse();
  return { success: true, openTrips: openTrips, options: OPTIONS };
}

function registrarSaida(data) {
  data = data || {};
  const placa = plate_(data.placaCarreta, 'Placa da carreta');
  const manifesto = limited_(data.manifesto, 80);
  const fiscal = requiredText_(data.fiscal, 'Fiscal', 120);
  const observacoes = limited_(data.observacoes, 500);
  const requestId = optionalRequestId_(data.clientRequestId);
  return withWriteLock_(function () {
    const sheet = ensureTabs_().viagens;
    const rows = rowsAsObjects_(sheet, VIAGEM_HEADERS);
    if (requestId) {
      const prior = rows.find(row => row.saidaRequestId === requestId);
      if (prior) return { success: true, viagem: publicTrip_(prior), repetido: true };
    }
    if (rows.some(row => row.status === 'EM_VIAGEM' && row.placaCarreta === placa)) {
      throw new Error('Esta carreta já tem uma saída aberta. Registre o retorno antes de criar outra viagem.');
    }
    const now = new Date().toISOString();
    const row = {
      id: Utilities.getUuid(), saidaEm: now, placaCarreta: placa,
      manifesto: manifesto, fiscalSaida: fiscal, observacoesSaida: observacoes,
      status: 'EM_VIAGEM', retornoEm: '', pesoKg: '', ticket: '',
      fiscalRetorno: '', observacoesRetorno: '', criadoEm: now, atualizadoEm: now,
      saidaRequestId: requestId, retornoRequestId: ''
    };
    appendObject_(sheet, VIAGEM_HEADERS, row);
    return { success: true, viagem: publicTrip_(row) };
  });
}

function registrarRetorno(data) {
  data = data || {};
  const id = requiredText_(data.viagemId, 'Viagem', 80);
  const pesoKg = precisePeso_(data.pesoKg);
  const ticket = limited_(data.ticket, 80);
  const fiscal = requiredText_(data.fiscal, 'Fiscal', 120);
  const observacoes = limited_(data.observacoes, 500);
  const requestId = optionalRequestId_(data.clientRequestId);
  return withWriteLock_(function () {
    const sheet = ensureTabs_().viagens;
    const rows = rowsAsObjects_(sheet, VIAGEM_HEADERS);
    const row = rows.find(item => item.id === id);
    if (!row) throw new Error('Saída da carreta não encontrada. Atualize a página.');
    if (row.status === 'CONCLUIDA') {
      if (requestId && row.retornoRequestId === requestId) {
        return { success: true, viagem: publicTrip_(row), repetido: true };
      }
      throw new Error('Esta viagem já possui retorno e peso. Nenhum dado foi duplicado.');
    }
    if (row.status !== 'EM_VIAGEM') throw new Error('A viagem não está aberta.');
    const now = new Date().toISOString();
    row.retornoEm = now;
    row.pesoKg = pesoKg;
    row.ticket = ticket;
    row.fiscalRetorno = fiscal;
    row.observacoesRetorno = observacoes;
    row.status = 'CONCLUIDA';
    row.atualizadoEm = now;
    row.retornoRequestId = requestId;
    sheet.getRange(row._rowNumber, 1, 1, VIAGEM_HEADERS.length)
      .setValues([VIAGEM_HEADERS.map(header => row[header])]);
    return { success: true, viagem: publicTrip_(row) };
  });
}

function registrarColetor(data) {
  data = data || {};
  const placaColetor = plate_(data.placaColetor, 'Placa do coletor');
  const bairro = requiredText_(data.bairro, 'Bairro', 120);
  const fiscal = requiredText_(data.fiscal, 'Fiscal', 120);
  let placaCarreta = data.placaCarreta ? plate_(data.placaCarreta, 'Placa da carreta') : '';
  const viagemId = limited_(data.viagemId, 80);
  const observacoes = limited_(data.observacoes, 500);
  const requestId = optionalRequestId_(data.clientRequestId);
  return withWriteLock_(function () {
    const tabs = ensureTabs_();
    const rows = rowsAsObjects_(tabs.coletores, COLETOR_HEADERS);
    if (requestId) {
      const prior = rows.find(row => row.clientRequestId === requestId);
      if (prior) return { success: true, registro: publicCollector_(prior), repetido: true };
    }
    if (viagemId) {
      const viagem = rowsAsObjects_(tabs.viagens, VIAGEM_HEADERS)
        .find(item => item.id === viagemId);
      if (!viagem) throw new Error('Viagem informada não encontrada.');
      if (placaCarreta && placaCarreta !== viagem.placaCarreta) {
        throw new Error('A placa da carreta não corresponde à viagem escolhida.');
      }
      placaCarreta = viagem.placaCarreta;
    }
    const now = new Date().toISOString();
    const row = {
      id: Utilities.getUuid(), registradoEm: now, placaColetor: placaColetor,
      bairro: bairro, fiscal: fiscal, placaCarreta: placaCarreta,
      viagemId: viagemId, observacoes: observacoes,
      criadoEm: now, clientRequestId: requestId
    };
    appendObject_(tabs.coletores, COLETOR_HEADERS, row);
    return { success: true, registro: publicCollector_(row) };
  });
}

function getHistorico(tipo, page, query) {
  if (tipo !== 'carretas' && tipo !== 'coletores') throw new Error('Tipo de histórico inválido.');
  page = Number(page || 1);
  if (!Number.isInteger(page) || page < 1 || page > 1000) throw new Error('Página inválida.');
  query = limited_(query, 120).toLocaleLowerCase('pt-BR');
  const tabs = ensureTabs_();
  let items;
  if (tipo === 'carretas') {
    const recentes = rowsAsObjects_(tabs.viagens, VIAGEM_HEADERS).reverse()
      .map(row => ({ id: row.id, source: 'novo', status: row.status,
        placaCarreta: row.placaCarreta, saidaEm: row.saidaEm,
        retornoEm: row.retornoEm, manifesto: row.manifesto,
        _search: [row.placaCarreta, row.manifesto].join(' ') }));
    const antigos = legacyHistory_(tabs.base, 'carretas');
    items = recentes.concat(antigos);
  } else {
    const recentes = rowsAsObjects_(tabs.coletores, COLETOR_HEADERS).reverse()
      .map(row => ({ id: row.id, source: 'novo', placaColetor: row.placaColetor,
        bairro: row.bairro, registradoEm: row.registradoEm,
        placaCarreta: row.placaCarreta,
        _search: [row.placaColetor, row.bairro, row.placaCarreta].join(' ') }));
    const antigos = legacyHistory_(SpreadsheetApp.openById(TRANSBORDO.coletoresHistoricoId), 'coletores');
    items = recentes.concat(antigos);
  }
  if (query) items = items.filter(item => String(item._search || '').toLocaleLowerCase('pt-BR').includes(query));
  const start = (page - 1) * TRANSBORDO.pageSize;
  const pageItems = items.slice(start, start + TRANSBORDO.pageSize).map(item => {
    const safe = Object.assign({}, item);
    delete safe._search;
    return safe;
  });
  return { success: true, items: pageItems,
    hasMore: start + TRANSBORDO.pageSize < items.length, total: items.length };
}

function gerarRelatorio(data) {
  data = data || {};
  assertReportPassword_(data.senha);
  const period = reportPeriod_(data.periodo, data.referencia);
  const tabs = ensureTabs_();
  const allTrips = rowsAsObjects_(tabs.viagens, VIAGEM_HEADERS);
  const allCollectors = rowsAsObjects_(tabs.coletores, COLETOR_HEADERS);
  const legacySheet = tabs.base.getSheetByName(TRANSBORDO.legadoTab);
  const legacyRows = legacySheet && legacySheet.getLastRow() > 0
    ? legacySheet.getRange(1, 1, legacySheet.getLastRow(), 25).getDisplayValues() : [];
  const legacy = typeof parseLegacyCarretas === 'function'
    ? parseLegacyCarretas(legacyRows, { timeZone: 'America/Sao_Paulo' })
    : { events: [], quality: { unavailable: true } };
  const legacyCollectorSheet = SpreadsheetApp.openById(TRANSBORDO.coletoresHistoricoId)
    .getSheetByName(TRANSBORDO.legadoTab);
  const legacyCollectors = legacyCollectorSheet
    ? parseLegacyCollectors_(legacyCollectorSheet.getRange(1, 1, legacyCollectorSheet.getLastRow(), 6).getDisplayValues())
    : { records: [], invalidDates: 0 };
  const legacyEvents = (legacy.events || []).map(event => ({
    id: event.id, placaCarreta: event.placaCarreta,
    retornoEm: event.retornoEm, pesoKg: event.pesoKg,
    source: 'legado'
  }));
  const currentEvents = allTrips.filter(row => row.status === 'CONCLUIDA')
    .map(row => ({ id: row.id, placaCarreta: row.placaCarreta,
      retornoEm: row.retornoEm, pesoKg: row.pesoKg, source: 'novo' }));
  const events = currentEvents.concat(legacyEvents);
  const report = aggregateReport_(events, allTrips,
    allCollectors.concat(legacyCollectors.records), period, legacy.quality, legacyCollectors.invalidDates);
  return { success: true, report: report };
}

function alterarSenhaRelatorio(data) {
  data = data || {};
  assertReportPassword_(data.senhaAtual);
  const next = String(data.novaSenha || '');
  if (next.length < 6 || next.length > 80) throw new Error('A nova senha deve ter entre 6 e 80 caracteres.');
  return withWriteLock_(function () {
    // Verifica novamente sob o bloqueio para não sobrescrever troca concorrente.
    assertReportPassword_(data.senhaAtual);
    const salt = Utilities.getUuid();
    PropertiesService.getScriptProperties().setProperties({
      REPORT_PASSWORD_SALT: salt,
      REPORT_PASSWORD_HASH: sha256_(salt + ':' + next)
    });
    return { success: true };
  });
}

function aggregateReport_(events, allTrips, allCollectors, period, legacyQuality, legacyCollectorInvalidDates) {
  const selected = events.filter(event => inPeriod_(event.retornoEm, period));
  const previous = events.filter(event => inPeriod_(event.retornoEm, period.previous));
  const byPlate = {};
  const byDay = {};
  let totalGrams = 0;
  let legacyGrams = 0;
  let legacyCount = 0;
  selected.forEach(event => {
    const grams = toGrams_(event.pesoKg);
    if (grams === null) return;
    const placa = String(event.placaCarreta || 'SEM PLACA');
    const dia = localDay_(event.retornoEm);
    totalGrams += grams;
    byPlate[placa] = byPlate[placa] || { placa: placa, grams: 0, viagens: 0 };
    byPlate[placa].grams += grams;
    byPlate[placa].viagens++;
    byDay[dia] = byDay[dia] || 0;
    byDay[dia] += grams;
    if (event.source === 'legado') { legacyGrams += grams; legacyCount++; }
  });
  const previousGrams = previous.reduce((sum, event) => sum + (toGrams_(event.pesoKg) || 0), 0);
  const collectorSelected = allCollectors.filter(row => inPeriod_(row.registradoEm, period));
  const collectorByBairro = {};
  const collectorByTrailer = {};
  let linked = 0;
  let linkedByTrip = 0;
  let legacyCollectorCount = 0;
  collectorSelected.forEach(row => {
    if (row.source === 'legado') legacyCollectorCount++;
    const bairro = row.bairro || 'NÃO INFORMADO';
    collectorByBairro[bairro] = (collectorByBairro[bairro] || 0) + 1;
    const placa = row.placaCarreta || '';
    if (placa) {
      linked++;
      if (row.viagemId) linkedByTrip++;
      collectorByTrailer[placa] = (collectorByTrailer[placa] || 0) + 1;
    }
  });
  const trailerTotals = {};
  Object.keys(byPlate).forEach(placa => { trailerTotals[placa] = byPlate[placa].grams; });
  const openTrips = allTrips.filter(row => row.status === 'EM_VIAGEM').length;
  const selectedNewCount = selected.length - legacyCount;
  return {
    periodoLabel: period.label, inicio: period.start, fim: period.end,
    totalKg: totalGrams / 1000, viagensConcluidas: selected.length,
    mediaKgPorViagem: selected.length ? totalGrams / 1000 / selected.length : 0,
    comparativo: {
      periodoAnteriorLabel: period.previous.label,
      totalAnteriorKg: previousGrams / 1000,
      diferencaKg: (totalGrams - previousGrams) / 1000,
      variacaoPercentual: previousGrams ? (totalGrams - previousGrams) / previousGrams * 100 : null
    },
    porCarreta: Object.keys(byPlate).map(key => ({
      placa: key, pesoKg: byPlate[key].grams / 1000, viagens: byPlate[key].viagens
    })).sort((a, b) => b.pesoKg - a.pesoKg),
    porDia: Object.keys(byDay).sort().map(day => ({ dia: day, pesoKg: byDay[day] / 1000 })),
    coletores: {
      total: collectorSelected.length, vinculados: linked,
      vinculadosViagem: linkedByTrip,
      semVinculo: collectorSelected.length - linked,
      porBairro: Object.keys(collectorByBairro).map(key => ({ bairro: key, registros: collectorByBairro[key] }))
        .sort((a, b) => b.registros - a.registros),
      porCarreta: Object.keys(collectorByTrailer).map(key => ({
        placaCarreta: key, registros: collectorByTrailer[key],
        pesoKg: (trailerTotals[key] || 0) / 1000
      })).sort((a, b) => b.registros - a.registros)
    },
    fontes: {
      viagensNovas: selectedNewCount,
      viagensLegadasVerificadas: legacyCount,
      pesoLegadoVerificadoKg: legacyGrams / 1000,
      coletoresNovos: collectorSelected.length - legacyCollectorCount,
      coletoresLegados: legacyCollectorCount
    },
    qualidade: {
      viagensEmAberto: openTrips,
      coletoresSemVinculo: collectorSelected.length - linked,
      legadoNaoConciliado: legacyQuality && (legacyQuality.unparsedWeightRows || 0),
      coletoresLegadosSemData: legacyCollectorInvalidDates || 0,
      legado: legacyQuality || {}
    },
    avisoRelacao: 'O peso pertence à carreta/viagem. Registros de coletores associados não representam divisão do peso entre coletores.'
  };
}

function parseLegacyCollectors_(rows) {
  const result = { records: [], invalidDates: 0 };
  if (!rows || rows.length < 2) return result;
  rows.slice(1).forEach((row, index) => {
    if (!row.some(cell => String(cell || '').trim())) return;
    const match = String(row[0] || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) { result.invalidDates++; return; }
    const check = new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]),
      Number(match[4]), Number(match[5]), Number(match[6] || 0)));
    if (check.getUTCFullYear() !== Number(match[3]) || check.getUTCMonth() + 1 !== Number(match[2]) ||
        check.getUTCDate() !== Number(match[1])) { result.invalidDates++; return; }
    const registradoEm = match[3] + '-' + match[2] + '-' + match[1] + 'T' +
      match[4] + ':' + match[5] + ':' + (match[6] || '00') + '-03:00';
    const origin = String(row[2] || '').trim();
    const otherOrigin = String(row[3] || '').trim();
    const bairro = /^(OUTROS?|OUTRA ORIGEM)$/i.test(origin) && otherOrigin ? otherOrigin : origin;
    result.records.push({
      id: 'legado-coletor-' + (index + 2), source: 'legado', registradoEm: registradoEm,
      placaColetor: String(row[1] || '').trim(), bairro: bairro || 'NÃO INFORMADO',
      fiscal: String(row[4] || '').trim(), placaCarreta: '', viagemId: ''
    });
  });
  return result;
}

function reportPeriod_(kind, reference) {
  if (kind !== 'semana' && kind !== 'mes') throw new Error('Período inválido.');
  const text = String(reference || '');
  let start;
  let end;
  let label;
  let previousStart;
  let previousEnd;
  if (kind === 'semana') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('Data da semana inválida.');
    const chosen = parseIsoDay_(text);
    const mondayOffset = (chosen.getUTCDay() + 6) % 7;
    start = addDays_(chosen, -mondayOffset);
    end = addDays_(start, 6);
    previousStart = addDays_(start, -7);
    previousEnd = addDays_(start, -1);
    label = 'Semana de ' + isoDay_(start) + ' a ' + isoDay_(end);
  } else {
    if (!/^\d{4}-\d{2}$/.test(text)) throw new Error('Mês inválido.');
    const year = Number(text.slice(0, 4));
    const month = Number(text.slice(5, 7));
    if (month < 1 || month > 12) throw new Error('Mês inválido.');
    start = new Date(Date.UTC(year, month - 1, 1));
    end = new Date(Date.UTC(year, month, 0));
    previousStart = new Date(Date.UTC(year, month - 2, 1));
    previousEnd = new Date(Date.UTC(year, month - 1, 0));
    label = 'Mês ' + text;
  }
  return {
    start: isoDay_(start), end: isoDay_(end), label: label,
    previous: { start: isoDay_(previousStart), end: isoDay_(previousEnd),
      label: kind === 'semana' ? 'Semana de ' + isoDay_(previousStart) + ' a ' + isoDay_(previousEnd)
        : 'Mês ' + isoDay_(previousStart).slice(0, 7) }
  };
}

function inPeriod_(value, period) {
  const day = localDay_(value);
  return day && day >= period.start && day <= period.end;
}

function localDay_(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return '';
  return Utilities.formatDate(date, TRANSBORDO.timezone, 'yyyy-MM-dd');
}

function parseIsoDay_(text) {
  const date = new Date(text + 'T00:00:00.000Z');
  if (isNaN(date.getTime()) || isoDay_(date) !== text) throw new Error('Data inválida.');
  return date;
}
function addDays_(date, days) { return new Date(date.getTime() + days * 86400000); }
function isoDay_(date) { return date.toISOString().slice(0, 10); }

function ensureTabs_() {
  const base = SpreadsheetApp.openById(TRANSBORDO.spreadsheetId);
  return {
    base: base,
    viagens: ensureSheet_(base, TRANSBORDO.viagensTab, VIAGEM_HEADERS),
    coletores: ensureSheet_(base, TRANSBORDO.coletoresTab, COLETOR_HEADERS)
  };
}

function ensureSheet_(book, title, headers) {
  let sheet = book.getSheetByName(title);
  if (!sheet) {
    sheet = book.insertSheet(title);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setBackground('#0d2552').setFontColor('#ffffff').setFontWeight('bold');
  } else {
    const actual = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    if (headers.some((header, i) => actual[i] !== header)) {
      throw new Error('Cabeçalhos inesperados na aba ' + title + '. Nenhum dado foi alterado.');
    }
  }
  return sheet;
}

function rowsAsObjects_(sheet, headers) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const values = sheet.getRange(2, 1, last - 1, headers.length).getValues();
  return values.map((valuesRow, index) => {
    const row = { _rowNumber: index + 2 };
    headers.forEach((key, i) => { row[key] = valuesRow[i]; });
    return row;
  }).filter(row => row.id);
}

function appendObject_(sheet, headers, row) {
  sheet.appendRow(headers.map(header => row[header]));
}

function legacyHistory_(book, kind) {
  const sheet = book.getSheetByName(TRANSBORDO.legadoTab);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const data = sheet.getDataRange().getValues();
  return data.slice(1).map((row, index) => {
    const raw = row.map(cell => cell instanceof Date
      ? Utilities.formatDate(cell, TRANSBORDO.timezone, 'dd/MM/yyyy HH:mm')
      : String(cell || '').trim());
    let compact;
    if (kind === 'carretas') {
      const map = typeof LEGACY_CARRETA_COLUMNS_ === 'object' ? LEGACY_CARRETA_COLUMNS_ : {};
      const plates = [...new Set(Object.keys(map).filter(col => raw[Number(col)])
        .map(col => map[col]))];
      if (!plates.length && typeof legacyMentionedPlates_ === 'function') {
        const known = [...new Set(Object.keys(map).map(col => map[col]))];
        plates.push(...legacyMentionedPlates_(raw[6] || '', known));
      }
      const plateLabel = plates.length === 1 ? plates[0] : plates.length > 1 ? 'várias carretas' : 'placa não identificada';
      compact = 'Carreta: ' + plateLabel + ' · ' + (raw[0] || 'sem data');
    } else {
      compact = 'Coletor: ' + (raw[1] || 'placa não informada') +
        ' · Bairro: ' + (raw[2] || 'não informado') + ' · ' + (raw[0] || 'sem data');
    }
    return { id: 'legado-' + kind + '-' + (index + 2), source: 'legado',
      registradoEm: raw[0] || '', descricao: compact,
      _search: raw.join(' ') };
  }).filter(item => item.registradoEm).reverse();
}

function publicTrip_(row) {
  return {
    id: row.id, saidaEm: row.saidaEm, placaCarreta: row.placaCarreta,
    manifesto: row.manifesto, fiscalSaida: row.fiscalSaida,
    observacoesSaida: row.observacoesSaida, status: row.status,
    retornoEm: row.retornoEm, pesoKg: row.pesoKg,
    ticket: row.ticket, fiscalRetorno: row.fiscalRetorno,
    observacoesRetorno: row.observacoesRetorno
  };
}

function publicCollector_(row) {
  return {
    id: row.id, registradoEm: row.registradoEm,
    placaColetor: row.placaColetor, bairro: row.bairro,
    fiscal: row.fiscal, placaCarreta: row.placaCarreta,
    viagemId: row.viagemId, observacoes: row.observacoes
  };
}

function withWriteLock_(callback) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('O sistema está ocupado. Aguarde alguns segundos e tente novamente.');
  try { return callback(); } finally { lock.releaseLock(); }
}

function plate_(value, label) {
  const text = String(value || '').toUpperCase().replace(/[\s-]/g, '');
  if (!/^[A-Z0-9]{7,8}$/.test(text)) throw new Error(label + ' inválida. Confira os caracteres.');
  return text;
}
function limited_(value, max) {
  const text = String(value == null ? '' : value).trim();
  if (text.length > max) throw new Error('Texto excede o limite de ' + max + ' caracteres.');
  return text;
}
function requiredText_(value, label, max) {
  const text = limited_(value, max);
  if (!text) throw new Error(label + ' é obrigatório.');
  return text;
}
function optionalRequestId_(value) {
  if (!value) return '';
  const text = String(value).trim();
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(text)) throw new Error('Identificador de envio inválido.');
  return text;
}
function precisePeso_(value) {
  const peso = Number(value);
  if (!Number.isFinite(peso) || peso <= 0 || peso > TRANSBORDO.maxPesoKg) {
    throw new Error('Peso inválido. Informe o peso em kg do comprovante.');
  }
  const grams = Math.round(peso * 1000);
  if (Math.abs(grams / 1000 - peso) > 0.000001) {
    throw new Error('Use no máximo três casas decimais para o peso em kg.');
  }
  return grams / 1000;
}
function toGrams_(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.round(num * 1000) : null;
}

function assertReportPassword_(password) {
  const props = PropertiesService.getScriptProperties();
  let salt = props.getProperty('REPORT_PASSWORD_SALT');
  let expected = props.getProperty('REPORT_PASSWORD_HASH');
  if (!salt || !expected) {
    // A senha inicial é informada pelo proprietário, manualmente, nas
    // propriedades privadas do projeto. No primeiro uso correto, migra para
    // hash com sal; nem a senha nem o hash entram no GitHub Pages.
    const initial = props.getProperty('REPORT_PASSWORD_INITIAL');
    if (!initial) throw new Error('Senha do relatório ainda não configurada pelo administrador.');
    if (String(password || '') !== initial) throw new Error('Senha incorreta.');
    salt = Utilities.getUuid();
    expected = sha256_(salt + ':' + initial);
    props.setProperties({ REPORT_PASSWORD_SALT: salt, REPORT_PASSWORD_HASH: expected });
    props.deleteProperty('REPORT_PASSWORD_INITIAL');
  }
  const supplied = sha256_(salt + ':' + String(password || ''));
  if (supplied !== expected) throw new Error('Senha incorreta.');
}
function sha256_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(byte => ('0' + ((byte + 256) % 256).toString(16)).slice(-2)).join('');
}
