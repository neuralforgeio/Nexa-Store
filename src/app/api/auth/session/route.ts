import { NextRequest, NextResponse } from "next/server";
import { jsonOk, getSession } from "@/lib/api/http";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { isAdminBlocked } from "@/lib/auth/access";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  let { role, email } = getSession(req);

  // A blocked Admin's existing session is revoked immediately.
  if (role === "ADMIN" && (await isAdminBlocked())) {
    role = null;
    email = null;
    const response = jsonOk({ authenticated: false, role: null, email: null });
    response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
    return response;
  }

  return jsonOk({
    authenticated: role !== null,
    role,
    email,
  });
}
