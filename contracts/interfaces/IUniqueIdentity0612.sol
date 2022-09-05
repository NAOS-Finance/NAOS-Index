// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

/// @dev This interface provides a subset of the functionality of the IUniqueIdentity
/// interface -- namely, the subset of functionality needed by NAOS protocol contracts
/// compiled with Solidity version 0.6.12.
interface IUniqueIdentity0612 {
  function expiration(address account, uint256 id) external view returns (uint256);
}
