// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

abstract contract IVerified {
  uint256 public constant ID_TYPE_0 = 0;
  uint256 public constant ID_TYPE_1 = 1;
  uint256 public constant ID_TYPE_2 = 2;
  uint256 public constant ID_TYPE_3 = 3;
  uint256 public constant ID_TYPE_4 = 4;
  uint256 public constant ID_TYPE_5 = 5;
  uint256 public constant ID_TYPE_6 = 6;
  uint256 public constant ID_TYPE_7 = 7;
  uint256 public constant ID_TYPE_8 = 8;
  uint256 public constant ID_TYPE_9 = 9;
  uint256 public constant ID_TYPE_10 = 10;

  /// @notice Returns the address of the UniqueIdentity contract.
  function uniqueIdentity() external virtual returns (address);

  function verify(address account) public view virtual returns (bool);

  function verifyOnlyIdTypes(address account, uint256[] calldata onlyIdTypes) public view virtual returns (bool);

  function verifyIndexPool(address account) public view virtual returns (bool);

  function updateNAOSConfig() external virtual;
}
