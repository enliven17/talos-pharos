// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MitosToken
/// @notice Per-agent equity token for a Talos. EVM/ERC-20 replacement for the
///         Stellar classic asset ("Mitos") issued per Talos. The full supply is
///         minted once to the operator treasury at deployment; holders (Patrons)
///         get governance + revenue-share rights enforced off-chain / in the
///         registry + payment layer.
/// @dev One MitosToken is deployed per Talos. `symbol` is the Talos's Pulse
///      token symbol (e.g. "VEGA"). Decimals default to 18 (EVM standard);
///      Stellar used 7 — the web layer must scale amounts accordingly.
contract MitosToken is ERC20 {
    /// @notice The Talos ID this token belongs to.
    uint256 public immutable talosId;

    /// @notice The treasury that received the initial supply.
    address public immutable treasury;

    /// @param name_        Token name (e.g. "Vega Mitos").
    /// @param symbol_      Token symbol (e.g. "VEGA").
    /// @param talosId_     Owning Talos ID.
    /// @param treasury_    Address that receives the full initial supply.
    /// @param wholeSupply_ Total supply in WHOLE (unscaled) tokens, e.g. 1_000_000.
    ///                     The constructor scales it by 10**decimals() (18) once.
    ///                     Pass the human number, NOT a pre-scaled value.
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 talosId_,
        address treasury_,
        uint256 wholeSupply_
    ) ERC20(name_, symbol_) {
        require(treasury_ != address(0), "treasury=0");
        require(wholeSupply_ > 0, "supply=0");
        talosId = talosId_;
        treasury = treasury_;
        _mint(treasury_, wholeSupply_ * 10 ** decimals());
    }
}
