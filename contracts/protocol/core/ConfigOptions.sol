// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

/**
 * @title ConfigOptions
 * @notice A central place for enumerating the configurable options of our NAOSConfig contract
 */

library ConfigOptions {
  // NEVER EVER CHANGE THE ORDER OF THESE!
  // You can rename or append. But NEVER change the order.
  enum Numbers {
    TotalFundsLimit,
    ReserveDenominator,
    WithdrawFeeDenominator,
    LatenessGracePeriodInDays,
    LatenessMaxDays,
    DrawdownPeriodInSeconds,
    LeverageRatio
  }
  enum Addresses {
    Pool,
    CreditLineImplementation,
    NAOSFactory,
    RWA,
    USDC,
    TreasuryReserve,
    ProtocolAdmin,
    NAOSConfig,
    PoolTokens,
    JuniorPoolImplementation,
    IndexPool,
    IndexPoolStrategy,
    NAOS,
    Verified,
    JuniorRewards,
    StakingRewards,
    BoostPool,
    WithdrawQueue
  }
}
