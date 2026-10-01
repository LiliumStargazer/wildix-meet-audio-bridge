const VERSION = chrome.runtime.getManifest().version;
const PREFIX = `[Wildix Meet Audio Bridge v${VERSION}]`;

const MEET_URL = "https://meet.google.com/*";
const TAB_VERIFY_ATTEMPTS = 3;
const TAB_VERIFY_DELAY_MS = 150;

let operationQueue = Promise.resolve();

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

function enqueueOperation(label, operation) {
  const run = async () => {
    console.log(
      `${PREFIX} Operazione: ${label}`
    );

    return operation();
  };

  const result = operationQueue.then(
    run,
    run
  );

  operationQueue = result.catch(error => {
    console.error(
      `${PREFIX} Operazione fallita: ${label}`,
      error
    );
  });

  return result;
}

async function getSessionState() {
  const result = await chrome.storage.session.get([
    "wildixBusy",
    "wildixStates",
    "meetStates"
  ]);

  return {
    wildixBusy: result.wildixBusy ?? false,
    wildixStates: result.wildixStates ?? {},
    meetStates: result.meetStates ?? {}
  };
}

async function setTabMuted(tabId, targetMuted) {
  for (
    let attempt = 1;
    attempt <= TAB_VERIFY_ATTEMPTS;
    attempt += 1
  ) {
    try {
      let tab = await chrome.tabs.get(tabId);
      const currentMuted =
        Boolean(tab.mutedInfo?.muted);

      if (currentMuted === targetMuted) {
        console.log(
          `${PREFIX} Tab Meet ${tabId}: audio confermato ${targetMuted ? "MUTED" : "UNMUTED"}`
        );
        return true;
      }

      await chrome.tabs.update(tabId, {
        muted: targetMuted
      });

      await sleep(TAB_VERIFY_DELAY_MS);

      tab = await chrome.tabs.get(tabId);

      if (
        Boolean(tab.mutedInfo?.muted) === targetMuted
      ) {
        console.log(
          `${PREFIX} Tab Meet ${tabId}: audio confermato ${targetMuted ? "MUTED" : "UNMUTED"}`
        );
        return true;
      }
    } catch (error) {
      console.warn(
        `${PREFIX} Tab Meet ${tabId}: impossibile modificare/verificare l'audio`,
        error
      );

      return false;
    }

    console.warn(
      `${PREFIX} Tab Meet ${tabId}: audio non confermato, tentativo ${attempt}/${TAB_VERIFY_ATTEMPTS}`
    );
  }

  console.error(
    `${PREFIX} Tab Meet ${tabId}: impossibile portare l'audio nello stato richiesto`
  );

  return false;
}

async function setWildixTabState(tabId, busy) {
  const state = await getSessionState();

  state.wildixStates[String(tabId)] = busy;

  const globalBusy =
    Object.values(state.wildixStates).some(Boolean);

  const changed =
    globalBusy !== state.wildixBusy;

  await chrome.storage.session.set({
    wildixStates: state.wildixStates,
    wildixBusy: globalBusy
  });

  if (!changed) {
    return;
  }

  console.log(
    `${PREFIX} Wildix globale: ${globalBusy ? "OCCUPATO" : "LIBERO"}`
  );

  if (globalBusy) {
    await muteMeet();
  } else {
    await restoreMeet();
  }
}

async function muteMeet() {
  const tabs = await chrome.tabs.query({
    url: MEET_URL
  });

  const state = await getSessionState();
  const meetStates = state.meetStates;

  for (const tab of tabs) {
    if (!tab.id) {
      continue;
    }

    const key = String(tab.id);

    if (!meetStates[key]) {
      meetStates[key] = {
        tabWasMuted: Boolean(
          tab.mutedInfo?.muted
        ),
        micWasMuted: null
      };
    }
  }

  await chrome.storage.session.set({
    meetStates
  });

  for (const tab of tabs) {
    if (!tab.id) {
      continue;
    }

    const key = String(tab.id);
    let micResult = null;

    try {
      micResult = await chrome.tabs.sendMessage(
        tab.id,
        {
          type: "FORCE_MUTE_MEET"
        }
      );

      if (micResult?.ok) {
        console.log(
          `${PREFIX} Tab Meet ${tab.id}: microfono confermato MUTED`
        );
      } else {
        console.warn(
          `${PREFIX} Tab Meet ${tab.id}: mute microfono non confermato`
        );
      }
    } catch (error) {
      console.warn(
        `${PREFIX} Tab Meet ${tab.id}: content script Meet non pronto`,
        error
      );
    }

    if (
      meetStates[key].micWasMuted === null &&
      typeof micResult?.wasMuted === "boolean"
    ) {
      meetStates[key].micWasMuted =
        micResult.wasMuted;
    }

    await setTabMuted(
      tab.id,
      true
    );
  }

  await chrome.storage.session.set({
    meetStates
  });
}

