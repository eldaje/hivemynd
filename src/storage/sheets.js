'use strict';
// Sheets advanced service facade injected by Apps Script; tests supply an API fake.
const TABLES = [
  { name: 'Tasks', key: 'tasks', fields: TASK_FIELDS },
  { name: 'Proposals', key: 'proposals', fields: PROPOSAL_FIELDS },
  { name: 'Activity_Log', key: 'events', fields: EVENT_FIELDS },
  { name: 'Operations', key: 'operations', fields: OP_FIELDS }
];
function cell(value) {
  if (value !== null && typeof value === 'object') value = JSON.stringify(value);
  return { userEnteredValue: typeof value === 'boolean' ? { boolValue: value } :
    typeof value === 'number' ? { numberValue: value } : { stringValue: value === null ? 'null' : String(value) } };
}
function row(values) { return { values: values.map(cell) }; }
function decodeCell(c) {
  const v = c.userEnteredValue;
  if (!v) return '';
  if (Object.hasOwn(v, 'formulaValue')) fault('OUT_OF_BAND_EDIT');
  return Object.hasOwn(v, 'stringValue') ? v.stringValue : Object.hasOwn(v, 'numberValue') ? v.numberValue : v.boolValue;
}
function gridRows(sheet) {
  const grids = sheet.data || [];
  if (grids.length > 1 || (grids[0] && (grids[0].startRow || grids[0].startColumn))) fault('STORE_CORRUPT');
  const result = ((grids[0] || {}).rowData || []).map(r => (r.values || []).map(decodeCell));
  while (result.length && result[result.length - 1].every(v => v === '')) result.pop();
  return result;
}
class SheetsStore {
  constructor(api, spreadsheetId, withLock, hash) {
    this.api = api; this.spreadsheetId = spreadsheetId; this.withLock = withLock; this.hash = hash;
  }
  load() {
    // Includes one overflow row and column, so edits inside the canonical bounds fail closed.
    const ranges = TABLES.map(t => "'" + t.name + "'!A1:Z" + (LIMITS[t.key] + 2));
    ranges.push("'_Integrity'!A1:C3");
    const book = this.api.get(this.spreadsheetId, { ranges, includeGridData: true,
      fields: 'sheets(properties(sheetId,title),data(startRow,startColumn,rowData(values(userEnteredValue))))' });
    const state = emptyState(); this.ids = {};
    for (const t of TABLES) {
      const sheet = book.sheets.find(s => s.properties.title === t.name);
      if (!sheet) fault('STORE_CORRUPT');
      this.ids[t.name] = sheet.properties.sheetId;
      const rows = gridRows(sheet), header = rows.shift() || [];
      if (canonical(header.slice(0, t.fields.length)) !== canonical(t.fields) || header.slice(t.fields.length).some(v => v !== '')) fault('OUT_OF_BAND_EDIT');
      if (rows.length > LIMITS[t.key]) fault('CAPACITY_REACHED');
      state[t.key] = rows.map(values => {
        if (values.slice(t.fields.length).some(v => v !== '')) fault('OUT_OF_BAND_EDIT');
        const item = {};
        t.fields.forEach((field, i) => {
          const value = values[i] === undefined ? '' : values[i];
          item[field] = ['proposed_change', 'outcome'].includes(field) ? JSON.parse(value) :
            field === 'expected_version' && value === 'null' ? null : value;
        });
        return item;
      });
    }
    const meta = book.sheets.find(s => s.properties.title === '_Integrity');
    if (!meta) fault('STORE_CORRUPT');
    this.ids._Integrity = meta.properties.sheetId;
    const metaRows = gridRows(meta);
    if (canonical(metaRows[0]) !== canonical(['format', 'digest']) || metaRows.length !== 2 || metaRows[1][0] !== 1 || metaRows[1].length !== 2) fault('OUT_OF_BAND_EDIT');
    const snapshot = { state, digest: metaRows[1][1] };
    checkSnapshot(snapshot, this.hash); return snapshot;
  }
  commit(before, after) {
    // Reread under the same ScriptLock; does not lock out direct human/connector editors.
    const fresh = this.load();
    if (fresh.digest !== before.digest) fault('OUT_OF_BAND_EDIT');
    const requests = [];
    for (const t of TABLES) {
      const oldRows = before.state[t.key], newRows = after.state[t.key];
      if (newRows.length < oldRows.length) fault('STORE_CORRUPT');
      for (let i = 0; i < oldRows.length; i++) {
        if (canonical(oldRows[i]) === canonical(newRows[i])) continue;
        if (['events', 'operations'].includes(t.key)) fault('IMMUTABLE_HISTORY');
        requests.push({ updateCells: { start: { sheetId: this.ids[t.name], rowIndex: i + 1, columnIndex: 0 },
          rows: [row(t.fields.map(f => newRows[i][f]))], fields: 'userEnteredValue' } });
      }
      if (newRows.length > oldRows.length) requests.push({ appendCells: { sheetId: this.ids[t.name],
        rows: newRows.slice(oldRows.length).map(v => row(t.fields.map(f => v[f]))), fields: 'userEnteredValue' } });
    }
    requests.push({ updateCells: { start: { sheetId: this.ids._Integrity, rowIndex: 1, columnIndex: 0 },
      rows: [row([1, after.digest])], fields: 'userEnteredValue' } });
    // One batch is the unit of atomicity, including the receipt and integrity digest.
    this.api.batchUpdate({ requests }, this.spreadsheetId);
  }
}
function newSpreadsheetBody(hash) {
  const sheets = TABLES.map((t, i) => ({ properties: { sheetId: i + 1, title: t.name,
    gridProperties: { rowCount: LIMITS[t.key] + 2, columnCount: 26, frozenRowCount: 1 } },
    data: [{ rowData: [row(t.fields)] }] }));
  sheets.push({ properties: { sheetId: 5, title: '_Integrity', hidden: true, gridProperties: { rowCount: 3, columnCount: 3 } },
    data: [{ rowData: [row(['format', 'digest']), row([1, seal(emptyState(), hash).digest])] }] });
  return { properties: { title: 'BLUE KITE — Hivemind fictional pilot', timeZone: 'America/Denver' }, sheets };
}
if (typeof module !== 'undefined') module.exports = { SheetsStore, TABLES, newSpreadsheetBody, cell, row };
