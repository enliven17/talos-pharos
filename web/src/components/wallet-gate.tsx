"use client";

import { useState } from "react";
import { useEvmWallet } from "./providers";

interface WalletGateProps {
  children: React.ReactNode;
  title?: string;
  description?: string;
}

export function WalletGate({
  children,
  title = "Connect Wallet to Continue",
  description = "This feature requires a connected EVM wallet on Pharos Atlantic.",
}: WalletGateProps) {
  const { isConnected, connect } = useEvmWallet();
  const [error, setError] = useState<string | null>(null);

  if (isConnected) return <>{children}</>;

  const handleConnect = async () => {
    setError(null);
    try {
      await connect();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Connection failed. Is MetaMask installed?",
      );
    }
  };

  return (
    <div className="max-w-lg mx-auto px-6 py-32 text-center">
      <div className="bg-surface border border-border p-10">
        <div className="text-muted text-xs mb-6 tracking-wider">[WALLET REQUIRED]</div>
        <div className="w-12 h-12 mx-auto mb-6 border border-border flex items-center justify-center">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-muted"
          >
            <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
            <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
            <path d="M18 12a2 2 0 0 0 0 4h4v-4h-4z" />
          </svg>
        </div>
        <h2 className="text-lg font-bold text-accent mb-2">{title}</h2>
        <p className="text-sm text-muted mb-8 leading-relaxed">{description}</p>
        <button
          onClick={handleConnect}
          className="bg-accent text-background px-8 py-2.5 text-sm font-medium hover:bg-foreground transition-colors"
        >
          Connect Wallet
        </button>
        {error && (
          <p className="text-xs text-red-500 mt-6 leading-relaxed">{error}</p>
        )}
        <p className="text-xs text-muted mt-6">
          Requires MetaMask (or another injected EVM wallet) on Pharos Atlantic.
        </p>
      </div>
    </div>
  );
}

export function ConnectButton({
  label = "Connect Wallet",
  className = "",
}: {
  label?: string;
  className?: string;
}) {
  const { isConnected, connect } = useEvmWallet();

  if (isConnected) return null;

  return (
    <button
      onClick={() => connect().catch(() => {})}
      className={`border border-border px-4 py-2 text-sm text-foreground hover:bg-surface-hover transition-colors ${className}`}
    >
      {label}
    </button>
  );
}

/**
 * Thin façade over the EVM wallet context. `address` is the connected 0x address.
 * `getWalletClient()` returns a viem WalletClient for writing contracts.
 */
export function useWallet() {
  const {
    isConnected,
    address,
    chainId,
    isCorrectChain,
    connect,
    disconnect,
    switchChain,
    getWalletClient,
  } = useEvmWallet();
  return {
    isConnected,
    address,
    chainId,
    isCorrectChain,
    connect,
    disconnect,
    switchChain,
    getWalletClient,
  };
}
