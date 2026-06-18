/** Open the session viewer in a focused popup window (same pattern as sign-off runner). */
export function openSessionViewerWindow() {
  return chrome.windows.create({
    url: chrome.runtime.getURL("viewer.html"),
    type: "popup",
    width: 980,
    height: 920,
    focused: true,
  });
}
