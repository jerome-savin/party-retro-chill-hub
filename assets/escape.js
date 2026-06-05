const ESCAPE_KEY = "prch_escape_state_v1";
const SESSION_KEY = "prch_escape_team_session_v1";
const ADMIN_KEY = "prch_escape_admin_password_v1";
const API_URL = (window.PRCH_API_URL || "").trim();
const CHALLENGES = [
  { id: 1, title: "L'acheteur compulsif", clue: "Fragment 01: le point de depart est cache dans la liste." },
  { id: 2, title: "Le gestionnaire de cataclysme", clue: "Fragment 02: retenez le numero qui revient deux fois." },
  { id: 3, title: "Le colis dangereux", clue: "Fragment 03: la couleur dominante indique la piste." },
  { id: 4, title: "Le claquage du stockage", clue: "Fragment 04: cherchez ce qui manque a l'image." },
  { id: 5, title: "L'IA c'est pas tout jeune", clue: "Fragment 05: le refrain donne l'ordre." },
  { id: 6, title: "Le phare de sion", clue: "Fragment 06: associez les deux moities avant de compter." },
  { id: 7, title: "On SUPPORTe plus", clue: "Fragment 07: l'ingredient final transforme la reponse." }
];

function defaultState(){
  return { selectedTeam: "", teams: [] };
}

function normalizeState(state){
  const base = state && Array.isArray(state.teams) ? state : defaultState();
  base.teams = base.teams.map(team => ({
    name: team.name,
    active: team.active !== false,
    hasPassword: Boolean(team.hasPassword),
    completed: Array.isArray(team.completed) ? team.completed.map(Number) : [],
    fragments: team.fragments || {}
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
      <span>Connexion Google Sheets</span>
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
      reject(new Error("Delai depasse avec Google Sheets"));
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
      reject(new Error("Impossible de contacter Google Sheets"));
    };
    script.src = url.toString();
    document.body.appendChild(script);
  });
}

async function loadState(adminPassword){
  if(!API_URL){
    return loadLocalState();
  }
  try{
    const remote = await apiRequest(adminPassword ? "adminList" : "get", adminPassword ? { adminPassword } : {});
    const local = loadLocalState();
    const state = normalizeState({ ...remote, selectedTeam: local.selectedTeam });
    saveLocalState(state);
    return state;
  }catch(error){
    if(adminPassword){
      throw error;
    }
    return loadLocalState();
  }
}

async function refreshState(currentState, adminPassword){
  const remote = await apiRequest(adminPassword ? "adminList" : "get", adminPassword ? { adminPassword } : {});
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
      const done = isChallengeComplete(team, challenge.id);
      return `<a class="challenge-card ${done ? "is-complete" : ""}" href="epreuve-${challenge.id}.html">
        <span class="challenge-kicker">Epreuve ${String(challenge.id).padStart(2, "0")}</span>
        <h3 class="challenge-title">${challenge.title}</h3>
        <p class="challenge-copy">${done ? "Fragment collecte." : "Fragment non collecte."}</p>
        <span class="status-badge">${done ? "Validee" : "A jouer"}</span>
      </a>`;
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
    setNotice(notice, API_URL ? "Synchronisation Google Sheets active." : "Mode local: renseignez PRCH_API_URL pour activer Google Sheets.");
  }

  finalPanel.querySelector("[data-final-link]").addEventListener("click", event => {
    if(event.currentTarget.getAttribute("aria-disabled") === "true"){
      event.preventDefault();
      setNotice(notice, "Finale verrouillee: les 7 fragments sont requis.", true);
    }
  });
  render();
  refreshState(state).then(nextState => {
    state = nextState;
    render();
  }).catch(() => {
    setNotice(notice, "Donnees locales affichees. Synchronisation Sheets indisponible.", true);
  });
}

