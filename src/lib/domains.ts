import { PublicKey, type Connection } from "@solana/web3.js";

import { COOKIE_DOMAINS_MARKET_PROGRAM_ID, COOKIE_DOMAINS_PROGRAM_ID } from "./config";
import { displayName, looksLikeName, nameError, normalizeName } from "./names";

/**
 * CookOven `.cook` names, read straight from the chain. The registry dApp is client-side only, so
 * there is no name API to call and no indexer to trust: a lookup is one PDA read.
 *
 * Byte layouts and the anchor discriminators below match `cookiechain/cookie-mcp`
 * (`src/core/domains/program.ts`), which pins them against the deployed IDL.
 */

const DOMAIN_SEED = new TextEncoder().encode("domain");
const PRIMARY_SEED = new TextEncoder().encode("primary");
const ESCROW_AUTHORITY_SEED = new TextEncoder().encode("escrow_authority");

const DOMAIN_DISCRIMINATOR = Uint8Array.from([35, 146, 98, 112, 13, 230, 231, 153]);
const PRIMARY_DISCRIMINATOR = Uint8Array.from([231, 255, 61, 63, 142, 184, 254, 42]);

/** `Pubkey::default()` — how the registry spells "unset". */
const UNSET_PUBKEY = "11111111111111111111111111111111";

/** Current `DomainAccount` size: 8 disc + (4 + 32) name + 3 × 32 pubkey + 8 i64 + 1 bump. */
const DOMAIN_ACCOUNT_SIZE = 149;

export class NameError extends Error {}

export function domainPda(label: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [DOMAIN_SEED, new TextEncoder().encode(label)],
    COOKIE_DOMAINS_PROGRAM_ID,
  )[0];
}

export function primaryPda(owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [PRIMARY_SEED, owner.toBytes()],
    COOKIE_DOMAINS_PROGRAM_ID,
  )[0];
}

/**
 * The marketplace escrow. A name that is listed for sale is owned by this PDA rather than by its
 * seller, so it must never be resolved into a payment address: the escrow is program-owned and has
 * no signer, and paying it would put the money somewhere nobody can spend it.
 */
export function escrowAuthorityPda(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [ESCROW_AUTHORITY_SEED],
    COOKIE_DOMAINS_MARKET_PROGRAM_ID,
  )[0];
}

export interface DecodedDomain {
  name: string;
  owner: string;
  resolver: string | null;
  createdAt: number | null;
  /** The pre-resolver account layout, still present for a couple of 2026 test names. */
  legacy: boolean;
}

function startsWithDiscriminator(data: Uint8Array, disc: Uint8Array): boolean {
  if (data.length < 8) return false;
  for (let i = 0; i < 8; i += 1) if (data[i] !== disc[i]) return false;
  return true;
}

export function decodeDomainAccount(data: Uint8Array): DecodedDomain | null {
  if (!startsWithDiscriminator(data, DOMAIN_DISCRIMINATOR)) return null;
  if (data.length < 12) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const nameLength = view.getUint32(8, true);
  const nameEnd = 12 + nameLength;
  if (nameLength === 0 || nameEnd + 32 > data.length) return null;

  const name = new TextDecoder().decode(data.subarray(12, nameEnd));
  const owner = new PublicKey(data.subarray(nameEnd, nameEnd + 32)).toBase58();

  if (data.length < DOMAIN_ACCOUNT_SIZE || nameEnd + 105 > data.length) {
    return { name, owner, resolver: null, createdAt: null, legacy: true };
  }
  const resolver = new PublicKey(data.subarray(nameEnd + 32, nameEnd + 64)).toBase58();
  return {
    name,
    owner,
    resolver: resolver === UNSET_PUBKEY ? null : resolver,
    createdAt: Number(view.getBigInt64(nameEnd + 96, true)),
    legacy: false,
  };
}

/** `clear_primary_domain` leaves the account in place with an empty name, which decodes to null. */
export function decodePrimaryAccount(data: Uint8Array): string | null {
  if (!startsWithDiscriminator(data, PRIMARY_DISCRIMINATOR)) return null;
  if (data.length < 44) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const length = view.getUint32(40, true);
  if (length === 0 || 44 + length > data.length) return null;
  return new TextDecoder().decode(data.subarray(44, 44 + length));
}

export async function fetchDomain(
  connection: Connection,
  input: string,
): Promise<DecodedDomain | null> {
  const label = normalizeName(input);
  const err = nameError(label);
  if (err) throw new NameError(`"${input}" is not a valid .cook name — ${err}`);
  const info = await connection.getAccountInfo(domainPda(label));
  return info ? decodeDomainAccount(new Uint8Array(info.data)) : null;
}

/** The wallet's own `.cook` name, for showing a jar under a name instead of an address. */
export async function fetchPrimaryName(
  connection: Connection,
  owner: PublicKey,
): Promise<string | null> {
  const info = await connection.getAccountInfo(primaryPda(owner));
  if (!info) return null;
  const label = decodePrimaryAccount(new Uint8Array(info.data));
  return label ? displayName(label) : null;
}

export interface ResolvedRecipient {
  address: PublicKey;
  /** The `.cook` name the address came from, when the caller passed one. */
  name: string | null;
}

/**
 * Accept either a base58 address or a `.cook` name wherever a recipient is expected. A well-formed
 * address never touches the network. A name that is listed for sale is refused rather than resolved
 * — see `escrowAuthorityPda`.
 */
export async function resolveRecipient(
  connection: Connection,
  input: string,
): Promise<ResolvedRecipient> {
  const s = input.trim();
  if (!looksLikeName(s)) {
    try {
      return { address: new PublicKey(s), name: null };
    } catch {
      throw new NameError(`"${input}" is neither a Cookie Chain address nor a .cook name`);
    }
  }

  const label = normalizeName(s);
  const domain = await fetchDomain(connection, label);
  if (!domain) {
    throw new NameError(`${displayName(label)} is not registered, so it resolves to no address`);
  }
  if (domain.owner === escrowAuthorityPda().toBase58()) {
    throw new NameError(
      `${displayName(label)} is listed for sale on the .cook marketplace, so it currently points ` +
        "at the marketplace escrow rather than a wallet — pay its owner's address directly",
    );
  }
  return { address: new PublicKey(domain.owner), name: displayName(label) };
}
