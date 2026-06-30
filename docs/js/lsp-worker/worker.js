import BrowserLanguageServer from './BrowserLanguageServer.js';

// ---------------------------------------------------------------------------
// Worker Event Listener
// ---------------------------------------------------------------------------
const server = new BrowserLanguageServer();
self.addEventListener('message', async (e) => {
  const response = await server.handleMessage(e.data);
  if (response) {
    self.postMessage(response);
  }
});
