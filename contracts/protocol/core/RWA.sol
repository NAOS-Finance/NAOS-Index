// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-ethereum-package/contracts/presets/ERC20PresetMinterPauser.sol";
import "./ConfigHelper.sol";

/**
 * @title RWA
 * @notice RWA (symbol: FIDU) is Goldfinch's liquidity token, representing shares
 *  in the Pool. When you deposit, we mint a corresponding amount of RWA, and when you withdraw, we
 *  burn RWA. The share price of the Pool implicitly represents the "exchange rate" between RWA
 *  and USDC (or whatever currencies the Pool may allow withdraws in during the future)
 * @author Goldfinch
 */

contract RWA is ERC20PresetMinterPauserUpgradeSafe {
  bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");
  NAOSConfig public config;
  using ConfigHelper for NAOSConfig;

  uint256 public usdDecimals;

  event NAOSConfigUpdated(address indexed who, address configAddress);

  /*
    We are using our own initializer function so we can set the owner by passing it in.
    I would override the regular "initializer" function, but I can't because it's not marked
    as "virtual" in the parent contract
  */
  // solhint-disable-next-line func-name-mixedcase
  function __initialize__(
    address owner,
    string calldata name,
    string calldata symbol,
    NAOSConfig _config
  ) external initializer {
    __Context_init_unchained();
    __AccessControl_init_unchained();
    __ERC20_init_unchained(name, symbol);

    __ERC20Burnable_init_unchained();
    __Pausable_init_unchained();
    __ERC20Pausable_init_unchained();

    config = _config;

    IERC20withDec usdc = config.getUSDC();
    usdDecimals = uint256(usdc.decimals());

    _setupRole(MINTER_ROLE, owner);
    _setupRole(PAUSER_ROLE, owner);
    _setupRole(OWNER_ROLE, owner);

    _setRoleAdmin(MINTER_ROLE, OWNER_ROLE);
    _setRoleAdmin(PAUSER_ROLE, OWNER_ROLE);
    _setRoleAdmin(OWNER_ROLE, OWNER_ROLE);
  }

  /**
   * @dev Creates `amount` new tokens for `to`.
   *
   * See {ERC20-_mint}.
   *
   * Requirements:
   *
   * - the caller must have the `MINTER_ROLE`.
   */
  function mintTo(address to, uint256 amount) public {
    require(canMint(amount), "Cannot mint: it would create an asset/liability mismatch");
    // This super call restricts to only the minter in its implementation, so we don't need to do it here.
    super.mint(to, amount);
  }

  /**
   * @dev Destroys `amount` tokens from `account`, deducting from the caller's
   * allowance.
   *
   * See {ERC20-_burn} and {ERC20-allowance}.
   *
   * Requirements:
   *
   * - the caller must have the MINTER_ROLE
   */
  function burnFrom(address from, uint256 amount) public override {
    require(hasRole(MINTER_ROLE, _msgSender()), "ERC20PresetMinterPauser: Must have minter role to burn");
    require(canBurn(amount), "Cannot burn: it would create an asset/liability mismatch");
    _burn(from, amount);
  }

  // Internal functions

  // canMint assumes that the USDC that backs the new shares has already been sent to the Pool
  function canMint(uint256 newAmount) internal view returns (bool) {
    IIndexPool seniorPool = config.getIndexPool();
    uint256 liabilities = totalSupply().add(newAmount).mul(seniorPool.sharePrice()).div(fiduMantissa());
    uint256 liabilitiesInDollars = fiduToUSDC(liabilities);
    uint256 _assets = seniorPool.assets();
    if (_assets >= liabilitiesInDollars) {
      return true;
    } else {
      return liabilitiesInDollars.sub(_assets) <= usdDecimals;
    }
  }

  // canBurn assumes that the USDC that backed these shares has already been moved out the Pool
  function canBurn(uint256 amountToBurn) internal view returns (bool) {
    IIndexPool seniorPool = config.getIndexPool();
    uint256 liabilities = totalSupply().sub(amountToBurn).mul(seniorPool.sharePrice()).div(fiduMantissa());
    uint256 liabilitiesInDollars = fiduToUSDC(liabilities);
    uint256 _assets = seniorPool.assets();
    if (_assets >= liabilitiesInDollars) {
      return true;
    } else {
      return liabilitiesInDollars.sub(_assets) <= usdDecimals;
    }
  }

  function fiduToUSDC(uint256 amount) internal view returns (uint256) {
    return amount.div(fiduMantissa().div(usdcMantissa()));
  }

  function fiduMantissa() internal pure returns (uint256) {
    return uint256(10)**uint256(18);
  }

  function usdcMantissa() internal view returns (uint256) {
    return uint256(10)**usdDecimals;
  }

  function updateNAOSConfig() external {
    require(hasRole(OWNER_ROLE, _msgSender()), "ERC20PresetMinterPauser: Must have minter role to change config");
    config = NAOSConfig(config.configAddress());
    emit NAOSConfigUpdated(msg.sender, address(config));
  }
}
