// Off-thread tic-tac-toe bot. The solo page posts a position here and gets back
// the bot's move, so even the deepest search ("umulig" on the big boards) never
// blocks the UI thread — on a low-power classroom Chromebook a main-thread
// search froze the tab mid-animation, which students read as a crash.
//
// Pure compute: it imports only the bot/search modules, never the DOM or React.
// All the decision-making lives in botProtocol.handleBotRequest so it can be
// tested without a worker; what's left here is the message plumbing.

import { handleBotRequest } from "@/lib/ttt/botProtocol";

const ctx = self as unknown as {
  postMessage: (m: unknown) => void;
  addEventListener: (t: "message", cb: (e: MessageEvent) => void) => void;
};

ctx.addEventListener("message", (e: MessageEvent) => {
  ctx.postMessage(handleBotRequest(e.data));
});
