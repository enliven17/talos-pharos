import { expect } from "chai";
import { ethers } from "hardhat";

// Parity tests mirroring the original Soroban `cargo test` coverage, plus the
// hardened access-control behaviour added after security review:
// Talos creation + auth gating, share validation, creator-gated name
// registration with front-running protection, name release, Mitos supply.

const kernel = { approvalThreshold: 1000, gtmBudget: 20000, minPatronPulse: 1000 };
const pulse = { totalSupply: 1_000_000, priceUsdCents: 250, tokenSymbol: "AGNT" };

function patronFor(creator: string, investor: string, treasury: string) {
  return {
    creatorShare: 60,
    investorShare: 25,
    treasuryShare: 15,
    creatorAddr: creator,
    investorAddr: investor,
    treasuryAddr: treasury,
  };
}

describe("TalosRegistry", () => {
  async function deploy() {
    const [deployer, creator, investor, treasury, other] =
      await ethers.getSigners();
    const Registry = await ethers.getContractFactory("TalosRegistry");
    const registry = await Registry.deploy(deployer.address);
    await registry.waitForDeployment();
    return { registry, deployer, creator, investor, treasury, other };
  }

  it("starts IDs at 1 and stores protocol fee = 300 bps", async () => {
    const { registry } = await deploy();
    expect(await registry.nextTalosId()).to.equal(1n);
    expect(await registry.protocolFeeBps()).to.equal(300);
  });

  it("creates a Talos and assigns sequential IDs", async () => {
    const { registry, creator, investor, treasury } = await deploy();
    const patron = patronFor(creator.address, investor.address, treasury.address);

    await expect(
      registry
        .connect(creator)
        .createTalos("Vega", "Marketing", "AI agent", patron, kernel, pulse),
    )
      .to.emit(registry, "TalosCreated")
      .withArgs(1n, creator.address, "Vega");

    expect(await registry.nextTalosId()).to.equal(2n);
    expect(await registry.creatorOf(1)).to.equal(creator.address);
    expect(await registry.isActive(1)).to.equal(true);

    const t = await registry.getTalos(1);
    expect(t.name).to.equal("Vega");
    expect(t.pulse.tokenSymbol).to.equal("AGNT");
  });

  it("rejects creation when caller is not the patron creator", async () => {
    const { registry, creator, investor, treasury, other } = await deploy();
    const patron = patronFor(creator.address, investor.address, treasury.address);
    await expect(
      registry
        .connect(other)
        .createTalos("Vega", "Marketing", "x", patron, kernel, pulse),
    ).to.be.revertedWithCustomError(registry, "Unauthorized");
  });

  it("rejects patron shares that do not sum to 100", async () => {
    const { registry, creator, investor, treasury } = await deploy();
    const bad = { ...patronFor(creator.address, investor.address, treasury.address), creatorShare: 50 };
    await expect(
      registry.connect(creator).createTalos("Vega", "Marketing", "x", bad, kernel, pulse),
    ).to.be.revertedWithCustomError(registry, "InvalidShares");
  });

  it("rejects zero investor/treasury address", async () => {
    const { registry, creator, treasury } = await deploy();
    const bad = patronFor(creator.address, ethers.ZeroAddress, treasury.address);
    await expect(
      registry.connect(creator).createTalos("Vega", "Marketing", "x", bad, kernel, pulse),
    ).to.be.revertedWithCustomError(registry, "ZeroAddress");
  });

  it("rejects zero totalSupply pulse", async () => {
    const { registry, creator, investor, treasury } = await deploy();
    const patron = patronFor(creator.address, investor.address, treasury.address);
    const badPulse = { ...pulse, totalSupply: 0 };
    await expect(
      registry.connect(creator).createTalos("Vega", "Marketing", "x", patron, kernel, badPulse),
    ).to.be.revertedWithCustomError(registry, "InvalidPulse");
  });

  it("only creator can update / deactivate", async () => {
    const { registry, creator, investor, treasury, other } = await deploy();
    const patron = patronFor(creator.address, investor.address, treasury.address);
    await registry
      .connect(creator)
      .createTalos("Vega", "Marketing", "x", patron, kernel, pulse);

    await expect(
      registry.connect(other).deactivateTalos(1),
    ).to.be.revertedWithCustomError(registry, "Unauthorized");

    await registry.connect(creator).deactivateTalos(1);
    expect(await registry.isActive(1)).to.equal(false);
  });

  it("reverts on missing Talos", async () => {
    const { registry } = await deploy();
    await expect(registry.getTalos(99)).to.be.revertedWithCustomError(
      registry,
      "TalosNotFound",
    );
  });

  it("only owner can set protocol wallet", async () => {
    const { registry, other } = await deploy();
    await expect(
      registry.connect(other).setProtocolWallet(other.address),
    ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
  });
});

describe("TalosNameService", () => {
  async function deploy() {
    const [deployer, creatorA, creatorB, investor, treasury] =
      await ethers.getSigners();
    const Registry = await ethers.getContractFactory("TalosRegistry");
    const registry = await Registry.deploy(deployer.address);
    await registry.waitForDeployment();

    const NameService = await ethers.getContractFactory("TalosNameService");
    const ns = await NameService.deploy(await registry.getAddress());
    await ns.waitForDeployment();

    // Talos 1 -> creatorA, Talos 2 -> creatorB
    await registry
      .connect(creatorA)
      .createTalos("A", "Marketing", "x", patronFor(creatorA.address, investor.address, treasury.address), kernel, pulse);
    await registry
      .connect(creatorB)
      .createTalos("B", "Marketing", "x", patronFor(creatorB.address, investor.address, treasury.address), kernel, pulse);

    return { ns, creatorA, creatorB };
  }

  it("registers and resolves a name (creator-gated)", async () => {
    const { ns, creatorA } = await deploy();
    await expect(ns.connect(creatorA).registerName(1, "marketbot"))
      .to.emit(ns, "NameRegistered")
      .withArgs(1n, ethers.keccak256(ethers.toUtf8Bytes("marketbot")), "marketbot");
    expect(await ns.resolveName("marketbot")).to.equal(1n);
    expect(await ns.nameOf(1)).to.equal("marketbot");
    expect(await ns.hasName(1)).to.equal(true);
    expect(await ns.isNameAvailable("marketbot")).to.equal(false);
  });

  it("blocks non-creator from registering a name (anti-squat)", async () => {
    const { ns, creatorB } = await deploy();
    // creatorB tries to grab a name for Talos 1 (owned by creatorA)
    await expect(
      ns.connect(creatorB).registerName(1, "stealme"),
    ).to.be.revertedWithCustomError(ns, "Unauthorized");
  });

  it("rejects duplicate names across different Taloses", async () => {
    const { ns, creatorA, creatorB } = await deploy();
    await ns.connect(creatorA).registerName(1, "taken");
    await expect(
      ns.connect(creatorB).registerName(2, "taken"),
    ).to.be.revertedWithCustomError(ns, "NameTaken");
  });

  it("releases the old name when a Talos re-registers", async () => {
    const { ns, creatorA } = await deploy();
    await ns.connect(creatorA).registerName(1, "first");
    await ns.connect(creatorA).registerName(1, "second");
    expect(await ns.resolveName("first")).to.equal(0n); // freed
    expect(await ns.resolveName("second")).to.equal(1n);
    expect(await ns.nameOf(1)).to.equal("second");
  });

  it("creator can release a name", async () => {
    const { ns, creatorA } = await deploy();
    await ns.connect(creatorA).registerName(1, "temp");
    await ns.connect(creatorA).releaseName(1);
    expect(await ns.hasName(1)).to.equal(false);
    expect(await ns.isNameAvailable("temp")).to.equal(true);
  });

  it("validates names (length, charset, hyphens)", async () => {
    const { ns, creatorA } = await deploy();
    expect(await ns.isNameAvailable("ab")).to.equal(false); // too short
    expect(await ns.isNameAvailable("UPPER")).to.equal(false); // uppercase
    expect(await ns.isNameAvailable("a--b")).to.equal(false); // consecutive hyphen
    expect(await ns.isNameAvailable("-lead")).to.equal(false); // leading hyphen
    expect(await ns.isNameAvailable("trail-")).to.equal(false); // trailing hyphen
    expect(await ns.isNameAvailable("good-name-1")).to.equal(true);
    await expect(
      ns.connect(creatorA).registerName(1, "bad name"),
    ).to.be.revertedWithCustomError(ns, "InvalidName");
  });
});

describe("MitosToken", () => {
  it("mints full supply to treasury", async () => {
    const [, treasury] = await ethers.getSigners();
    const Mitos = await ethers.getContractFactory("MitosToken");
    const token = await Mitos.deploy("Vega Mitos", "VEGA", 1, treasury.address, 1_000_000);
    await token.waitForDeployment();

    const decimals = await token.decimals();
    const expected = 1_000_000n * 10n ** BigInt(decimals);
    expect(await token.totalSupply()).to.equal(expected);
    expect(await token.balanceOf(treasury.address)).to.equal(expected);
    expect(await token.symbol()).to.equal("VEGA");
    expect(await token.talosId()).to.equal(1n);
  });

  it("rejects zero supply and zero treasury", async () => {
    const [, treasury] = await ethers.getSigners();
    const Mitos = await ethers.getContractFactory("MitosToken");
    await expect(
      Mitos.deploy("X", "X", 1, treasury.address, 0),
    ).to.be.revertedWith("supply=0");
    await expect(
      Mitos.deploy("X", "X", 1, ethers.ZeroAddress, 100),
    ).to.be.revertedWith("treasury=0");
  });
});
