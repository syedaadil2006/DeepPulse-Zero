import { check, issue, parseClaims, signingKeys } from "../../../lib/certificate.ts"; // relative + .ts so node:test can import this route

export const dynamic = "force-dynamic";

/** Issue a signed Proof-of-Pulse certificate for a passed Breath Challenge. */
export async function POST(req: Request) {
  const claims = parseClaims(await req.json().catch(() => null));
  if (!claims) return Response.json({ error: "Only a passed Breath Challenge can be certified." }, { status: 400 });
  return Response.json({ token: issue(claims, signingKeys().privateKey) });
}

/** Verify a certificate token: GET /api/certificate?t=<token> */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  const cert = check(token, signingKeys().publicKey);
  return Response.json(cert ? { valid: true, cert } : { valid: false });
}
