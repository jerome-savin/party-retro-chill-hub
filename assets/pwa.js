(function(){
  const statusNodes = () => document.querySelectorAll("[data-push-status]");
  const enableButtons = () => document.querySelectorAll("[data-push-enable]");
  const disableButtons = () => document.querySelectorAll("[data-push-disable]");

  function setStatus(message, isError = false){
    statusNodes().forEach(node => {
      node.textContent = message;
      node.classList.toggle("is-error", isError);
    });
  }

  function isSupported(){
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  }

  function urlBase64ToUint8Array(value){
    const padding = "=".repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = window.atob(base64);
    return Uint8Array.from([...raw].map(char => char.charCodeAt(0)));
  }

  async function registerServiceWorker(){
    if(!("serviceWorker" in navigator)){
      return null;
    }
    return navigator.serviceWorker.register("service-worker.js");
  }

  async function getRegistration(){
    return navigator.serviceWorker.ready;
  }

  async function getSubscription(){
    if(!isSupported()){
      return null;
    }
    const registration = await getRegistration();
    return registration.pushManager.getSubscription();
  }

  async function subscribe(){
    if(!isSupported()){
      throw new Error("Notifications non supportees sur cet appareil.");
    }
    if(!window.PRCH_VAPID_PUBLIC_KEY){
      throw new Error("Cle Push non configuree.");
    }
    if(!window.PRCH_AUTH || !PRCH_AUTH.getSession()){
      throw new Error("Connectez-vous avant d'activer les notifications.");
    }

    const permission = await Notification.requestPermission();
    if(permission !== "granted"){
      throw new Error("Autorisation de notification refusee.");
    }

    const registration = await getRegistration();
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(window.PRCH_VAPID_PUBLIC_KEY)
    });
    const session = PRCH_AUTH.getSession();
    await PRCH_AUTH.request("pushSubscribe", {
      username: session.username,
      userToken: session.userToken,
      subscription: JSON.stringify(subscription),
      userAgent: navigator.userAgent
    });
    await refreshControls();
    return subscription;
  }

  async function unsubscribe(){
    if(!isSupported()){
      return;
    }
    const subscription = await getSubscription();
    const session = window.PRCH_AUTH ? PRCH_AUTH.getSession() : null;
    if(subscription && session){
      await PRCH_AUTH.request("pushUnsubscribe", {
        username: session.username,
        userToken: session.userToken,
        endpoint: subscription.endpoint
      });
      await subscription.unsubscribe();
    }
    await refreshControls();
  }

  async function refreshControls(){
    const supported = isSupported();
    const session = window.PRCH_AUTH ? PRCH_AUTH.getSession() : null;
    const subscription = supported ? await getSubscription().catch(() => null) : null;
    const canConfigure = supported && Boolean(session);

    enableButtons().forEach(button => {
      button.hidden = !canConfigure || Boolean(subscription);
      button.disabled = !window.PRCH_VAPID_PUBLIC_KEY;
    });
    disableButtons().forEach(button => {
      button.hidden = !canConfigure || !subscription;
    });

    if(!supported){
      setStatus("Notifications app non supportees sur cet appareil.", true);
    }else if(!session){
      setStatus("Connectez-vous pour activer les notifications app.");
    }else if(subscription){
      setStatus("Notifications app actives sur cet appareil.");
    }else if(!window.PRCH_VAPID_PUBLIC_KEY){
      setStatus("Notifications app a configurer cote serveur.", true);
    }else{
      setStatus("Notifications app disponibles sur cet appareil.");
    }
  }

  document.addEventListener("click", async event => {
    const enable = event.target.closest("[data-push-enable]");
    const disable = event.target.closest("[data-push-disable]");
    if(!enable && !disable){
      return;
    }

    const button = enable || disable;
    button.disabled = true;
    try{
      if(enable){
        setStatus("Activation des notifications app...");
        await subscribe();
      }else{
        setStatus("Desactivation des notifications app...");
        await unsubscribe();
      }
    }catch(error){
      setStatus(error.message, true);
    }finally{
      button.disabled = false;
    }
  });

  document.addEventListener("DOMContentLoaded", () => {
    registerServiceWorker().finally(() => {
      setTimeout(refreshControls, 400);
    });
  });

  window.PRCH_PUSH = {
    isSupported,
    subscribe,
    unsubscribe,
    refreshControls,
    getSubscription
  };
})();
