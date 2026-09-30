function getMicState() {
  const muteButton =
    document.querySelector('button[aria-label="Disattiva microfono"]');

  if (muteButton) {
    return {
      muted: false,
      button: muteButton
    };
  }

  const unmuteButton =
    document.querySelector('button[aria-label="Attiva microfono"]');

  if (unmuteButton) {
    return {
      muted: true,
      button: unmuteButton
    };
  }

  return null;
}