async function restoreMeet() {
  const state = await getSessionState();
  const entries = Object.entries(
    state.meetStates
  );

  for (const [tabIdString, saved] of entries) {
    const tabId = Number(tabIdString);

    try {
      const micResult =
        await chrome.tabs.sendMessage(
          tabId,
          {
            type: "RESTORE_MEET",
            wasMicMuted: saved.micWasMuted
          }
        );

      if (micResult?.ok) {
        console.log(
          `${PREFIX} Tab Meet ${tabId}: microfono ripristinato`
        );
      } else {
        console.warn(
          `${PREFIX} Tab Meet ${tabId}: ripristino microfono non confermato`
        );
      }
    } catch (error) {
      console.warn(
        `${PREFIX} Tab Meet ${tabId}: impossibile ripristinare il microfono`,
        error
      );
    }

    await setTabMuted(
      tabId,
      Boolean(saved.tabWasMuted)
    );
  }

  await chrome.storage.session.set({
    meetStates: {}
  });
}

async function handleMeetReady(tabId) {
  const state = await getSessionState();

  if (state.wildixBusy) {
    console.log(
      `${PREFIX} Meet ${tabId} pronto mentre Wildix e occupato: riallineo lo stato`
    );

    await muteMeet();
  }
}

async function handleRemovedTab(tabId) {
  const state = await getSessionState();
  const key = String(tabId);

  delete state.meetStates[key];

  if (
    Object.prototype.hasOwnProperty.call(
      state.wildixStates,
      key
    )
  ) {
    const wasBusy = state.wildixBusy;

    delete state.wildixStates[key];

    const globalBusy =
      Object.values(
        state.wildixStates
      ).some(Boolean);

    await chrome.storage.session.set({
      wildixStates: state.wildixStates,
      wildixBusy: globalBusy,
      meetStates: state.meetStates
    });

    if (!globalBusy && wasBusy) {
      await restoreMeet();
    }

    return;
  }

  await chrome.storage.session.set({
    meetStates: state.meetStates
  });
}

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    if (
      message.type === "WILDIX_STATE_CHANGED" &&
      sender.tab?.id
    ) {
      enqueueOperation(
        `Wildix tab ${sender.tab.id} -> ${message.busy ? "BUSY" : "FREE"}`,
        () =>
          setWildixTabState(
            sender.tab.id,
            message.busy
          )
      )
        .then(() => {
          sendResponse({
            ok: true
          });
        })
        .catch(error => {
          console.error(
            `${PREFIX} Errore gestione stato Wildix`,
            error
          );

          sendResponse({
            ok: false
          });
        });

      return true;
    }

    if (
      message.type === "MEET_READY" &&
      sender.tab?.id
    ) {
      enqueueOperation(
        `Meet tab ${sender.tab.id} ready`,
        () =>
          handleMeetReady(
            sender.tab.id
          )
      )
        .then(() => {
          sendResponse({
            ok: true
          });
        })
        .catch(error => {
          console.error(
            `${PREFIX} Errore gestione MEET_READY`,
            error
          );

          sendResponse({
            ok: false
          });
        });

      return true;
    }
  }
);

chrome.tabs.onRemoved.addListener(
  tabId => {
    enqueueOperation(
      `Tab ${tabId} removed`,
      () =>
        handleRemovedTab(tabId)
    ).catch(error => {
      console.error(
        `${PREFIX} Errore gestione chiusura tab`,
        error
      );
    });
  }
);

console.log(
  `${PREFIX} Service worker avviato`
);