async function initJoinPage(){
  let state = loadLocalState();
  const root = document.querySelector("[data-join-team]");
  const select = root.querySelector("[data-team-select]");
  const password = root.querySelector("[data-team-password]");
  const button = root.querySelector("[data-join-button]");
  const leaveButton = root.querySelector("[data-leave-team]");
  const notice = root.querySelector("[data-notice]");
  const sessionBox = root.querySelector("[data-session-box]");

  function render(){
    renderTeamSelect(select, state, true);
    const session = getSession();
    sessionBox.textContent = session ? `Equipe connectee: ${session.team}` : "Aucune equipe connectee sur cet appareil.";
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

  leaveButton.addEventListener("click", () => {
    clearSession();
    setNotice(notice, "Session equipe retiree de cet appareil.");
    render();
  });

  render();
  refreshState(state).then(nextState => {
    state = nextState;
    render();
  }).catch(() => {
    setNotice(notice, "Liste locale affichee. Synchronisation Sheets indisponible.", true);
  });
}

async function initChallengePage(){
  let state = loadLocalState();
  const root = document.querySelector("[data-challenge-page]");
  const id = Number(root.dataset.challengeId);
  const challenge = CHALLENGES[id - 1];
  const select = root.querySelector("[data-team-select]");
  const note = root.querySelector("[data-fragment-note]");
  const completeButton = root.querySelector("[data-complete-challenge]");
  const notice = root.querySelector("[data-notice]");
  const title = root.querySelector("[data-challenge-title]");
  const clue = root.querySelector("[data-default-clue]");
  const session = getSession();

  title.textContent = challenge.title;
  clue.textContent = challenge.clue;

  function render(){
    if(!session){
      renderTeamSelect(select, state, true);
      select.disabled = true;
      note.disabled = true;
      completeButton.disabled = true;
      setNotice(notice, "Rejoignez une equipe avec son mot de passe avant de valider une epreuve.", true);
      return;
    }

    state.selectedTeam = session.team;
    saveLocalState(state);
    renderTeamSelect(select, state);
    select.value = session.team;
    select.disabled = true;
    const team = getTeam(state, session.team);
    note.value = team.fragments[id] || "";
    setNotice(notice, isChallengeComplete(team, id) ? "Epreuve deja validee pour cette equipe." : `Connecte: ${session.team}`);
  }

  completeButton.addEventListener("click", async () => {
    if(!session){
      return;
    }
    const fragment = note.value.trim() || CHALLENGES[id - 1].clue;
    setNotice(notice, "Enregistrement en cours...");
    try{
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
  refreshState(state).then(nextState => {
    state = nextState;
    render();
  }).catch(() => {});
}

async function initAdminPage(){
  let state = defaultState();
  const root = document.querySelector("[data-admin]");
  const adminPassword = root.querySelector("[data-admin-password]");
  const teamName = root.querySelector("[data-team-name]");
  const teamPassword = root.querySelector("[data-team-password]");
  const loginButton = root.querySelector("[data-admin-login]");
  const createButton = root.querySelector("[data-admin-create]");
  const list = root.querySelector("[data-admin-list]");
  const notice = root.querySelector("[data-notice]");
  const storedPassword = sessionStorage.getItem(ADMIN_KEY);
  if(storedPassword){
    adminPassword.value = storedPassword;
  }

  async function refresh(){
    state = normalizeState(await apiRequest("adminList", { adminPassword: adminPassword.value }));
    sessionStorage.setItem(ADMIN_KEY, adminPassword.value);
    render();
  }

  function render(){
    list.innerHTML = state.teams.length ? state.teams.map(team => (
      `<div class="team-pill admin-row">
        <span>${escapeHtml(team.name)} (${completedCount(team)}/${CHALLENGES.length})${team.hasPassword ? "" : " - sans mot de passe"}</span>
        <span class="admin-actions">
          <button type="button" class="secondary" data-reset="${escapeHtml(team.name)}">Reset</button>
          <button type="button" class="secondary" data-password="${escapeHtml(team.name)}">MDP</button>
          <button type="button" class="secondary" data-delete="${escapeHtml(team.name)}">Suppr.</button>
        </span>
      </div>`
    )).join("") : '<p class="empty">Aucune equipe.</p>';
  }

  loginButton.addEventListener("click", async () => {
    setNotice(notice, "Connexion admin...");
    try{
      await refresh();
      setNotice(notice, "Acces admin OK.");
    }catch(error){
      setNotice(notice, error.message, true);
    }
  });

  createButton.addEventListener("click", async () => {
    setNotice(notice, "Creation equipe...");
    try{
      state = normalizeState(await apiRequest("adminCreateTeam", {
        adminPassword: adminPassword.value,
        name: teamName.value,
        password: teamPassword.value
      }));
      teamName.value = "";
      teamPassword.value = "";
      sessionStorage.setItem(ADMIN_KEY, adminPassword.value);
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
    const team = button.dataset.reset || button.dataset.password || button.dataset.delete;
    try{
      if(button.dataset.reset){
        state = normalizeState(await apiRequest("adminResetTeam", { adminPassword: adminPassword.value, team }));
        setNotice(notice, "Progression remise a zero.");
      }
      if(button.dataset.password){
        const nextPassword = window.prompt(`Nouveau mot de passe pour ${team}`);
        if(!nextPassword){
          return;
        }
        state = normalizeState(await apiRequest("adminSetPassword", { adminPassword: adminPassword.value, team, password: nextPassword }));
        setNotice(notice, "Mot de passe mis a jour.");
      }
      if(button.dataset.delete){
        if(!window.confirm(`Supprimer ${team} et sa progression ?`)){
          return;
        }
        state = normalizeState(await apiRequest("adminDeleteTeam", { adminPassword: adminPassword.value, team }));
        setNotice(notice, "Equipe supprimee.");
      }
      render();
    }catch(error){
      setNotice(notice, error.message, true);
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  if(document.querySelector("[data-dashboard]")) initDashboard();
  if(document.querySelector("[data-join-team]")) initJoinPage();
  if(document.querySelector("[data-challenge-page]")) initChallengePage();
  if(document.querySelector("[data-finale]")) initFinale();
  if(document.querySelector("[data-admin]")) initAdminPage();
});
