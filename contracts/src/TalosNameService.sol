// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.20;

interface ITalosRegistry {
    function creatorOf(uint256 talosId) external view returns (address);
}

/// @title TalosNameService
/// @notice EVM port of the Soroban TalosNameService for Pharos.
///         Maps human-readable names to Talos IDs (e.g. "marketbot" => 42).
/// @dev Registration is gated to the Talos creator (looked up from the
///      TalosRegistry) to prevent name squatting / front-running, which is an
///      open hole on a public EVM mempool. Full character validation
///      (lowercase alphanumeric + hyphens, no consecutive/leading/trailing
///      hyphens) is enforced on-chain, matching the off-chain Next.js regex.
contract TalosNameService {
    // ── Storage ─────────────────────────────────────────────────────────

    ITalosRegistry public immutable registry;

    mapping(string => uint256) private _nameToId; // name => talosId (0 = unset)
    mapping(uint256 => string) private _idToName; // talosId => name

    // ── Events ──────────────────────────────────────────────────────────

    event NameRegistered(uint256 indexed talosId, bytes32 indexed nameHash, string name);
    event NameReleased(uint256 indexed talosId, bytes32 indexed nameHash, string name);

    // ── Errors ──────────────────────────────────────────────────────────

    error InvalidName();
    error NameTaken();
    error Unauthorized();

    constructor(address registry_) {
        registry = ITalosRegistry(registry_);
    }

    // ── Core ────────────────────────────────────────────────────────────

    /// @notice Register a name for a Talos. Caller must be the Talos creator.
    ///         Reverts if the name is invalid or already taken. If the Talos
    ///         already had a name, the old name is released first.
    function registerName(uint256 talosId, string calldata name) external {
        if (msg.sender != registry.creatorOf(talosId)) revert Unauthorized();
        if (!_validateName(name)) revert InvalidName();
        if (_nameToId[name] != 0) revert NameTaken();

        // Release any previously held name so it doesn't dangle.
        string memory old = _idToName[talosId];
        if (bytes(old).length != 0) {
            delete _nameToId[old];
            emit NameReleased(talosId, keccak256(bytes(old)), old);
        }

        _nameToId[name] = talosId;
        _idToName[talosId] = name;

        emit NameRegistered(talosId, keccak256(bytes(name)), name);
    }

    /// @notice Release the name held by a Talos. Caller must be the creator.
    function releaseName(uint256 talosId) external {
        if (msg.sender != registry.creatorOf(talosId)) revert Unauthorized();
        string memory name = _idToName[talosId];
        if (bytes(name).length == 0) return;

        delete _nameToId[name];
        delete _idToName[talosId];
        emit NameReleased(talosId, keccak256(bytes(name)), name);
    }

    /// @notice Resolve a name to its Talos ID. Returns 0 if not registered.
    function resolveName(string calldata name) external view returns (uint256) {
        return _nameToId[name];
    }

    /// @notice Get the name for a Talos ID. Empty string if none.
    function nameOf(uint256 talosId) external view returns (string memory) {
        return _idToName[talosId];
    }

    /// @notice Whether a name is valid AND currently unclaimed.
    function isNameAvailable(string calldata name) external view returns (bool) {
        if (!_validateName(name)) return false;
        return _nameToId[name] == 0;
    }

    /// @notice Whether a Talos has a registered name.
    function hasName(uint256 talosId) external view returns (bool) {
        return bytes(_idToName[talosId]).length != 0;
    }

    // ── Validation ──────────────────────────────────────────────────────

    /// @dev 3-32 chars, lowercase [a-z0-9] and '-', no leading/trailing hyphen,
    ///      no consecutive hyphens.
    function _validateName(string calldata name) internal pure returns (bool) {
        bytes calldata b = bytes(name);
        uint256 len = b.length;
        if (len < 3 || len > 32) return false;

        bool prevHyphen = false;
        for (uint256 i = 0; i < len; i++) {
            bytes1 c = b[i];
            bool isLower = (c >= 0x61 && c <= 0x7a); // a-z
            bool isDigit = (c >= 0x30 && c <= 0x39); // 0-9
            bool isHyphen = (c == 0x2d); // '-'

            if (!isLower && !isDigit && !isHyphen) return false;

            if (isHyphen) {
                if (i == 0 || i == len - 1) return false; // no leading/trailing
                if (prevHyphen) return false; // no consecutive
                prevHyphen = true;
            } else {
                prevHyphen = false;
            }
        }
        return true;
    }
}
