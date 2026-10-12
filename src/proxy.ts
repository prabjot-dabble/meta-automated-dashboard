import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Password gate for the whole dashboard (pages AND /api routes).
 *
 * The dashboard shows live ad spend and revenue and has no accounts of its own,
 * so anyone who finds the URL could read it. This puts a browser password prompt
 * (HTTP Basic auth) in front of everything. Set `DASHBOARD_PASSWORD` in the
 * environment (Vercel: Settings -> Environment Variables). The username is
 * ignored: type anything, the password is what counts.
 *
 * - Password set: every request needs it.
 * - Password NOT set in production: fail closed (503). A missing setting must
 *   never leave live ad data open to the internet.
 * - Password NOT set in development: open, so local work isn't interrupted.
 *
 * Next 16 renamed `middleware` to `proxy`; it runs on the Node.js runtime.
 */

const REALM = 'Basic realm="Dabble Meta Dashboard", charset="UTF-8"';

/** Compare via fixed-length hashes so timing reveals nothing about the password. */
function passwordMatches(given: string, expected: string): boolean {
    const a = createHash("sha256").update(given).digest();
    const b = createHash("sha256").update(expected).digest();
    return timingSafeEqual(a, b);
}

/** Returns the password from a `Authorization: Basic base64(user:pass)` header. */
function passwordFrom(header: string | null): string | null {
    if (!header || !header.toLowerCase().startsWith("basic ")) return null;
    try {
        const decoded = Buffer.from(header.slice(6).trim(), "base64").toString(
            "utf8"
        );
        const colon = decoded.indexOf(":");
        // Everything after the FIRST colon is the password (it may contain colons).
        return colon === -1 ? null : decoded.slice(colon + 1);
    } catch {
        return null;
    }
}

const noStore = { "Cache-Control": "no-store" };

export async function proxy(request: NextRequest) {
    const expected = process.env.DASHBOARD_PASSWORD;

    if (!expected) {
        if (process.env.NODE_ENV === "production") {
            return new NextResponse(
                "Dashboard locked: DASHBOARD_PASSWORD is not configured on the server.",
                { status: 503, headers: noStore }
            );
        }
        return NextResponse.next();
    }

    const given = passwordFrom(request.headers.get("authorization"));
    if (given !== null && passwordMatches(given, expected)) {
        return NextResponse.next();
    }

    // Wrong guess: wait a moment so brute-forcing is slow. (No attempt counter:
    // serverless instances don't share memory, so use a long password.)
    if (given !== null) {
        await new Promise((resolve) => setTimeout(resolve, 600));
    }

    return new NextResponse("Authentication required.", {
        status: 401,
        headers: { "WWW-Authenticate": REALM, ...noStore },
    });
}

export const config = {
    // Everything except Next's static build output and the favicon. `/api` is
    // deliberately NOT excluded: the data routes must be behind the password too.
    matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
