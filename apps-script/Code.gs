const SHEET_REGISTRATIONS = 'Inscriptions';
const SHEET_PREDICTIONS = 'Pronostics_Organisateurs';
const SHEET_USERS = 'Users';
const SHEET_CHAT = 'Chat_Messages';
const SHEET_NOTIFICATIONS = 'Notifications_Log';
const SHEET_TEAMS = 'Escape_Teams';
const SHEET_PROGRESS = 'Escape_Progress';
const DEFAULT_TEAMS = [];
const CHALLENGE_COUNT = 7;
const ESCAPE_STATE_CACHE_KEY = 'escape_public_state_v2';
const ESCAPE_STATE_CACHE_SECONDS = 60;
const PASSWORD_RESET_TTL_MINUTES = 30;
const ORGANIZER_USERNAME = 'organisateurs';

function setupSheets() {
  setupRegistrationSheet_();
  setupPredictionSheet_();
  setupUserSheet_();
  setupChatSheets_();
  setupEscapeSheets_();
}

function doGet(event) {
  const params = event.parameter || {};
  const callback = params.callback || 'callback';

  try {
    if (params.action) {
      setupPredictionSheet_();
      setupUserSheet_();
      setupChatSheets_();
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

function setupPredictionSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(SHEET_PREDICTIONS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_PREDICTIONS);
    sheet.appendRow(['voterKey', 'voterName', 'suspect1', 'suspect2', 'createdAt', 'updatedAt']);
  }
}

function setupUserSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(SHEET_USERS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_USERS);
    sheet.appendRow(['username', 'displayName', 'email', 'phone', 'notifyByEmail', 'avatar', 'passwordHash', 'createdAt', 'active', 'lastLoginAt', 'resetToken', 'resetTokenExpiresAt']);
  } else {
    migrateUserSheet_(sheet);
  }
}

function migrateUserSheet_(sheet) {
  const requiredHeader = ['username', 'displayName', 'email', 'phone', 'notifyByEmail', 'avatar', 'passwordHash', 'createdAt', 'active', 'lastLoginAt', 'resetToken', 'resetTokenExpiresAt'];
  const values = sheet.getDataRange().getValues();
  if (!values.length) {
    sheet.appendRow(requiredHeader);
    return;
  }

  const header = values[0].map(value => String(value || '').trim());
  if (header.join('|') === requiredHeader.join('|')) {
    return;
  }

  const index = {};
  header.forEach((name, position) => {
    index[name] = position;
  });
  sheet.getRange(1, 1, 1, requiredHeader.length).setValues([requiredHeader]);
  for (let row = 2; row <= values.length; row++) {
    const existing = values[row - 1];
    const username = String(existing[index.username] || '').trim();
    if (!username) {
      continue;
    }
    const oldFormat = index.passwordHash === undefined && existing.length <= 6;
    sheet.getRange(row, 1, 1, requiredHeader.length).setValues([[
      username,
      String(existing[index.displayName] || existing[1] || existing[0] || '').trim(),
      String(existing[index.email] || '').trim(),
      String(existing[index.phone] || '').trim(),
      index.notifyByEmail === undefined ? false : existing[index.notifyByEmail] === true,
      String(existing[index.avatar] || '').trim(),
      String(index.passwordHash === undefined ? existing[2] || '' : existing[index.passwordHash] || '').trim(),
      index.createdAt === undefined ? existing[3] || new Date() : existing[index.createdAt] || new Date(),
      oldFormat ? (existing[4] === '' ? true : existing[4]) : (index.active === undefined || existing[index.active] === '' ? true : existing[index.active]),
      oldFormat ? existing[5] || '' : (index.lastLoginAt === undefined ? '' : existing[index.lastLoginAt] || ''),
      index.resetToken === undefined ? '' : existing[index.resetToken] || '',
      index.resetTokenExpiresAt === undefined ? '' : existing[index.resetTokenExpiresAt] || ''
    ]]);
  }
}

