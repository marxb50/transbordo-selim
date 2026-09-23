'use strict';

// URL /exec da implantação do clone TRANSBORDO na conta marxb50.
const SCRIPT_BRIDGE_URL = 'https://script.google.com/macros/s/AKfycbxXOVsfgi81rqb5F_-kQY4CZwrN5XmwUSCr84E7bb3DjfdJDnrSBVkG1-W55q3MRy6n0A/exec';
const BRIDGE_MARKER = 'selimTransbordoBridge';
const BRIDGE_METHODS = new Set([
  'getBootstrap', 'registrarSaida', 'registrarRetorno', 'registrarColetor',
  'getHistorico', 'gerarRelatorio', 'alterarSenhaRelatorio'
]);

const state = {
  demo: new URLSearchParams(window.location.search).get('demo') === '1',
  mode: '',
  step: 'saida',
  openTrips: [],
  options: { carretasPlates: [], collectorPlates: [], neighborhoods: [], fiscals: [] },
  history: { carretas: { page: 0, query: '', hasMore: true }, coletores: { page: 0, query: '', hasMore: true } }
};

const $ = id => document.getElementById(id);
const kgFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
const integerFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const percentFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

const bridge = {
  frame: null,
  ready: false,
  origin: null,
  remoteWindow: null,
  session: window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  nextId: 1,
  pending: new Map(),
  waiters: [],

  init() {
    if (state.demo) {
      this.ready = true;
      setStatus('Demonstração: os dados exibidos são fictícios e não são salvos.', 'ok');
      return;
    }
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:[?#].*)?$/.test(SCRIPT_BRIDGE_URL)) {
      setStatus('A conexão com a planilha ainda não foi publicada. Não é possível registrar dados.', 'error');
      return;
    }
    this.frame = $('bridgeFrame');
    window.addEventListener('message', event => this.handleMessage(event));
    const url = new URL(SCRIPT_BRIDGE_URL);
    url.searchParams.set('bridge', '1');
    url.searchParams.set('bridgeSession', this.session);
    this.frame.src = url.toString();
    setStatus('Conectando à planilha do Transbordo...');
  },

  handleMessage(event) {
    if (!this.frame || !event.data || event.data[BRIDGE_MARKER] !== true) return;
    let host;
    try { host = new URL(event.origin); } catch (_) { return; }
    if (host.protocol !== 'https:' || !(host.hostname === 'script.google.com' || host.hostname.endsWith('.googleusercontent.com'))) return;
    if (event.data.session !== this.session) return;
    if (event.data.type === 'ready') {
      this.origin = event.origin;
      this.remoteWindow = event.source;
      this.ready = true;
      setStatus('Conectado à planilha do Transbordo.', 'ok');
      this.waiters.splice(0).forEach(waiter => waiter());
      return;
    }
    const pending = this.pending.get(event.data.id);
    if (!pending) return;
    if (event.source !== pending.window) return;
    this.pending.delete(event.data.id);
    clearTimeout(pending.timer);
    if (event.data.error) pending.reject(new Error(String(event.data.error)));
    else pending.resolve(event.data.result);
  },

  async waitUntilReady() {
    if (this.ready) return;
    if (!this.frame) throw new Error('A conexão com a planilha ainda não está configurada.');
    await new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('A conexão demorou para responder. Recarregue a página.')), 45000);
      this.waiters.push(() => { clearTimeout(timer); resolve(); });
    });
  },

  async call(method, args = []) {
    if (!BRIDGE_METHODS.has(method)) throw new Error('Operação não permitida.');
    if (state.demo) return demoCall(method, args);
    await this.waitUntilReady();
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('A operação demorou para responder. Antes de tentar de novo, consulte os registros para evitar duplicidade.'));
      }, method === 'gerarRelatorio' ? 120000 : 90000);
      this.pending.set(id, { resolve, reject, timer, window: this.remoteWindow });
      this.remoteWindow.postMessage({ [BRIDGE_MARKER]: true, session: this.session, id, method, args }, this.origin);
    });
  }
};

function setStatus(message, kind = '') {
  const node = $('systemStatus');
  node.textContent = message;
  node.className = `system-status${kind ? ` ${kind}` : ''}`;
}

let toastTimer;
function toast(message, kind = '') {
  const node = $('toast');
  node.textContent = message;
  node.className = `toast${kind ? ` ${kind}` : ''}`;
  node.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { node.hidden = true; }, 7000);
}

function assertResult(result) {
  if (!result || result.success !== true) throw new Error(String(result?.message || result?.error || 'Não foi possível concluir. Tente novamente.'));
  return result;
}

