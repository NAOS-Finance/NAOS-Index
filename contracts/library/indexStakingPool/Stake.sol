// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.6.12;

import {Math} from "@openzeppelin/contracts/math/Math.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";

import {FixedPointMath} from "../FixedPointMath.sol";
import {Pool} from "./Pool.sol";

/// @title Stake
///
/// @dev A library which provides the Stake data struct and associated functions.
library Stake {
    using FixedPointMath for FixedPointMath.uq192x64;
    using Pool for Pool.Data;
    using SafeMath for uint256;
    using Stake for Stake.Data;

    struct Data {
        uint256 totalDeposited;
        uint256 totalDepositedWeight;
        uint256 totalUnclaimed;
        uint256 depositTime;
        FixedPointMath.uq192x64 lastAccumulatedWeight;
        bool isWithdraw;
    }

    function update(
        Data storage _self,
        Pool.Data storage _pool,
        Pool.Context storage _ctx
    ) internal {
        _self.totalUnclaimed = _self.getUpdatedTotalUnclaimed(_pool, _ctx);
        _self.lastAccumulatedWeight = _pool.getUpdatedAccumulatedRewardWeight(_ctx);
    }

    function getUpdatedTotalUnclaimed(
        Data storage _self,
        Pool.Data storage _pool,
        Pool.Context storage _ctx
    ) internal view returns (uint256) {
        FixedPointMath.uq192x64 memory _currentAccumulatedWeight = _pool.getUpdatedAccumulatedRewardWeight(_ctx);
        FixedPointMath.uq192x64 memory _lastAccumulatedWeight = _self.lastAccumulatedWeight;

        if (_currentAccumulatedWeight.cmp(_lastAccumulatedWeight) == 0) {
            return _self.totalUnclaimed;
        }

        uint256 _distributedAmount = _currentAccumulatedWeight.sub(_lastAccumulatedWeight).mul(_self.totalDepositedWeight).decode();

        return _self.totalUnclaimed.add(_distributedAmount);
    }
}