function setupChatSheets_() {
  const ss = SpreadsheetApp.getActive();
  let chat = ss.getSheetByName(SHEET_CHAT);
  let notifications = ss.getSheetByName(SHEET_NOTIFICATIONS);

  if (!chat) {
    chat = ss.insertSheet(SHEET_CHAT);
    chat.appendRow(['id', 'createdAt', 'authorUsername', 'authorName', 'visibility', 'recipientUsername', 'recipientName', 'message', 'mentions', 'parentId']);
  }

  if (!notifications) {
    notifications = ss.insertSheet(SHEET_NOTIFICATIONS);
    notifications.appendRow(['createdAt', 'type', 'recipientUsername', 'recipientEmail', 'subject', 'status', 'detail']);
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

  if (action === 'getPredictions') {
    return readPredictions_();
  }

  if (action === 'savePrediction') {
    savePrediction_(params.voterName, params.suspect1, params.suspect2);
    return readPredictions_();
  }

  if (action === 'userRegister') {
    return registerUser_(params.username, params.password, params.email, params.phone, params.notifyByEmail, params.avatar);
  }

  if (action === 'userLookupAvatar') {
    return lookupUserByAvatar_(params.avatar);
  }

  if (action === 'userLogin') {
    return loginUser_(params.username, params.password);
  }

  if (action === 'requestPasswordReset') {
    requestPasswordReset_(params.identifier, params.resetUrl);
    return { sent: true };
  }

  if (action === 'resetPassword') {
    resetPassword_(params.token, params.password);
    return { reset: true };
  }

  if (action === 'validateUserSession') {
    validateUserToken_(params.username, params.userToken);
    const user = getUserRecord_(params.username);
    return { username: normalizeUsername_(params.username), displayName: user.displayName, avatar: user.avatar, email: user.email, phone: user.phone, notifyByEmail: user.notifyByEmail };
  }

  if (action === 'userUpdatePreferences') {
    return updateUserPreferences_(params.username, params.userToken, params.email, params.phone, params.notifyByEmail);
  }

  if (action === 'listParticipants') {
    return listParticipants_();
  }

  if (action === 'chatList') {
    return readChat_(params.username, params.userToken);
  }

  if (action === 'chatPost') {
    return postChat_(params.username, params.userToken, params.visibility, params.recipientUsername, params.message, params.parentId);
  }

  if (action === 'adminCreateUser') {
    requireAdmin_(params.adminPassword);
    return adminCreateUser_(params.username, params.email, params.phone, params.notifyByEmail, params.avatar);
  }

  if (action === 'adminNotifySiteUpdate') {
    requireAdmin_(params.adminPassword);
    return notifySiteUpdate_(params.subject, params.message);
  }

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

function savePrediction_(voterName, suspect1, suspect2) {
  const cleanVoter = String(voterName || '').trim();
  const cleanSuspect1 = String(suspect1 || '').trim();
  const cleanSuspect2 = String(suspect2 || '').trim();

  if (!cleanVoter) {
    throw new Error('Nom du votant requis');
  }
  if (!cleanSuspect1 || !cleanSuspect2) {
    throw new Error('Deux suspects sont requis');
  }
  if (cleanSuspect1 === cleanSuspect2) {
    throw new Error('Choisissez deux suspects differents');
  }

  const voterKey = normalizeKey_(cleanVoter);
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_PREDICTIONS);
  const values = sheet.getDataRange().getValues();

  for (let row = 2; row <= values.length; row++) {
    if (String(values[row - 1][0] || '') === voterKey) {
      sheet.getRange(row, 2, 1, 5).setValues([[
        cleanVoter,
        cleanSuspect1,
        cleanSuspect2,
        values[row - 1][4] || new Date(),
        new Date()
      ]]);
      return;
    }
  }

  sheet.appendRow([voterKey, cleanVoter, cleanSuspect1, cleanSuspect2, new Date(), new Date()]);
}

function readPredictions_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_PREDICTIONS);
  const rows = sheet.getDataRange().getValues().slice(1);
  return {
    votes: rows
      .filter(row => row[0] && row[1])
      .map(row => ({
        voterName: String(row[1] || ''),
        suspects: [String(row[2] || ''), String(row[3] || '')].filter(Boolean),
        updatedAt: row[5] instanceof Date ? row[5].toISOString() : String(row[5] || '')
      }))
  };
}

