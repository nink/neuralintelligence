const SLICE_MS = 1000;

const MIME_CANDIDATES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

function pickSupportedMimeType() {
  if (typeof MediaRecorder === "undefined") {
    return "";
  }

  for (const mimeType of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }

  return "";
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result || "");
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(new Error("Failed to encode video blob."));
    reader.readAsDataURL(blob);
  });
}

function requestTabStreamId(tabId) {
  return new Promise((resolve, reject) => {
    if (!chrome.tabCapture?.getMediaStreamId) {
      reject(new Error("chrome.tabCapture.getMediaStreamId is unavailable."));
      return;
    }

    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!streamId) {
        reject(new Error("Tab capture returned no stream id."));
        return;
      }

      resolve(streamId);
    });
  });
}

async function requestTabStreamIdFromBackground(tabId) {
  const response = await chrome.runtime.sendMessage({
    action: "GET_TAB_STREAM_ID",
    tabId,
  });

  if (!response || response.status !== "SUCCESS" || !response.streamId) {
    throw new Error(response?.message || "Background tab capture failed.");
  }

  return response.streamId;
}

async function resolveTabStreamId(tabId) {
  try {
    return await requestTabStreamId(tabId);
  } catch (_popupError) {
    return requestTabStreamIdFromBackground(tabId);
  }
}

async function openTabMediaStream(streamId) {
  const constraintSets = [
    {
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      },
    },
    {
      audio: false,
      video: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    },
  ];

  let lastError = null;
  for (const constraints of constraintSets) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Could not open tab media stream.");
}

export class TabVideoRecorder {
  constructor() {
    this.chunks = [];
    this.recorder = null;
    this.stream = null;
    this.mimeType = "";
    this.sliceCount = 0;
  }

  isRecording() {
    return this.recorder?.state === "recording";
  }

  async start(tabId) {
    if (typeof MediaRecorder === "undefined") {
      throw new Error("MediaRecorder is not available in this context.");
    }

    this.mimeType = pickSupportedMimeType();
    if (!this.mimeType) {
      throw new Error("No supported WebM MediaRecorder mime type found.");
    }

    const streamId = await resolveTabStreamId(tabId);
    this.stream = await openTabMediaStream(streamId);
    this.chunks = [];
    this.sliceCount = 0;

    this.recorder = new MediaRecorder(this.stream, { mimeType: this.mimeType });

    this.recorder.addEventListener("dataavailable", (event) => {
      if (!event.data || event.data.size === 0) {
        return;
      }

      this.chunks.push(event.data);
      this.sliceCount += 1;
    });

    await new Promise((resolve, reject) => {
      this.recorder.addEventListener("start", () => resolve(), { once: true });
      this.recorder.addEventListener(
        "error",
        () => reject(this.recorder.error || new Error("MediaRecorder failed to start.")),
        { once: true }
      );
      this.recorder.start(SLICE_MS);
    });
  }

  releaseStream() {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
  }

  async cancel() {
    if (this.recorder && this.recorder.state !== "inactive") {
      this.recorder.stop();
    }

    this.releaseStream();
    this.recorder = null;
    this.chunks = [];
    this.sliceCount = 0;
  }

  async stop() {
    if (!this.recorder) {
      return null;
    }

    if (this.recorder.state === "recording") {
      await new Promise((resolve, reject) => {
        this.recorder.addEventListener("stop", () => resolve(), { once: true });
        this.recorder.addEventListener(
          "error",
          () => reject(this.recorder.error || new Error("MediaRecorder failed to stop.")),
          { once: true }
        );
        this.recorder.stop();
      });
    }

    this.releaseStream();

    if (!this.chunks.length) {
      this.recorder = null;
      return null;
    }

    const blob = new Blob(this.chunks, { type: this.mimeType });
    const base64 = await blobToBase64(blob);

    const result = {
      base64,
      mimeType: this.mimeType,
      sliceCount: this.sliceCount,
      byteLength: blob.size,
    };

    this.recorder = null;
    this.chunks = [];
    this.sliceCount = 0;

    return result;
  }
}

export async function captureTabVideoDuring(tabId, work) {
  const recorder = new TabVideoRecorder();

  try {
    await recorder.start(tabId);
    const workResult = await work();
    const videoResult = await recorder.stop();

    return {
      workResult,
      videoResult,
    };
  } catch (error) {
    await recorder.cancel();
    throw error;
  }
}
