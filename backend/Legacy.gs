/**
 * Read-only importer for the copied "Carretas Manifesto" Form response tab.
 *
 * Pass getDisplayValues() for A:Y (header included). Leading zeroes in the
 * manifesto and ticket are meaningful, so getValues() is not preferred.
 * No historical row is edited and no uncertain weight is included in events.
 *
 * Returned events are completed weighings, not departures. A timestamp is the
 * Form submission time (a proxy for the historical return/weighing time).
 * `retornoEm` is ISO 8601 with the copied workbook's historical UTC-03 offset.
 * New-app trips must be summed separately and combined by the caller.
 *
 * Options: firstSheetRow (default 1), legacyOffset (default '-03:00'),
 * timeZone (default 'America/Sao_Paulo'). When passing a chunk without the
 * header, firstSheetRow must be the actual sheet row of rows[0].
 *
 * Result: {
 *   events: [{id, placaCarreta, manifesto, ticket, retornoEm, pesoKg,
 *             sourceRow, source:'legado'}],
 *   quality: {dataRows, rowsWithWeightEvidence, verifiedEvents,
 *             duplicateSubmissions, quarantinedRows, unparsedWeightRows,
 *             reasonCounts},
 *   quarantine: [{sourceRow, reasons:[...]}]  // no private cell contents
 * }
 */

var LEGACY_CARRETA_COLUMNS_ = {
  1: 'JAS2D61', 2: 'JAS2F62', 3: 'JAS2F88', 4: 'JAS2G73',
  5: 'IVX2B560', 8: 'LYX2156', 10: 'JAY7C40', 11: 'RVG1140',
  12: 'IYX2156', 14: 'JAZ7I36', 15: 'RVW5E95', 16: 'SLS4B99',
  17: 'OWG7E81', 18: 'TSY2H92', 19: 'VCL291', 20: 'ELU1B42',
  21: 'TSY2H92', 22: 'RVG1I40'
};

