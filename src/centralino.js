importScripts("centralino-settings.js");

const CENTRALINO_PREFIX = `[Wildix Meet Audio Bridge v${chrome.runtime.getManifest().version}]`;

async function setCentralinoConnected(connected) {
  const { centralinoConnected } = await chrome.storage.session.get("centralinoConnected");
  const iconColor = connected ? "green" : "red";
  await chrome.action.setIcon({ path: {
    16: `icons/icon16-${iconColor}.png`, 32: `icons/icon32-${iconColor}.png`
  } });
  await chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
  await chrome.action.setBadgeText({ text: connected ? "" : "!" });
  await chrome.storage.session.set({ centralinoConnected: connected });
  if (centralinoConnected !== connected) {
    console.log(`${CENTRALINO_PREFIX} Centralino ${connected ? "collegato" : "scollegato"}`);
    if (connected !== (centralinoConnected ?? false)) {
      await chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "Collegamento al Centralino",
        message: connected
          ? "Collegamento al Centralino riuscito."
          : "Collegamento al Centralino interrotto. Controlla la rete e le opzioni dell'estensione."
      }).catch(() => {
        console.warn(`${CENTRALINO_PREFIX} Impossibile mostrare la notifica del Centralino`);
      });
    }
  }
}

let centralinoQueue = Promise.resolve();

function enqueueCentralinoOperation(operation) {
  const result = centralinoQueue.then(operation);
  centralinoQueue = result.catch(async () => {
    console.error(`${CENTRALINO_PREFIX} Operazione di collegamento al Centralino fallita`);
    await setCentralinoConnected(false);
  }).catch(() => {});
  return result;
}

async function startCentralinoConnection(restart = false) {
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  const { centralinoSettings } = await chrome.storage.local.get("centralinoSettings");
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL("src/offscreen.html")]
  });
  if (!restart && contexts.length && centralinoSettings) {
    const { centralinoConnectionId } = await chrome.storage.session.get("centralinoConnectionId");
    if (centralinoConnectionId) {
      try {
        const response = await chrome.runtime.sendMessage({
          type: "CENTRALINO_SYNC", connectionId: centralinoConnectionId
        });
        if (response?.ok === true) {
          return;
        }
      } catch {
        // A document can still exist without a live message listener.
      }
      console.warn(`${CENTRALINO_PREFIX} Documento offscreen non disponibile: riavvio il collegamento`);
    }
  }
  await chrome.storage.session.set({ centralinoConnectionId: null });
  if (contexts.length) {
    await chrome.offscreen.closeDocument();
  }
  await setCentralinoConnected(false);
  if (!centralinoSettings) {
    return;
  }
  const settings = validateCentralinoSettings(centralinoSettings);
  if (!await chrome.permissions.contains({ origins: [`${settings.url}/*`] })) {
    console.warn(`${CENTRALINO_PREFIX} Permesso per il Centralino assente: salva le opzioni`);
    return;
  }
  await chrome.storage.session.set({ centralinoConnectionId: crypto.randomUUID() });
  await chrome.offscreen.createDocument({
    url: "src/offscreen.html",
    reasons: ["DOM_PARSER"],
    justification: "WTAPI v1 usa il DOM per leggere gli eventi XML del Centralino."
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id === chrome.runtime.id && !sender.tab &&
      sender.url === chrome.runtime.getURL("src/popup.html") &&
      message.type === "CENTRALINO_SAVE_SETTINGS") {
    enqueueCentralinoOperation(async () => {
      let settings;
      try {
        settings = validateCentralinoSettings(message.settings);
      } catch (error) {
        return { error: error.message };
      }
      if (!await chrome.permissions.contains({ origins: [`${settings.url}/*`] })) {
        return { error: "Permesso per il Centralino negato. Le credenziali non sono state salvate." };
      }
      try {
        await chrome.storage.local.set({ centralinoSettings: settings });
      } catch {
        return { error: "Impossibile salvare le credenziali. Riprova." };
      }
      await startCentralinoConnection(true);
      return { ok: true };
    }).then(sendResponse, () => sendResponse({
      error: "Impossibile avviare il collegamento. Controlla la configurazione e i permessi."
    }));
    return true;
  }
  if (sender.url === chrome.runtime.getURL("src/offscreen.html") &&
      !sender.tab && message.type === "CENTRALINO_CONNECTION_CHANGED" &&
      typeof message.connected === "boolean") {
    enqueueCentralinoOperation(async () => {
      const { centralinoConnectionId } = await chrome.storage.session.get("centralinoConnectionId");
      if (centralinoConnectionId && message.connectionId === centralinoConnectionId) {
        await setCentralinoConnected(message.connected);
      }
    });
  }
  if (sender.url === chrome.runtime.getURL("src/offscreen.html") &&
      !sender.tab && message.type === "CENTRALINO_GET_SETTINGS") {
    enqueueCentralinoOperation(async () => {
      const { centralinoSettings } = await chrome.storage.local.get("centralinoSettings");
      const { centralinoConnectionId } = await chrome.storage.session.get("centralinoConnectionId");
      return {
        settings: validateCentralinoSettings(centralinoSettings),
        connectionId: centralinoConnectionId
      };
    }).then(sendResponse, () => sendResponse({ error: "Configurazione del Centralino non valida." }));
    return true;
  }
});

chrome.runtime.onStartup.addListener(() => {
  enqueueCentralinoOperation(() => startCentralinoConnection());
});
chrome.runtime.onInstalled.addListener(() => {
  enqueueCentralinoOperation(() => startCentralinoConnection());
});
enqueueCentralinoOperation(() => startCentralinoConnection());