function normalizeKey_(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function registerUser_(username, password, email, phone, notifyByEmail, avatar) {
  const cleanUsername = normalizeUsername_(username);
  const cleanPassword = String(password || '').trim();
  const cleanDisplayName = String(username || '').trim();
  const cleanEmail = String(email || '').trim();
  const cleanPhone = String(phone || '').trim();
  const cleanAvatar = String(avatar || '').trim();
  const wantsNotifications = String(notifyByEmail || '') === 'true';

  if (!cleanUsername) {
    throw new Error('Pseudo requis');
  }
  if (cleanUsername.length < 3) {
    throw new Error('Pseudo trop court');
  }
  if (!cleanEmail) {
    throw new Error('Email requis');
  }
  if (!cleanPhone) {
    throw new Error('Telephone requis');
  }
  if (!cleanAvatar) {
    throw new Error('Image requise');
  }
  if (cleanPassword.length < 4) {
    throw new Error('Mot de passe trop court');
  }

  const records = getUserRecords_();
  const existingByUsername = records.find(user => user.username === cleanUsername);
  const existingByAvatar = cleanAvatar ? records.find(user => user.avatar === cleanAvatar) : null;
  if (existingByUsername && existingByUsername.passwordHash) {
    throw new Error('Compte deja existant');
  }
  if (existingByAvatar && existingByAvatar.username !== cleanUsername) {
    throw new Error('Cette image est deja associee a un compte');
  }

  const passwordHash = hash_(cleanPassword);
  if (existingByUsername) {
    SpreadsheetApp.getActive().getSheetByName(SHEET_USERS)
      .getRange(existingByUsername.row, 1, 1, 12)
      .setValues([[
        cleanUsername,
        cleanDisplayName || cleanUsername,
        cleanEmail,
        cleanPhone,
        wantsNotifications,
        cleanAvatar,
        passwordHash,
        existingByUsername.createdAt || new Date(),
        true,
        new Date(),
        '',
        ''
      ]]);
    return makeUserSession_(cleanUsername, cleanDisplayName || cleanUsername, passwordHash, cleanAvatar);
  }

  SpreadsheetApp.getActive().getSheetByName(SHEET_USERS).appendRow([
    cleanUsername,
    cleanDisplayName || cleanUsername,
    cleanEmail,
    cleanPhone,
    wantsNotifications,
    cleanAvatar,
    passwordHash,
    new Date(),
    true,
    new Date(),
    '',
    ''
  ]);

  return makeUserSession_(cleanUsername, cleanDisplayName || cleanUsername, passwordHash, cleanAvatar);
}

function loginUser_(username, password) {
  const cleanUsername = normalizeUsername_(username);
  const cleanPassword = String(password || '').trim();
  const record = getUserRecord_(cleanUsername);

  if (!record.active) {
    throw new Error('Compte desactive');
  }
  if (!record.passwordHash) {
    throw new Error('Compte a activer: utilisez mot de passe oublie pour creer votre mot de passe');
  }
  if (hash_(cleanPassword) !== record.passwordHash) {
    throw new Error('Pseudo ou mot de passe invalide');
  }

  SpreadsheetApp.getActive().getSheetByName(SHEET_USERS).getRange(record.row, 10).setValue(new Date());
  return makeUserSession_(record.username, record.displayName, record.passwordHash, record.avatar);
}

function requestPasswordReset_(identifier, resetUrl) {
  const cleanIdentifier = String(identifier || '').trim();
  const cleanResetUrl = String(resetUrl || '').trim();
  if (!cleanIdentifier || !cleanResetUrl) {
    return;
  }

  const record = findUserByIdentifier_(cleanIdentifier);
  if (!record || !record.active || !record.email) {
    return;
  }

  const token = makeResetToken_();
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000);
  SpreadsheetApp.getActive().getSheetByName(SHEET_USERS)
    .getRange(record.row, 11, 1, 2)
    .setValues([[token, expiresAt]]);

  const separator = cleanResetUrl.indexOf('?') === -1 ? '?' : '&';
  const link = cleanResetUrl + separator + 'reset=' + encodeURIComponent(token);
  const subject = 'Reinitialisation de votre mot de passe PRCH';
  const body = [
    'Bonjour ' + record.displayName + ',',
    '',
    'Vous avez demande la reinitialisation de votre mot de passe Party Retro Chill Hub.',
    'Ce lien est valable ' + PASSWORD_RESET_TTL_MINUTES + ' minutes :',
    link,
    '',
    'Si vous n etes pas a l origine de cette demande, ignorez cet email.'
  ].join('\n');

  sendMail_(record, subject, body, null, 'passwordReset');
}

