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
import "../../interfaces/IVerified.sol";
import "../../interfaces/IBoostPool.sol";

/**
 * @title ConfigHelper
 * @notice A convenience library for getting easy access to other contracts and constants within the
 *  protocol, through the use of the NAOSConfig contract
 */

library ConfigHelper {
  function getPool(NAOSConfig config) internal view returns (IPool) {
    return IPool(poolAddress(config));
  }

  function getIndexPool(NAOSConfig config) internal view returns (IIndexPool) {
    return IIndexPool(indexPoolAddress(config));
  }

  function getIndexPoolStrategy(NAOSConfig config) internal view returns (IIndexPoolStrategy) {
    return IIndexPoolStrategy(indexPoolStrategyAddress(config));
  }

  function getUSDC(NAOSConfig config) internal view returns (IERC20withDec) {
    return IERC20withDec(usdcAddress(config));
  }

  function getRWA(NAOSConfig config) internal view returns (IRWA) {
    return IRWA(rwaAddress(config));
  }

  function getNAOS(NAOSConfig config) internal view returns (IERC20) {
    return IRWA(naosAddress(config));
  }

  function getPoolTokens(NAOSConfig config) internal view returns (IPoolTokens) {
    return IPoolTokens(poolTokensAddress(config));
  }

  function getJuniorRewards(NAOSConfig config) internal view returns (IJuniorRewards) {
    return IJuniorRewards(juniorRewardsAddress(config));
  }

  function getNAOSFactory(NAOSConfig config) internal view returns (INAOSFactory) {
    return INAOSFactory(naosFactoryAddress(config));
  }

  function getVerified(NAOSConfig config) internal view returns (IVerified) {
    return IVerified(verifiedAddress(config));
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

  function juniorRewardsAddress(NAOSConfig config) internal view returns (address) {
    return config.getAddress(uint256(ConfigOptions.Addresses.JuniorRewards));
  }

  function indexPoolAddress(NAOSConfig config) internal view returns (address) {
    return config.getAddress(uint256(ConfigOptions.Addresses.IndexPool));
  }

  function indexPoolStrategyAddress(NAOSConfig config) internal view returns (address) {
    return config.getAddress(uint256(ConfigOptions.Addresses.IndexPoolStrategy));
  }

  function naosFactoryAddress(NAOSConfig config) internal view returns (address) {
    return config.getAddress(uint256(ConfigOptions.Addresses.NAOSFactory));
  }

  function rwaAddress(NAOSConfig config) internal view returns (address) {
    return config.getAddress(uint256(ConfigOptions.Addresses.RWA));
  }

  function usdcAddress(NAOSConfig config) internal view returns (address) {
    return config.getAddress(uint256(ConfigOptions.Addresses.USDC));
  }

  function naosAddress(NAOSConfig config) internal view returns (address) {
    return config.getAddress(uint256(ConfigOptions.Addresses.NAOS));
  }

  function juniorPoolAddress(NAOSConfig config) internal view returns (address) {
    return config.getAddress(uint256(ConfigOptions.Addresses.JuniorPoolImplementation));
  }

  function reserveAddress(NAOSConfig config) internal view returns (address) {
    return config.getAddress(uint256(ConfigOptions.Addresses.TreasuryReserve));
  }

  function protocolAdminAddress(NAOSConfig config) internal view returns (address) {
    return config.getAddress(uint256(ConfigOptions.Addresses.ProtocolAdmin));
  }

  function verifiedAddress(NAOSConfig config) internal view returns (address) {
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
