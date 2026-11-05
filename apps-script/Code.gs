/* Source entrypoint. npm run build:gas produces dist/apps-script/Code.gs with shared core. */
function gasHash_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
    .map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
}
function gasAuthenticate_(principals) {
  const ids = new Set(), tokens = new Set();
  if (!Array.isArray(principals) || principals.length < 1) fault('CONFIGURATION_ERROR');
  principals.forEach(p => {
    if (!p || typeof p.actor_id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(p.actor_id) || ids.has(p.actor_id) ||
      !/^[a-f0-9]{64}$/.test(p.token_hash) || tokens.has(p.token_hash) || !Array.isArray(p.permissions) ||
      p.permissions.some(v => !['read', 'write', 'propose', 'verify'].includes(v))) fault('CONFIGURATION_ERROR');
    ids.add(p.actor_id); tokens.add(p.token_hash);
  });
  if (principals.filter(p => p.permissions.includes('write')).length !== 1) fault('CONFIGURATION_ERROR');
  return token => {
    const digest = gasHash_(token);
    return principals.find(p => {
      let diff = 0;
      for (let i = 0; i < digest.length; i++) diff |= digest.charCodeAt(i) ^ p.token_hash.charCodeAt(i);
      return diff === 0;
    });
  };
}
function gasWithLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fault('BUSY');
  try { return fn(); } finally { lock.releaseLock(); }
}
function gasHandle_(envelope) {
  try {
    const properties = PropertiesService.getScriptProperties();
    const sheetId = properties.getProperty('BLUE_KITE_SHEET_ID');
    if (!sheetId) fault('CONFIGURATION_ERROR');
    const authenticate = gasAuthenticate_(JSON.parse(properties.getProperty('BLUE_KITE_PRINCIPALS') || 'null'));
    const store = new SheetsStore(Sheets.Spreadsheets, sheetId, gasWithLock_, gasHash_);
    return makeGateway({ store, authenticate, hash: gasHash_, uuid: () => Utilities.getUuid(),
      now: () => new Date().toISOString(),
      verifyEvidence: (ref, task) => BLUE_KITE_EVIDENCE.some(e => e.reference === ref && e.expected_title === task.title && e.verdict === 'pass') })(envelope);
  } catch (e) { return { ok: false, code: e.code || 'STORE_UNAVAILABLE' }; }
}
function jsonOutput_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
function doPost(e) {
  // ContentService cannot set HTTP status; callers must inspect ok/code.
  if (!e || !e.postData || e.postData.length > LIMITS.payload || e.postData.contents.length > LIMITS.payload) return jsonOutput_({ ok: false, code: 'PAYLOAD_TOO_LARGE' });
  if (e.queryString) return jsonOutput_({ ok: false, code: 'QUERY_NOT_ALLOWED' });
  if (!(e.postData.type || '').startsWith('application/json')) return jsonOutput_({ ok: false, code: 'JSON_REQUIRED' });
  let envelope;
  try { envelope = JSON.parse(e.postData.contents); }
  catch (_) { return jsonOutput_({ ok: false, code: 'INVALID_JSON' }); }
  return jsonOutput_(gasHandle_(envelope));
}
function doGet() { return jsonOutput_({ ok: false, code: 'POST_REQUIRED' }); }
// Editor-only setup; never called from doPost. Run only after Workspace setup approval.
function initializeBlueKite() {
  return gasWithLock_(() => {
    const properties = PropertiesService.getScriptProperties();
    if (properties.getProperty('BLUE_KITE_SHEET_ID')) fault('ALREADY_CONFIGURED');
    gasAuthenticate_(JSON.parse(properties.getProperty('BLUE_KITE_PRINCIPALS') || 'null'));
    const book = Sheets.Spreadsheets.create(newSpreadsheetBody(gasHash_));
    properties.setProperty('BLUE_KITE_SHEET_ID', book.spreadsheetId);
    return { ok: true, spreadsheetId: book.spreadsheetId };
  });
}
