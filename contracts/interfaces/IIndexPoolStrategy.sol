// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "./IIndexPool.sol";
import "./IJuniorPool.sol";

abstract contract IIndexPoolStrategy {
  function getLeverageRatio(IJuniorPool pool) public view virtual returns (uint256);

  function invest(IJuniorPool pool) public view virtual returns (uint256 amount);

  function estimateInvestment(IJuniorPool pool) public view virtual returns (uint256);
}
