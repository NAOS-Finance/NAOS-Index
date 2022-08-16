// contracts/GLDToken.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/drafts/ERC20Permit.sol";

contract TestERC20 is ERC20("TEST MOCK", "MOCK"), ERC20Permit("TEST MOCK") {
  constructor(uint256 initialSupply, uint8 decimals) public {
    _setupDecimals(decimals);
    _mint(msg.sender, initialSupply);
  }
}