const ESCAPE_KEY = "prch_escape_state_v1";
const SESSION_KEY = "prch_escape_team_session_v1";
const API_URL = (window.PRCH_API_URL || "").trim();
const ORGANIZER_USERNAME = "organisateurs";
const CHALLENGES = [
  { id: 1, title: "Négociation sous tension", clue: "Fragment 01: le point de depart est cache dans la liste." },
  { id: 2, title: "Fournisseur sous couverture", clue: "Fragment 02: retenez le numero qui revient deux fois." },
  { id: 3, title: "Le colis dangereux", clue: "Fragment 03: la couleur dominante indique la piste." },
  { id: 4, title: "Le claquage du stockage", clue: "Fragment 04: cherchez ce qui manque a l'image." },
  { id: 5, title: "L'IA c'est pas tout jeune", clue: "Fragment 05: le refrain donne l'ordre." },
  { id: 6, title: "Le phare de sion", clue: "Fragment 06: associez les deux moities avant de compter." },
  { id: 7, title: "On SUPPORTe plus", clue: "Fragment 07: l'ingredient final transforme la reponse." }
];

function challengeUrl(challenge){
  return `epreuve-${challenge.id}.html`;
}

function defaultState(){
  return { selectedTeam: "", teams: [] };
}

function normalizeState(state){
  const base = state && Array.isArray(state.teams) ? state : defaultState();
  base.participants = Array.isArray(base.participants) ? base.participants : [];
  base.teams = base.teams.map(team => ({
    name: team.name,
    active: team.active !== false,
    hasPassword: Boolean(team.hasPassword),
    completed: Array.isArray(team.completed) ? team.completed.map(Number) : [],
    fragments: team.fragments || {},
    startChallengeId: normalizeChallengeId(team.startChallengeId || 1),
    nextChallengeId: team.nextChallengeId == null ? null : normalizeChallengeId(team.nextChallengeId),
    members: Array.isArray(team.members) ? team.members : []
  }));
  if(!base.selectedTeam || !base.teams.some(team => team.name === base.selectedTeam)){
    base.selectedTeam = base.teams[0] ? base.teams[0].name : "";
  }
  return base;
}

function loadLocalState(){
  try{
    return normalizeState(JSON.parse(localStorage.getItem(ESCAPE_KEY)));
  }catch(error){
    return defaultState();
  }
}

function saveLocalState(state){
  localStorage.setItem(ESCAPE_KEY, JSON.stringify(state));
}

function getSession(){
  try{
    const session = JSON.parse(localStorage.getItem(SESSION_KEY));
    return session && session.team && session.teamToken ? session : null;
  }catch(error){
    return null;
  }
}

