import { ethers } from "hardhat";

/**
 * Deploys the Talos Protocol core contracts to Pharos Atlantic Testnet.
 *
 *   1. TalosRegistry(protocolWallet)
 *   2. TalosNameService()
 *
 * MitosToken is deployed per-Talos at Genesis (from the web layer), not here.
 *
 * Run: pnpm --dir contracts deploy:atlantic
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const protocolWallet = process.env.TALOS_PROTOCOL_WALLET || deployer.address;

  console.log("Deployer:        ", deployer.address);
  console.log("Protocol wallet: ", protocolWallet);

  const Registry = await ethers.getContractFactory("TalosRegistry");
  const registry = await Registry.deploy(protocolWallet);
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log("TalosRegistry deployed:    ", registryAddr);

  const NameService = await ethers.getContractFactory("TalosNameService");
  const nameService = await NameService.deploy(registryAddr);
  await nameService.waitForDeployment();
  const nameServiceAddr = await nameService.getAddress();
  console.log("TalosNameService deployed: ", nameServiceAddr);

  console.log("\n── Add to web/.env.local ──────────────────────────");
  console.log(`NEXT_PUBLIC_TALOS_REGISTRY_CONTRACT=${registryAddr}`);
  console.log(`NEXT_PUBLIC_TALOS_NAME_SERVICE_CONTRACT=${nameServiceAddr}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
