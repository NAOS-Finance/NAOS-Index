// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "./BaseUpgradeablePausable.sol";
import "./ConfigHelper.sol";
import "../../interfaces/IIndexPoolStrategy.sol";
import "../../interfaces/IIndexPool.sol";
import "../../interfaces/IJuniorPool.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";

abstract contract LeverageRatioStrategy is BaseUpgradeablePausable, IIndexPoolStrategy {
  using SafeMath for uint256;

  uint256 internal constant LEVERAGE_RATIO_DECIMALS = 1e18;

  /**
   * @notice Determines how much money to invest in the senior tranche based on what is committed to the junior
   * tranche, what is committed to the senior tranche, and a leverage ratio to the junior tranche. Because
   * it takes into account what is already committed to the senior tranche, the value returned by this
   * function can be used "idempotently" to achieve the investment target amount without exceeding that target.
   * @param pool The tranched pool to invest into (as the senior)
   * @return The amount of money to invest into the tranched pool's senior tranche, from the index pool
   */
  function invest(IJuniorPool pool) public view override returns (uint256) {
    uint256 nSlices = pool.numSlices();
    // If the pool has no slices, we cant invest
    if (nSlices == 0) {
      return 0;
    }
    uint256 sliceIndex = nSlices.sub(1);
    IJuniorPool.TrancheInfo memory juniorTranche = pool.getTranche(sliceIndex.mul(2).add(2));
    IJuniorPool.TrancheInfo memory seniorTranche = pool.getTranche(sliceIndex.mul(2).add(1));

    // If junior capital is not yet invested, or pool already locked, then don't invest anything.
    if (juniorTranche.lockedUntil == 0 || seniorTranche.lockedUntil > 0) {
      return 0;
    }

    return _invest(pool, juniorTranche, seniorTranche);
  }

  /**
   * @notice A companion of `invest()`: determines how much would be returned by `invest()`, as the
   * value to invest into the senior tranche, if the junior tranche were locked and the senior tranche
   * were not locked.
   * @param pool The tranched pool to invest into (as the senior)
   * @return The amount of money to invest into the tranched pool's senior tranche, from the index pool
   */
  function estimateInvestment(IJuniorPool pool) public view override returns (uint256) {
    IJuniorPool.TrancheInfo memory juniorTranche = pool.getTranche(uint256(IJuniorPool.Tranches.Junior));
    IJuniorPool.TrancheInfo memory seniorTranche = pool.getTranche(uint256(IJuniorPool.Tranches.Senior));

    return _invest(pool, juniorTranche, seniorTranche);
  }

  function _invest(
    IJuniorPool pool,
    IJuniorPool.TrancheInfo memory juniorTranche,
    IJuniorPool.TrancheInfo memory seniorTranche
  ) internal view returns (uint256) {
    uint256 juniorCapital = juniorTranche.principalDeposited;
    uint256 existingSeniorCapital = seniorTranche.principalDeposited;
    uint256 seniorTarget = juniorCapital.mul(getLeverageRatio(pool)).div(LEVERAGE_RATIO_DECIMALS);

    if (existingSeniorCapital >= seniorTarget) {
      return 0;
    }

    return seniorTarget.sub(existingSeniorCapital);
  }
}
