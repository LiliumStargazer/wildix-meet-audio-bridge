// Runs in MAIN at document_start, before Meet can request a microphone.
(() => {
  const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  const gains = new Set();
  // Keep the signal closed until the background supplies the initial state.
  let isOccupato = true;

  window.addEventListener("wildix-meet-bridge:occupato", event => {
    if (typeof event.detail !== "boolean") {
      return;
    }
    isOccupato = event.detail;
    for (const gain of gains) {
      gain.gain.value = isOccupato ? 0 : 1;
    }
  });

  navigator.mediaDevices.getUserMedia = async (...args) => {
    const stream = await getUserMedia(...args);
    const microphoneTracks = stream.getAudioTracks();
    if (!microphoneTracks.length) {
      return stream;
    }

    let context;
    let gain;
    let isStopped = false;
    const activeMicrophones = new Set();
    const stopCapture = () => {
      if (isStopped) {
        return;
      }
      isStopped = true;
      microphoneTracks.forEach(track => track.stop());
      gains.delete(gain);
      context?.close().catch(error => {
        console.warn("[Wildix Meet Audio Bridge] Impossibile chiudere il controllo del microfono", error);
      });
    };

    function trackMicrophoneLifetime(microphone) {
      if (microphone.readyState === "ended") {
        return microphone;
      }
      activeMicrophones.add(microphone);
      const stop = microphone.stop.bind(microphone);
      const clone = microphone.clone.bind(microphone);
      microphone.stop = () => {
        stop();
        activeMicrophones.delete(microphone);
        if (!activeMicrophones.size) {
          stopCapture();
        }
      };
      microphone.clone = () => trackMicrophoneLifetime(clone());
      return microphone;
    }

    function trackStreamLifetime(stream) {
      stream.getAudioTracks().forEach(trackMicrophoneLifetime);
      const clone = stream.clone.bind(stream);
      stream.clone = () => trackStreamLifetime(clone());
      return stream;
    }

    try {
      context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      gain = context.createGain();
      const destination = context.createMediaStreamDestination();
      gain.gain.value = isOccupato ? 0 : 1;
      gains.add(gain);
      source.connect(gain).connect(destination);

      const controlledStream = trackStreamLifetime(new MediaStream([
        ...destination.stream.getAudioTracks(), ...stream.getVideoTracks()
      ]));
      microphoneTracks.forEach(track => {
        track.addEventListener("ended", () => {
          for (const microphone of activeMicrophones) {
            microphone.stop();
            // stop() emits no ended event: forward the hardware disconnection.
            microphone.dispatchEvent(new Event("ended"));
          }
        }, { once: true });
      });
      await context.resume();

      return controlledStream;
    } catch (error) {
      stopCapture();
      stream.getTracks().forEach(track => track.stop());
      throw error;
    }
  };
})();
