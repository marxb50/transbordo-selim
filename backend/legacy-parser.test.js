const test = require('node:test');
const assert = require('node:assert/strict');
const {parseLegacyCarretas} = require('./Legacy.gs');

const header = ['Carimbo de data/hora'];
function row(date, cells = {}) {
  const result = Array(23).fill('');
  result[0] = date;
  for (const [col, value] of Object.entries(cells)) result[Number(col)] = value;
  return result;
}
function parse(...records) { return parseLegacyCarretas([header, ...records]); }

test('counts a return once, on its submission day, not on departure day', () => {
  const result = parse(
    row('02/02/2026 23:50:00', {1: 'Manifesto 0019001 Hora 23:40'}),
    row('03/02/2026 00:20:00', {1: 'Peso 23820 manifesto 0019001'})
  );
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].pesoKg, 23820);
  assert.equal(result.events[0].retornoEm, '2026-02-03T00:20:00-03:00');
});

test('one response may contain three independently bound trailers', () => {
  const result = parse(row('05/02/2026 10:00:00', {
    1: '0019002 / peso 15900 kg',
    11: '0019003 / peso 22760 kg',
    14: '0019004 / peso 21410 kg'
  }));
  assert.equal(result.events.length, 3);
  assert.equal(result.events.reduce((sum, event) => sum + event.pesoKg, 0), 60070);
});

test('exact same-day resubmission is deduplicated', () => {
  const result = parse(
    row('06/02/2026 09:41:00', {9: '31560', 13: '01297526', 18: '0019005'}),
    row('06/02/2026 11:04:00', {9: '31560', 13: '01297526', 18: '0019005'})
  );
  assert.equal(result.events.length, 1);
  assert.equal(result.quality.duplicateSubmissions, 1);
});

test('conflicting weights for a plate and manifesto are quarantined', () => {
  const result = parse(
    row('07/02/2026 11:00:00', {18: 'Peso 26250 manifesto 0019006'}),
    row('07/02/2026 11:05:00', {18: 'Peso 22540 manifesto 0019006'})
  );
  assert.equal(result.events.length, 0);
  assert.equal(result.quality.reasonCounts.PESOS_CONFLITANTES, 2);
});

test('same manifesto claimed by different plates cannot be attributed', () => {
  const result = parse(
    row('08/02/2026 09:00:00', {1: 'Manifesto 0019007'}),
    row('08/02/2026 10:00:00', {2: '0019007/26000kg'})
  );
  assert.equal(result.events.length, 0);
  assert.equal(result.quality.reasonCounts.MANIFESTO_EM_PLACAS_DIFERENTES, 1);
});

test('structured peso binds only to a unique plate and manifesto', () => {
  const valid = parse(row('09/02/2026 10:00:00', {9: '22960', 13: '01292926', 18: '0019008'}));
  assert.equal(valid.events.length, 1);
  assert.equal(valid.events[0].ticket, '01292926');
  const ambiguous = parse(row('09/02/2026 10:00:00', {1: '0019009', 2: '0019010', 9: '22960'}));
  assert.equal(ambiguous.events.length, 0);
  assert.equal(ambiguous.quality.reasonCounts.VINCULO_ESTRUTURADO_AMBIGUO, 1);
});

test('same weight resubmitted on a different date has uncertain reporting period', () => {
  const result = parse(
    row('10/02/2026 23:00:00', {1: '0019011/24850kg'}),
    row('11/02/2026 08:00:00', {1: '0019011/24850kg'})
  );
  assert.equal(result.events.length, 0);
  assert.equal(result.quality.reasonCounts.DATA_DE_RETORNO_CONFLITANTE, 2);
});

test('test submissions never become trips', () => {
  const result = parse(row('12/02/2026 10:00:00', {
    1: '0019012', 6: 'Teste direto de conexao', 9: '24850'
  }));
  assert.equal(result.events.length, 0);
  assert.equal(result.quality.reasonCounts.LINHA_DE_TESTE, 1);
});

test('explicit observation plate may bind an otherwise unique structured weight', () => {
  const result = parse(row('13/02/2026 10:00:00', {
    6: ', Placa: RVG 1I 40 - Manifesto: 0019013', 9: '26000', 13: '01262426'
  }));
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].placaCarreta, 'RVG1I40');
});

test('concatenated Peso and accented manifesto are recognized', () => {
  const result = parse(row('14/02/2026 00:20:00', {
    14: 'Peso29190  manifestó 0019014'
  }));
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].pesoKg, 29190);
});

test('a misspelled weight unit is left for manual review', () => {
  const result = parse(row('15/02/2026 10:00:00', {1: '0019015/30810kd'}));
  assert.equal(result.events.length, 0);
  assert.equal(result.quality.reasonCounts.PESO_TEXTO_AMBIGUO_OU_INVALIDO, 1);
});