function resetPassword_(token, password) {
  const cleanToken = String(token || '').trim();
  const cleanPassword = String(password || '').trim();
  if (!cleanToken) {
    throw new Error('Lien de reinitialisation invalide');
  }
  if (cleanPassword.length < 4) {
    throw new Error('Mot de passe trop court');
  }

  const record = getUserRecords_().find(user => user.resetToken === cleanToken);
  if (!record) {
    throw new Error('Lien de reinitialisation invalide');
  }
  if (!record.resetTokenExpiresAt || record.resetTokenExpiresAt.getTime() < Date.now()) {
    throw new Error('Lien de reinitialisation expire');
  }

  SpreadsheetApp.getActive().getSheetByName(SHEET_USERS)
    .getRange(record.row, 7, 1, 6)
    .setValues([[hash_(cleanPassword), record.createdAt || new Date(), record.active, new Date(), '', '']]);
}

function updateUserPreferences_(username, token, email, phone, notifyByEmail) {
  const user = getValidatedUser_(username, token);
  const cleanEmail = String(email || '').trim();
  const cleanPhone = String(phone || '').trim();
  const wantsNotifications = String(notifyByEmail || '') === 'true';

  if (!cleanEmail) {
    throw new Error('Email requis');
  }

  SpreadsheetApp.getActive().getSheetByName(SHEET_USERS)
    .getRange(user.row, 3, 1, 3)
    .setValues([[cleanEmail, cleanPhone, wantsNotifications]]);

  return {
    username: user.username,
    displayName: user.displayName,
    avatar: user.avatar,
    email: cleanEmail,
    phone: cleanPhone,
    notifyByEmail: wantsNotifications
  };
}

function lookupUserByAvatar_(avatar) {
  const cleanAvatar = String(avatar || '').trim();
  if (!cleanAvatar) {
    throw new Error('Image requise');
  }

  const record = getUserRecords_().find(user => user.avatar === cleanAvatar);
  if (!record) {
    return { exists: false, avatar: cleanAvatar };
  }

  return {
    exists: true,
    username: record.username,
    displayName: record.displayName,
    avatar: record.avatar,
    hasPassword: Boolean(record.passwordHash),
    emailHint: maskEmail_(record.email)
  };
}

