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
  const templates = [];
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
    HtmlService: {
      XFrameOptionsMode: {ALLOWALL: 'ALLOWALL'},
      createTemplateFromFile(name) {
        const template = {
          name,
          evaluate() {
            return {setTitle() {return this;}, setXFrameOptionsMode() {return this;}};
          }
        };
        templates.push(template);
        return template;
      }
    },
    LockService: {getScriptLock() {return {tryLock() {return true;}, releaseLock() {}};}},
    PropertiesService: {getScriptProperties() {return {
      getProperty(key) {return properties.get(key) || null;},
      setProperties(values) {Object.entries(values).forEach(([k, v]) => properties.set(k, v));},
      deleteProperty(key) {properties.delete(key);}
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
    'globalThis.__api = {doGet,setupTransbordo,getBootstrap,getHistorico,registrarSaida,registrarRetorno,registrarColetor,gerarRelatorio,alterarSenhaRelatorio,aggregateReport_,reportPeriod_,precisePeso_,parseLegacyCollectors_};', context);
  properties.set('REPORT_PASSWORD_SALT', 'unit-test-salt');
  properties.set('REPORT_PASSWORD_HASH', crypto.createHash('sha256').update('unit-test-salt:310186').digest('hex'));
  return {api: context.__api, books, properties, templates};
}

test('doGet recusa sessão com HTML e aceita UUID e sessão alternativa', () => {
  const {api, templates} = makeRuntime();
  assert.throws(() => api.doGet({parameter:{bridgeSession:'</script><script>alert(1)</script>'}}), /Sessão de conexão inválida/);
  assert.equal(templates.length, 0);
  const uuid = '0a4cdf9e-9e73-48c0-b655-2c3f256a2b1a';
  api.doGet({parameter:{bridgeSession:uuid}});
  assert.equal(templates[0].bridgeSession, uuid);
  const fallback = '1727090000000-abc123def';
  api.doGet({parameter:{bridgeSession:fallback}});
  assert.equal(templates[1].bridgeSession, fallback);
  api.doGet();
  assert.equal(templates[2].bridgeSession, '');
});

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

test('bootstrap público mostra somente dados necessários das saídas abertas', () => {
  const {api} = makeRuntime();
  api.setupTransbordo();
  const saved = api.registrarSaida({
    placaCarreta:'ABC1D23', manifesto:'0019001', fiscal:'Fiscal reservado',
    observacoes:'Observação reservada'
  }).viagem;
  assert.equal(saved.fiscalSaida, 'Fiscal reservado');
  assert.equal(saved.observacoesSaida, 'Observação reservada');
  const open = api.getBootstrap().openTrips[0];
  assert.equal(open.id, saved.id);
  assert.equal(open.placaCarreta, 'ABC1D23');
  assert.equal(open.manifesto, '0019001');
  assert.ok(open.saidaEm);
  assert.equal(open.fiscalSaida, undefined);
  assert.equal(open.observacoesSaida, undefined);
  assert.equal(open.pesoKg, undefined);
});

test('campos livres são gravados como texto, sem executar fórmulas na planilha', () => {
  const {api, books} = makeRuntime();
  api.setupTransbordo();
  const trip = api.registrarSaida({
    placaCarreta:'ABC1D23', manifesto:'=1+1', fiscal:'+1+1', observacoes:'-1+1'
  }).viagem;
  const book = books.get('1zrrpnGf05A_7aAhvTis9DKYZZqlad5onXpwSSvAZyOM');
  const viagens = book.getSheetByName('Viagens_Carretas');
  assert.equal(viagens.rows[1][3], "'=1+1");
  assert.equal(viagens.rows[1][4], "'+1+1");
  assert.equal(viagens.rows[1][5], "'-1+1");

  api.registrarRetorno({
    viagemId:trip.id, pesoKg:18500, ticket:'@SUM(1)', fiscal:'=2+2', observacoes:'+2+2'
  });
  assert.equal(viagens.rows[1][8], 18500);
  assert.equal(viagens.rows[1][9], "'@SUM(1)");
  assert.equal(viagens.rows[1][10], "'=2+2");
  assert.equal(viagens.rows[1][11], "'+2+2");
  assert.equal(viagens.rows[1][3], "'=1+1");

  api.registrarColetor({
    placaColetor:'XYZ9Z99', bairro:'=3+3', fiscal:'-3+3', observacoes:'@SUM(3)'
  });
  const coletores = book.getSheetByName('Registros_Coletores');
  assert.equal(coletores.rows[1][3], "'=3+3");
  assert.equal(coletores.rows[1][4], "'-3+3");
  assert.equal(coletores.rows[1][7], "'@SUM(3)");
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
  const trips = [{id:'a',status:'CONCLUIDA',placaCarreta:'ABC1D23',manifesto:'0019001',retornoEm:'2026-09-23T12:00:00-03:00',pesoKg:20000}];
  const collectors = [
    {id:'c1',registradoEm:'2026-09-22T12:00:00-03:00',bairro:'Centro',placaCarreta:'ABC1D23',viagemId:'a'},
    {id:'c2',registradoEm:'2026-09-23T13:00:00-03:00',bairro:'Centro',placaCarreta:'',viagemId:'',source:'legado'}
  ];
  const report = api.aggregateReport_(events,trips,collectors,period,{},0);
  assert.equal(report.coletores.total,2);
  assert.equal(report.coletores.vinculados,1);
  assert.equal(report.coletores.semVinculo,1);
  assert.equal(report.coletores.porViagem.length,1);
  assert.equal(report.coletores.porViagem[0].viagemId,'a');
  assert.equal(report.coletores.porViagem[0].registros,1);
  assert.equal(report.coletores.porViagem[0].pesoKg,20000);
  assert.equal(report.coletores.porPlacaSemViagem.length,0);
  assert.match(report.avisoRelacao,/sem divisão/);
});

test('vínculo exato entra na semana do retorno e peso aparece uma vez por viagem', () => {
  const {api} = makeRuntime();
  const firstWeek = api.reportPeriod_('semana','2026-09-27');
  const nextWeek = api.reportPeriod_('semana','2026-09-28');
  const trips = [
    {id:'t1',status:'CONCLUIDA',placaCarreta:'ABC1D23',manifesto:'0019001',retornoEm:'2026-09-28T00:10:00-03:00',pesoKg:20000},
    {id:'t2',status:'CONCLUIDA',placaCarreta:'ABC1D23',manifesto:'0019002',retornoEm:'2026-09-29T10:00:00-03:00',pesoKg:25000},
    {id:'t3',status:'EM_VIAGEM',placaCarreta:'XYZ9Z99',manifesto:'0019003',retornoEm:'',pesoKg:''}
  ];
  const events = trips.slice(0,2).map(trip => ({
    id:trip.id, placaCarreta:trip.placaCarreta, retornoEm:trip.retornoEm,
    pesoKg:trip.pesoKg, source:'novo'
  }));
  const collectors = [
    {id:'c1',registradoEm:'2026-09-27T23:50:00-03:00',bairro:'Centro',placaCarreta:'ABC1D23',viagemId:'t1'},
    {id:'c2',registradoEm:'2026-09-27T23:55:00-03:00',bairro:'Centro',placaCarreta:'ABC1D23',viagemId:'t1'},
    {id:'c3',registradoEm:'2026-09-28T08:00:00-03:00',bairro:'Bosque',placaCarreta:'ABC1D23',viagemId:''},
    {id:'c4',registradoEm:'2026-09-28T09:00:00-03:00',bairro:'Bosque',placaCarreta:'',viagemId:'',source:'legado'},
    {id:'c5',registradoEm:'2026-09-28T10:00:00-03:00',bairro:'Centro',placaCarreta:'XYZ9Z99',viagemId:'t3'},
    {id:'c6',registradoEm:'2026-09-28T11:00:00-03:00',bairro:'Centro',placaCarreta:'XYZ9Z99',viagemId:'missing'}
  ];
  const before = api.aggregateReport_(events,trips,collectors,firstWeek,{},0);
  assert.equal(before.coletores.total,2);
  assert.equal(before.coletores.vinculados,2);
  assert.equal(before.coletores.porViagem.length,0);

  const after = api.aggregateReport_(events,trips,collectors,nextWeek,{},0);
  assert.equal(after.totalKg,45000);
  assert.equal(after.coletores.total,4);
  assert.equal(after.coletores.vinculados,3);
  assert.equal(after.coletores.semVinculo,1);
  assert.equal(after.coletores.porViagem.length,1);
  assert.equal(after.coletores.porViagem[0].viagemId,'t1');
  assert.equal(after.coletores.porViagem[0].registros,2);
  assert.equal(after.coletores.porViagem[0].pesoKg,20000);
  assert.equal(after.coletores.porPlacaSemViagem.length,1);
  assert.equal(after.coletores.porPlacaSemViagem[0].placaCarreta,'ABC1D23');
  assert.equal(after.coletores.porPlacaSemViagem[0].registros,1);
});

test('vínculo exato cruza o mês sem deslocar totais de atividade', () => {
  const {api} = makeRuntime();
  const trips = [{id:'t1',status:'CONCLUIDA',placaCarreta:'ABC1D23',manifesto:'0019001',retornoEm:'2026-10-01T00:05:00-03:00',pesoKg:18000}];
  const events = [{id:'t1',placaCarreta:'ABC1D23',retornoEm:trips[0].retornoEm,pesoKg:18000,source:'novo'}];
  const collectors = [{id:'c1',registradoEm:'2026-09-30T23:45:00-03:00',bairro:'Centro',placaCarreta:'ABC1D23',viagemId:'t1'}];
  const september = api.aggregateReport_(events,trips,collectors,api.reportPeriod_('mes','2026-09'),{},0);
  const october = api.aggregateReport_(events,trips,collectors,api.reportPeriod_('mes','2026-10'),{},0);
  assert.equal(september.coletores.total,1);
  assert.equal(september.coletores.porViagem.length,0);
  assert.equal(september.totalKg,0);
  assert.equal(october.coletores.total,0);
  assert.equal(october.coletores.semVinculo,0);
  assert.equal(october.totalKg,18000);
  assert.equal(october.coletores.porViagem[0].registros,1);
  assert.equal(october.coletores.porViagem[0].pesoKg,18000);
});

test('coletores legados filtram testes nas observações e recuperam bairro e placa explícitos', () => {
  const {api} = makeRuntime();
  const rows = [
    ['Carimbo de data/hora', 'PLACA', 'ORIGEM', 'Observação outras origens:', 'Nome do Fiscal:', 'Observação outras placas:'],
    ['22/11/2025 22:54:54', 'TTG9H78 (257)', 'Cajupiranga', 'teste', '', ''],
    ['27/11/2025 08:34:17', 'TTG9H78 (257)', 'Bosque', 'TEST', 'Fiscal', ''],
    ['05/12/2025 10:22:37', 'JCX2A75 (229)', '', 'teste origens', 'Fiscal', 'teste placa'],
    ['12/09/2026 15:44:51', 'TUA1D18 (266)', 'Nova Parnamirim', 'Teste ao vivo de sincronismo', 'Fiscal', ''],
    ['23/09/2026 08:00:00', 'TTQ1D28 (263)', '', 'Vida nova', 'Fiscal Teste', ''],
    ['23/09/2026 08:01:00', '', 'Teste da Vila', '', 'Fiscal', 'Elu 1B42 (291)'],
    ['23/09/2026 08:02:00', '', 'Bosque', '', 'Fiscal', 'Placa digitada: 291'],
    ['23/09/2026 08:03:00', '', 'Bosque', '', 'Fiscal', 'ELU1B42 e TTG9H78'],
    ['23/09/2026 08:04:00', 'JCX2A75 (229)', 'Centro', '', 'Fiscal', 'ELU1B42'],
    ['data inválida', 'TTQ1D28 (263)', 'Centro', '', 'Fiscal', '']
  ];
  const parsed = api.parseLegacyCollectors_(rows);
  assert.equal(parsed.invalidDates, 1);
  assert.equal(parsed.records.length, 5);
  assert.equal(parsed.records.map(row => row.id).join(','),
    'legado-coletor-6,legado-coletor-7,legado-coletor-8,legado-coletor-9,legado-coletor-10');
  assert.equal(parsed.records[0].bairro, 'Vida nova');
  assert.equal(parsed.records[0].fiscal, 'Fiscal Teste');
  assert.equal(parsed.records[1].bairro, 'Teste da Vila');
  assert.equal(parsed.records[1].placaColetor, 'ELU1B42');
  assert.equal(parsed.records[2].placaColetor, '');
  assert.equal(parsed.records[3].placaColetor, '');
  assert.equal(parsed.records[4].placaColetor, 'JCX2A75 (229)');
});

test('histórico de coletores aplica os mesmos filtros e campos recuperados do relatório', () => {
  const {api, books} = makeRuntime();
  api.setupTransbordo();
  api.getHistorico('coletores', 1, '');
  const book = books.get('1EwM6Cqf30MMbPTtTlfz2dwNFUppT_Y9HHPRuNzluUCU');
  const sheet = book.insertSheet('Respostas ao formulário 1');
  sheet.appendRow(['Carimbo de data/hora', 'PLACA', 'ORIGEM', 'Observação outras origens:', 'Nome do Fiscal:', 'Observação outras placas:']);
  sheet.appendRow(['22/11/2025 22:54:54', 'TTG9H78 (257)', 'Cajupiranga', 'teste', '', '']);
  sheet.appendRow(['23/09/2026 08:00:00', 'TTQ1D28 (263)', '', 'Vida nova', 'Fiscal', '']);
  sheet.appendRow(['23/09/2026 08:01:00', '', 'Bosque', '', 'Fiscal', 'Elu 1B42 (291)']);
  sheet.appendRow(['23/09/2026 08:02:00', 'JCX2A75 (229)', 'Centro', '', 'Fiscal', 'TEST']);
  sheet.appendRow(['23/09/2026 08:03:00', '', 'Bosque', '', 'Fiscal', 'Placa digitada: 291']);

  const history = api.getHistorico('coletores', 1, '');
  assert.equal(history.total, 3);
  assert.equal(history.items.map(item => item.id).join(','),
    'legado-coletores-6,legado-coletores-4,legado-coletores-3');
  assert.match(history.items[0].descricao, /placa não informada · Bairro: Bosque/);
  assert.match(history.items[1].descricao, /ELU1B42 · Bairro: Bosque/);
  assert.match(history.items[2].descricao, /TTQ1D28 \(263\) · Bairro: Vida nova/);
  assert.equal(api.getHistorico('coletores', 1, 'ELU1B42').total, 1);
  assert.equal(api.getHistorico('coletores', 1, 'teste').total, 0);
});

test('senha incorreta não libera relatório e pode ser trocada', () => {
  const {api} = makeRuntime();
  assert.throws(() => api.gerarRelatorio({senha:'errada',periodo:'mes',referencia:'2026-09'}),/Senha incorreta/);
  assert.equal(api.alterarSenhaRelatorio({senhaAtual:'310186',novaSenha:'nova-senha-forte'}).success,true);
  assert.throws(() => api.gerarRelatorio({senha:'310186',periodo:'mes',referencia:'2026-09'}),/Senha incorreta/);
});

test('senha inicial privada migra para hash após primeiro uso correto', () => {
  const {api,properties} = makeRuntime();
  properties.delete('REPORT_PASSWORD_SALT');
  properties.delete('REPORT_PASSWORD_HASH');
  properties.set('REPORT_PASSWORD_INITIAL','310186');
  assert.throws(() => api.gerarRelatorio({senha:'errada',periodo:'mes',referencia:'2026-09'}),/Senha incorreta/);
  assert.equal(properties.get('REPORT_PASSWORD_INITIAL'),'310186');
  const result = api.gerarRelatorio({senha:'310186',periodo:'mes',referencia:'2026-09'});
  assert.equal(result.success,true);
  assert.equal(properties.has('REPORT_PASSWORD_INITIAL'),false);
  assert.ok(properties.get('REPORT_PASSWORD_HASH'));
});
