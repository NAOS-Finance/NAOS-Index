// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../protocol/core/IndexPool.sol";

contract TestIndexPool is IndexPool {
  function _getNumShares(uint256 amount) public view returns (uint256) {
    return getNumShares(amount);
  }

  // function _usdcMantissa() public pure returns (uint256) {
  //   return usdcMantissa();
  // }

  // function _rwaMantissa() public pure returns (uint256) {
  //   return rwaMantissa();
  // }

  function _usdcToRWA(uint256 amount) public view returns (uint256) {
    return usdcToRWA(amount);
  }

  function _setSharePrice(uint256 newSharePrice) public returns (uint256) {
    sharePrice = newSharePrice;
  }
}
