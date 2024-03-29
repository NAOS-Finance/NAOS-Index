// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "./IJuniorPool.sol";

abstract contract IIndexPool {
  uint256 public sharePrice;
  uint256 public totalLoansOutstanding;
  uint256 public totalWritedowns;

  mapping(IJuniorPool => uint256[]) public juniorPoolTokens;

  function deposit(uint256 amount) external virtual returns (uint256 depositShares);

  function depositWithPermit(
    uint256 amount,
    uint256 deadline,
    uint8 v,
    bytes32 r,
    bytes32 s
  ) external virtual returns (uint256 depositShares);

  function withdraw(uint256 usdcAmount) external virtual returns (uint256 amount);

  function withdrawInRWA(uint256 rwaAmount) external virtual returns (uint256 amount);

  function invest(IJuniorPool pool) public virtual;

  function estimateInvestment(IJuniorPool pool) public view virtual returns (uint256);

  function redeem(uint256 tokenId) public virtual;

  function writedown(IJuniorPool pool) public virtual;

  function calculateWritedown(uint256 tokenId) public view virtual returns (uint256 writedownAmount);

  function assets() public view virtual returns (uint256);

  function getNumShares(uint256 amount) public view virtual returns (uint256);

  function vaultCount() public view virtual returns (uint256);

  function getVaultTotalDeposited(uint256 _vaultId) external view virtual returns (uint256);

  function juniorPoolTokensCount(IJuniorPool pool) external view virtual returns (uint256);
}
