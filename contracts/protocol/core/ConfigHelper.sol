// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/IERC20.sol";

import "./NAOSConfig.sol";
import "../../interfaces/IPool.sol";
import "../../interfaces/IRWA.sol";
import "../../interfaces/IIndexPool.sol";
import "../../interfaces/IIndexPoolStrategy.sol";
import "../../interfaces/IERC20withDec.sol";
import "../../interfaces/IPoolTokens.sol";
import "../../interfaces/IJuniorRewards.sol";
import "../../interfaces/INAOSFactory.sol";
import "../../interfaces/IGo.sol";
import "../../interfaces/IBoostPool.sol";

/**
 * @title ConfigHelper
 * @notice A convenience library for getting easy access to other contracts and constants within the
 *  protocol, through the use of the NAOSConfig contract
 * @author Goldfinch
 */

library ConfigHelper {
  function getPool(NAOSConfig config) internal view returns (IPool) {
    return IPool(poolAddress(config));
  }

  function getIndexPool(NAOSConfig config) internal view returns (IIndexPool) {
    return IIndexPool(seniorPoolAddress(config));
  }

  function getIndexPoolStrategy(NAOSConfig config) internal view returns (IIndexPoolStrategy) {
    return IIndexPoolStrategy(seniorPoolStrategyAddress(config));
  }

  function getUSDC(NAOSConfig config) internal view returns (IERC20withDec) {
    return IERC20withDec(usdcAddress(config));
  }

  function getRWA(NAOSConfig config) internal view returns (IRWA) {
    return IRWA(fiduAddress(config));
  }

  function getNAOS(NAOSConfig config) internal view returns (IERC20) {
    return IRWA(naosAddress(config));
  }

  function getPoolTokens(NAOSConfig config) internal view returns (IPoolTokens) {
    return IPoolTokens(poolTokensAddress(config));
  }

  function getJuniorRewards(NAOSConfig config) internal view returns (IJuniorRewards) {
    return IJuniorRewards(backerRewardsAddress(config));
  }

  function getNAOSFactory (NAOSConfig config) internal view returns (INAOSFactory ) {
    return INAOSFactory (goldfinchFactoryAddress(config));
  }

  function getVerified(NAOSConfig config) internal view returns (IGo) {
    return IGo(goAddress(config));
  }

  function getBoostPool(NAOSConfig config) internal view returns (IBoostPool) {
    return IBoostPool(boostPoolAddress(config));
  }

  function getWithdrawQueue(NAOSConfig config) internal view returns (address) {
    return withdrawQueueAddress(config);
  }

  function creditLineImplementationAddress(NAOSConfig config) internal view returns (address) {
    return config.getAddress(uint256(ConfigOptions.Addresses.CreditLineImplementation));
  }

  function configAddress(NAOSConfig config) internal view returns (address) {
    return config.getAddress(uint256(ConfigOptions.Addresses.NAOSConfig));
  }

  function poolAddress(NAOSConfig config) internal view returns (address) {
    return config.getAddress(uint256(ConfigOptions.Addresses.Pool));
  }

  function poolTokensAddress(NAOSConfig config) internal view returns (address) {
    return config.getAddress(uint256(ConfigOptions.Addresses.PoolTokens));
  }

  function backerRewardsAddress(NAOSConfig config) internal view returns (address) {
    return config.getAddress(uint256(ConfigOptions.Addresses.JuniorRewards));
  }

  function seniorPoolAddress(NAOSConfig config) internal view returns (address) {
    return config.getAddress(uint256(ConfigOptions.Addresses.IndexPool));
  }

  function seniorPoolStrategyAddress(NAOSConfig config) internal view returns (address) {
    return config.getAddress(uint256(ConfigOptions.Addresses.IndexPoolStrategy));
  }

  function goldfinchFactoryAddress(NAOSConfig config) internal view returns (address) {
    return config.getAddress(uint256(ConfigOptions.Addresses.NAOSFactory ));
  }

  function fiduAddress(NAOSConfig config) internal view returns (address) {
    return config.getAddress(uint256(ConfigOptions.Addresses.RWA));
  }

  function usdcAddress(NAOSConfig config) internal view returns (address) {
    return config.getAddress(uint256(ConfigOptions.Addresses.USDC));
  }

  function naosAddress(NAOSConfig config) internal view returns (address) {
    return config.getAddress(uint256(ConfigOptions.Addresses.NAOS));
  }

  function tranchedPoolAddress(NAOSConfig config) internal view returns (address) {
    return config.getAddress(uint256(ConfigOptions.Addresses.JuniorPoolImplementation));
  }

  function reserveAddress(NAOSConfig config) internal view returns (address) {
    return config.getAddress(uint256(ConfigOptions.Addresses.TreasuryReserve));
  }

  function protocolAdminAddress(NAOSConfig config) internal view returns (address) {
    return config.getAddress(uint256(ConfigOptions.Addresses.ProtocolAdmin));
  }

  function goAddress(NAOSConfig config) internal view returns (address) {
    return config.getAddress(uint256(ConfigOptions.Addresses.Go));
  }

  function stakingRewardsAddress(NAOSConfig config) internal view returns (address) {
    return config.getAddress(uint256(ConfigOptions.Addresses.StakingRewards));
  }

  function boostPoolAddress(NAOSConfig config) internal view returns (address) {
    return config.getAddress(uint256(ConfigOptions.Addresses.BoostPool));
  }

  function withdrawQueueAddress (NAOSConfig config) internal view returns (address) {
    return config.getAddress(uint256(ConfigOptions.Addresses.WithdrawQueue));
  }

  function getReserveDenominator(NAOSConfig config) internal view returns (uint256) {
    return config.getNumber(uint256(ConfigOptions.Numbers.ReserveDenominator));
  }

  function getWithdrawFeeDenominator(NAOSConfig config) internal view returns (uint256) {
    return config.getNumber(uint256(ConfigOptions.Numbers.WithdrawFeeDenominator));
  }

  function getLatenessGracePeriodInDays(NAOSConfig config) internal view returns (uint256) {
    return config.getNumber(uint256(ConfigOptions.Numbers.LatenessGracePeriodInDays));
  }

  function getLatenessMaxDays(NAOSConfig config) internal view returns (uint256) {
    return config.getNumber(uint256(ConfigOptions.Numbers.LatenessMaxDays));
  }

  function getDrawdownPeriodInSeconds(NAOSConfig config) internal view returns (uint256) {
    return config.getNumber(uint256(ConfigOptions.Numbers.DrawdownPeriodInSeconds));
  }

  function getLeverageRatio(NAOSConfig config) internal view returns (uint256) {
    return config.getNumber(uint256(ConfigOptions.Numbers.LeverageRatio));
  }
}
