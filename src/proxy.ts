import { NextRequest, NextResponse } from "next/server";

/**
 * Propagates the original pathname to the (rewritten) storefront page so the
 * server component can enforce the Developer's lockdown / maintenance gates
 * before a single byte of the storefront renders. Edge-safe: no fs access.
 *
 * Next 16 proxy convention (formerly middleware.ts).
 */
export default function proxy(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set("x-pathname", req.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Everything except API routes, Next internals, static assets and the gate
  // screens themselves (which must always render).
  matcher: ["/((?!api|_next/static|_next/image|lockdown|maintenance|game-icons|.*\\..*).*)"],
};