function clean(value) { return String(value ?? '').trim(); }
function plate(value) { return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function number(value) { const result = Number(value); return Number.isFinite(result) && result >= 0 ? result : 0; }
function formatKg(value) { return `${kgFormat.format(number(value))} kg`; }
function requestIdFor(form, payload) {
  const signature = JSON.stringify(payload);
  if (!form.dataset.clientRequestId || form.dataset.requestSignature !== signature) {
    form.dataset.clientRequestId = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    form.dataset.requestSignature = signature;
  }
  return form.dataset.clientRequestId;
}
function clearRequestId(form) {
  delete form.dataset.clientRequestId;
  delete form.dataset.requestSignature;
}
function formatDateTime(value) {
  if (!value) return 'horário não informado';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? clean(value) : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Fortaleza' }).format(date);
}
function humanDay(value) {
  const text = clean(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : text;
}
function humanPeriodLabel(value) {
  return clean(value).replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, year, month, day) => `${day}/${month}/${year}`)
    .replace(/\b(\d{4})-(\d{2})\b/g, (_, year, month) => `${month}/${year}`);
}
function todayLocal() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function setBusy(button, busy, label) {
  if (busy) {
    button.dataset.normalLabel = button.textContent;
    button.textContent = label || 'Salvando...';
    button.disabled = true;
  } else {
    button.textContent = button.dataset.normalLabel || button.textContent;
    button.disabled = false;
  }
}
function setFormBusy(form, button, busy, label) {
  setBusy(button, busy, label);
  form.querySelectorAll('input, select, textarea').forEach(control => { control.disabled = busy; });
}

function chooseMode(mode, focus = true) {
  state.mode = mode;
  const carretas = mode === 'carretas';
  $('carretasSection').hidden = !carretas;
  $('coletoresSection').hidden = carretas;
  $('chooseCarretas').classList.toggle('active', carretas);
  $('chooseColetores').classList.toggle('active', !carretas);
  $('chooseCarretas').setAttribute('aria-pressed', String(carretas));
  $('chooseColetores').setAttribute('aria-pressed', String(!carretas));
  if (focus) {
    const section = carretas ? $('carretasSection') : $('coletoresSection');
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    section.querySelector('h2').setAttribute('tabindex', '-1');
    section.querySelector('h2').focus({ preventScroll: true });
  }
}

function chooseStep(step) {
  state.step = step;
  const saida = step === 'saida';
  $('saidaPanel').hidden = !saida;
  $('retornoPanel').hidden = saida;
  $('showSaida').classList.toggle('active', saida);
  $('showRetorno').classList.toggle('active', !saida);
  $('showSaida').setAttribute('aria-pressed', String(saida));
  $('showRetorno').setAttribute('aria-pressed', String(!saida));
  if (!saida) refreshBootstrap();
}

function fillDatalist(id, values) {
  const list = $(id);
  list.replaceChildren();
  [...new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')).forEach(value => {
    const option = document.createElement('option');
    option.value = value;
    list.appendChild(option);
  });
}

function tripLabel(trip) {
  return `${plate(trip.placaCarreta)} · saída ${formatDateTime(trip.saidaEm)}${trip.manifesto ? ` · manifesto ${clean(trip.manifesto)}` : ''}`;
}

function renderOpenTrips() {
  const options = [
    { id: 'retornoViagem', first: 'Selecione a saída correspondente' },
    { id: 'coletorViagem', first: 'Não sei a viagem / nenhuma viagem aberta' }
  ];
  for (const config of options) {
    const select = $(config.id);
    const former = select.value;
    select.replaceChildren(new Option(config.first, ''));
    state.openTrips.forEach(trip => select.add(new Option(tripLabel(trip), clean(trip.id))));
    if ([...select.options].some(option => option.value === former)) select.value = former;
  }
  $('retornoViagemHint').textContent = state.openTrips.length
    ? `${state.openTrips.length} saída(s) aguardando retorno. Confira placa e horário.`
    : 'Nenhuma saída em aberto. Registre primeiro a saída da carreta.';
}

