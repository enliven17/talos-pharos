/**
 * Talos contract reads on Pharos — port of soroban.ts to viem.
 *
 * TalosRegistry + TalosNameService on Pharos Atlantic (EVM).
 * Read-only calls use a viem public client. Write calls (create Talos,
 * register name) are sent from the user's wallet in the frontend / API layer.
 */

import { getPublicClient, isValidEvmAddress } from "./evm";
import { type Address } from "viem";

export const TALOS_REGISTRY_CONTRACT = (process.env.NEXT_PUBLIC_TALOS_REGISTRY_CONTRACT ??
  "") as Address;

export const TALOS_NAME_SERVICE_CONTRACT =
  (process.env.NEXT_PUBLIC_TALOS_NAME_SERVICE_CONTRACT ?? "") as Address;

// Minimal ABIs — only the read functions used here.
const NAME_SERVICE_ABI = [
  {
    type: "function",
    name: "isNameAvailable",
    stateMutability: "view",
    inputs: [{ name: "name", type: "string" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "resolveName",
    stateMutability: "view",
    inputs: [{ name: "name", type: "string" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "nameOf",
    stateMutability: "view",
    inputs: [{ name: "talosId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

const REGISTRY_ABI = [
  {
    type: "function",
    name: "isActive",
    stateMutability: "view",
    inputs: [{ name: "talosId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "creatorOf",
    stateMutability: "view",
    inputs: [{ name: "talosId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "nextTalosId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const NAME_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/**
 * Check if a name is available on-chain. Falls back to regex validation if the
 * contract is not deployed yet.
 */
export async function isNameAvailableOnChain(name: string): Promise<boolean> {
  if (!TALOS_NAME_SERVICE_CONTRACT) {
    return NAME_REGEX.test(name) && !name.includes("--");
  }
  try {
    const client = getPublicClient();
    return (await client.readContract({
      address: TALOS_NAME_SERVICE_CONTRACT,
      abi: NAME_SERVICE_ABI,
      functionName: "isNameAvailable",
      args: [name],
    })) as boolean;
  } catch {
    return NAME_REGEX.test(name) && !name.includes("--");
  }
}

/** Resolve a name to its on-chain Talos ID. Returns null if unregistered. */
export async function resolveNameOnChain(name: string): Promise<number | null> {
  if (!TALOS_NAME_SERVICE_CONTRACT) return null;
  try {
    const client = getPublicClient();
    const id = (await client.readContract({
      address: TALOS_NAME_SERVICE_CONTRACT,
      abi: NAME_SERVICE_ABI,
      functionName: "resolveName",
      args: [name],
    })) as bigint;
    return id > BigInt(0) ? Number(id) : null;
  } catch {
    return null;
  }
}

/** Get the on-chain creator (owner) address of a Talos, or null. */
export async function creatorOfOnChain(talosId: number): Promise<string | null> {
  if (!TALOS_REGISTRY_CONTRACT) return null;
  try {
    const client = getPublicClient();
    const addr = (await client.readContract({
      address: TALOS_REGISTRY_CONTRACT,
      abi: REGISTRY_ABI,
      functionName: "creatorOf",
      args: [BigInt(talosId)],
    })) as string;
    return addr && addr !== "0x0000000000000000000000000000000000000000" ? addr : null;
  } catch {
    return null;
  }
}

export { isValidEvmAddress };
