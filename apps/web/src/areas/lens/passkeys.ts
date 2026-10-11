// passkeys.ts — B19.10: approvals with Face ID, on the phone.
//
// The browser half of Lens's B19.16. A passkey is made on this device (Face ID, Touch ID or the
// device's PIN — WebAuthn with user verification required) and Lens keeps its public key; from then
// on every approve or deny is signed with it over a challenge Lens issues for that one approval.
// Pushes arrive through /sw.js, subscribed with the key Lens serves.

import { agentBankApi, type PasskeyAssertion } from './agentBankApi'

export function b64u(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64u(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Whether this browser can make and use passkeys at all. */
export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && 'PublicKeyCredential' in window && !!navigator.credentials
}

/** Whether this browser can take pushes (on an iPhone: only once added to the Home Screen). */
export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window
}

/** Makes a passkey on this device and registers it with Lens. */
export async function registerThisDevice(name: string): Promise<void> {
  const { challenge, rp_id } = await agentBankApi.passkeyChallenge()
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: fromB64u(challenge),
      rp: { id: rp_id, name: 'Talyvor' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'Talyvor approvals', displayName: name },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }], // ES256, the one Lens verifies
      authenticatorSelection: { userVerification: 'required', residentKey: 'preferred' },
      attestation: 'none',
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null
  if (!cred) throw new Error('No passkey was made.')
  const res = cred.response as AuthenticatorAttestationResponse
  const spki = res.getPublicKey()
  if (!spki || res.getPublicKeyAlgorithm() !== -7) {
    throw new Error('This device made a passkey Lens cannot check (it needs ES256).')
  }
  await agentBankApi.registerPasskey({
    credential_id: b64u(cred.rawId),
    name,
    public_key: b64u(spki),
    client_data_json: b64u(res.clientDataJSON),
    authenticator_data: b64u(res.getAuthenticatorData()),
  })
}

/** Signs one approval's challenge with a passkey of this workspace — Face ID asks here. */
export async function signApproval(approvalID: string): Promise<PasskeyAssertion> {
  return assertOver(await agentBankApi.approvalChallenge(approvalID))
}

/** B30.96 — signs a saved payee's challenge the same way: a close or no match is confirmed only so (Lens B30.16). */
export async function signPayee(payeeID: string): Promise<PasskeyAssertion> {
  return assertOver(await agentBankApi.payeeChallenge(payeeID))
}

async function assertOver({ challenge, allow_credentials }: { challenge: string; allow_credentials: string[] | null }): Promise<PasskeyAssertion> {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: fromB64u(challenge),
      allowCredentials: (allow_credentials ?? []).map((id) => ({ type: 'public-key' as const, id: fromB64u(id) })),
      userVerification: 'required',
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null
  if (!cred) throw new Error('The approval was not signed.')
  const res = cred.response as AuthenticatorAssertionResponse
  return {
    credential_id: b64u(cred.rawId),
    client_data_json: b64u(res.clientDataJSON),
    authenticator_data: b64u(res.authenticatorData),
    signature: b64u(res.signature),
  }
}

/** Subscribes this device to approval pushes. */
export async function notifyThisDevice(): Promise<void> {
  const reg = await navigator.serviceWorker.register('/sw.js')
  const { public_key } = await agentBankApi.pushPublicKey()
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(public_key) })
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error('The browser gave no push subscription.')
  await agentBankApi.subscribePush({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } })
}
