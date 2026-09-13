import { NexaApp } from "@/components/store/nexa-app";

/**
 * Nexa Store — single user-visible route (sandbox platform constraint, A1).
 * All views are client-side hash routes rendered by this shell;
 * server-side logic lives in /api route handlers.
 */
export default function Page() {
  return <NexaApp />;
}
