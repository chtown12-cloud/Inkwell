import { NextResponse } from "next/server";

/* Fallback for the Web Share Target POST when the service worker isn't
   controlling yet (very first launch). The photo can't be recovered
   server-side without storing it, so we bounce to /capture with a flag
   that tells the user to try the share again (the SW registers on load,
   so the second attempt works). Normally the SW intercepts this POST and
   this handler never runs. */
export async function POST(request) {
  return NextResponse.redirect(new URL("/capture?shared=missed", request.url), 303);
}

export const dynamic = "force-dynamic";
