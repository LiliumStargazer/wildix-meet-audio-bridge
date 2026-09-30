(() => {
  let forcedMute = false;
  let originalMicMuted = null;
  let checkTimer = null;

  function getMicState() {
    const muteButton =
      document.querySelector('button[aria-label="Disattiva microfono"]') ||
      document.querySelector('button[aria-label="Turn off microphone"]');

    if (muteButton) {
      return {
        muted: false,
        button: muteButton
      };
    }

    const unmuteButton =
      document.querySelector('button[aria-label="Attiva microfono"]') ||
      document.querySelector('button[aria-label="Turn on microphone"]');

    if (unmuteButton) {
      return {
        muted: true,
        button: unmuteButton
      };
    }

    return null;
  }

  function ensureMuted() {
    if (!forcedMute) {
      return;
    }

    const mic = getMicState();

    if (mic && !mic.muted) {
      console.log("[Wildix Meet Audio Bridge] Forzo mute microfono Meet");
      mic.button.click();
    }
  }

  function enableForcedMute() {
    const mic = getMicState();

    if (!mic) {
      console.warn(
        "[Wildix Meet Audio Bridge] Pulsante microfono Meet non trovato"
      );

      return {
        ok: false,
        wasMuted: null
      };
    }

    if (!forcedMute) {
      originalMicMuted = mic.muted;
    }

    forcedMute = true;

    if (!mic.muted) {
      mic.button.click();
    }

    console.log(
      "[Wildix Meet Audio Bridge] Microfono Meet silenziato"
    );

    return {
      ok: true,
      wasMuted: originalMicMuted
    };
  }

  function restoreMic(wasMuted) {
    forcedMute = false;

    const mic = getMicState();

    if (!mic) {
      console.warn(
        "[Wildix Meet Audio Bridge] Impossibile ripristinare il microfono"
      );
      return;
    }

    const targetMuted =
      typeof wasMuted === "boolean"
        ? wasMuted
        : originalMicMuted;

    if (targetMuted === false && mic.muted) {
      mic.button.click();
    }

    if (targetMuted === true && !mic.muted) {
      mic.button.click();
    }

    originalMicMuted = null;

    console.log(
      "[Wildix Meet Audio Bridge] Stato microfono Meet ripristinato"
    );
  }

  chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {
      if (message.type === "FORCE_MUTE_MEET") {
        sendResponse(enableForcedMute());
        return;
      }

      if (message.type === "RESTORE_MEET") {
        restoreMic(message.wasMicMuted);
        sendResponse({ ok: true });
      }
    }
  );

  const observer = new MutationObserver(() => {
    if (!forcedMute) {
      return;
    }

    clearTimeout(checkTimer);

    checkTimer = setTimeout(() => {
      ensureMuted();
    }, 100);
  });

  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["aria-label"]
  });

  chrome.runtime.sendMessage({
    type: "MEET_READY"
  });

  console.log("[Wildix Meet Audio Bridge] Monitor Google Meet avviato");
})();