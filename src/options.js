const centralinoForm = document.getElementById("centralino-form");
const internoInput = document.getElementById("interno");
const passwordInput = document.getElementById("password");
const centralinoUrlInput = document.getElementById("url");
const saveButton = document.getElementById("save");
const saveStatus = document.getElementById("save-status");
const connectionStatus = document.getElementById("connection-status");

function showCentralinoConnection(connected) {
  connectionStatus.textContent = connected ? "Collegato" : "Scollegato";
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "session" && changes.centralinoConnected) {
    showCentralinoConnection(changes.centralinoConnected.newValue === true);
  }
});

(async () => {
  const { centralinoSettings } = await chrome.storage.local.get("centralinoSettings");
  internoInput.value = centralinoSettings?.interno ?? "";
  passwordInput.value = centralinoSettings?.password ?? "";
  centralinoUrlInput.value = centralinoSettings?.url ?? DEFAULT_CENTRALINO_URL;
  const { centralinoConnected } = await chrome.storage.session.get("centralinoConnected");
  showCentralinoConnection(centralinoConnected === true);
  saveButton.disabled = false;
})().catch(() => {
  saveStatus.textContent = "Impossibile leggere le opzioni. Riapri questa pagina.";
});

centralinoForm.addEventListener("submit", async event => {
  event.preventDefault();
  saveButton.disabled = true;
  saveStatus.textContent = "";
  try {
    const settings = validateCentralinoSettings({
      interno: internoInput.value,
      password: passwordInput.value,
      url: centralinoUrlInput.value
    });
    const granted = await chrome.permissions.request({ origins: [`${settings.url}/*`] });
    if (!granted) {
      throw new Error("Permesso per il Centralino negato. Le opzioni non sono state salvate.");
    }
    await chrome.storage.local.set({ centralinoSettings: settings });
    const response = await chrome.runtime.sendMessage({ type: "CENTRALINO_RESTART" });
    if (response?.ok !== true) {
      throw new Error(response?.error ?? "Il collegamento non è stato avviato. Riprova a salvare le opzioni.");
    }
    saveStatus.textContent = "Opzioni salvate. Collegamento al Centralino avviato.";
  } catch (error) {
    saveStatus.textContent = error.message;
  } finally {
    saveButton.disabled = false;
  }
});