function parseLegacyCarretas(rows, opts) {
  opts = opts || {};
  if (!Array.isArray(rows)) throw new Error('Linhas históricas inválidas.');
  var firstSheetRow = Number(opts.firstSheetRow || 1);
  var offset = String(opts.legacyOffset || '-03:00');
  if (!/^[+-]\d{2}:\d{2}$/.test(offset)) throw new Error('Offset histórico inválido.');
  var header = rows.length && /carimbo de data/i.test(String((rows[0] || [])[0] || ''));
  var start = header ? 1 : 0;
  var knownPlates = Object.keys(LEGACY_CARRETA_COLUMNS_).map(function (key) {
    return LEGACY_CARRETA_COLUMNS_[key];
  }).filter(function (plate, index, all) { return all.indexOf(plate) === index; });
  var rowReasons = {};
  var weightRows = {};
  var claimsByManifest = {};
  var ticketClaims = {};
  var candidates = [];
  var dataRows = 0;

  function flag(rowNum, reason) {
    if (!rowReasons[rowNum]) rowReasons[rowNum] = {};
    rowReasons[rowNum][reason] = true;
  }
  function claim(manifest, plate) {
    if (!claimsByManifest[manifest]) claimsByManifest[manifest] = {};
    claimsByManifest[manifest][plate] = true;
  }
  function ticketClaim(ticket, key) {
    if (!ticket || !key) return;
    if (!ticketClaims[ticket]) ticketClaims[ticket] = {};
    ticketClaims[ticket][key] = true;
  }

  for (var r = start; r < rows.length; r++) {
    var row = rows[r] || [];
    var rowNum = firstSheetRow + r;
    if (!row.some(function (cell) { return String(cell == null ? '' : cell).trim() !== ''; })) continue;
    dataRows++;
    var timestamp = legacyTimestamp_(row[0], offset, opts.timeZone || 'America/Sao_Paulo');
    var structuredRaw = legacyCell_(row[9]);
    var structuredPresent = structuredRaw !== '';
    var structuredPeso = /^\d{5}$/.test(structuredRaw) ? Number(structuredRaw) : null;
    var ticket = legacyTicket_(row[13]);
    // Historic connectivity tests must never affect real totals or block a
    // real manifesto through the cross-plate conflict checks below.
    if (row.some(function (cell) { return /\bTESTE\b|\bTEST\b/i.test(legacyNormalize_(cell)); })) {
      flag(rowNum, 'LINHA_DE_TESTE');
      if (structuredPresent || row.some(function (cell) { return /\bPESO\b|\d\s*KG\b/i.test(legacyNormalize_(cell)); })) {
        weightRows[rowNum] = true;
      }
      continue;
    }
    var sources = [];
    var pairs = {};
    var hasWeightEvidence = structuredPresent;

    Object.keys(LEGACY_CARRETA_COLUMNS_).forEach(function (col) {
      var raw = legacyCell_(row[Number(col)]);
      if (!raw) return;
      var plate = LEGACY_CARRETA_COLUMNS_[col];
      var parsed = legacyParseText_(raw);
      var mentions = legacyMentionedPlates_(raw, knownPlates);
      var conflictingMention = mentions.some(function (mentioned) { return mentioned !== plate; });
      if (conflictingMention) flag(rowNum, 'PLACA_CONFLITANTE_NA_LINHA');
      if (parsed.weightEvidence) hasWeightEvidence = true;
      parsed.manifests.forEach(function (manifest) {
        claim(manifest, plate);
        pairs[plate + '|' + manifest] = {plate: plate, manifest: manifest};
      });
      sources.push({plate: plate, parsed: parsed, conflictingMention: conflictingMention});
    });

    [6, 13].forEach(function (col) {
      var raw = legacyCell_(row[col]);
      if (!raw || (col === 13 && ticket && /^\d{8}$/.test(raw))) return;
      var parsed = legacyParseText_(raw);
      var mentions = legacyMentionedPlates_(raw, knownPlates);
      if (parsed.weightEvidence) hasWeightEvidence = true;
      if (parsed.manifests.length && mentions.length === 1) {
        parsed.manifests.forEach(function (manifest) {
          claim(manifest, mentions[0]);
          pairs[mentions[0] + '|' + manifest] = {plate: mentions[0], manifest: manifest};
        });
      }
      if (parsed.manifests.length && mentions.length > 1) flag(rowNum, 'PLACA_AMBIGUA');
      sources.push({plate: mentions.length === 1 ? mentions[0] : null,
        parsed: parsed, conflictingMention: mentions.length > 1});
    });

    if (!hasWeightEvidence) continue; // Usually a departure/manifests-only row.
    weightRows[rowNum] = true;
    if (!timestamp) flag(rowNum, 'DATA_INVALIDA');
    if (structuredPresent && structuredPeso === null) flag(rowNum, 'PESO_ESTRUTURADO_INVALIDO');

    if (structuredPeso !== null) {
      var pairKeys = Object.keys(pairs);
      if (pairKeys.length !== 1) {
        flag(rowNum, pairKeys.length ? 'VINCULO_ESTRUTURADO_AMBIGUO' : 'SEM_PLACA_MANIFESTO');
      } else {
        var onlyPair = pairs[pairKeys[0]];
        var disagreement = sources.some(function (source) {
          return source.parsed.weights.length &&
            source.parsed.manifests.indexOf(onlyPair.manifest) !== -1 &&
            source.plate === onlyPair.plate &&
            (source.parsed.weights.length !== 1 || source.parsed.weights[0] !== structuredPeso);
        });
        if (disagreement) flag(rowNum, 'PESOS_DIVERGENTES_NA_LINHA');
        if (!disagreement && timestamp) {
          candidates.push(legacyCandidate_(onlyPair.plate, onlyPair.manifest,
            structuredPeso, ticket, timestamp, rowNum));
          ticketClaim(ticket, pairKeys[0]);
        }
      }
    }

    sources.forEach(function (source) {
      var parsed = source.parsed;
      if (!parsed.weightEvidence) return;
      if (!source.plate || source.conflictingMention) {
        flag(rowNum, 'PLACA_AMBIGUA');
        return;
      }
      if (parsed.manifests.length !== 1) {
        flag(rowNum, parsed.manifests.length ? 'MANIFESTO_AMBIGUO' : 'SEM_MANIFESTO');
        return;
      }
      if (parsed.weights.length !== 1 || !legacyValidPeso_(parsed.weights[0])) {
        flag(rowNum, 'PESO_TEXTO_AMBIGUO_OU_INVALIDO');
        return;
      }
      if (timestamp) {
        candidates.push(legacyCandidate_(source.plate, parsed.manifests[0],
          parsed.weights[0], ticket, timestamp, rowNum));
        ticketClaim(ticket, source.plate + '|' + parsed.manifests[0]);
      }
    });
  }

  // Never choose one of two plates claiming the same manifesto, including
  // claims made in departure-only rows.
  var conflictingManifest = {};
  Object.keys(claimsByManifest).forEach(function (manifest) {
    if (Object.keys(claimsByManifest[manifest]).length > 1) conflictingManifest[manifest] = true;
  });
  var conflictingTicket = {};
  Object.keys(ticketClaims).forEach(function (ticket) {
    if (Object.keys(ticketClaims[ticket]).length > 1) conflictingTicket[ticket] = true;
  });
  var byKey = {};
  candidates.forEach(function (candidate) {
    var fatal = rowReasons[candidate.sourceRow] || {};
    if (fatal.DATA_INVALIDA || fatal.PLACA_CONFLITANTE_NA_LINHA ||
        fatal.PESO_ESTRUTURADO_INVALIDO || fatal.VINCULO_ESTRUTURADO_AMBIGUO ||
        fatal.PESOS_DIVERGENTES_NA_LINHA) return;
    var key = candidate.placaCarreta + '|' + candidate.manifesto;
    if (!byKey[key]) byKey[key] = [];
    byKey[key].push(candidate);
  });

  var events = [];
  var duplicateSubmissions = 0;
  var acceptedRows = {};
  Object.keys(byKey).forEach(function (key) {
    var group = byKey[key];
    var manifest = group[0].manifesto;
    if (conflictingManifest[manifest]) {
      group.forEach(function (candidate) { flag(candidate.sourceRow, 'MANIFESTO_EM_PLACAS_DIFERENTES'); });
      return;
    }
    var distinctWeights = legacyUnique_(group.map(function (candidate) { return candidate.pesoKg; }));
    if (distinctWeights.length !== 1) {
      group.forEach(function (candidate) { flag(candidate.sourceRow, 'PESOS_CONFLITANTES'); });
      return;
    }
    var distinctDays = legacyUnique_(group.map(function (candidate) { return candidate.retornoEm.slice(0, 10); }));
    if (distinctDays.length !== 1) {
      group.forEach(function (candidate) { flag(candidate.sourceRow, 'DATA_DE_RETORNO_CONFLITANTE'); });
      return;
    }
    if (group.some(function (candidate) { return candidate.ticket && conflictingTicket[candidate.ticket]; })) {
      group.forEach(function (candidate) { flag(candidate.sourceRow, 'TICKET_EM_VIAGENS_DIFERENTES'); });
      return;
    }
    var distinctTickets = legacyUnique_(group.map(function (candidate) { return candidate.ticket; }).filter(Boolean));
    if (distinctTickets.length > 1) {
      group.forEach(function (candidate) { flag(candidate.sourceRow, 'TICKETS_CONFLITANTES'); });
      return;
    }
    group.sort(function (a, b) {
      return a.retornoEm < b.retornoEm ? -1 : a.retornoEm > b.retornoEm ? 1 : a.sourceRow - b.sourceRow;
    });
    var first = group[0];
    first.ticket = distinctTickets.length ? distinctTickets[0] : '';
    events.push(first);
    group.forEach(function (candidate) { acceptedRows[candidate.sourceRow] = true; });
    // A duplicate source row can appear twice when both structured and text
    // fields report the same weighing; count distinct submissions only.
    duplicateSubmissions += legacyUnique_(group.map(function (candidate) { return candidate.sourceRow; })).length - 1;
  });
  events.sort(function (a, b) { return a.retornoEm < b.retornoEm ? -1 : a.retornoEm > b.retornoEm ? 1 : a.sourceRow - b.sourceRow; });

  var weightRowNumbers = Object.keys(weightRows);
  weightRowNumbers.forEach(function (rowNum) {
    if (!acceptedRows[rowNum] && !rowReasons[rowNum]) flag(rowNum, 'PESO_NAO_CONCILIADO');
  });
  var reasonCounts = {};
  var quarantine = Object.keys(rowReasons).map(function (rowNum) {
    var reasons = Object.keys(rowReasons[rowNum]).sort();
    reasons.forEach(function (reason) { reasonCounts[reason] = (reasonCounts[reason] || 0) + 1; });
    return {sourceRow: Number(rowNum), reasons: reasons};
  }).sort(function (a, b) { return a.sourceRow - b.sourceRow; });
  return {
    events: events,
    quality: {
      dataRows: dataRows,
      rowsWithWeightEvidence: weightRowNumbers.length,
      verifiedEvents: events.length,
      duplicateSubmissions: duplicateSubmissions,
      quarantinedRows: quarantine.length,
      unparsedWeightRows: weightRowNumbers.filter(function (rowNum) { return !acceptedRows[rowNum]; }).length,
      reasonCounts: reasonCounts
    },
    quarantine: quarantine
  };
}

