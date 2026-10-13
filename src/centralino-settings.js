const DEFAULT_CENTRALINO_URL = "https://automaticmachines.wildixin.com";

function validateCentralinoSettings(settings) {
  if (typeof settings?.interno !== "string" || !settings.interno.trim() ||
      typeof settings.password !== "string" || !settings.password) {
    throw new Error("Inserisci Interno e password del Centralino.");
  }

  let url;
  try {
    url = new URL(settings.url);
  } catch {
    throw new Error("Inserisci un indirizzo HTTPS valido per il Centralino.");
  }
  if (url.protocol !== "https:" || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Usa il solo indirizzo HTTPS del Centralino, senza percorso o credenziali.");
  }

  return { interno: settings.interno.trim(), password: settings.password, url: url.origin };
}
