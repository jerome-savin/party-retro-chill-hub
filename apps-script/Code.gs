const SHEET_REGISTRATIONS = 'Inscriptions';
const SHEET_TEAMS = 'Escape_Teams';
const SHEET_PROGRESS = 'Escape_Progress';
const DEFAULT_TEAMS = [];
const CHALLENGE_COUNT = 7;
const ESCAPE_STATE_CACHE_KEY = 'escape_public_state_v2';
const ESCAPE_STATE_CACHE_SECONDS = 60;

function setupSheets() {
  setupRegistrationSheet_();
  setupEscapeSheets_();
}

function doGet(event) {
  const params = event.parameter || {};
  const callback = params.callback || 'callback';

  try {
    if (params.action) {
      if (params.action !== 'get') {
        setupEscapeSheets_();
      }
      return jsonp_(callback, { ok: true, data: handleEscapeAction_(params) });
    }

    setupRegistrationSheet_();
    return jsonp_(callback, readRegistrations_());
  } catch (error) {
    if (params.action) {
      return jsonp_(callback, { ok: false, error: error.message });
    }
    return jsonp_(callback, { guests: [], registrations: 0, participants: 0, error: error.message });
  }
}

function doPost(event) {
  try {
    setupRegistrationSheet_();
    saveRegistration_(event.parameter || {});
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function setupRegistrationSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(SHEET_REGISTRATIONS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_REGISTRATIONS);
    sheet.appendRow(['createdAt', 'firstName', 'guests', 'email', 'phone', 'diet', 'comment', 'source']);
  }
}

function saveRegistration_(params) {
  const firstName = String(params.firstName || '').trim();
  const email = String(params.email || '').trim();
  const guests = Number(params.guests || 1);

  if (!firstName) {
    throw new Error('Prenom requis');
  }

  SpreadsheetApp.getActive().getSheetByName(SHEET_REGISTRATIONS).appendRow([
    new Date(),
    firstName,
    guests,
    email,
    String(params.phone || '').trim(),
    String(params.diet || '').trim(),
    String(params.comment || '').trim(),
    String(params.source || '').trim()
  ]);
}

function readRegistrations_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_REGISTRATIONS);
  const rows = sheet.getDataRange().getValues().slice(1);
  const guests = rows
    .filter(row => row[1])
    .map(row => ({
      firstName: row[1],
      guests: Number(row[2] || 1)
    }));

  return {
    guests,
    registrations: guests.length,
    participants: guests.reduce((sum, guest) => sum + Number(guest.guests || 1), 0)
  };
}

function handleEscapeAction_(params) {
  const action = params.action || 'get';

  if (action === 'get') {
    return readEscapeState_();
  }

  if (action === 'joinTeam') {
    return joinEscapeTeam_(params.team, params.password);
  }

  if (action === 'validateSession') {
    validateTeamToken_(params.team, params.teamToken);
    return { team: params.team };
  }

  if (action === 'completeChallenge') {
    validateTeamToken_(params.team, params.teamToken);
    completeEscapeChallenge_(params.team, Number(params.challengeId), params.fragment);
    return readEscapeState_();
  }

  if (action === 'adminList') {
    requireAdmin_(params.adminPassword);
    return readEscapeAdminState_();
  }

  if (action === 'adminCreateTeam') {
    requireAdmin_(params.adminPassword);
    createEscapeTeam_(params.name, params.password);
    return readEscapeAdminState_();
  }

  if (action === 'adminSetPassword') {
    requireAdmin_(params.adminPassword);
    setEscapeTeamPassword_(params.team, params.password);
    return readEscapeAdminState_();
  }

  if (action === 'adminResetTeam') {
    requireAdmin_(params.adminPassword);
    resetEscapeTeam_(params.team);
    return readEscapeAdminState_();
  }

  if (action === 'adminDeleteTeam') {
    requireAdmin_(params.adminPassword);
    deleteEscapeTeam_(params.team);
    return readEscapeAdminState_();
  }

  throw new Error('Action escape inconnue: ' + action);
}

function setupEscapeSheets_() {
  const ss = SpreadsheetApp.getActive();
  let teams = ss.getSheetByName(SHEET_TEAMS);
  let progress = ss.getSheetByName(SHEET_PROGRESS);

  if (!teams) {
    teams = ss.insertSheet(SHEET_TEAMS);
    teams.appendRow(['team', 'passwordHash', 'createdAt', 'active']);
  } else {
    migrateTeamsSheet_(teams);
  }

  if (!progress) {
    progress = ss.insertSheet(SHEET_PROGRESS);
    progress.appendRow(['team', 'challengeId', 'fragment', 'completedAt']);
  }

  const currentTeams = getEscapeTeamRecords_().map(team => team.name);
  DEFAULT_TEAMS.forEach(team => {
    if (!currentTeams.includes(team)) {
      teams.appendRow([team, '', new Date(), true]);
    }
  });
}

