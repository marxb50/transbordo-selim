const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const path = require('node:path');

function makeRuntime() {
  const script = fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8');
  const legacy = fs.readFileSync(path.join(__dirname, 'Legacy.gs'), 'utf8');
  const books = new Map();
  const properties = new Map();
  let nextId = 0;
  class Sheet {
    constructor(name) { this.name = name; this.rows = []; }
    getLastRow() { return this.rows.length; }
    getRange(row, col, height, width) {
      const sheet = this;
      return {
        getValues() {
          return Array.from({length: height}, (_, ri) => Array.from({length: width}, (_, ci) =>
            (sheet.rows[row - 1 + ri] || [])[col - 1 + ci] ?? ''));
        },
        getDisplayValues() { return this.getValues().map(r => r.map(String)); },
        setValues(values) {
          values.forEach((cells, ri) => {
            const index = row - 1 + ri;
            sheet.rows[index] = sheet.rows[index] || [];
            cells.forEach((cell, ci) => { sheet.rows[index][col - 1 + ci] = cell; });
          });
          return this;
        },
        setBackground() { return this; }, setFontColor() { return this; },
        setFontWeight() { return this; }
      };
    }
    appendRow(cells) { this.rows.push(cells); }
    setFrozenRows() {}
    getDataRange() { return this.getRange(1, 1, this.rows.length, Math.max(1, ...this.rows.map(r => r.length))); }
  }
  class Book {
    constructor() { this.sheets = new Map(); }
    getSheetByName(name) { return this.sheets.get(name) || null; }
    insertSheet(name) { const sheet = new Sheet(name); this.sheets.set(name, sheet); return sheet; }
  }
  const context = vm.createContext({
    Date, Number, String, Object, Array, RegExp, Math,
    SpreadsheetApp: {
      openById(id) { if (!books.has(id)) books.set(id, new Book()); return books.get(id); }
    },
    LockService: {getScriptLock() {return {tryLock() {return true;}, releaseLock() {}};}},
    PropertiesService: {getScriptProperties() {return {
      getProperty(key) {return properties.get(key) || null;},
      setProperties(values) {Object.entries(values).forEach(([k, v]) => properties.set(k, v));}
    };}},
    Utilities: {
      getUuid() {return `test-uuid-${++nextId}`;},
      formatDate(date, zone, pattern) {
        assert.equal(zone, 'America/Fortaleza');
        assert.equal(pattern, 'yyyy-MM-dd');
        return new Intl.DateTimeFormat('en-CA', {
          timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'
        }).format(date);
      },
      DigestAlgorithm: {SHA_256: 'sha256'}, Charset: {UTF_8: 'utf8'},
      computeDigest(_, text) { return Array.from(crypto.createHash('sha256').update(text).digest()); }
    }
  });
  vm.runInContext(script + '\n' + legacy + '\n' +
    'globalThis.__api = {setupTransbordo,getBootstrap,registrarSaida,registrarRetorno,registrarColetor,gerarRelatorio,alterarSenhaRelatorio,aggregateReport_,reportPeriod_,precisePeso_};', context);
  properties.set('REPORT_PASSWORD_SALT', 'unit-test-salt');
  properties.set('REPORT_PASSWORD_HASH', crypto.createHash('sha256').update('unit-test-salt:310186').digest('hex'));
  return {api: context.__api, books, properties};
}

test('saída e retorno são vinculados, e pedidos repetidos não duplicam peso', () => {
  const {api} = makeRuntime();
  api.setupTransbordo();
  const first = api.registrarSaida({placaCarreta:'ABC1D23', fiscal:'Fiscal', manifesto:'0019001', clientRequestId:'request-saida-01'});
  assert.equal(first.viagem.status, 'EM_VIAGEM');
  assert.equal(api.registrarSaida({placaCarreta:'ABC1D23', fiscal:'Fiscal', clientRequestId:'request-saida-01'}).repetido, true);
  assert.throws(() => api.registrarSaida({placaCarreta:'ABC1D23', fiscal:'Fiscal', clientRequestId:'request-saida-02'}), /já tem uma saída aberta/);
  const closed = api.registrarRetorno({viagemId:first.viagem.id,pesoKg:18500.125,fiscal:'Fiscal',clientRequestId:'request-retorno-01'});
  assert.equal(closed.viagem.pesoKg, 18500.125);
  assert.equal(api.registrarRetorno({viagemId:first.viagem.id,pesoKg:18500.125,fiscal:'Fiscal',clientRequestId:'request-retorno-01'}).repetido, true);
  assert.throws(() => api.registrarRetorno({viagemId:first.viagem.id,pesoKg:18500.125,fiscal:'Fiscal',clientRequestId:'request-retorno-02'}), /já possui retorno/);
});

test('relatório semanal soma cada viagem uma vez, por data de retorno', () => {
  const {api} = makeRuntime();
  const period = api.reportPeriod_('semana','2026-09-23');
  assert.equal(period.start,'2026-09-21');
  assert.equal(period.end,'2026-09-27');
  const events = [
    {id:'a',placaCarreta:'ABC1D23',retornoEm:'2026-09-20T23:50:00-03:00',pesoKg:10000,source:'novo'},
    {id:'b',placaCarreta:'ABC1D23',retornoEm:'2026-09-21T00:10:00-03:00',pesoKg:18000.125,source:'novo'},
    {id:'c',placaCarreta:'XYZ9Z99',retornoEm:'2026-09-23T12:00:00-03:00',pesoKg:25000,source:'legado'}
  ];
  const report = api.aggregateReport_(events,[],[],period,{unparsedWeightRows:3},0);
  assert.equal(report.totalKg,43000.125);
  assert.equal(report.viagensConcluidas,2);
  assert.equal(report.comparativo.totalAnteriorKg,10000);
  assert.equal(report.porCarreta.length,2);
  assert.equal(report.fontes.viagensLegadasVerificadas,1);
  assert.equal(report.qualidade.legadoNaoConciliado,3);
});

test('coletor só é ligado por placa/viagem explícita, sem alocar peso individual', () => {
  const {api} = makeRuntime();
  const period = api.reportPeriod_('mes','2026-09');
  const events = [{id:'a',placaCarreta:'ABC1D23',retornoEm:'2026-09-23T12:00:00-03:00',pesoKg:20000,source:'novo'}];
  const collectors = [
    {id:'c1',registradoEm:'2026-09-22T12:00:00-03:00',bairro:'Centro',placaCarreta:'ABC1D23',viagemId:'a'},
    {id:'c2',registradoEm:'2026-09-23T13:00:00-03:00',bairro:'Centro',placaCarreta:'',viagemId:'',source:'legado'}
  ];
  const report = api.aggregateReport_(events,[],collectors,period,{},0);
  assert.equal(report.coletores.total,2);
  assert.equal(report.coletores.vinculados,1);
  assert.equal(report.coletores.semVinculo,1);
  assert.equal(report.coletores.porCarreta[0].pesoKg,20000);
  assert.match(report.avisoRelacao,/não representam divisão/);
});

test('senha incorreta não libera relatório e pode ser trocada', () => {
  const {api} = makeRuntime();
  assert.throws(() => api.gerarRelatorio({senha:'errada',periodo:'mes',referencia:'2026-09'}),/Senha incorreta/);
  assert.equal(api.alterarSenhaRelatorio({senhaAtual:'310186',novaSenha:'nova-senha-forte'}).success,true);
  assert.throws(() => api.gerarRelatorio({senha:'310186',periodo:'mes',referencia:'2026-09'}),/Senha incorreta/);
});
