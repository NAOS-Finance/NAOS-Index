// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../protocol/core/NAOSConfig.sol";

contract TestTheConfig {
  address public poolAddress = 0xBAc2781706D0aA32Fb5928c9a5191A13959Dc4AE;
  address public clImplAddress = 0xc783df8a850f42e7F7e57013759C285caa701eB6;
  address public naosFactoryAddress = 0x0afFE1972479c386A2Ab21a27a7f835361B6C0e9;
  address public rwaAddress = 0xf3c9B38c155410456b5A98fD8bBf5E35B87F6d96;
  address public treasuryReserveAddress = 0xECd9C93B79AE7C1591b1fB5323BD777e86E150d5;
  address public naosConfigAddress = address(8);

  function testTheEnums(address configAddress) public {
    NAOSConfig(configAddress).setNumber(uint256(ConfigOptions.Numbers.TotalFundsLimit), 2);
    NAOSConfig(configAddress).setNumber(uint256(ConfigOptions.Numbers.ReserveDenominator), 4);
    NAOSConfig(configAddress).setNumber(uint256(ConfigOptions.Numbers.WithdrawFeeDenominator), 5);
    NAOSConfig(configAddress).setNumber(uint256(ConfigOptions.Numbers.LatenessGracePeriodInDays), 6);
    NAOSConfig(configAddress).setNumber(uint256(ConfigOptions.Numbers.LatenessMaxDays), 7);
    NAOSConfig(configAddress).setNumber(uint256(ConfigOptions.Numbers.DrawdownPeriodInSeconds), 8);
    NAOSConfig(configAddress).setNumber(uint256(ConfigOptions.Numbers.LeverageRatio), 10);

    NAOSConfig(configAddress).setAddress(uint256(ConfigOptions.Addresses.RWA), rwaAddress);
    NAOSConfig(configAddress).setAddress(
      uint256(ConfigOptions.Addresses.NAOSFactory),
      naosFactoryAddress
    );
    NAOSConfig(configAddress).setAddress(uint256(ConfigOptions.Addresses.NAOSConfig), naosConfigAddress);

    NAOSConfig(configAddress).setTreasuryReserve(treasuryReserveAddress);
  }
}