function legacyCandidate_(plate, manifest, peso, ticket, timestamp, rowNum) {
  return {id: 'legado:' + plate + ':' + manifest, placaCarreta: plate,
    manifesto: manifest, ticket: ticket || '', retornoEm: timestamp,
    pesoKg: peso, sourceRow: rowNum, source: 'legado'};
}

function legacyCell_(value) { return String(value == null ? '' : value).trim(); }

function legacyNormalize_(value) {
  var text = legacyCell_(value).toUpperCase();
  return typeof text.normalize === 'function'
    ? text.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : text;
}

function legacyMentionedPlates_(raw, knownPlates) {
  var compact = legacyNormalize_(raw).replace(/[^A-Z0-9]/g, '');
  return knownPlates.filter(function (plate) { return compact.indexOf(plate) !== -1; });
}

function legacyParseText_(raw) {
  var text = legacyNormalize_(raw);
  var manifests = legacyUnique_((text.match(/(^|\D)(00[1-9]\d{4})(?!\d)/g) || []).map(function (match) {
    var found = match.match(/00[1-9]\d{4}/);
    return found ? found[0] : '';
  }).filter(Boolean));
  var weights = [];
  var match;
  var pesoRe = /\bPESO\s*[:=\-]?\s*(\d{4,6})(?!\d)/g;
  while ((match = pesoRe.exec(text))) weights.push(Number(match[1]));
  var kgRe = /(^|[^\d])(\d{4,6})\s*KG\b/g;
  while ((match = kgRe.exec(text))) weights.push(Number(match[2]));
  manifests.forEach(function (manifest) {
    // Require a real field boundary; `30810kd` is not a verified `kg` entry.
    var slashRe = new RegExp(manifest + '\\s*/\\s*(\\d{4,6})(?!\\d)(?=\\s*(?:KG\\b|$|[;,./-]))', 'g');
    while ((match = slashRe.exec(text))) weights.push(Number(match[1]));
  });
  weights = legacyUnique_(weights);
  return {manifests: manifests, weights: weights,
    weightEvidence: /\bPESO|\d\s*KG\b/.test(text) || weights.length > 0 || /\/\s*\d{4,6}/.test(text)};
}

