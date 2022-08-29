// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface IUniqueIdentity {
  function mint(
    uint256 id,
    uint256 expiresAt,
    bytes calldata signature
  ) external;

  function burn(
    address account,
    uint256 id,
    uint256 expiresAt,
    bytes calldata signature
  ) external;
}
