(() => {
  const VERSION = chrome.runtime.getManifest().version;
  const PREFIX = `[Wildix Meet Audio Bridge v${VERSION}]`;

  const FIND_TIMEOUT_MS = 1500;
  const VERIFY_TIMEOUT_MS = 1000;
  const POLL_INTERVAL_MS = 100;
  const MAX_SET_ATTEMPTS = 3;

  let originalMicMuted = null;
  let managed = false;

  const sleep = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

  function getControlsRoot() {
    return (
      document.querySelector(
        '[role="region"][aria-label="Controlli di chiamata"]'
      ) ||
      document.querySelector(
        '[role="region"][aria-label="Call controls"]'
      ) ||
      document
    );
  }

  function getMicState() {
    const controls = getControlsRoot();

    const muteButton =
      controls.querySelector(
        'button[aria-label="Disattiva microfono"]'
      ) ||
      controls.querySelector(
        'button[aria-label="Turn off microphone"]'
      );

    if (muteButton) {
      return {
        muted: false,
        button: muteButton
      };
    }

    const unmuteButton =
      controls.querySelector(
        'button[aria-label="Attiva microfono"]'
      ) ||
      controls.querySelector(
        'button[aria-label="Turn on microphone"]'
      );

    if (unmuteButton) {
      return {
        muted: true,
        button: unmuteButton
      };
    }

    return null;
  }

  async function waitForMicAvailable(
    timeoutMs = FIND_TIMEOUT_MS
  ) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const mic = getMicState();

      if (mic) {
        return mic;
      }

      await sleep(POLL_INTERVAL_MS);
    }

    return getMicState();
  }

  async function waitForMicState(
    targetMuted,
    timeoutMs = VERIFY_TIMEOUT_MS
  ) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const mic = getMicState();

      if (mic?.muted === targetMuted) {
        return true;
      }

      await sleep(POLL_INTERVAL_MS);
    }

    return getMicState()?.muted === targetMuted;
  }

  async function setMicMuted(targetMuted) {
    for (
      let attempt = 1;
      attempt <= MAX_SET_ATTEMPTS;
      attempt += 1
    ) {
      const mic = await waitForMicAvailable(
        attempt === 1 ? FIND_TIMEOUT_MS : 500
      );

      if (!mic) {
        console.warn(
          `${PREFIX} Microfono Meet non trovato, tentativo ${attempt}/${MAX_SET_ATTEMPTS}`
        );
        continue;
      }

      if (mic.muted === targetMuted) {
        console.log(
          `${PREFIX} Microfono Meet confermato ${targetMuted ? "MUTED" : "UNMUTED"}`
        );
        return true;
      }

      console.log(
        `${PREFIX} Richiedo microfono Meet ${targetMuted ? "MUTED" : "UNMUTED"} - tentativo ${attempt}/${MAX_SET_ATTEMPTS}`
      );

      mic.button.click();

      if (await waitForMicState(targetMuted)) {
        console.log(
          `${PREFIX} Microfono Meet confermato ${targetMuted ? "MUTED" : "UNMUTED"}`
        );
        return true;
      }

      console.warn(
        `${PREFIX} Cambio stato microfono non confermato, ritento`
      );
    }

    console.error(
      `${PREFIX} Impossibile portare il microfono Meet nello stato richiesto`
    );

    return false;
  }

  async function muteMeetMic() {
    const initialMic = await waitForMicAvailable();

    if (!initialMic) {
      console.warn(
        `${PREFIX} Pulsante microfono Meet non trovato`
      );

      return {
        ok: false,
        wasMuted: null
      };
    }

    if (!managed) {
      originalMicMuted = initialMic.muted;
      managed = true;

      console.log(
        `${PREFIX} Stato microfono iniziale: ${originalMicMuted ? "MUTED" : "UNMUTED"}`
      );
    }

    const ok = await setMicMuted(true);

    return {
      ok,
      wasMuted: originalMicMuted
    };
  }

  async function restoreMeetMic(wasMuted) {
    const targetMuted =
      typeof wasMuted === "boolean"
        ? wasMuted
        : originalMicMuted;

    if (typeof targetMuted !== "boolean") {
      console.warn(
        `${PREFIX} Stato originale del microfono non disponibile`
      );

      return {
        ok: false
      };
    }

    console.log(
      `${PREFIX} Ripristino microfono a ${targetMuted ? "MUTED" : "UNMUTED"}`
    );

    const ok = await setMicMuted(targetMuted);

    if (ok) {
      managed = false;
      originalMicMuted = null;
    }

    return {
      ok
    };
  }

  chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {
      if (message.type === "FORCE_MUTE_MEET") {
        muteMeetMic()
          .then(sendResponse)
          .catch(error => {
            console.error(
              `${PREFIX} Errore durante il mute del microfono Meet`,
              error
            );

            sendResponse({
              ok: false,
              wasMuted: originalMicMuted
            });
          });

        return true;
      }

      if (message.type === "RESTORE_MEET") {
        restoreMeetMic(message.wasMicMuted)
          .then(sendResponse)
          .catch(error => {
            console.error(
              `${PREFIX} Errore durante il ripristino del microfono Meet`,
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

  chrome.runtime.sendMessage({
    type: "MEET_READY"
  }).catch(error => {
    console.warn(
      `${PREFIX} Impossibile notificare MEET_READY`,
      error
    );
  });

  console.log(
    `${PREFIX} Monitor Google Meet avviato`
  );
})();