function legacyValidPeso_(peso) {
  return Number.isInteger(peso) && peso >= 10000 && peso <= 99999;
}

function legacyTicket_(raw) {
  var text = legacyNormalize_(raw);
  if (/^\d{8}$/.test(text)) return text;
  var found = text.match(/\bTICKET\s*[:=\-]?\s*(\d{8})\b/);
  return found ? found[1] : '';
}

function legacyTimestamp_(value, offset, timeZone) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    if (typeof Utilities !== 'undefined') {
      var local = Utilities.formatDate(value, timeZone, "yyyy-MM-dd'T'HH:mm:ss");
      var zone = Utilities.formatDate(value, timeZone, 'Z').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
      return local + zone;
    }
    return value.toISOString();
  }
  var raw = legacyCell_(value);
  var match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return '';
  var day = Number(match[1]), month = Number(match[2]), year = Number(match[3]);
  var hour = Number(match[4]), minute = Number(match[5]), second = Number(match[6]);
  var check = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month ||
      check.getUTCDate() !== day || check.getUTCHours() !== hour ||
      check.getUTCMinutes() !== minute || check.getUTCSeconds() !== second) return '';
  return match[3] + '-' + match[2] + '-' + match[1] + 'T' +
    match[4] + ':' + match[5] + ':' + match[6] + offset;
}

function legacyUnique_(items) {
  return items.filter(function (item, index) { return items.indexOf(item) === index; });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {parseLegacyCarretas: parseLegacyCarretas};
}
