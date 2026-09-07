/**
 * Install as a spreadsheet-bound Apps Script on the Google Form response sheet.
 * Script Properties: WORKNEST_ORIGIN, WORKNEST_TOKEN.
 * Install a spreadsheet "On form submit" trigger for sendContactToWorknest.
 * Never deploy as a public web app. Company approval for external transfer is required.
 */
function sendContactToWorknest(e) {
  if (!e || !e.range || !e.namedValues) throw new Error('Use a spreadsheet form-submit trigger.');
  var properties = PropertiesService.getScriptProperties();
  var origin = properties.getProperty('WORKNEST_ORIGIN');
  var token = properties.getProperty('WORKNEST_TOKEN');
  if (!/^https:\/\/[a-z0-9.-]+$/.test(origin || '') || !token) throw new Error('Configure origin and token in Script Properties.');
  var value = function(name) { return (e.namedValues[name] || [''])[0]; };
  // Stable per submission: retries do not create duplicates. Renaming columns requires changing these mappings.
  var externalId = e.source.getId() + ':' + e.range.getSheet().getSheetId() + ':' + e.range.getRow();
  var payload = { requestId: externalId, contacts: [{
    externalId: externalId, name: value('氏名'), company: value('会社名'),
    email: value('メールアドレス'), campaign: value('施策名'),
    consent: value('連絡許可') === '同意する' ? 'allowed' : 'unknown'
  }] };
  var response = UrlFetchApp.fetch(origin + '/api/integrations/v1/contacts', {
    method: 'post', contentType: 'application/json', followRedirects: false,
    headers: { Authorization: 'Bearer ' + token, 'X-Worknest': '1' },
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  var status = response.getResponseCode();
  if (status !== 200 && status !== 202) throw new Error('Worknest HTTP ' + status + '. Check token expiry, required fields and quota.');
  // No personal information or token is logged. Approval happens in Worknest's integration inbox.
}
