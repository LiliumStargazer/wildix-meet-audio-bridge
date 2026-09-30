const MEET_URL = "https://meet.google.com/*";

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
    `[Wildix Meet Audio Bridge] Wildix globale: ${
      globalBusy ? "OCCUPATO" : "LIBERO"
    }`
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
    const alreadyManaged = Boolean(meetStates[key]);

    let micResult = null;

    try {
      micResult = await chrome.tabs.sendMessage(
        tab.id,
        {
          type: "FORCE_MUTE_MEET"
        }
      );
    } catch (error) {
      console.warn(
        "[Wildix Meet Audio Bridge] Meet non ancora pronto:",
        error
      );
    }

    if (!alreadyManaged) {
      meetStates[key] = {
        tabWasMuted: Boolean(tab.mutedInfo?.muted),
        micWasMuted:
          typeof micResult?.wasMuted === "boolean"
            ? micResult.wasMuted
            : null
      };
    }

    try {
      await chrome.tabs.update(tab.id, {
        muted: true
      });
    } catch (error) {
      console.warn(
        "[Wildix Meet Audio Bridge] Impossibile silenziare tab Meet:",
        error
      );
    }
  }

  await chrome.storage.session.set({
    meetStates
  });
}

async function restoreMeet() {
  const state = await getSessionState();

  for (const [tabIdString, saved] of Object.entries(
    state.meetStates
  )) {
    const tabId = Number(tabIdString);

    try {
      await chrome.tabs.update(tabId, {
        muted: saved.tabWasMuted
      });
    } catch {
      // Tab chiusa nel frattempo.
    }

    try {
      await chrome.tabs.sendMessage(
        tabId,
        {
          type: "RESTORE_MEET",
          wasMicMuted: saved.micWasMuted
        }
      );
    } catch {
      // Tab Meet chiusa o ricaricata.
    }
  }

  await chrome.storage.session.set({
    meetStates: {}
  });
}

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    if (
      message.type === "WILDIX_STATE_CHANGED" &&
      sender.tab?.id
    ) {
      setWildixTabState(
        sender.tab.id,
        message.busy
      )
        .then(() => sendResponse({ ok: true }))
        .catch(error => {
          console.error(error);
          sendResponse({ ok: false });
        });

      return true;
    }

    if (
      message.type === "MEET_READY" &&
      sender.tab?.id
    ) {
      getSessionState()
        .then(async state => {
          if (state.wildixBusy) {
            await muteMeet();
          }

          sendResponse({ ok: true });
        })
        .catch(error => {
          console.error(error);
          sendResponse({ ok: false });
        });

      return true;
    }
  }
);

chrome.tabs.onRemoved.addListener(async tabId => {
  const state = await getSessionState();

  delete state.meetStates[String(tabId)];

  if (Object.prototype.hasOwnProperty.call(
    state.wildixStates,
    String(tabId)
  )) {
    delete state.wildixStates[String(tabId)];

    const globalBusy =
      Object.values(state.wildixStates).some(Boolean);

    await chrome.storage.session.set({
      wildixStates: state.wildixStates,
      wildixBusy: globalBusy,
      meetStates: state.meetStates
    });

    if (!globalBusy && state.wildixBusy) {
      await restoreMeet();
    }

    return;
  }

  await chrome.storage.session.set({
    meetStates: state.meetStates
  });
});