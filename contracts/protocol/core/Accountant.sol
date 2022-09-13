// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "./CreditLine.sol";
import "../../interfaces/ICreditLine.sol";
import "../../interfaces/IJuniorPool.sol";
import "../../external/FixedPoint.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/math/Math.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";

/**
 * @title The Accountant
 * @notice Library for handling key financial calculations, such as interest and principal accrual.
 */

library Accountant {
  using SafeMath for uint256;
  using FixedPoint for FixedPoint.Signed;
  using FixedPoint for FixedPoint.Unsigned;
  using FixedPoint for int256;
  using FixedPoint for uint256;

  // Scaling factor used by FixedPoint.sol. We need this to convert the fixed point raw values back to unscaled
  uint256 public constant FP_SCALING_FACTOR = 10**18;
  uint256 public constant INTEREST_DECIMALS = 1e18;
  uint256 public constant SECONDS_PER_DAY = 60 * 60 * 24;
  uint256 public constant SECONDS_PER_YEAR = (SECONDS_PER_DAY * 365);

  struct PaymentAllocation {
    uint256 interestPayment;
    uint256 principalPayment;
    uint256 additionalBalancePayment;
  }

  function calculateInterestAndPrincipalAccrued(
    CreditLine cl,
    uint256 timestamp,
    uint256 lateFeeGracePeriod,
    IJuniorPool.LiquidationProcess liquidated
  ) public view returns (uint256, uint256) {
    uint256 balance = cl.balance(); // gas optimization
    uint256 interestAccrued = 0;
    if (liquidated != IJuniorPool.LiquidationProcess.Processing) {
      interestAccrued = calculateInterestAccrued(cl, balance, timestamp, lateFeeGracePeriod);
    }
    uint256 principalAccrued = calculatePrincipalAccrued(cl, balance, timestamp, liquidated);
    return (interestAccrued, principalAccrued);
  }

  function calculatePrincipalAccrued(
    ICreditLine cl,
    uint256 balance,
    uint256 timestamp,
    IJuniorPool.LiquidationProcess liquidated
  ) public view returns (uint256) {
    // If we've already accrued principal as of the term end time, then don't accrue more principal
    uint256 termEndTime = cl.termEndTime();
    if (cl.interestAccruedAsOf() >= termEndTime || liquidated == IJuniorPool.LiquidationProcess.Processing) {
      return 0;
    }
    if (timestamp >= termEndTime || liquidated == IJuniorPool.LiquidationProcess.Starting) {
      return balance;
    } else {
      return 0;
    }
  }

  function calculateWritedownFor(
    ICreditLine cl,
    uint256 timestamp,
    uint256 maxDaysLate
  ) public view returns (uint256) {
    return calculateWritedownForPrincipal(cl, cl.balance(), timestamp, maxDaysLate);
  }

  function calculateWritedownForPrincipal(
    ICreditLine cl,
    uint256 principal,
    uint256 timestamp,
    uint256 maxDaysLate
  ) public view returns (uint256) {
    FixedPoint.Unsigned memory amountOwedPerDay = calculateAmountOwedForOneDay(cl);
    if (amountOwedPerDay.isEqual(0)) {
      return 0;
    }
    FixedPoint.Unsigned memory daysLate;

    uint256 interestOwed = cl.interestOwed();
    uint256 totalOwed = interestOwed.add(cl.principalOwed());
    daysLate = FixedPoint.fromUnscaledUint(interestOwed).div(amountOwedPerDay);
    if (timestamp > cl.termEndTime() && totalOwed > 0) {
      uint256 secondsLate = timestamp.sub(cl.termEndTime());
      daysLate = daysLate.add(FixedPoint.fromUnscaledUint(secondsLate).div(SECONDS_PER_DAY));
    }

    FixedPoint.Unsigned memory maxLate = FixedPoint.fromUnscaledUint(maxDaysLate);
    if (daysLate.isLessThanOrEqual(maxLate)) {
      return 0;
    }
    return principal;
  }

  function calculateAmountOwedForOneDay(ICreditLine cl) public view returns (FixedPoint.Unsigned memory interestOwed) {
    // Determine theoretical interestOwed for one full day
    uint256 totalInterestPerYear = cl.balance().mul(cl.interestApr()).div(INTEREST_DECIMALS);
    interestOwed = FixedPoint.fromUnscaledUint(totalInterestPerYear).div(365);
    return interestOwed;
  }

  function calculateInterestAccrued(
    CreditLine cl,
    uint256 balance,
    uint256 timestamp,
    uint256 lateFeeGracePeriodInDays
  ) public view returns (uint256) {
    // We use Math.min here to prevent integer overflow (ie. go negative) when calculating
    // numSecondsElapsed. Typically this shouldn't be possible, because
    // the interestAccruedAsOf couldn't be *after* the current timestamp. However, when assessing
    // we allow this function to be called with a past timestamp, which raises the possibility
    // of overflow.
    // This use of min should not generate incorrect interest calculations, since
    // this function's purpose is just to normalize balances, and handing in a past timestamp
    // will necessarily return zero interest accrued (because zero elapsed time), which is correct.
    uint256 startTime = Math.min(timestamp, cl.interestAccruedAsOf());
    return calculateInterestAccruedOverPeriod(cl, balance, startTime, timestamp, lateFeeGracePeriodInDays);
  }

  function calculateInterestAccruedOverPeriod(
    CreditLine cl,
    uint256 balance,
    uint256 startTime,
    uint256 endTime,
    uint256 lateFeeGracePeriodInDays
  ) public view returns (uint256 interestOwed) {
    uint256 secondsElapsed = endTime.sub(startTime);
    uint256 totalInterestPerYear = balance.mul(cl.interestApr()).div(INTEREST_DECIMALS);
    interestOwed = totalInterestPerYear.mul(secondsElapsed).div(SECONDS_PER_YEAR);
    if (lateFeeApplicable(cl, endTime, lateFeeGracePeriodInDays)) {
      uint256 lateFeeInterestPerYear = balance.mul(cl.lateFeeApr()).div(INTEREST_DECIMALS);
      uint256 additionalLateFeeInterest = lateFeeInterestPerYear.mul(secondsElapsed).div(SECONDS_PER_YEAR);
      interestOwed = interestOwed.add(additionalLateFeeInterest);
    }

    return interestOwed;
  }

  function lateFeeApplicable(
    CreditLine cl,
    uint256 timestamp,
    uint256 gracePeriodInDays
  ) public view returns (bool) {
    uint256 secondsLate = timestamp.sub(cl.lastFullPaymentTime());
    return cl.lateFeeApr() > 0 && secondsLate > gracePeriodInDays.mul(SECONDS_PER_DAY);
  }

  function allocatePayment(
    uint256 paymentAmount,
    uint256 balance,
    uint256 interestOwed,
    uint256 principalOwed,
    uint256 liquidated
  ) public pure returns (PaymentAllocation memory) {
    uint256 paymentRemaining = paymentAmount;
    uint256 interestPayment;
    uint256 principalPayment;
    IJuniorPool.LiquidationProcess liquidate = IJuniorPool.LiquidationProcess(liquidated);

    if (liquidate == IJuniorPool.LiquidationProcess.NotInProcess) {
      interestPayment = Math.min(interestOwed, paymentRemaining);
      paymentRemaining = paymentRemaining.sub(interestPayment);

      principalPayment = Math.min(principalOwed, paymentRemaining);
      paymentRemaining = paymentRemaining.sub(principalPayment);
    } else {
      principalPayment = Math.min(principalOwed, paymentRemaining);
      paymentRemaining = paymentRemaining.sub(principalPayment);

      interestPayment = Math.min(interestOwed, paymentRemaining);
      paymentRemaining = paymentRemaining.sub(interestPayment);
    }

    uint256 balanceRemaining = balance.sub(principalPayment);
    uint256 additionalBalancePayment = Math.min(paymentRemaining, balanceRemaining);

    return
      PaymentAllocation({
        interestPayment: interestPayment,
        principalPayment: principalPayment,
        additionalBalancePayment: additionalBalancePayment
      });
  }
}
