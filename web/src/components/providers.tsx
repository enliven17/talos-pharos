"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import {
  createWalletClient,
  custom,
  getAddress,
  type WalletClient,
  type Address,
} from "viem";
import { pharosAtlantic, PHAROS_CHAIN_ID } from "@/lib/evm";

// ── EIP-1193 provider typing (injected wallet, e.g. MetaMask) ───────────
interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

const PHAROS_RPC_URL =
  process.env.NEXT_PUBLIC_PHAROS_RPC_URL ?? "https://atlantic.dplabs-internal.com";
const PHAROS_EXPLORER =
  process.env.NEXT_PUBLIC_PHAROS_EXPLORER ?? "https://atlantic.pharosscan.xyz";

/** chainId 688689 as the 0x hex string EIP-1193 expects. */
const CHAIN_ID_HEX = `0x${PHAROS_CHAIN_ID.toString(16)}`;

function getInjectedProvider(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  return window.ethereum ?? null;
}

/**
 * Ensure the injected wallet is on Pharos Atlantic (688689). Tries to switch;
 * if the chain is unknown to the wallet (4902), adds it then switches.
 */
async function ensurePharosChain(provider: Eip1193Provider): Promise<void> {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID_HEX }],
    });
  } catch (err) {
    const code = (err as { code?: number })?.code;
    // 4902 = chain not added to the wallet. Add it, then switch.
    if (code === 4902 || code === -32603) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: CHAIN_ID_HEX,
            chainName: "Pharos Atlantic Testnet",
            nativeCurrency: { name: "Pharos", symbol: "PHRS", decimals: 18 },
            rpcUrls: [PHAROS_RPC_URL],
            blockExplorerUrls: [PHAROS_EXPLORER],
          },
        ],
      });
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CHAIN_ID_HEX }],
      });
    } else {
      throw err;
    }
  }
}

interface WalletContextValue {
  /** Connected EVM address (0x), or null. */
  address: Address | null;
  isConnected: boolean;
  /** Currently selected chainId (decimal), or null. */
  chainId: number | null;
  /** True when the wallet is on Pharos Atlantic (688689). */
  isCorrectChain: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  /** Ensure/switch the wallet to Pharos Atlantic. */
  switchChain: () => Promise<void>;
  /**
   * Get a viem WalletClient bound to the injected provider + connected account
   * on the Pharos Atlantic chain. Throws if no wallet / account.
   */
  getWalletClient: () => Promise<WalletClient>;
}

const WalletContext = createContext<WalletContextValue>({
  address: null,
  isConnected: false,
  chainId: null,
  isCorrectChain: false,
  connect: async () => {},
  disconnect: () => {},
  switchChain: async () => {},
  getWalletClient: async () => {
    throw new Error("Wallet not connected");
  },
});

/** Hook exposing the connected EVM wallet + a viem WalletClient factory. */
export function useEvmWallet(): WalletContextValue {
  return useContext(WalletContext);
}

export function Providers({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);

  // Restore an already-authorized account on mount (no prompt).
  useEffect(() => {
    const provider = getInjectedProvider();
    if (!provider) return;

    provider
      .request({ method: "eth_accounts" })
      .then((accs) => {
        const list = accs as string[];
        if (list && list.length > 0) setAddress(getAddress(list[0]));
      })
      .catch(() => {});

    provider
      .request({ method: "eth_chainId" })
      .then((id) => setChainId(Number(id as string)))
      .catch(() => {});

    const onAccountsChanged = (...args: unknown[]) => {
      const accs = args[0] as string[];
      setAddress(accs && accs.length > 0 ? getAddress(accs[0]) : null);
    };
    const onChainChanged = (...args: unknown[]) => {
      setChainId(Number(args[0] as string));
    };
    provider.on?.("accountsChanged", onAccountsChanged);
    provider.on?.("chainChanged", onChainChanged);
    return () => {
      provider.removeListener?.("accountsChanged", onAccountsChanged);
      provider.removeListener?.("chainChanged", onChainChanged);
    };
  }, []);

  const connect = useCallback(async () => {
    const provider = getInjectedProvider();
    if (!provider) {
      throw new Error(
        "No EVM wallet detected. Install MetaMask (or another injected wallet).",
      );
    }
    const accs = (await provider.request({
      method: "eth_requestAccounts",
    })) as string[];
    if (!accs || accs.length === 0) throw new Error("No account authorized.");

    await ensurePharosChain(provider);

    setAddress(getAddress(accs[0]));
    const id = (await provider.request({ method: "eth_chainId" })) as string;
    setChainId(Number(id));
  }, []);

  const switchChain = useCallback(async () => {
    const provider = getInjectedProvider();
    if (!provider) throw new Error("No EVM wallet detected.");
    await ensurePharosChain(provider);
    const id = (await provider.request({ method: "eth_chainId" })) as string;
    setChainId(Number(id));
  }, []);

  const disconnect = useCallback(() => {
    // Injected wallets have no programmatic disconnect; clear local state.
    setAddress(null);
  }, []);

  const getWalletClient = useCallback(async (): Promise<WalletClient> => {
    const provider = getInjectedProvider();
    if (!provider) throw new Error("No EVM wallet detected.");
    const accs = (await provider.request({
      method: "eth_requestAccounts",
    })) as string[];
    if (!accs || accs.length === 0) throw new Error("No account authorized.");
    await ensurePharosChain(provider);
    return createWalletClient({
      account: getAddress(accs[0]),
      chain: pharosAtlantic,
      transport: custom(provider),
    });
  }, []);

  return (
    <WalletContext.Provider
      value={{
        address,
        isConnected: !!address,
        chainId,
        isCorrectChain: chainId === PHAROS_CHAIN_ID,
        connect,
        disconnect,
        switchChain,
        getWalletClient,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}