function listParticipants_() {
  return {
    participants: getUserRecords_()
      .filter(user => user.active)
      .map(user => ({
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
  };
}

function adminCreateUser_(username, email, phone, notifyByEmail, avatar) {
  const cleanUsername = normalizeUsername_(username);
  const cleanDisplayName = String(username || '').trim();
  const cleanEmail = String(email || '').trim();
  const cleanPhone = String(phone || '').trim();
  const cleanAvatar = String(avatar || '').trim();
  const wantsNotifications = String(notifyByEmail || '') === 'true';

  if (!cleanUsername || cleanUsername.length < 3) {
    throw new Error('Pseudo requis');
  }
  if (!cleanEmail) {
    throw new Error('Email requis');
  }
  if (!cleanAvatar) {
    throw new Error('Image requise');
  }

  const records = getUserRecords_();
  const byUsername = records.find(user => user.username === cleanUsername);
  const byAvatar = records.find(user => user.avatar === cleanAvatar && user.username !== cleanUsername);
  if (byAvatar) {
    throw new Error('Image deja associee a ' + byAvatar.displayName);
  }

  const row = [
    cleanUsername,
    cleanDisplayName || cleanUsername,
    cleanEmail,
    cleanPhone,
    wantsNotifications,
    cleanAvatar,
    byUsername ? byUsername.passwordHash : '',
    byUsername ? byUsername.createdAt || new Date() : new Date(),
    true,
    byUsername ? byUsername.lastLoginAt || '' : '',
    '',
    ''
  ];

  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_USERS);
  if (byUsername) {
    sheet.getRange(byUsername.row, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }

  return { username: cleanUsername, createdWithoutPassword: !row[6] };
}

function readChat_(username, token) {
  const viewer = getValidatedUser_(username, token);
  const usersByUsername = {};
  getUserRecords_().forEach(user => {
    usersByUsername[user.username] = user;
  });
  const messages = getChatRows_()
    .filter(message => message.visibility === 'public' || message.authorUsername === viewer.username || message.recipientUsername === viewer.username)
    .map(message => ({
      id: message.id,
      createdAt: message.createdAt instanceof Date ? message.createdAt.toISOString() : String(message.createdAt || ''),
      authorUsername: message.authorUsername,
      authorName: message.authorName,
      authorAvatar: usersByUsername[message.authorUsername] ? usersByUsername[message.authorUsername].avatar : '',
      visibility: message.visibility,
      recipientUsername: message.recipientUsername,
      recipientName: message.recipientName,
      message: message.message,
      mentions: message.mentions,
      parentId: message.parentId
    }));

  return { messages, participants: listParticipants_().participants };
}

function postChat_(username, token, visibility, recipientUsername, message, parentId) {
  const author = getValidatedUser_(username, token);
  const cleanVisibility = String(visibility || 'public') === 'private' ? 'private' : 'public';
  const cleanRecipient = normalizeUsername_(recipientUsername);
  const cleanMessage = String(message || '').trim();
  const cleanParentId = String(parentId || '').trim();

  if (!cleanMessage) {
    throw new Error('Message requis');
  }
  if (cleanMessage.length > 1200) {
    throw new Error('Message trop long');
  }

  let recipient = null;
  if (cleanVisibility === 'private') {
    const targetUsername = author.username === ORGANIZER_USERNAME && cleanRecipient ? cleanRecipient : ORGANIZER_USERNAME;
    if (!targetUsername) {
      throw new Error('Destinataire requis');
    }
    recipient = getUserRecord_(targetUsername);
    if (author.username !== ORGANIZER_USERNAME && recipient.username !== ORGANIZER_USERNAME) {
      throw new Error('Les messages prives sont reserves aux organisateurs');
    }
  }

  const mentions = extractMentions_(cleanMessage);
  const id = Utilities.getUuid();
  SpreadsheetApp.getActive().getSheetByName(SHEET_CHAT).appendRow([
    id,
    new Date(),
    author.username,
    author.displayName,
    cleanVisibility,
    recipient ? recipient.username : '',
    recipient ? recipient.displayName : '',
    cleanMessage,
    mentions.join(','),
    cleanParentId
  ]);

  notifyChatRecipients_(author, recipient, mentions, cleanMessage, cleanVisibility);
  return readChat_(username, token);
}

function notifySiteUpdate_(subject, message) {
  const cleanSubject = String(subject || 'Nouveaute sur Party Retro Chill Hub').trim();
  const cleanMessage = String(message || '').trim();
  if (!cleanMessage) {
    throw new Error('Message requis');
  }

  const users = getUserRecords_().filter(user => user.active && user.notifyByEmail && user.email);
  users.forEach(user => sendMail_(user, cleanSubject, cleanMessage, null, 'siteUpdate'));
  return { sent: users.length };
}

function validateUserToken_(username, token) {
  const record = getUserRecord_(username);
  if (!record.active || !record.passwordHash || makeUserToken_(record.username, record.passwordHash) !== String(token || '')) {
    throw new Error('Session utilisateur invalide');
  }
}

function getValidatedUser_(username, token) {
  validateUserToken_(username, token);
  return getUserRecord_(username);
}

function getUserRecord_(username) {
  const cleanUsername = normalizeUsername_(username);
  const record = getUserRecords_().find(user => user.username === cleanUsername);
  if (!record) {
    throw new Error('Compte inconnu');
  }
  return record;
}

function findUserByIdentifier_(identifier) {
  const cleanIdentifier = String(identifier || '').trim();
  const cleanUsername = normalizeUsername_(cleanIdentifier);
  const cleanEmail = cleanIdentifier.toLowerCase();
  return getUserRecords_().find(user => user.username === cleanUsername || user.email.toLowerCase() === cleanEmail) || null;
}

function getUserRecords_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_USERS);
  return sheet.getDataRange().getValues().slice(1)
    .map((row, index) => ({
      row: index + 2,
      username: normalizeUsername_(row[0]),
      displayName: String(row[1] || row[0] || '').trim(),
      email: String(row[2] || '').trim(),
      phone: String(row[3] || '').trim(),
      notifyByEmail: row[4] === true,
      avatar: String(row[5] || '').trim(),
      passwordHash: String(row[6] || '').trim(),
      createdAt: row[7],
      active: row[8] === '' ? true : row[8] !== false,
      lastLoginAt: row[9],
      resetToken: String(row[10] || '').trim(),
      resetTokenExpiresAt: row[11] instanceof Date ? row[11] : null
    }))
    .filter(user => user.username);
}

function getChatRows_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_CHAT);
  return sheet.getDataRange().getValues().slice(1)
    .map(row => ({
      id: String(row[0] || '').trim(),
      createdAt: row[1],
      authorUsername: normalizeUsername_(row[2]),
      authorName: String(row[3] || '').trim(),
      visibility: String(row[4] || 'public').trim(),
      recipientUsername: normalizeUsername_(row[5]),
      recipientName: String(row[6] || '').trim(),
      message: String(row[7] || ''),
      mentions: String(row[8] || '').split(',').map(normalizeUsername_).filter(Boolean),
      parentId: String(row[9] || '').trim()
    }))
    .filter(message => message.id);
}

