type MessageFns = {
  onMessage: (event: MessageEvent) => void;
};

let impl: MessageFns;
export function registerMessageFunctions(fns: MessageFns) { impl = fns; }

export function bindMessageHandler() {
  window.onmessage = (event) => impl.onMessage(event);
}

export function postPluginMessage(payload: unknown) {
  parent.postMessage({ pluginMessage: payload }, '*');
}
