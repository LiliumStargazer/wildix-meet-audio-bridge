const centralinoForm = document.getElementById("centralino-form");
const internoInput = document.getElementById("interno");
const passwordInput = document.getElementById("password");
const centralinoUrlInput = document.getElementById("url");
const saveButton = document.getElementById("save");
const saveStatus = document.getElementById("save-status");
const connectionStatus = document.getElementById("connection-status");
const credentialsSummary = document.getElementById("credentials-summary");
const summaryInterno = document.getElementById("summary-interno");
const editCredentialsButton = document.getElementById("edit-credentials");
let savedCentralinoSettings;
let isCentralinoConnected = false;

function showCentralinoConnection(connected) {
  isCentralinoConnected = connected;
  connectionStatus.textContent = connected ? "Collegato"
    : savedCentralinoSettings ? "Scollegato — riconnessione automatica" : "Scollegato";
}

function showSavedCredentials() {
  centralinoForm.hidden = true;
  credentialsSummary.hidden = false;
  summaryInterno.textContent = savedCentralinoSettings.interno;
  passwordInput.value = "";
  editCredentialsButton.focus();
  showCentralinoConnection(isCentralinoConnected);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "session" && changes.centralinoConnected) {
    showCentralinoConnection(changes.centralinoConnected.newValue === true);
  }
  if (areaName === "local" && changes.centralinoSettings) {
    savedCentralinoSettings = changes.centralinoSettings.newValue;
    showSavedCredentials();
  }
});

editCredentialsButton.addEventListener("click", () => {
  internoInput.value = savedCentralinoSettings.interno;
  passwordInput.value = savedCentralinoSettings.password;
  centralinoUrlInput.value = savedCentralinoSettings.url ?? DEFAULT_CENTRALINO_URL;
  document.getElementById("advanced-settings").open = false;
  credentialsSummary.hidden = true;
  centralinoForm.hidden = false;
  saveStatus.textContent = "";
  internoInput.focus();
});

(async () => {
  const { centralinoSettings } = await chrome.storage.local.get("centralinoSettings");
  savedCentralinoSettings = centralinoSettings;
  if (savedCentralinoSettings) {
    showSavedCredentials();
  }
  const { centralinoConnected } = await chrome.storage.session.get("centralinoConnected");
  showCentralinoConnection(centralinoConnected === true);
  saveButton.disabled = false;
})().catch(() => {
  saveStatus.textContent = "Impossibile leggere la configurazione. Riapri la finestrella.";
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
      throw new Error("Permesso per il Centralino negato. Le credenziali non sono state salvate.");
    }
    const response = await chrome.runtime.sendMessage({ type: "CENTRALINO_SAVE_SETTINGS", settings });
    if (response?.ok !== true) {
      throw new Error(response?.error ?? "Il collegamento non è stato avviato. Riprova a salvare le credenziali.");
    }
    savedCentralinoSettings = settings;
    showSavedCredentials();
    saveStatus.textContent = "Credenziali salvate. Collegamento al Centralino avviato.";
  } catch (error) {
    saveStatus.textContent = error.message;
  } finally {
    saveButton.disabled = false;
  }
});
