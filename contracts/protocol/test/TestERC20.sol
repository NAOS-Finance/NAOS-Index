// contracts/GLDToken.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/drafts/ERC20Permit.sol";

contract TestERC20 is ERC20("Test USD Coin", "TUSD"), ERC20Permit("Test USD Coin") {
  constructor(uint256 initialSupply, uint8 decimals) public {
    _setupDecimals(decimals);
    _mint(msg.sender, initialSupply);
  }

  function _beforeTokenTransfer(address from, address to, uint256 amount) internal override {}

  function mint(address to, uint256 amount) public {
      _mint(to, amount);
  }
}