function migrateTeamsSheet_(sheet) {
  const requiredHeader = ['team', 'passwordHash', 'createdAt', 'active'];
  const values = sheet.getDataRange().getValues();
  if (!values.length) {
    sheet.appendRow(requiredHeader);
    return;
  }

  const header = values[0].map(value => String(value || '').trim());
  if (header.join('|') === requiredHeader.join('|')) {
    return;
  }

  sheet.getRange(1, 1, 1, requiredHeader.length).setValues([requiredHeader]);
  for (let row = 2; row <= values.length; row++) {
    const existing = values[row - 1];
    const name = String(existing[0] || '').trim();
    if (!name) {
      continue;
    }
    sheet.getRange(row, 1, 1, requiredHeader.length).setValues([[
      name,
      existing[1] && String(existing[1]).length > 20 ? existing[1] : '',
      existing[2] || new Date(),
      existing[3] === '' ? true : existing[3]
    ]]);
  }
}

function readEscapeState_() {
  const cached = CacheService.getScriptCache().get(ESCAPE_STATE_CACHE_KEY);
  if (cached) {
    return JSON.parse(cached);
  }

  const teams = getEscapeTeamRecords_().filter(team => team.active);
  const progress = getProgressRows_();

  const state = {
    teams: teams.map(team => {
      const completed = [];
      const fragments = {};
      progress.forEach(row => {
        if (row.team === team.name) {
          completed.push(row.challengeId);
          fragments[row.challengeId] = row.fragment || '';
        }
      });
      return { name: team.name, completed, fragments };
    })
  };
  CacheService.getScriptCache().put(ESCAPE_STATE_CACHE_KEY, JSON.stringify(state), ESCAPE_STATE_CACHE_SECONDS);
  return state;
}

function readEscapeAdminState_() {
  const publicState = readEscapeStateNoCache_();
  const records = getEscapeTeamRecords_();
  return {
    teams: records.map(record => {
      const publicTeam = publicState.teams.find(team => team.name === record.name) || { completed: [], fragments: {} };
      return {
        name: record.name,
        active: record.active,
        hasPassword: Boolean(record.passwordHash),
        completed: publicTeam.completed,
        fragments: publicTeam.fragments
      };
    })
  };
}

function readEscapeStateNoCache_() {
  const teams = getEscapeTeamRecords_().filter(team => team.active);
  const progress = getProgressRows_();

  return {
    teams: teams.map(team => {
      const completed = [];
      const fragments = {};
      progress.forEach(row => {
        if (row.team === team.name) {
          completed.push(row.challengeId);
          fragments[row.challengeId] = row.fragment || '';
        }
      });
      return { name: team.name, completed, fragments };
    })
  };
}

function invalidateEscapeCache_() {
  CacheService.getScriptCache().remove(ESCAPE_STATE_CACHE_KEY);
}

function getEscapeTeamRecords_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_TEAMS);
  return sheet.getDataRange().getValues().slice(1)
    .map((row, index) => ({
      row: index + 2,
      name: String(row[0] || '').trim(),
      passwordHash: String(row[1] || '').trim(),
      createdAt: row[2],
      active: row[3] === '' ? true : row[3] !== false
    }))
    .filter(team => team.name);
}

function getProgressRows_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_PROGRESS);
  return sheet.getDataRange().getValues().slice(1)
    .map(row => ({
      team: String(row[0] || '').trim(),
      challengeId: Number(row[1]),
      fragment: String(row[2] || '')
    }))
    .filter(row => row.team && row.challengeId);
}

function createEscapeTeam_(name, password) {
  const cleanName = String(name || '').trim();
  const cleanPassword = String(password || '').trim();
  if (!cleanName) {
    throw new Error('Nom d equipe requis');
  }
  if (!cleanPassword) {
    throw new Error('Mot de passe equipe requis');
  }

  const records = getEscapeTeamRecords_();
  const existing = records.find(team => team.name.toLowerCase() === cleanName.toLowerCase());
  if (existing) {
    setEscapeTeamPassword_(existing.name, cleanPassword);
    SpreadsheetApp.getActive().getSheetByName(SHEET_TEAMS).getRange(existing.row, 4).setValue(true);
    invalidateEscapeCache_();
    return;
  }

  SpreadsheetApp.getActive().getSheetByName(SHEET_TEAMS).appendRow([
    cleanName,
    hash_(cleanPassword),
    new Date(),
    true
  ]);
  invalidateEscapeCache_();
}

