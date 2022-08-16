// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../protocol/core/UniqueIdentity.sol";

contract TestUniqueIdentity is UniqueIdentity {
  function _mintForTest(
    address to,
    uint256 id,
    uint256 expiresAt,
    bytes memory data
  ) public onlyAdmin incrementNonce(to) {
    _updateExpiration(to, id, expiresAt);
  }
}
