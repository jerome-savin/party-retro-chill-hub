(function(){
  const SESSION_KEY = "prch_user_session_v1";
  const API_URL = window.PRCH_API_URL || "";
  const PUBLIC_PAGES = new Set(["connexion.html", "index.html", "pronostics.html"]);
  const ADMIN_PAGES = new Set(["admin.html", "admin-communications.html", "admin-escape.html", "admin-missions.html"]);
  const ORGANIZER_USERNAME = "organisateurs";

  function currentPage(){
    const page = window.location.pathname.split("/").pop();
    return page || "index.html";
  }

  function isPublicPage(){
    return PUBLIC_PAGES.has(currentPage());
  }

  function isAdminPage(){
    return ADMIN_PAGES.has(currentPage());
  }

  function getSession(){
    try{
      const session = JSON.parse(localStorage.getItem(SESSION_KEY));
      return session && session.username && session.userToken ? session : null;
    }catch(error){
      return null;
    }
  }

  function saveSession(session){
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      username: session.username,
      displayName: session.displayName || session.username,
      avatar: session.avatar || "",
      userToken: session.userToken,
      loggedAt: Date.now()
    }));
  }

  function clearSession(){
    localStorage.removeItem(SESSION_KEY);
  }

  function loginUrl(){
    const next = currentPage() + window.location.search + window.location.hash;
    return `connexion.html?next=${encodeURIComponent(next)}`;
  }

  function redirectToLogin(){
    if(!isPublicPage()){
      window.location.replace(loginUrl());
    }
  }

  function authRequest(action, params = {}){
    return new Promise((resolve, reject) => {
      if(!API_URL){
        reject(new Error("Serveur non configure"));
        return;
      }

      const callback = `prchAuth${Date.now()}${Math.floor(Math.random() * 10000)}`;
      const query = new URLSearchParams({ action, callback });
      Object.entries(params).forEach(([key, value]) => query.set(key, value == null ? "" : String(value)));

      const script = document.createElement("script");
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error("Delai depasse avec le serveur"));
      }, 12000);

      function cleanup(){
        window.clearTimeout(timer);
        delete window[callback];
        script.remove();
      }

      window[callback] = (payload) => {
        cleanup();
        if(payload && payload.ok){
          resolve(payload.data || {});
          return;
        }
        reject(new Error((payload && payload.error) || "Erreur serveur"));
      };

      script.onerror = () => {
        cleanup();
        reject(new Error("Impossible de contacter le serveur"));
      };
      script.src = `${API_URL}?${query.toString()}`;
      document.body.appendChild(script);
    });
  }

  function showUser(session){
    const name = session ? (session.displayName || session.username) : "";
    const avatar = session ? (session.avatar || "") : "";
    document.querySelectorAll("[data-user-name]").forEach(node => {
      node.textContent = name;
    });
    document.querySelectorAll("[data-user-avatar]").forEach(node => {
      if(node.tagName === "IMG"){
        node.src = avatar;
        node.alt = name;
        node.hidden = !avatar;
      }
    });
    document.querySelectorAll("[data-auth-logout]").forEach(button => {
      button.hidden = !session;
    });
  }

  async function ensureAuthenticated(){
    if(isPublicPage()){
      return;
    }

    const session = getSession();
    if(!session){
      redirectToLogin();
      return;
    }

    showUser(session);

    try{
      const data = await authRequest("validateUserSession", {
        username: session.username,
        userToken: session.userToken
      });
      if(isAdminPage() && data.username !== ORGANIZER_USERNAME){
        window.location.replace("index.html");
        return;
      }
      saveSession({ ...session, displayName: data.displayName || session.displayName, avatar: data.avatar || session.avatar });
      showUser(getSession());
    }catch(error){
      clearSession();
      redirectToLogin();
    }
  }

  document.addEventListener("click", event => {
    const button = event.target.closest("[data-auth-logout]");
    if(!button){
      return;
    }
    clearSession();
    window.location.href = loginUrl();
  });

  document.addEventListener("DOMContentLoaded", ensureAuthenticated);

  window.PRCH_AUTH = {
    getSession,
    saveSession,
    clearSession,
    request: authRequest,
    ensureAuthenticated
  };
})();