function extractMentions_(message) {
  const known = {};
  getUserRecords_().forEach(user => {
    known[user.username] = true;
  });

  const mentions = {};
  const regex = /@([\p{L}\p{N}_.-]+)/gu;
  let match;
  while ((match = regex.exec(message)) !== null) {
    const username = normalizeUsername_(match[1]);
    if (known[username]) {
      mentions[username] = true;
    }
  }
  return Object.keys(mentions);
}

function notifyChatRecipients_(author, recipient, mentions, message, visibility) {
  const notified = {};
  const subject = visibility === 'private'
    ? 'Nouveau message prive sur Party Retro Chill Hub'
    : 'Vous avez ete mentionne sur Party Retro Chill Hub';

  if (recipient && recipient.username !== author.username) {
    notifyUser_(recipient, subject, buildChatMailBody_(author, message), 'privateReply');
    notified[recipient.username] = true;
  }

  mentions.forEach(username => {
    if (username === author.username || notified[username]) {
      return;
    }
    const user = getUserRecord_(username);
    notifyUser_(user, 'Mention sur Party Retro Chill Hub', buildChatMailBody_(author, message), 'mention');
  });
}

function buildChatMailBody_(author, message) {
  return [
    'Bonjour,',
    '',
    author.displayName + ' vous a envoye un message sur Party Retro Chill Hub :',
    '',
    message,
    '',
    'Connectez-vous au site pour repondre :',
    getSiteUrl_() + '/chat.html'
  ].join('\n');
}

function notifyUser_(user, subject, body, type) {
  if (!user.active || !user.notifyByEmail || !user.email) {
    logNotification_(type, user, subject, 'skipped', 'notifications desactivees ou email manquant');
    return;
  }
  sendMail_(user, subject, body, null, type);
}

function sendMail_(user, subject, text, html, type) {
  const props = PropertiesService.getScriptProperties();
  const url = String(props.getProperty('PRCH_MAIL_API_URL') || 'https://party-retro-chill-hub.fr/api/mail.php').trim();
  const key = String(props.getProperty('PRCH_MAIL_API_KEY') || '').trim();
  if (!key) {
    logNotification_(type, user, subject, 'skipped', 'PRCH_MAIL_API_KEY manquante');
    return;
  }

  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-PRCH-Mail-Key': key },
      payload: JSON.stringify({
        to: user.email,
        subject,
        text,
        html: html || ''
      }),
      muteHttpExceptions: true
    });
    const status = response.getResponseCode();
    if (status < 200 || status >= 300) {
      throw new Error('HTTP ' + status + ' - ' + response.getContentText().slice(0, 180));
    }
    logNotification_(type, user, subject, 'sent', '');
  } catch (error) {
    logNotification_(type, user, subject, 'error', error.message);
    throw error;
  }
}

function logNotification_(type, user, subject, status, detail) {
  SpreadsheetApp.getActive().getSheetByName(SHEET_NOTIFICATIONS).appendRow([
    new Date(),
    type || '',
    user ? user.username : '',
    user ? user.email : '',
    subject || '',
    status || '',
    detail || ''
  ]);
}

function maskEmail_(email) {
  const value = String(email || '').trim();
  const parts = value.split('@');
  if (parts.length !== 2) {
    return '';
  }
  const name = parts[0];
  return name.slice(0, 2) + '***@' + parts[1];
}

function getSiteUrl_() {
  return String(PropertiesService.getScriptProperties().getProperty('PRCH_SITE_URL') || 'https://party-retro-chill-hub.fr').replace(/\/+$/, '');
}

function makeUserSession_(username, displayName, passwordHash, avatar) {
  return {
    username,
    displayName,
    avatar,
    userToken: makeUserToken_(username, passwordHash)
  };
}

function makeUserToken_(username, passwordHash) {
  return hash_(username + ':' + passwordHash + ':prch-user-v1');
}

function normalizeUsername_(username) {
  return String(username || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function makeResetToken_() {
  return Utilities.getUuid() + '-' + Utilities.getUuid();
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
