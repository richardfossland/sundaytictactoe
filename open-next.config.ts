import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// OpenNext → Cloudflare Workers adapter. Default config is sufficient: the app
// has no ISR/edge-cache needs (game state lives in Supabase). Deployed at
// chess.sundaysuite.app.
export default defineCloudflareConfig();