function setEscapeTeamPassword_(team, password) {
  const cleanTeam = String(team || '').trim();
  const cleanPassword = String(password || '').trim();
  if (!cleanPassword) {
    throw new Error('Mot de passe equipe requis');
  }
  const record = findTeamRecord_(cleanTeam);
  SpreadsheetApp.getActive().getSheetByName(SHEET_TEAMS).getRange(record.row, 2).setValue(hash_(cleanPassword));
  invalidateEscapeCache_();
}

function joinEscapeTeam_(team, password) {
  const cleanTeam = String(team || '').trim();
  const cleanPassword = String(password || '').trim();
  const record = findTeamRecord_(cleanTeam);
  if (!record.active) {
    throw new Error('Equipe desactivee');
  }
  if (!record.passwordHash) {
    throw new Error('Equipe sans mot de passe');
  }
  if (hash_(cleanPassword) !== record.passwordHash) {
    throw new Error('Mot de passe incorrect');
  }

  return {
    team: record.name,
    teamToken: makeTeamToken_(record.name, record.passwordHash)
  };
}

function validateTeamToken_(team, token) {
  const record = findTeamRecord_(team);
  if (!record.active || !record.passwordHash || makeTeamToken_(record.name, record.passwordHash) !== String(token || '')) {
    throw new Error('Session equipe invalide');
  }
}

function findTeamRecord_(team) {
  const cleanTeam = String(team || '').trim();
  const record = getEscapeTeamRecords_().find(item => item.name === cleanTeam);
  if (!record) {
    throw new Error('Equipe inconnue');
  }
  return record;
}

function resetEscapeTeam_(team) {
  const cleanTeam = String(team || '').trim();
  if (!cleanTeam) {
    throw new Error('Equipe requise');
  }

  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_PROGRESS);
  const values = sheet.getDataRange().getValues();
  for (let row = values.length; row >= 2; row--) {
    if (values[row - 1][0] === cleanTeam) {
      sheet.deleteRow(row);
    }
  }
  invalidateEscapeCache_();
}

function deleteEscapeTeam_(team) {
  const record = findTeamRecord_(team);
  resetEscapeTeam_(record.name);
  SpreadsheetApp.getActive().getSheetByName(SHEET_TEAMS).deleteRow(record.row);
  invalidateEscapeCache_();
}

function completeEscapeChallenge_(team, challengeId, fragment) {
  const cleanTeam = String(team || '').trim();
  const cleanFragment = String(fragment || '').trim();

  if (!cleanTeam) {
    throw new Error('Equipe requise');
  }
  if (!challengeId || challengeId < 1 || challengeId > CHALLENGE_COUNT) {
    throw new Error('Epreuve invalide');
  }

  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_PROGRESS);
  const values = sheet.getDataRange().getValues();
  for (let row = 2; row <= values.length; row++) {
    if (values[row - 1][0] === cleanTeam && Number(values[row - 1][1]) === challengeId) {
      sheet.getRange(row, 3, 1, 2).setValues([[cleanFragment, new Date()]]);
      invalidateEscapeCache_();
      return;
    }
  }

  sheet.appendRow([cleanTeam, challengeId, cleanFragment, new Date()]);
  invalidateEscapeCache_();
}

function requireAdmin_(adminPassword) {
  const expected = PropertiesService.getScriptProperties().getProperty('PRCH_ADMIN_PASSWORD');
  if (!expected) {
    throw new Error('Mot de passe admin non configure dans Script Properties');
  }
  if (String(adminPassword || '') !== expected) {
    throw new Error('Mot de passe admin invalide');
  }
}

function makeTeamToken_(team, passwordHash) {
  return hash_(team + ':' + passwordHash + ':prch-escape-v1');
}

function hash_(value) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8);
  return digest.map(byte => {
    const normalized = byte < 0 ? byte + 256 : byte;
    return ('0' + normalized.toString(16)).slice(-2);
  }).join('');
}

function jsonp_(callback, payload) {
  const safeCallback = String(callback).replace(/[^\w.$]/g, '');
  return ContentService
    .createTextOutput(safeCallback + '(' + JSON.stringify(payload) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}
