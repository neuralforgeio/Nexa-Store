import { NextRequest, NextResponse } from "next/server";
import { jsonOk, getSession } from "@/lib/api/http";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { readAccessControl, isAdminBlocked } from "@/lib/auth/access";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  let { role, email } = getSession(req);

  // A blocked Admin's existing session is revoked immediately. The block
  // info rides along so the dashboard can show the blocking modal with the
  // Developer's reason instead of a silent redirect to /login.
  if (role === "ADMIN" && (await isAdminBlocked())) {
    const control = await readAccessControl();
    role = null;
    email = null;
    const response = jsonOk({
      authenticated: false,
      role: null,
      email: null,
      blocked: {
        byRole: "DEVELOPER" as const,
        reason: control.reason ?? null,
      },
    });
    response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
    return response;
  }

  return jsonOk({
    authenticated: role !== null,
    role,
    email,
  });
}
