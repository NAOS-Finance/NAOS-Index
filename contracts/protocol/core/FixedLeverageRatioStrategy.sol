// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "./BaseUpgradeablePausable.sol";
import "./ConfigHelper.sol";
import "./LeverageRatioStrategy.sol";
import "../../interfaces/IIndexPoolStrategy.sol";
import "../../interfaces/IIndexPool.sol";
import "../../interfaces/IJuniorPool.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";

contract FixedLeverageRatioStrategy is LeverageRatioStrategy {
  NAOSConfig public config;
  using ConfigHelper for NAOSConfig;

  event NAOSConfigUpdated(address indexed who, address configAddress);

  function initialize(address owner, NAOSConfig _config) public initializer {
    require(owner != address(0) && address(_config) != address(0), "Owner and config addresses cannot be empty");
    __BaseUpgradeablePausable__init(owner);
    config = _config;
  }

  function updateNAOSConfig() external onlyAdmin {
    config = NAOSConfig(config.configAddress());
    emit NAOSConfigUpdated(msg.sender, address(config));
  }

  function getLeverageRatio(IJuniorPool pool) public view override returns (uint256) {
    return config.getLeverageRatio();
  }
}
