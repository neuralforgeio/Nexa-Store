import { getRepository } from "@/lib/catalog/repo";
import type { AccessControlState } from "@/lib/catalog/types";

/**
 * Admin access control (D8). The blocked flag lives in
 * data/store/access-control.json — writable only by the Developer
 * (capability "access.manage"), never through the Admin settings routes.
 *
 * Reads are lenient on purpose: a missing or corrupt file must not take
 * the whole store down. Fail-open is safe here because Admin can never
 * write this file through any mutation surface.
 */

const FALLBACK: AccessControlState = { adminBlocked: false };

export async function readAccessControl(): Promise<AccessControlState> {
  try {
    const { repo } = getRepository();
    const read = await repo.readSnapshot();
    return read.snapshot.accessControl ?? FALLBACK;
  } catch {
    return FALLBACK;
  }
}

export async function isAdminBlocked(): Promise<boolean> {
  return (await readAccessControl()).adminBlocked === true;
}