async function refreshBootstrap() {
  try {
    const result = assertResult(await bridge.call('getBootstrap'));
    state.openTrips = Array.isArray(result.openTrips) ? result.openTrips : [];
    state.options = result.options || state.options;
    fillDatalist('carretasPlates', state.options.carretasPlates);
    fillDatalist('collectorPlates', state.options.collectorPlates);
    fillDatalist('neighborhoods', state.options.neighborhoods);
    fillDatalist('fiscals', state.options.fiscals);
    renderOpenTrips();
    if (state.demo) setStatus('Demonstração: dados fictícios, nada é gravado.', 'ok');
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

// Peso: separador decimal brasileiro e separador de milhares. Valor com unidade
// visível é convertido para kg antes de enviar. Ambiguidade é evitada na confirmação.
function parseLocaleWeight(raw, unit) {
  let value = clean(raw).replace(/\s/g, '');
  if (!/^\d[\d.,]*$/.test(value)) return NaN;
  const comma = value.lastIndexOf(',');
  const dot = value.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? ',' : '.';
    const grouping = decimal === ',' ? '.' : ',';
    value = value.replaceAll(grouping, '').replace(decimal, '.');
  } else if (comma >= 0) {
    const fragments = value.split(',');
    value = fragments.length === 2 ? value.replace(',', '.') : fragments.slice(1).every(part => part.length === 3) ? value.replaceAll(',', '') : 'INVALID';
  } else if (dot >= 0) {
    const fragments = value.split('.');
    value = fragments.length === 2 && (unit === 't' || fragments[1].length !== 3)
      ? value
      : fragments.slice(1).every(part => part.length === 3) ? value.replaceAll('.', '') : 'INVALID';
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return NaN;
  const kg = unit === 't' ? parsed * 1000 : parsed;
  return Math.round(kg * 1000) / 1000;
}

function updateWeightPreview() {
  const raw = $('retornoPeso').value;
  const unit = $('retornoUnidade').value;
  const kg = parseLocaleWeight(raw, unit);
  $('weightPreview').textContent = Number.isFinite(kg)
    ? `Peso a registrar: ${formatKg(kg)}${kg < 1000 ? ' · Confira se a unidade do comprovante é kg ou t.' : ''}`
    : 'Peso a registrar: —';
}

async function saveSaida(event) {
  event.preventDefault();
  const form = $('saidaForm');
  if (!form.reportValidity()) return;
  const payload = {
    placaCarreta: plate($('saidaPlaca').value),
    manifesto: clean($('saidaManifesto').value),
    fiscal: clean($('saidaFiscal').value),
    observacoes: clean($('saidaObservacoes').value)
  };
  if (!payload.placaCarreta || !payload.fiscal) return toast('Informe a placa e o fiscal.', 'error');
  if (!window.confirm(`Confirmar saída da carreta ${payload.placaCarreta} SEM peso?\nO peso será informado somente no retorno.`)) return;
  payload.clientRequestId = requestIdFor(form, payload);
  const button = $('saveSaida');
  setFormBusy(form, button, true, 'Registrando saída...');
  try {
    assertResult(await bridge.call('registrarSaida', [payload]));
    form.reset();
    clearRequestId(form);
    $('saidaFiscal').value = payload.fiscal;
    toast(`Saída da carreta ${payload.placaCarreta} registrada.`, 'success');
    await refreshBootstrap();
    resetHistory('carretas');
  } catch (error) { toast(error.message, 'error'); }
  finally { setFormBusy(form, button, false); }
}

async function saveRetorno(event) {
  event.preventDefault();
  const form = $('retornoForm');
  if (!form.reportValidity()) return;
  const viagemId = clean($('retornoViagem').value);
  const trip = state.openTrips.find(item => clean(item.id) === viagemId);
  if (!trip) return toast('Selecione uma saída em aberto e confira a placa.', 'error');
  const kg = parseLocaleWeight($('retornoPeso').value, $('retornoUnidade').value);
  if (!Number.isFinite(kg) || kg <= 0) return toast('Informe um peso válido e a unidade do comprovante.', 'error');
  const payload = {
    viagemId,
    pesoKg: kg,
    ticket: clean($('retornoTicket').value),
    fiscal: clean($('retornoFiscal').value),
    observacoes: clean($('retornoObservacoes').value)
  };
  if (!payload.fiscal) return toast('Informe o fiscal responsável.', 'error');
  const originalWeight = `${clean($('retornoPeso').value)} ${$('retornoUnidade').value}`;
  if (!window.confirm(`Confirmar retorno da carreta ${plate(trip.placaCarreta)}?\nPeso digitado: ${originalWeight}\nPeso gravado: ${formatKg(kg)}\nConfira o comprovante antes de continuar.`)) return;
  payload.clientRequestId = requestIdFor(form, payload);
  const button = $('saveRetorno');
  setFormBusy(form, button, true, 'Registrando retorno...');
  try {
    assertResult(await bridge.call('registrarRetorno', [payload]));
    form.reset();
    clearRequestId(form);
    $('retornoFiscal').value = payload.fiscal;
    updateWeightPreview();
    toast(`Retorno de ${plate(trip.placaCarreta)} registrado com ${formatKg(kg)}.`, 'success');
    await refreshBootstrap();
    resetHistory('carretas');
  } catch (error) { toast(error.message, 'error'); }
  finally { setFormBusy(form, button, false); }
}

function syncCollectorTrip() {
  const trip = state.openTrips.find(item => clean(item.id) === clean($('coletorViagem').value));
  if (trip) $('coletorCarreta').value = plate(trip.placaCarreta);
}

async function saveColetor(event) {
  event.preventDefault();
  const form = $('coletorForm');
  if (!form.reportValidity()) return;
  const payload = {
    placaColetor: plate($('coletorPlaca').value),
    bairro: clean($('coletorBairro').value),
    fiscal: clean($('coletorFiscal').value),
    placaCarreta: plate($('coletorCarreta').value),
    viagemId: clean($('coletorViagem').value),
    observacoes: clean($('coletorObservacoes').value)
  };
  if (!payload.placaColetor || !payload.bairro || !payload.fiscal) return toast('Informe placa do coletor, bairro e fiscal.', 'error');
  const trip = state.openTrips.find(item => clean(item.id) === payload.viagemId);
  if (payload.viagemId && !trip) return toast('A viagem selecionada não está mais aberta. Atualize e confira.', 'error');
  if (trip && payload.placaCarreta && payload.placaCarreta !== plate(trip.placaCarreta)) {
    return toast('A placa da carreta não corresponde à viagem selecionada. Corrija antes de salvar.', 'error');
  }
  if (trip) payload.placaCarreta = plate(trip.placaCarreta);
  const relation = payload.placaCarreta ? `Carreta relacionada: ${payload.placaCarreta}${trip ? ' (viagem identificada)' : ' (somente placa)'}.` : 'Sem carreta relacionada.';
  if (!window.confirm(`Registrar coletor ${payload.placaColetor} no bairro ${payload.bairro}?\n${relation}`)) return;
  payload.clientRequestId = requestIdFor(form, payload);
  const button = $('saveColetor');
  setFormBusy(form, button, true, 'Registrando coletor...');
  try {
    assertResult(await bridge.call('registrarColetor', [payload]));
    form.reset();
    clearRequestId(form);
    $('coletorFiscal').value = payload.fiscal;
    toast(`Coletor ${payload.placaColetor} registrado em ${payload.bairro}.`, 'success');
    await refreshBootstrap();
    resetHistory('coletores');
  } catch (error) { toast(error.message, 'error'); }
  finally { setFormBusy(form, button, false); }
}

function resetHistory(tipo) {
  state.history[tipo] = { page: 0, query: clean($(tipo === 'carretas' ? 'carretasSearch' : 'coletoresSearch').value), hasMore: true };
  $(tipo === 'carretas' ? 'carretasHistoryItems' : 'coletoresHistoryItems').replaceChildren();
  if ($(tipo === 'carretas' ? 'carretasHistory' : 'coletoresHistory').open) loadHistory(tipo);
}

function historyCard(item, tipo) {
  const card = document.createElement('article');
  card.className = 'history-item';
  const title = document.createElement('strong');
  const info = document.createElement('p');
  if (item.source === 'legado') {
    title.textContent = 'Registro antigo do Forms · consulta';
    info.textContent = `${clean(item.descricao) || 'Dados antigos sem descrição'} · Não é um lançamento novo deste aplicativo.`;
    card.append(title, info);
    return card;
  }
  if (tipo === 'carretas') {
    const completed = item.status === 'CONCLUIDA' || Boolean(item.retornoEm);
    title.textContent = `${plate(item.placaCarreta) || 'Carreta sem placa'} · ${completed ? 'retorno registrado' : 'aguardando retorno'}`;
    info.textContent = `Saída: ${formatDateTime(item.saidaEm)}${item.retornoEm ? ` · Retorno: ${formatDateTime(item.retornoEm)}` : ''}${item.manifesto ? ` · Manifesto: ${clean(item.manifesto)}` : ''}`;
  } else {
    title.textContent = `${plate(item.placaColetor) || 'Coletor sem placa'} · ${clean(item.bairro) || 'bairro não informado'}`;
    info.textContent = `${formatDateTime(item.registradoEm)}${item.placaCarreta ? ` · Carreta: ${plate(item.placaCarreta)}` : ' · Sem carreta relacionada'}`;
  }
  card.append(title, info);
  return card;
}

async function loadHistory(tipo) {
  const config = state.history[tipo];
  if (!config.hasMore) return;
  const itemsNode = $(tipo === 'carretas' ? 'carretasHistoryItems' : 'coletoresHistoryItems');
  const moreButton = $(tipo === 'carretas' ? 'moreCarretas' : 'moreColetores');
  moreButton.disabled = true;
  try {
    const result = assertResult(await bridge.call('getHistorico', [tipo, config.page + 1, config.query]));
    const rows = Array.isArray(result.items) ? result.items : [];
    if (config.page === 0 && rows.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-note';
      empty.textContent = 'Nenhum registro encontrado.';
      itemsNode.appendChild(empty);
    } else rows.forEach(row => itemsNode.appendChild(historyCard(row, tipo)));
    config.page++;
    config.hasMore = Boolean(result.hasMore);
    moreButton.hidden = !config.hasMore;
  } catch (error) { toast(error.message, 'error'); }
  finally { moreButton.disabled = false; }
}

function toggleReportPeriod() {
  const month = $('reportPeriod').value === 'mes';
  $('reportDateField').hidden = month;
  $('reportMonthField').hidden = !month;
  $('reportDate').required = !month;
  $('reportMonth').required = month;
  clearReportView();
}

function clearReportView() {
  $('reportOutput').hidden = true;
  $('reportOutput').replaceChildren();
  reportMessage('');
}

function reportMessage(message, kind = '') {
  const node = $('reportMessage');
  node.textContent = message;
  node.className = `inline-message${kind ? ` ${kind}` : ''}`;
}

function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = String(value);
  return node;
}

function metric(label, value) {
  const node = element('div', 'metric');
  node.append(element('span', 'label', label), element('strong', '', value));
  return node;
}

function reportSection(title) {
  const section = element('section', 'report-section');
  section.appendChild(element('h4', '', title));
  return section;
}

function reportTable(headers, rows) {
  const wrapper = element('div', 'report-table-wrap');
  const table = element('table', 'report-table');
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  headers.forEach(header => headRow.appendChild(element('th', header.numeric ? 'number' : '', header.label)));
  head.appendChild(headRow);
  const body = document.createElement('tbody');
  if (rows.length) rows.forEach(row => {
    const tr = document.createElement('tr');
    row.forEach((cell, index) => tr.appendChild(element('td', headers[index]?.numeric ? 'number' : '', cell)));
    body.appendChild(tr);
  });
  else {
    const tr = document.createElement('tr');
    const td = element('td', '', 'Sem registros neste período.');
    td.colSpan = headers.length;
    tr.appendChild(td);
    body.appendChild(tr);
  }
  table.append(head, body);
  wrapper.appendChild(table);
  return wrapper;
}

function weightChart(title, rows, labelFn, valueFn) {
  const section = reportSection(title);
  if (!rows.length) {
    section.appendChild(element('p', 'empty-note', 'Sem pesos registrados neste período.'));
    return section;
  }
  const chart = element('div', 'chart');
  chart.setAttribute('role', 'img');
  chart.setAttribute('aria-label', title + ': ' + rows.map(row => `${labelFn(row)} ${formatKg(valueFn(row))}`).join('; '));
  const max = Math.max(1, ...rows.map(row => number(valueFn(row))));
  rows.forEach(row => {
    const line = element('div', 'chart-row');
    const label = element('span', 'chart-label', labelFn(row));
    const track = element('span', 'chart-track');
    const fill = element('span', 'chart-fill');
    fill.style.width = `${Math.max(0, (number(valueFn(row)) / max) * 100)}%`;
    track.appendChild(fill);
    line.append(label, track, element('span', 'chart-value', formatKg(valueFn(row))));
    chart.appendChild(line);
  });
  section.appendChild(chart);
  return section;
}

function renderReport(report, periodo) {
  const root = $('reportOutput');
  root.replaceChildren();
  const header = element('div', 'report-masthead');
  const logo = document.createElement('img');
  logo.src = 'assets/logo-parnamirim.png';
  logo.alt = 'Prefeitura de Parnamirim';
  const headerText = element('div');
  headerText.append(element('h3', '', `Relatório ${periodo === 'mes' ? 'mensal' : 'semanal'} do Transbordo`), element('p', '', humanPeriodLabel(report.periodoLabel) || `${humanDay(report.inicio)} a ${humanDay(report.fim)}`));
  header.append(logo, headerText);
  root.appendChild(header);

  root.appendChild(element('p', 'report-note', 'Nas viagens novas, o peso é contado na data de RETORNO da carreta. Dados antigos dos Forms entram no total apenas quando a conciliação confirma viagem e peso; registros conflitantes ou não conciliados ficam fora. O peso da carreta não é dividido nem atribuído individualmente aos coletores.'));

  const carretas = Array.isArray(report.porCarreta) ? report.porCarreta : [];
  const days = Array.isArray(report.porDia) ? report.porDia : [];
  const collectors = report.coletores || {};
  const sources = report.fontes || {};
  const collectorByTrailer = Array.isArray(collectors.porCarreta) ? collectors.porCarreta : [];
  const collectorByNeighborhood = Array.isArray(collectors.porBairro) ? collectors.porBairro : [];
  const trips = number(report.viagensConcluidas);
  const metrics = element('div', 'metric-grid');
  metrics.append(
    metric('Peso total das carretas', formatKg(report.totalKg)),
    metric('Viagens com retorno', integerFormat.format(trips)),
    metric('Média por viagem', trips ? formatKg(number(report.totalKg) / trips) : '—'),
    metric('Carretas com pesagem', integerFormat.format(carretas.length)),
    metric('Registros de coletores', integerFormat.format(number(collectors.total))),
    metric('Coletores relacionados a carreta', integerFormat.format(number(collectors.vinculados)))
  );
  if (sources.viagensLegadasVerificadas !== undefined || sources.pesoLegadoVerificadoKg !== undefined) {
    metrics.append(
      metric('Viagens novas', integerFormat.format(number(sources.viagensNovas))),
      metric('Viagens antigas verificadas', integerFormat.format(number(sources.viagensLegadasVerificadas))),
      metric('Peso antigo verificado', formatKg(sources.pesoLegadoVerificadoKg))
    );
  }
  if (sources.coletoresNovos !== undefined || sources.coletoresLegados !== undefined) {
    metrics.append(
      metric('Coletores novos', integerFormat.format(number(sources.coletoresNovos))),
      metric('Coletores antigos datados', integerFormat.format(number(sources.coletoresLegados)))
    );
  }
  root.appendChild(metrics);

  const comparison = report.comparativo || {};
  if (comparison.totalAnteriorKg !== undefined) {
    const comparisonSection = reportSection('Comparação com o período anterior');
    const comparisonMetrics = element('div', 'metric-grid');
    const rawDelta = Number(comparison.diferencaKg);
    const delta = Number.isFinite(rawDelta) ? rawDelta : 0;
    const variation = comparison.variacaoPercentual === null || comparison.variacaoPercentual === undefined
      ? 'Sem base anterior'
      : `${delta > 0 ? '+' : ''}${percentFormat.format(Number(comparison.variacaoPercentual))}%`;
    comparisonMetrics.append(
      metric(humanPeriodLabel(comparison.periodoAnteriorLabel) || 'Período anterior', formatKg(comparison.totalAnteriorKg)),
      metric('Diferença de peso', `${delta > 0 ? '+' : ''}${kgFormat.format(delta)} kg`),
      metric('Variação', variation)
    );
    comparisonSection.appendChild(comparisonMetrics);
    root.appendChild(comparisonSection);
  }

  root.appendChild(weightChart('Peso por carreta', carretas, row => plate(row.placa), row => row.pesoKg));
  root.appendChild(weightChart('Peso por dia de retorno', days, row => humanDay(row.dia), row => row.pesoKg));

  const trailerSection = reportSection('Totais de cada carreta');
  trailerSection.appendChild(reportTable([
    { label: 'Carreta' }, { label: 'Viagens', numeric: true }, { label: 'Peso total', numeric: true }, { label: 'Média por viagem', numeric: true }
  ], carretas.map(row => [plate(row.placa), integerFormat.format(number(row.viagens)), formatKg(row.pesoKg), number(row.viagens) ? formatKg(number(row.pesoKg) / number(row.viagens)) : '—'])));
  root.appendChild(trailerSection);

  const relationSection = reportSection('Relação entre carretas e coletores');
  relationSection.appendChild(element('p', 'report-note', 'A quantidade de registros de coletores vinculados aparece ao lado do peso total da carreta no período. Isso mostra a relação operacional, mas NÃO significa que cada coletor transportou uma fração desse peso. Quando há apenas placa e não uma viagem identificada, a relação é por placa e período. Os registros antigos de coletores contam no total quando a data é válida, mas não recebem vínculo de carreta automaticamente.'));
  relationSection.appendChild(reportTable([
    { label: 'Carreta' }, { label: 'Registros de coletores relacionados', numeric: true }, { label: 'Peso total da carreta', numeric: true }
  ], collectorByTrailer.map(row => [plate(row.placaCarreta), integerFormat.format(number(row.registros)), formatKg(row.pesoKg)])));
  root.appendChild(relationSection);

  const neighborhoodSection = reportSection('Coletores por bairro');
  neighborhoodSection.appendChild(reportTable([
    { label: 'Bairro' }, { label: 'Registros', numeric: true }
  ], collectorByNeighborhood.map(row => [clean(row.bairro), integerFormat.format(number(row.registros))])));
  root.appendChild(neighborhoodSection);

  const quality = report.qualidade || {};
  const qualitySection = reportSection('Conferência dos dados');
  const chips = element('div', 'report-quality');
  chips.append(
    element('span', 'quality-chip', `Viagens em aberto agora: ${integerFormat.format(number(quality.viagensEmAberto))}`),
    element('span', 'quality-chip', `Coletores sem vínculo de carreta: ${integerFormat.format(number(quality.coletoresSemVinculo ?? collectors.semVinculo))}`),
    element('span', 'quality-chip', `Registros legados não conciliados na base: ${integerFormat.format(number(quality.legadoNaoConciliado))}`)
  );
  if (collectors.vinculadosViagem !== undefined) chips.appendChild(element('span', 'quality-chip', `Coletores com viagem exata: ${integerFormat.format(number(collectors.vinculadosViagem))}`));
  if (quality.coletoresLegadosSemData !== undefined) chips.appendChild(element('span', 'quality-chip', `Coletores antigos sem data válida na base: ${integerFormat.format(number(quality.coletoresLegadosSemData))}`));
  qualitySection.appendChild(chips);
  root.appendChild(qualitySection);

  const printButton = element('button', 'secondary-button', 'Imprimir / salvar PDF');
  printButton.type = 'button';
  printButton.addEventListener('click', () => window.print());
  root.appendChild(printButton);
  root.hidden = false;
}

async function generateReport(event) {
  event.preventDefault();
  const form = $('reportForm');
  if (!form.reportValidity()) return;
  const periodo = $('reportPeriod').value;
  const referencia = periodo === 'mes' ? $('reportMonth').value : $('reportDate').value;
  const senha = $('reportPassword').value;
  if (!referencia || !senha) return reportMessage('Escolha o período e informe a senha.', 'error');
  const button = $('generateReport');
  setBusy(button, true, 'Calculando relatório...');
  reportMessage('Calculando pesos e vínculos...');
  try {
    const response = assertResult(await bridge.call('gerarRelatorio', [{ senha, periodo, referencia }]));
    $('reportPassword').value = '';
    renderReport(response.report || {}, periodo);
    reportMessage('Relatório gerado.', 'success');
  } catch (error) {
    $('reportOutput').hidden = true;
    reportMessage(error.message, 'error');
  } finally { setBusy(button, false); }
}

async function changePassword(event) {
  event.preventDefault();
  const form = $('changePasswordForm');
  if (!form.reportValidity()) return;
  const senhaAtual = $('currentPassword').value;
  const novaSenha = $('newPassword').value;
  if (novaSenha.length < 6) return reportMessage('A nova senha precisa ter pelo menos 6 caracteres.', 'error');
  const button = $('changePasswordButton');
  setBusy(button, true, 'Salvando senha...');
  try {
    assertResult(await bridge.call('alterarSenhaRelatorio', [{ senhaAtual, novaSenha }]));
    form.reset();
    $('changePasswordDetails').open = false;
    reportMessage(state.demo ? 'Demonstração: alteração simulada, sem salvar.' : 'Senha alterada. Use a nova senha no próximo relatório.', 'success');
  } catch (error) { reportMessage(error.message, 'error'); }
  finally { setBusy(button, false); }
}

function init() {
  $('reportDate').value = todayLocal();
  $('reportMonth').value = todayLocal().slice(0, 7);
  $('chooseCarretas').addEventListener('click', () => chooseMode('carretas'));
  $('chooseColetores').addEventListener('click', () => chooseMode('coletores'));
  $('showSaida').addEventListener('click', () => chooseStep('saida'));
  $('showRetorno').addEventListener('click', () => chooseStep('retorno'));
  $('saidaForm').addEventListener('submit', saveSaida);
  $('retornoForm').addEventListener('submit', saveRetorno);
  $('coletorForm').addEventListener('submit', saveColetor);
  $('retornoPeso').addEventListener('input', updateWeightPreview);
  $('retornoUnidade').addEventListener('change', updateWeightPreview);
  $('coletorViagem').addEventListener('change', syncCollectorTrip);
  ['saidaPlaca', 'coletorPlaca', 'coletorCarreta'].forEach(id => $(id).addEventListener('blur', () => { $(id).value = plate($(id).value); }));
  $('carretasHistory').addEventListener('toggle', () => { if ($('carretasHistory').open && state.history.carretas.page === 0) loadHistory('carretas'); });
  $('coletoresHistory').addEventListener('toggle', () => { if ($('coletoresHistory').open && state.history.coletores.page === 0) loadHistory('coletores'); });
  $('searchCarretas').addEventListener('click', () => resetHistory('carretas'));
  $('searchColetores').addEventListener('click', () => resetHistory('coletores'));
  $('carretasSearch').addEventListener('keydown', event => { if (event.key === 'Enter') resetHistory('carretas'); });
  $('coletoresSearch').addEventListener('keydown', event => { if (event.key === 'Enter') resetHistory('coletores'); });
  $('moreCarretas').addEventListener('click', () => loadHistory('carretas'));
  $('moreColetores').addEventListener('click', () => loadHistory('coletores'));
  $('openReport').addEventListener('click', () => { $('reportDialog').showModal(); $('reportPassword').focus(); });
  $('closeReport').addEventListener('click', () => $('reportDialog').close());
  $('reportDialog').addEventListener('close', () => {
    $('reportPassword').value = '';
    $('currentPassword').value = '';
    $('newPassword').value = '';
    $('changePasswordDetails').open = false;
    clearReportView();
  });
  $('reportPeriod').addEventListener('change', toggleReportPeriod);
  $('reportDate').addEventListener('change', clearReportView);
  $('reportMonth').addEventListener('change', clearReportView);
  $('reportForm').addEventListener('submit', generateReport);
  $('changePasswordForm').addEventListener('submit', changePassword);
  bridge.init();
  refreshBootstrap();
}

const demo = {
  openTrips: [{ id: 'DEMO-01', placaCarreta: 'QGB1A23', manifesto: 'M-2026-001', saidaEm: new Date().toISOString(), fiscal: 'Maria' }],
  trips: [],
  collectors: []
};

async function demoCall(method, args) {
  await new Promise(resolve => window.setTimeout(resolve, 180));
  if (method === 'getBootstrap') return {
    success: true,
    openTrips: demo.openTrips.map(trip => ({ ...trip })),
    options: {
      carretasPlates: ['QGB1A23', 'QGX2B34', ...demo.openTrips.map(trip => trip.placaCarreta)],
      collectorPlates: ['QGK3C45', 'QGM4D56'],
      neighborhoods: ['Centro', 'Cohabinal', 'Nova Esperança', 'Rosa dos Ventos'],
      fiscals: ['Maria', 'José']
    }
  };
  if (method === 'registrarSaida') {
    const record = { ...args[0], id: `DEMO-${Date.now()}`, saidaEm: new Date().toISOString() };
    demo.openTrips.unshift(record);
    return { success: true, id: record.id };
  }
  if (method === 'registrarRetorno') {
    const index = demo.openTrips.findIndex(trip => trip.id === args[0].viagemId);
    if (index < 0) return { success: false, message: 'Viagem não encontrada.' };
    const [trip] = demo.openTrips.splice(index, 1);
    demo.trips.unshift({ ...trip, ...args[0], retornoEm: new Date().toISOString() });
    return { success: true, id: trip.id };
  }
  if (method === 'registrarColetor') {
    const record = { ...args[0], id: `COL-${Date.now()}`, criadoEm: new Date().toISOString() };
    demo.collectors.unshift(record);
    return { success: true, id: record.id };
  }
  if (method === 'getHistorico') {
    const [tipo, page, query] = args;
    const all = tipo === 'carretas' ? [...demo.openTrips, ...demo.trips] : demo.collectors;
    const filtered = all.filter(row => JSON.stringify(row).toLocaleLowerCase('pt-BR').includes(clean(query).toLocaleLowerCase('pt-BR')));
    const start = (page - 1) * 15;
    return { success: true, items: filtered.slice(start, start + 15), hasMore: start + 15 < filtered.length };
  }
  if (method === 'gerarRelatorio') {
    const input = args[0];
    if (!input.senha) return { success: false, message: 'Informe uma senha para testar a tela.' };
    const returned = demo.trips.reduce((sum, trip) => sum + number(trip.pesoKg), 0);
    const demoKg = returned || 57200;
    return { success: true, report: {
      periodoLabel: input.periodo === 'mes' ? 'Mês selecionado · exemplo fictício' : 'Semana selecionada · exemplo fictício',
      totalKg: demoKg, viagensConcluidas: demo.trips.length || 3,
      porCarreta: [{ placa: 'QGB1A23', pesoKg: returned || 38200, viagens: demo.trips.length || 2 }, { placa: 'QGX2B34', pesoKg: returned ? 0 : 19000, viagens: returned ? 0 : 1 }],
      porDia: [{ dia: 'Segunda', pesoKg: returned || 38200 }, { dia: 'Terça', pesoKg: returned ? 0 : 19000 }],
      coletores: { total: demo.collectors.length || 5, vinculados: demo.collectors.filter(row => row.placaCarreta).length || 3, semVinculo: demo.collectors.filter(row => !row.placaCarreta).length || 2,
        porBairro: [{ bairro: 'Centro', registros: 3 }, { bairro: 'Nova Esperança', registros: 2 }],
        porCarreta: [{ placaCarreta: 'QGB1A23', registros: 3, pesoKg: returned || 38200 }] },
      qualidade: { viagensEmAberto: demo.openTrips.length, coletoresSemVinculo: 2, legadoNaoConciliado: 0 }
    } };
  }
  if (method === 'alterarSenhaRelatorio') return { success: true };
  return { success: false, message: 'Operação não disponível na demonstração.' };
}

document.addEventListener('DOMContentLoaded', init);
