// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.6.12;

import {Math} from "@openzeppelin/contracts/math/Math.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";

import {FixedPointMath} from "../FixedPointMath.sol";

/// @title Pool
///
/// @dev A library which provides the Pool data struct and associated functions.
library Pool {
    using FixedPointMath for FixedPointMath.uq192x64;
    using Pool for Pool.Data;
    using SafeMath for uint256;

    struct Context {
        uint256 rewardRate;
    }

    struct Data {
        IERC20 token;
        uint256 totalDeposited;
        uint256 totalDepositedWeight;
        FixedPointMath.uq192x64 accumulatedRewardWeight;
        uint256 lastUpdatedBlock;
    }

    /// @dev Updates the pool.
    ///
    /// @param _ctx the pool context.
    function update(Data storage _data, Context storage _ctx) internal {
        _data.accumulatedRewardWeight = _data.getUpdatedAccumulatedRewardWeight(_ctx);
        _data.lastUpdatedBlock = block.number;
    }

    /// @dev distribute rewards to other users.
    ///
    /// @param _distributeAmount the amount will be distributed.
    function distribute(Data storage _data, uint256 _distributeAmount) internal {
        FixedPointMath.uq192x64 memory distributeAmount = FixedPointMath.fromU256(_distributeAmount).div(_data.totalDepositedWeight);
        _data.accumulatedRewardWeight = _data.accumulatedRewardWeight.add(distributeAmount);
    }

    /// @dev Gets the accumulated reward weight of a pool.
    ///
    /// @param _ctx the pool context.
    ///
    /// @return the accumulated reward weight.
    function getUpdatedAccumulatedRewardWeight(Data storage _data, Context storage _ctx) internal view returns (FixedPointMath.uq192x64 memory) {
        if (_data.totalDeposited == 0) {
            return _data.accumulatedRewardWeight;
        }

        uint256 _elapsedTime = block.number.sub(_data.lastUpdatedBlock);
        if (_elapsedTime == 0) {
            return _data.accumulatedRewardWeight;
        }

        uint256 _distributeAmount = _ctx.rewardRate.mul(_elapsedTime);

        if (_distributeAmount == 0) {
            return _data.accumulatedRewardWeight;
        }

        FixedPointMath.uq192x64 memory _rewardWeight = FixedPointMath.fromU256(_distributeAmount).div(_data.totalDepositedWeight);
        return _data.accumulatedRewardWeight.add(_rewardWeight);
    }

    /// @dev Adds an element to the list.
    function set(Data storage _self, IERC20 _token) internal {
        _self.token = _token;
        _self.totalDeposited = 0;
        _self.totalDepositedWeight = 0;
        _self.accumulatedRewardWeight = FixedPointMath.uq192x64(0);
        _self.lastUpdatedBlock = block.number;
    }

    /// @dev Gets an element from the list.
    ///
    /// @return the element at the specified index.
    function get(Data storage _self) internal view returns (Data storage) {
        return _self;
    }
}