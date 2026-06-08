// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title TalosRegistry
/// @notice EVM port of the Soroban TalosRegistry contract for Pharos.
///         Creates and manages Talos entities on-chain (Genesis), stores
///         Patron/Kernel/Pulse config, and exposes the protocol fee policy.
/// @dev Soroban `require_auth()` is mapped to `msg.sender` checks. The 3%
///      protocol fee is a policy value (bps) stored on-chain; fund movement
///      is handled off-chain / in the payment layer, mirroring the original
///      Soroban contract which stored the fee but did not transfer it.
contract TalosRegistry is Ownable2Step {
    // ── Data Types ──────────────────────────────────────────────────────

    /// @dev Shares are percentages and MUST sum to 100.
    struct Patron {
        uint32 creatorShare;
        uint32 investorShare;
        uint32 treasuryShare;
        address creatorAddr;
        address investorAddr;
        address treasuryAddr;
    }

    struct Kernel {
        uint256 approvalThreshold;
        uint256 gtmBudget;
        uint256 minPatronPulse;
    }

    struct Pulse {
        uint256 totalSupply;
        uint256 priceUsdCents;
        string tokenSymbol;
    }

    struct Talos {
        uint256 id;
        string name;
        string category;
        string description;
        address creator;
        Patron patron;
        Kernel kernel;
        Pulse pulse;
        uint64 createdAt;
        bool active;
    }

    // ── Constants ───────────────────────────────────────────────────────

    /// @notice Protocol fee in basis points (3%).
    uint32 public constant PROTOCOL_FEE_BPS = 300;

    uint256 internal constant MAX_NAME_LEN = 64;
    uint256 internal constant MAX_CATEGORY_LEN = 64;
    uint256 internal constant MAX_DESCRIPTION_LEN = 1024;
    uint256 internal constant MAX_SYMBOL_LEN = 16;

    // ── Storage ─────────────────────────────────────────────────────────

    address public protocolWallet;
    uint256 public nextTalosId;

    mapping(uint256 => Talos) private _talos;
    mapping(uint256 => address) public creatorOf;

    // ── Events ──────────────────────────────────────────────────────────

    event TalosCreated(uint256 indexed talosId, address indexed creator, string name);
    event PatronUpdated(
        uint256 indexed talosId,
        uint32 creatorShare,
        uint32 investorShare,
        uint32 treasuryShare
    );
    event ProtocolWalletUpdated(address indexed protocolWallet);

    // ── Errors ──────────────────────────────────────────────────────────

    error TalosNotFound();
    error Unauthorized();
    error ZeroAddress();
    error InvalidShares();
    error InvalidPulse();
    error StringTooLong();

    // ── Init ────────────────────────────────────────────────────────────

    /// @notice Set protocol wallet and start IDs at 1. Mirrors Soroban `initialize`.
    /// @dev Owner = deployer (via Ownable2Step). Soroban version was unguarded.
    constructor(address protocolWallet_) Ownable(msg.sender) {
        if (protocolWallet_ == address(0)) revert ZeroAddress();
        protocolWallet = protocolWallet_;
        nextTalosId = 1;
    }

    // ── Core ────────────────────────────────────────────────────────────

    /// @notice Create a new Talos on-chain. Caller must be the patron's creator.
    /// @return talosId The newly assigned Talos ID.
    function createTalos(
        string calldata name,
        string calldata category,
        string calldata description,
        Patron calldata patron,
        Kernel calldata kernel,
        Pulse calldata pulse
    ) external returns (uint256 talosId) {
        if (msg.sender != patron.creatorAddr) revert Unauthorized();
        _validatePatron(patron);
        _validatePulse(pulse);
        if (bytes(name).length == 0 || bytes(name).length > MAX_NAME_LEN) revert StringTooLong();
        if (bytes(category).length > MAX_CATEGORY_LEN) revert StringTooLong();
        if (bytes(description).length > MAX_DESCRIPTION_LEN) revert StringTooLong();
        if (bytes(pulse.tokenSymbol).length > MAX_SYMBOL_LEN) revert StringTooLong();

        talosId = nextTalosId;

        Talos storage t = _talos[talosId];
        t.id = talosId;
        t.name = name;
        t.category = category;
        t.description = description;
        t.creator = patron.creatorAddr;
        t.patron = patron;
        t.kernel = kernel;
        t.pulse = pulse;
        t.createdAt = uint64(block.timestamp);
        t.active = true;

        creatorOf[talosId] = patron.creatorAddr;
        nextTalosId = talosId + 1;

        emit TalosCreated(talosId, patron.creatorAddr, name);
    }

    // ── Reads ───────────────────────────────────────────────────────────

    /// @notice Get a Talos by ID. Reverts if it does not exist.
    function getTalos(uint256 talosId) external view returns (Talos memory) {
        if (_talos[talosId].id == 0) revert TalosNotFound();
        return _talos[talosId];
    }

    /// @notice Whether a Talos exists and is active.
    function isActive(uint256 talosId) external view returns (bool) {
        return _talos[talosId].id != 0 && _talos[talosId].active;
    }

    // ── Mutations (creator-gated) ───────────────────────────────────────

    function updatePatron(uint256 talosId, Patron calldata patron) external {
        Talos storage t = _talos[talosId];
        if (t.id == 0) revert TalosNotFound();
        if (msg.sender != t.creator) revert Unauthorized();
        _validatePatron(patron);

        t.patron = patron;
        emit PatronUpdated(
            talosId,
            patron.creatorShare,
            patron.investorShare,
            patron.treasuryShare
        );
    }

    function updateKernel(uint256 talosId, Kernel calldata kernel) external {
        Talos storage t = _talos[talosId];
        if (t.id == 0) revert TalosNotFound();
        if (msg.sender != t.creator) revert Unauthorized();

        t.kernel = kernel;
    }

    function updatePulse(uint256 talosId, Pulse calldata pulse) external {
        Talos storage t = _talos[talosId];
        if (t.id == 0) revert TalosNotFound();
        if (msg.sender != t.creator) revert Unauthorized();
        _validatePulse(pulse);
        if (bytes(pulse.tokenSymbol).length > MAX_SYMBOL_LEN) revert StringTooLong();

        t.pulse = pulse;
    }

    function deactivateTalos(uint256 talosId) external {
        Talos storage t = _talos[talosId];
        if (t.id == 0) revert TalosNotFound();
        if (msg.sender != t.creator) revert Unauthorized();

        t.active = false;
    }

    // ── Admin ───────────────────────────────────────────────────────────

    /// @notice Update the protocol wallet (owner only).
    function setProtocolWallet(address protocolWallet_) external onlyOwner {
        if (protocolWallet_ == address(0)) revert ZeroAddress();
        protocolWallet = protocolWallet_;
        emit ProtocolWalletUpdated(protocolWallet_);
    }

    /// @notice Protocol fee in basis points (kept for ABI parity with Soroban).
    function protocolFeeBps() external pure returns (uint32) {
        return PROTOCOL_FEE_BPS;
    }

    // ── Validation ──────────────────────────────────────────────────────

    function _validatePatron(Patron calldata p) internal pure {
        if (p.investorAddr == address(0) || p.treasuryAddr == address(0)) revert ZeroAddress();
        // Shares are percentages and must sum to exactly 100.
        if (uint256(p.creatorShare) + p.investorShare + p.treasuryShare != 100) {
            revert InvalidShares();
        }
    }

    function _validatePulse(Pulse calldata p) internal pure {
        if (p.totalSupply == 0) revert InvalidPulse();
    }
}