function saveSession(session){
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession(){
  localStorage.removeItem(SESSION_KEY);
}

async function ensureAssignedSession(){
  const currentSession = getSession();
  if(!window.PRCH_AUTH || !API_URL){
    return currentSession;
  }
  const userSession = PRCH_AUTH.getSession();
  if(!userSession){
    return currentSession;
  }
  try{
    const data = await apiRequest("getMyEscapeTeam", {
      username: userSession.username,
      userToken: userSession.userToken
    });
    if(data && data.team && data.teamToken){
      const session = { team: data.team, teamToken: data.teamToken, assignedAt: Date.now() };
      saveSession(session);
      return session;
    }
  }catch(error){
    clearSession();
    return null;
  }
  return currentSession;
}

function getUserSession(){
  return window.PRCH_AUTH ? PRCH_AUTH.getSession() : null;
}

function isOrganizerSession(session = getUserSession()){
  return Boolean(session && session.username === ORGANIZER_USERNAME && session.userToken);
}

let pendingApiRequests = 0;

function setLoading(isLoading){
  pendingApiRequests += isLoading ? 1 : -1;
  pendingApiRequests = Math.max(0, pendingApiRequests);
  document.body.classList.toggle("is-loading", pendingApiRequests > 0);
  const loader = document.querySelector("[data-time-loader]");
  if(loader){
    loader.setAttribute("aria-hidden", pendingApiRequests > 0 ? "false" : "true");
  }
}

function ensureLoader(){
  if(document.querySelector("[data-time-loader]")){
    return;
  }
  const loader = document.createElement("div");
  loader.className = "time-loader";
  loader.dataset.timeLoader = "";
  loader.setAttribute("aria-live", "polite");
  loader.setAttribute("aria-hidden", "true");
  loader.innerHTML = `
    <div class="flux-core" aria-hidden="true">
      <span></span><span></span><span></span>
    </div>
    <div class="loader-copy">
      <strong>Synchronisation temporelle</strong>
      <span>Connexion serveur</span>
    </div>
  `;
  document.body.appendChild(loader);
}

function apiRequest(action, payload = {}){
  if(!API_URL){
    return Promise.reject(new Error("API non configuree"));
  }
  ensureLoader();
  setLoading(true);
  return new Promise((resolve, reject) => {
    const callbackName = `prchEscape${Date.now()}${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const url = new URL(API_URL);
    url.searchParams.set("callback", callbackName);
    url.searchParams.set("action", action);
    Object.entries(payload).forEach(([key, value]) => {
      url.searchParams.set(key, typeof value === "string" ? value : JSON.stringify(value));
    });
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Delai depasse avec le serveur"));
    }, 12000);
    function cleanup(){
      window.clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
      setLoading(false);
    }
    window[callbackName] = response => {
      cleanup();
      if(response && response.ok){
        resolve(response.data);
      }else if(response && Array.isArray(response.guests)){
        reject(new Error("API Apps Script non mise a jour avec les routes escape"));
      }else{
        reject(new Error(response && response.error ? response.error : "Erreur Apps Script"));
      }
    };
    script.onerror = () => {
      cleanup();
      reject(new Error("Impossible de contacter le serveur"));
    };
    script.src = url.toString();
    document.body.appendChild(script);
  });
}

async function loadState(){
  if(!API_URL){
    return loadLocalState();
  }
  try{
    const remote = await apiRequest("get");
    const local = loadLocalState();
    const state = normalizeState({ ...remote, selectedTeam: local.selectedTeam });
    saveLocalState(state);
    return state;
  }catch(error){
    return loadLocalState();
  }
}

async function refreshState(currentState){
  const remote = await apiRequest("get");
  const selectedTeam = currentState.selectedTeam;
  const state = normalizeState({ ...remote, selectedTeam });
  saveLocalState(state);
  return state;
}

function getTeam(state, name = state.selectedTeam){
  return state.teams.find(team => team.name === name) || state.teams[0] || { name: "", completed: [], fragments: {} };
}

function completedCount(team){
  return new Set(team.completed).size;
}

function isChallengeComplete(team, id){
  return team.completed.includes(id);
}

function normalizeChallengeId(value){
  const id = Number(value);
  if(!id || id < 1 || id > CHALLENGES.length){
    return 1;
  }
  return Math.floor(id);
}

function challengeSequence(startChallengeId){
  const start = normalizeChallengeId(startChallengeId);
  return CHALLENGES.map((_, offset) => ((start - 1 + offset) % CHALLENGES.length) + 1);
}

function getNextChallengeId(team){
  if(team.nextChallengeId === null){
    return null;
  }
  if(team.nextChallengeId){
    return team.nextChallengeId;
  }
  const done = new Set((team.completed || []).map(Number));
  return challengeSequence(team.startChallengeId).find(id => !done.has(id)) || null;
}

function getChallengeStatus(team, challenge){
  const done = isChallengeComplete(team, challenge.id);
  const next = getNextChallengeId(team);
  return {
    done,
    current: !done && next === challenge.id,
    accessible: done || next === challenge.id
  };
}

function escapeHtml(value){
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function renderTeamSelect(select, state, includeEmpty = false){
  select.innerHTML = `${includeEmpty ? '<option value="">Choisir une equipe</option>' : ''}${state.teams.map(team => (
    `<option value="${escapeHtml(team.name)}">${escapeHtml(team.name)}</option>`
  )).join("")}`;
  select.value = state.selectedTeam || "";
}

function updateProgress(container, team){
  const count = completedCount(team);
  const pct = Math.round((count / CHALLENGES.length) * 100);
  container.querySelector("[data-progress-count]").textContent = `${count}/${CHALLENGES.length}`;
  container.querySelector("[data-progress-fill]").style.width = `${pct}%`;
  container.querySelector("[data-final-progress]").textContent = `${pct}%`;
}

function setNotice(node, message, isError = false){
  if(!node){
    return;
  }
  node.textContent = message;
  node.classList.toggle("is-error", isError);
}

function normalizeChallengeAnswer(value){
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function setEscapeAccessState(state){
  document.body.classList.remove("escape-access-checking", "escape-access-granted", "escape-access-denied");
  document.body.classList.add(`escape-access-${state}`);
}

function showChallengeAccessPanel(root, title, message, isError = false){
  let panel = root.querySelector("[data-challenge-access-panel]");
  if(!panel){
    panel = document.createElement("section");
    panel.className = "panel challenge-access-panel";
    panel.dataset.challengeAccessPanel = "";
    const hero = root.querySelector(".hero");
    if(hero && hero.nextSibling){
      root.insertBefore(panel, hero.nextSibling);
    }else{
      root.appendChild(panel);
    }
  }
  panel.innerHTML = `
    <h2 class="panel-title">${escapeHtml(title)}</h2>
    <p class="challenge-copy">${escapeHtml(message)}</p>
    <div class="button-row" style="margin-top:1rem">
      <a class="button" href="escape.html">Retour au dashboard</a>
      <a class="button secondary" href="rejoindre-equipe.html">Rejoindre une equipe</a>
    </div>
  `;
  panel.querySelector(".challenge-copy").classList.toggle("notice", !isError);
  panel.querySelector(".challenge-copy").classList.toggle("is-error", isError);
}

async function verifyChallengeAccess(root, challengeId){
  setEscapeAccessState("checking");
  showChallengeAccessPanel(root, "Verification d'acces", "Connexion au serveur temporel...");
  const userSession = getUserSession();
  if(isOrganizerSession(userSession)){
    if(!API_URL){
      setEscapeAccessState("denied");
      showChallengeAccessPanel(root, "Serveur requis", "L'acces organisateur doit etre confirme par le serveur.", true);
      return false;
    }
    try{
      const access = await apiRequest("getOrganizerChallengeAccess", {
        username: userSession.username,
        userToken: userSession.userToken,
        challengeId
      });
      if(access && access.allowed){
        setEscapeAccessState("granted");
        const panel = root.querySelector("[data-challenge-access-panel]");
        if(panel){
          panel.remove();
        }
        return true;
      }
    }catch(error){
      setEscapeAccessState("denied");
      showChallengeAccessPanel(root, "Acces organisateur impossible", error.message, true);
      return false;
    }
  }
  const session = await ensureAssignedSession();
  if(!session){
    setEscapeAccessState("denied");
    showChallengeAccessPanel(root, "Epreuve verrouillee", "Rejoignez une equipe avant d'acceder au contenu de cette epreuve.", true);
    return false;
  }
  if(!API_URL){
    setEscapeAccessState("denied");
    showChallengeAccessPanel(root, "Serveur requis", "L'acces aux epreuves doit etre confirme par le serveur.", true);
    return false;
  }
  try{
    const access = await apiRequest("getChallengeAccess", {
      team: session.team,
      teamToken: session.teamToken,
      challengeId
    });
    if(access && access.allowed){
      setEscapeAccessState("granted");
      const panel = root.querySelector("[data-challenge-access-panel]");
      if(panel){
        panel.remove();
      }
      return true;
    }
    setEscapeAccessState("denied");
    showChallengeAccessPanel(root, "Epreuve verrouillee", access && access.reason ? access.reason : "Cette epreuve n'est pas encore accessible pour votre equipe.", true);
    return false;
  }catch(error){
    setEscapeAccessState("denied");
    showChallengeAccessPanel(root, "Acces impossible", error.message, true);
    return false;
  }
}

async function initDashboard(){
  let state = loadLocalState();
  const root = document.querySelector("[data-dashboard]");
  const currentTeamName = root.querySelector("[data-current-team]");
  const teamList = root.querySelector("[data-team-list]");
  const challengeGrid = root.querySelector("[data-challenge-grid]");
  const finalPanel = root.querySelector("[data-final-panel]");
  const notice = root.querySelector("[data-sync-notice]");

  function render(){
    const session = getSession();
    if(session && state.teams.some(item => item.name === session.team)){
      state.selectedTeam = session.team;
    }
    const team = session ? getTeam(state, session.team) : { name: "", completed: [], fragments: {} };
    currentTeamName.textContent = session ? session.team : "Non connectee";
    updateProgress(root, team);
    const otherTeams = state.teams.filter(item => item.name !== team.name);
    teamList.innerHTML = otherTeams.length ? otherTeams.map(item => {
      const pct = Math.round((completedCount(item) / CHALLENGES.length) * 100);
      return `<div class="team-progress">
        <div class="team-progress-head"><span>${escapeHtml(item.name)}</span><strong>${completedCount(item)}/${CHALLENGES.length}</strong></div>
        <div class="mini-track" aria-hidden="true"><span style="width:${pct}%"></span></div>
      </div>`;
    }).join("") : '<p class="empty">Aucune autre equipe a afficher.</p>';
    challengeGrid.innerHTML = CHALLENGES.map(challenge => {
      const status = session ? getChallengeStatus(team, challenge) : { done: false, current: false, accessible: false };
      const classes = [
        "challenge-card",
        status.done ? "is-complete" : "",
        status.current ? "is-current" : "",
        !status.accessible ? "is-locked" : ""
      ].filter(Boolean).join(" ");
      const tag = status.accessible ? "a" : "div";
      const href = status.accessible ? ` href="${challengeUrl(challenge)}"` : ' aria-disabled="true"';
      const copy = status.done ? "Fragment collecte." : status.current ? "Epreuve disponible." : "Epreuve verrouillee.";
      const badge = status.done ? "Validee" : status.current ? "Disponible" : "Verrouillee";
      return `<${tag} class="${classes}"${href}>
        <span class="challenge-kicker">Epreuve ${String(challenge.id).padStart(2, "0")}</span>
        <h3 class="challenge-title">${challenge.title}</h3>
        <p class="challenge-copy">${copy}</p>
        <span class="status-badge">${badge}</span>
      </${tag}>`;
    }).join("");
    const unlocked = completedCount(team) === CHALLENGES.length;
    finalPanel.classList.toggle("is-locked", !unlocked);
    finalPanel.querySelector("[data-final-state]").textContent = unlocked ? "Finale debloquee" : "Finale verrouillee";
    finalPanel.querySelector("[data-final-copy]").textContent = unlocked
      ? "Tous les fragments sont collectes pour cette equipe."
      : "La finale se debloque progressivement avec les 7 fragments.";
    const finalLink = finalPanel.querySelector("[data-final-link]");
    finalLink.classList.toggle("is-disabled", !unlocked);
    finalLink.setAttribute("aria-disabled", unlocked ? "false" : "true");
    finalLink.tabIndex = unlocked ? 0 : -1;
    setNotice(notice, API_URL ? "Synchronisation serveur active." : "Mode local: renseignez PRCH_API_URL pour activer le serveur.");
  }

  finalPanel.querySelector("[data-final-link]").addEventListener("click", event => {
    if(event.currentTarget.getAttribute("aria-disabled") === "true"){
      event.preventDefault();
      setNotice(notice, "Finale verrouillee: les 7 fragments sont requis.", true);
    }
  });
  render();
  ensureAssignedSession().then(session => {
    if(session){
      state.selectedTeam = session.team;
    }
    return refreshState(state);
  }).then(nextState => {
    state = nextState;
    render();
  }).catch(() => {
    setNotice(notice, "Donnees locales affichees. Synchronisation serveur indisponible.", true);
  });
}

async function initJoinPage(){
  let state = loadLocalState();
  const root = document.querySelector("[data-join-team]");
  const select = root.querySelector("[data-team-select]");
  const password = root.querySelector("[data-team-password]");
  const button = root.querySelector("[data-join-button]");
  const notice = root.querySelector("[data-notice]");
  const sessionBox = root.querySelector("[data-session-box]");
  const sessionHelp = root.querySelector("[data-session-help]");
  const sessionCard = root.querySelector("[data-session-card]");
  const sessionActions = root.querySelector("[data-session-actions]");
  const accessPanel = root.querySelector("[data-access-panel]");
  const changeButton = root.querySelector("[data-change-team]");

  function render(){
    const session = getSession();
    if(!session){
      renderTeamSelect(select, state, true);
    }
    sessionBox.textContent = session ? session.team : "Aucune equipe connectee sur cet appareil.";
    sessionBox.classList.toggle("is-ok", Boolean(session));
    sessionCard.classList.toggle("is-connected", Boolean(session));
    accessPanel.classList.toggle("is-hidden", Boolean(session));
    sessionActions.hidden = !session;
    if(sessionHelp){
      sessionHelp.textContent = session
        ? "Vous etes bien connecte a une equipe."
        : "Utilisez le bandeau Acces equipe pour vous connecter.";
      sessionHelp.classList.toggle("is-ok", Boolean(session));
    }
  }

  button.addEventListener("click", async () => {
    setNotice(notice, "Verification en cours...");
    try{
      const data = await apiRequest("joinTeam", { team: select.value, password: password.value });
      saveSession({ team: data.team, teamToken: data.teamToken, joinedAt: Date.now() });
      state.selectedTeam = data.team;
      saveLocalState(state);
      password.value = "";
      setNotice(notice, "Equipe rejointe. Vous ne devrez plus saisir le mot de passe sur cet appareil.");
      render();
    }catch(error){
      setNotice(notice, error.message, true);
    }
  });

  changeButton.addEventListener("click", () => {
    clearSession();
    setNotice(notice, "Session equipe retiree de cet appareil.");
    render();
  });

  render();
  refreshState(state).then(nextState => {
    state = nextState;
    render();
  }).catch(() => {
    setNotice(notice, "Liste locale affichee. Synchronisation serveur indisponible.", true);
  });
}

async function initChallengePage(){
  let state = loadLocalState();
  const root = document.querySelector("[data-challenge-page]");
  const id = Number(root.dataset.challengeId);
  const validationMode = root.dataset.validationMode || "manual";
  const expectedCode = root.dataset.expectedCode || "";
  const configuredFragment = root.dataset.fragment || "";
  const challenge = CHALLENGES[id - 1];
  const select = root.querySelector("[data-team-select]");
  const note = root.querySelector("[data-fragment-note]");
  const answer = root.querySelector("[data-challenge-answer]");
  const completeButton = root.querySelector("[data-complete-challenge]");
  const notice = root.querySelector("[data-notice]");
  const title = root.querySelector("[data-challenge-title]");
  const clue = root.querySelector("[data-default-clue]");
  const fragmentResult = root.querySelector("[data-fragment-result]");
  const fragmentResultText = root.querySelector("[data-fragment-result-text]");
  let session = getSession();

  if(title){
    title.textContent = challenge.title;
  }
  if(clue){
    clue.textContent = challenge.clue;
  }

  function render(){
    if(isOrganizerSession()){
      renderTeamSelect(select, state, true);
      select.disabled = true;
      if(note){
        note.disabled = true;
      }
      if(answer){
        answer.disabled = true;
      }
      completeButton.disabled = true;
      if(fragmentResult){
        fragmentResult.hidden = true;
      }
      setNotice(notice, "Mode organisateurs: acces autorise en consultation.");
      return;
    }

    if(!session){
      renderTeamSelect(select, state, true);
      select.disabled = true;
      if(note){
        note.disabled = true;
      }
      if(answer){
        answer.disabled = true;
      }
      completeButton.disabled = true;
      if(fragmentResult){
        fragmentResult.hidden = true;
      }
      setNotice(notice, "Rejoignez une equipe avec son mot de passe avant de valider une epreuve.", true);
      return;
    }

    state.selectedTeam = session.team;
    saveLocalState(state);
    renderTeamSelect(select, state);
    select.value = session.team;
    select.disabled = true;
    const team = getTeam(state, session.team);
    const fragment = team.fragments[id] || "";
    const isComplete = isChallengeComplete(team, id);
    if(note){
      note.value = fragment;
    }
    if(answer){
      answer.disabled = isComplete;
      if(isComplete){
        answer.value = "";
      }
    }
    if(fragmentResult && fragmentResultText){
      fragmentResult.hidden = !fragment;
      fragmentResultText.textContent = fragment;
    }
    completeButton.disabled = isComplete && validationMode === "local-code";
    setNotice(notice, isComplete ? "Epreuve deja validee pour cette equipe." : `Connecte: ${session.team}`);
  }

  const hasAccess = await verifyChallengeAccess(root, id);
  if(!hasAccess){
    return;
  }
  session = getSession();

  completeButton.addEventListener("click", async () => {
    if(!session){
      return;
    }
    if(validationMode === "local-code" && answer && !answer.value.trim()){
      setNotice(notice, "Saisissez le code fourni avant de valider.", true);
      return;
    }
    if(validationMode === "local-code" && normalizeChallengeAnswer(answer ? answer.value : "") !== normalizeChallengeAnswer(expectedCode)){
      setNotice(notice, "Code incorrect. Verifiez le code fourni par votre contact.", true);
      return;
    }
    setNotice(notice, "Enregistrement en cours...");
    try{
      const fragment = validationMode === "local-code"
        ? configuredFragment || CHALLENGES[id - 1].clue
        : note && note.value.trim() ? note.value.trim() : CHALLENGES[id - 1].clue;
      const remote = await apiRequest("completeChallenge", {
        team: session.team,
        teamToken: session.teamToken,
        challengeId: id,
        fragment
      });
      state = normalizeState({ ...remote, selectedTeam: session.team });
      saveLocalState(state);
      setNotice(notice, "Progression enregistree.");
      render();
    }catch(error){
      setNotice(notice, error.message, true);
    }
  });
  render();
  refreshState(state).then(nextState => {
    state = nextState;
    render();
  }).catch(() => {});
}

async function initFinale(){
  let state = loadLocalState();
  const root = document.querySelector("[data-finale]");
  const select = root.querySelector("[data-team-select]");
  const fragments = root.querySelector("[data-fragments]");
  const locked = root.querySelector("[data-locked]");
  const unlocked = root.querySelector("[data-unlocked]");

  function render(){
    const team = getTeam(state);
    renderTeamSelect(select, state);
    updateProgress(root, team);
    const isUnlocked = completedCount(team) === CHALLENGES.length;
    locked.hidden = isUnlocked;
    unlocked.hidden = !isUnlocked;
    fragments.innerHTML = CHALLENGES.map(challenge => {
      const fragment = team.fragments[challenge.id];
      return `<div class="team-pill fragment-row">
        <span>${String(challenge.id).padStart(2, "0")} ${challenge.title}</span>
        <span>${fragment ? escapeHtml(fragment) : "Manquant"}</span>
      </div>`;
    }).join("");
  }

  select.addEventListener("change", () => {
    state.selectedTeam = select.value;
    saveLocalState(state);
    render();
  });
  render();
  ensureAssignedSession().then(session => {
    if(session){
      state.selectedTeam = session.team;
    }
    return refreshState(state);
  }).then(nextState => {
    state = nextState;
    render();
  }).catch(() => {});
}

async function initStandaloneChallengeGate(selector){
  const root = document.querySelector(selector);
  if(!root){
    return;
  }
  await verifyChallengeAccess(root, Number(root.dataset.challengeId));
}

async function initAdminPage(){
  let state = defaultState();
  const root = document.querySelector("[data-admin]");
  const adminContent = root.querySelector("[data-admin-content]");
  const teamName = root.querySelector("[data-team-name]");
  const teamPassword = root.querySelector("[data-team-password]");
  const teamStartChallenge = root.querySelector("[data-team-start-challenge]");
  const createButton = root.querySelector("[data-admin-create]");
  const list = root.querySelector("[data-admin-list]");
  const notice = root.querySelector("[data-notice]");

  function adminSessionParams(){
    const session = window.PRCH_AUTH ? PRCH_AUTH.getSession() : null;
    return {
      username: session ? session.username : "",
      userToken: session ? session.userToken : ""
    };
  }

  async function refresh(){
    state = normalizeState(await apiRequest("adminList", adminSessionParams()));
    render();
  }

  async function ensureOrganizerAccess(){
    const session = window.PRCH_AUTH ? PRCH_AUTH.getSession() : null;
    if(!session){
      return;
    }
    try{
      const data = await PRCH_AUTH.request("validateUserSession", adminSessionParams());
      if(data.username !== "organisateurs"){
        setNotice(notice, "Acces reserve aux organisateurs.", true);
        return;
      }
      adminContent.hidden = false;
      setNotice(notice, "Chargement des equipes...");
      await refresh();
      setNotice(notice, "Acces organisateurs OK.");
    }catch(error){
      setNotice(notice, error.message, true);
    }
  }

  function render(){
    const participants = Array.isArray(state.participants) ? state.participants : [];
    const assignedUsernames = new Set(state.teams.flatMap(team => (team.members || []).map(member => member.username)));
    const unassigned = participants.filter(participant => !assignedUsernames.has(participant.username));
    const unassignedBlock = participants.length ? `<article class="admin-team-card">
      <div class="admin-team-head">
        <div>
          <h3 class="admin-team-name">A placer</h3>
          <div class="admin-team-meta">
            <span class="admin-chip ${unassigned.length ? "is-warn" : "is-ok"}">${unassigned.length} participant${unassigned.length > 1 ? "s" : ""}</span>
          </div>
        </div>
      </div>
      <div class="admin-member-list">
        ${unassigned.length ? unassigned.map(renderMemberBadge).join("") : '<span class="admin-member-empty">Tous les participants actifs sont affectes.</span>'}
      </div>
    </article>` : "";
    list.innerHTML = state.teams.length ? unassignedBlock + state.teams.map(team => {
      const count = completedCount(team);
      const isComplete = count === CHALLENGES.length;
      const nextLabel = team.nextChallengeId ? `Epreuve ${team.nextChallengeId}` : "Parcours termine";
      const selectedMembers = new Set((team.members || []).map(member => member.username));
      const steps = CHALLENGES.map(challenge => {
        const done = isChallengeComplete(team, challenge.id);
        const isNext = team.nextChallengeId === challenge.id;
        return `<span class="admin-step ${done ? "is-done" : ""} ${isNext ? "is-next" : ""}" title="${escapeHtml(challenge.title)}">${challenge.id}</span>`;
      }).join("");
      const memberOptions = participants.map(participant => (
        `<option value="${escapeHtml(participant.username)}" ${selectedMembers.has(participant.username) ? "selected" : ""}>${escapeHtml(participant.displayName || participant.username)}</option>`
      )).join("");
      return `<article class="admin-team-card ${isComplete ? "is-complete" : ""}">
        <div class="admin-team-head">
          <div>
            <h3 class="admin-team-name">${escapeHtml(team.name)}</h3>
            <div class="admin-team-meta">
              <span class="admin-chip ${isComplete ? "is-ok" : "is-warn"}">${count}/${CHALLENGES.length} fragments</span>
              <span class="admin-chip">Depart ${team.startChallengeId || 1}</span>
              <span class="admin-chip ${team.nextChallengeId ? "is-warn" : "is-ok"}">${escapeHtml(nextLabel)}</span>
              <span class="admin-chip ${team.hasPassword ? "is-ok" : "is-danger"}">${team.hasPassword ? "Mot de passe OK" : "Sans mot de passe"}</span>
            </div>
          </div>
        </div>
        <div class="admin-steps" aria-label="Progression des epreuves">${steps}</div>
        <div class="admin-members">
          <div class="admin-members-head">
            <span>Membres de l'equipe</span>
            <strong>${selectedMembers.size}</strong>
          </div>
          <div class="admin-member-list">
            ${team.members && team.members.length ? team.members.map(renderMemberBadge).join("") : '<span class="admin-member-empty">Aucun participant affecte.</span>'}
          </div>
          <select class="admin-member-picker" multiple data-members-for="${escapeHtml(team.name)}" aria-label="Participants de ${escapeHtml(team.name)}">
            ${memberOptions}
          </select>
        </div>
        <div class="admin-actions">
          <button type="button" class="secondary" data-members="${escapeHtml(team.name)}">Enregistrer membres</button>
          <button type="button" class="secondary" data-reset="${escapeHtml(team.name)}">Reset progression</button>
          <button type="button" class="secondary" data-password="${escapeHtml(team.name)}">Changer MDP</button>
          <button type="button" class="secondary" data-start="${escapeHtml(team.name)}" data-start-current="${team.startChallengeId || 1}">Changer depart</button>
          <button type="button" class="secondary" data-delete="${escapeHtml(team.name)}">Supprimer</button>
        </div>
      </article>`;
    }).join("") : '<p class="empty">Aucune equipe.</p>';
  }

  function renderMemberBadge(member){
    const label = member.displayName || member.username;
    const avatar = member.avatar ? `<img src="${escapeHtml(member.avatar)}" alt=""/>` : "";
    return `<span class="admin-member">${avatar}<span>${escapeHtml(label)}</span></span>`;
  }

  createButton.addEventListener("click", async () => {
    setNotice(notice, "Creation equipe...");
    try{
      state = normalizeState(await apiRequest("adminCreateTeam", {
        ...adminSessionParams(),
        name: teamName.value,
        password: teamPassword.value,
        startChallengeId: teamStartChallenge ? teamStartChallenge.value : 1
      }));
      teamName.value = "";
      teamPassword.value = "";
      render();
      setNotice(notice, "Equipe creee.");
    }catch(error){
      setNotice(notice, error.message, true);
    }
  });

  list.addEventListener("click", async event => {
    const button = event.target.closest("button");
    if(!button){
      return;
    }
    const team = button.dataset.members || button.dataset.reset || button.dataset.password || button.dataset.start || button.dataset.delete;
    try{
      if(button.dataset.members){
        const select = button.closest(".admin-team-card").querySelector("[data-members-for]");
        const members = Array.from(select.selectedOptions).map(option => option.value).join(",");
        state = normalizeState(await apiRequest("adminSetTeamMembers", { ...adminSessionParams(), team, members }));
        setNotice(notice, "Membres de l'equipe mis a jour.");
      }
      if(button.dataset.reset){
        state = normalizeState(await apiRequest("adminResetTeam", { ...adminSessionParams(), team }));
        setNotice(notice, "Progression remise a zero.");
      }
      if(button.dataset.password){
        const nextPassword = window.prompt(`Nouveau mot de passe pour ${team}`);
        if(!nextPassword){
          return;
        }
        state = normalizeState(await apiRequest("adminSetPassword", { ...adminSessionParams(), team, password: nextPassword }));
        setNotice(notice, "Mot de passe mis a jour.");
      }
      if(button.dataset.start){
        const nextStart = window.prompt(`Epreuve de depart pour ${team} (1 a ${CHALLENGES.length})`, button.dataset.startCurrent || "1");
        if(!nextStart){
          return;
        }
        state = normalizeState(await apiRequest("adminSetStartChallenge", { ...adminSessionParams(), team, startChallengeId: nextStart }));
        setNotice(notice, "Epreuve de depart mise a jour.");
      }
      if(button.dataset.delete){
        if(!window.confirm(`Supprimer ${team} et sa progression ?`)){
          return;
        }
        state = normalizeState(await apiRequest("adminDeleteTeam", { ...adminSessionParams(), team }));
        setNotice(notice, "Equipe supprimee.");
      }
      render();
    }catch(error){
      setNotice(notice, error.message, true);
    }
  });

  setTimeout(ensureOrganizerAccess, 350);
}

document.addEventListener("DOMContentLoaded", () => {
  if(document.querySelector("[data-dashboard]")) initDashboard();
  if(document.querySelector("[data-join-team]")) initJoinPage();
  if(document.querySelector("[data-challenge-page]")) initChallengePage();
  if(document.querySelector("[data-journal-challenge]")) initStandaloneChallengeGate("[data-journal-challenge]");
  if(document.querySelector("[data-agent-challenge]")) initStandaloneChallengeGate("[data-agent-challenge]");
  if(document.querySelector("[data-finale]")) initFinale();
  if(document.querySelector("[data-admin]")) initAdminPage();
});
