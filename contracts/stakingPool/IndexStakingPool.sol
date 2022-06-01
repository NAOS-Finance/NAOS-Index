// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.6.12;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import {FixedPointMath} from "../library/FixedPointMath.sol";
import {Pool} from "../library/indexStakingPool/Pool.sol";
import {Stake} from "../library/indexStakingPool/Stake.sol";

/// @title IndexStakingPool
/// @dev A contract which allows users to stake to farm tokens.
///
/// This contract was inspired by Chef Nomi's 'MasterChef' contract which can be found in this
/// repository: https://github.com/sushiswap/sushiswap.
contract IndexStakingPool is ReentrancyGuard {
    using FixedPointMath for FixedPointMath.uq192x64;
    using Pool for Pool.Data;
    using SafeERC20 for IERC20;
    using SafeMath for uint256;
    using Stake for Stake.Data;

    struct LockTimeWeighted {
        uint256 lockTime;
        uint256 weighted;
    }

    struct UserDepositedOrder {
        uint256 amount;
        uint256 expiredTime;
        uint256 weighted;
        bool isWithdraw;
    }

    event PendingGovernanceUpdated(address pendingGovernance);

    event GovernanceUpdated(address governance);

    event RewardRateUpdated(uint256 rewardRate);

    event LockTimeWeightedSet(uint256 lockTime, uint256 weighted);

    event PenaltyPercentUpdated(uint256 percent);

    event TokensDeposited(address indexed user, uint256 amount, uint256 weightedAmount);

    event TokensWithdrawn(address indexed user, uint256 amount, uint256 weightedAmount);

    event TokensClaimed(address indexed user, uint256 amount);

    /// @dev The token which will be minted as a reward for staking.
    IERC20 public reward;

    /// @dev The address of the account which currently has administrative capabilities over this contract.
    address public governance;

    /// @dev The address which is the candidate of governance
    address public pendingGovernance;

    /// @dev The resolution of fixed point. The resolution allows for a granularity of 1% increments.
    uint256 public constant PERCENT_RESOLUTION = 100;

    /// @dev The weight in the pool of different lock time
    LockTimeWeighted[] lockTimeWeightedList;

    /// @dev The count of user's deposited orders.
    mapping(address => uint256) public userOrderCount;

    /// @dev The record of user's deposited orders.
    mapping(address => mapping(uint256 => UserDepositedOrder)) public userDepositedOrder;

    /// @dev The context shared between the pools.
    Pool.Context private _ctx;

    /// @dev The pool information.
    Pool.Data private pool;

    /// @dev A mapping of all of the user stakes mapped by address.
    mapping(address => Stake.Data) private _stakes;

    constructor(
        IERC20 _token,
        IERC20 _reward,
        address _governance
    ) public {
        require(address(_token) != address(0), "BoostPool: token address cannot be 0x0");
        require(address(_reward) != address(0), "BoostPool: reward address cannot be 0x0");
        require(_governance != address(0), "BoostPool: governance address cannot be 0x0");

        pool.set(_token);

        reward = _reward;
        governance = _governance;
    }

    /// @dev A modifier which reverts when the caller is not the governance.
    modifier onlyGovernance() {
        require(msg.sender == governance, "BoostPool: only governance");
        _;
    }

    /// @dev Sets the governance.
    ///
    /// This function can only called by the current governance.
    ///
    /// @param _pendingGovernance the new pending governance.
    function setPendingGovernance(address _pendingGovernance) external onlyGovernance {
        require(_pendingGovernance != address(0), "BoostPool: pending governance address cannot be 0x0");
        pendingGovernance = _pendingGovernance;

        emit PendingGovernanceUpdated(_pendingGovernance);
    }

    function acceptGovernance() external {
        require(msg.sender == pendingGovernance, "BoostPool: only pending governance");

        governance = pendingGovernance;

        emit GovernanceUpdated(pendingGovernance);
    }

    /// @dev Sets the distribution reward rate.
    ///
    /// @param _rewardRate The number of tokens to distribute per block.
    function setRewardRate(uint256 _rewardRate) external onlyGovernance {
        Pool.Data storage _pool = pool.get();
        _pool.update(_ctx);

        _ctx.rewardRate = _rewardRate;

        emit RewardRateUpdated(_rewardRate);
    }

    /// @dev set lock time and its weight
    ///
    /// @param _lockTime the lock time of the deposited order
    /// @param _weighted the weighted of the deposited order
    function setLockTimeWeighted(uint256 _lockTime, uint256 _weighted) external onlyGovernance {
        lockTimeWeightedList.push(LockTimeWeighted({lockTime: _lockTime, weighted: _weighted}));

        emit LockTimeWeightedSet(_lockTime, _weighted);
    }

    /// @dev Stakes tokens into a pool.
    ///
    /// @param _depositAmount the amount of tokens to deposit.
    /// @param _index the index of the lock time weighted list
    function deposit(uint256 _depositAmount, uint256 _index) external nonReentrant {
        require(_index < lockTimeWeightedList.length, "invalid index");

        Pool.Data storage _pool = pool.get();
        _pool.update(_ctx);

        Stake.Data storage _stake = _stakes[msg.sender];
        _stake.update(_pool, _ctx);

        _deposit(_depositAmount, _index);
    }

    /// @dev Withdraws staked tokens from a pool.
    ///
    /// @param _index           The index of deposited order.
    function withdraw(uint256[] calldata _index) external nonReentrant {
        Pool.Data storage _pool = pool.get();
        _pool.update(_ctx);

        Stake.Data storage _stake = _stakes[msg.sender];
        _stake.update(_pool, _ctx);

        require(_index.length <= userOrderCount[msg.sender], "invalid index");

        uint256 withdrawAmount;
        uint256 weightedWithdrawAmount;
        for (uint256 i = 0; i < _index.length; i++) {
            UserDepositedOrder storage depositedOrder = userDepositedOrder[msg.sender][_index[i]];
            require(_index[i] < userOrderCount[msg.sender], "invalid index");
            require(!depositedOrder.isWithdraw, "The order has been withdrew");
            require(depositedOrder.expiredTime < block.timestamp, "The lock time is not expired!");
            depositedOrder.isWithdraw = true;
            withdrawAmount = withdrawAmount.add(depositedOrder.amount);
            weightedWithdrawAmount = weightedWithdrawAmount.add(depositedOrder.amount.mul(depositedOrder.weighted));
        }

        _withdraw(withdrawAmount, weightedWithdrawAmount);
    }

    /// @dev Claims all rewarded tokens from a pool.
    function claim() external nonReentrant {
        Pool.Data storage _pool = pool.get();
        _pool.update(_ctx);

        Stake.Data storage _stake = _stakes[msg.sender];
        _stake.update(_pool, _ctx);

        if (address(reward) == address(_pool.token)) {
            require(_pool.totalDeposited.add(_stake.totalUnclaimed) <= reward.balanceOf(address(this)), "pool has no enough rewards");
        }

        _claim();
    }

    /// @dev donate reward to the pool
    ///
    /// @param _donateAmount The donate amount
    function donateReward(uint256 _donateAmount) external nonReentrant {
        Pool.Data storage _pool = pool.get();
        _pool.update(_ctx);

        _pool.distribute(_donateAmount);
        reward.transferFrom(msg.sender, address(this), _donateAmount);
    }

    /// @dev Gets the rate at which tokens are minted to stakers for all pools.
    ///
    /// @return the reward rate.
    function rewardRate() external view returns (uint256) {
        return _ctx.rewardRate;
    }

    /// @dev Gets the token a pool accepts.
    ///
    /// @return the token.
    function getPoolToken() external view returns (IERC20) {
        Pool.Data storage _pool = pool.get();
        return _pool.token;
    }

    /// @dev Gets the total amount of funds staked in a pool.
    ///
    /// @return the total amount of staked or deposited tokens.
    function getPoolTotalDeposited() external view returns (uint256) {
        Pool.Data storage _pool = pool.get();
        return _pool.totalDeposited;
    }

    /// @dev Gets the pool total deposited weight.
    ///
    /// @return the pool total deposited weight.
    function getPoolTotalDepositedWeight() external view returns (uint256) {
        Pool.Data storage _pool = pool.get();
        return _pool.totalDepositedWeight;
    }

    /// @dev Gets the number of tokens a user has staked into a pool.
    ///
    /// @param _account The account to query.
    ///
    /// @return the amount of deposited tokens.
    function getStakeTotalDeposited(address _account) external view returns (uint256) {
        Stake.Data storage _stake = _stakes[_account];
        return _stake.totalDeposited;
    }

    /// @dev Gets the user's deposited weight.
    ///
    /// @param _account The account to query.
    ///
    /// @return the account's total boost weight.
    function getStakeTotalDepositedWeight(address _account) external view returns (uint256) {
        Stake.Data storage _stake = _stakes[_account];
        return _stake.totalDepositedWeight;
    }

    /// @dev Gets the number of unclaimed reward tokens a user can claim from a pool.
    ///
    /// @param _account The account to get the unclaimed balance of.
    ///
    /// @return the amount of unclaimed reward tokens a user has in a pool.
    function getStakeTotalUnclaimed(address _account) external view returns (uint256) {
        Stake.Data storage _stake = _stakes[_account];
        return _stake.getUpdatedTotalUnclaimed(pool.get(), _ctx);
    }

    /// @dev Gets the number of user's deposited order count.
    ///
    /// @param _account The user account.
    ///
    /// @return count the count of user's deposited order.
    function getUserOrderCount(address _account) external view returns (uint256 count) {
        return userOrderCount[_account];
    }

    /// @dev Gets user's deposited order by index.
    ///
    /// @param _account The user account.
    /// @param _index The deposited order index.
    ///
    /// @return amount the amount of the deposited order.
    /// @return expiredTime the expired time of the deposited order.
    /// @return weighted the weighted of the deposited order
    /// @return isWithdraw the deposited order is withdraw or not.
    function getUserDepositOrderByIndex(address _account, uint256 _index)
        external
        view
        returns (
            uint256 amount,
            uint256 expiredTime,
            uint256 weighted,
            bool isWithdraw
        )
    {
        UserDepositedOrder memory depositedOrder = userDepositedOrder[_account][_index];
        return (depositedOrder.amount, depositedOrder.expiredTime, depositedOrder.weighted, depositedOrder.isWithdraw);
    }

    /// @dev Gets lock time weighted list length.
    ///
    /// @return the lock time weighted list length.
    function getLockTimeWeightedListLength() external view returns (uint256) {
        return lockTimeWeightedList.length;
    }

    /// @dev Gets the lock time and weighted of lock time weighted list by index.
    ///
    /// @param _index index.
    ///
    /// @return lockTime the lock time.
    /// @return weighted the weighted when user locks the time.
    function getLockTimeWeightedByIndex(uint256 _index) external view returns (uint256 lockTime, uint256 weighted) {
        require(_index < lockTimeWeightedList.length, "invalid index");
        LockTimeWeighted memory lockTimeWeight = lockTimeWeightedList[_index];
        return (lockTimeWeight.lockTime, lockTimeWeight.weighted);
    }

    /// @dev Stakes tokens into a pool.
    ///
    /// The pool and stake MUST be updated before calling this function.
    ///
    /// @param _depositAmount the amount of tokens to deposit.
    /// @param _index the index of the lock time weighted list
    function _deposit(uint256 _depositAmount, uint256 _index) internal {
        Pool.Data storage _pool = pool.get();
        Stake.Data storage _stake = _stakes[msg.sender];
        LockTimeWeighted memory lockTimeWeight = lockTimeWeightedList[_index];

        _pool.totalDeposited = _pool.totalDeposited.add(_depositAmount);
        _stake.totalDeposited = _stake.totalDeposited.add(_depositAmount);
        _pool.totalDepositedWeight = _pool.totalDepositedWeight.add(_depositAmount.mul(lockTimeWeight.weighted));
        _stake.totalDepositedWeight = _stake.totalDepositedWeight.add(_depositAmount.mul(lockTimeWeight.weighted));

        userDepositedOrder[msg.sender][userOrderCount[msg.sender]] = UserDepositedOrder({amount: _depositAmount, expiredTime: block.timestamp.add(lockTimeWeight.lockTime), weighted: lockTimeWeight.weighted, isWithdraw: false});

        userOrderCount[msg.sender] = userOrderCount[msg.sender] + 1;

        _pool.token.transferFrom(msg.sender, address(this), _depositAmount);

        emit TokensDeposited(msg.sender, _depositAmount, _depositAmount.mul(lockTimeWeight.weighted));
    }

    /// @dev Withdraws staked tokens from a pool.
    ///
    /// The pool and stake MUST be updated before calling this function.
    ///
    /// @param _withdrawAmount  The number of tokens to withdraw.
    /// @param _weightedWithdrawAmount The weighted withdraw amount
    function _withdraw(uint256 _withdrawAmount, uint256 _weightedWithdrawAmount) internal {
        Pool.Data storage _pool = pool.get();
        Stake.Data storage _stake = _stakes[msg.sender];

        _pool.totalDeposited = _pool.totalDeposited.sub(_withdrawAmount);
        _stake.totalDeposited = _stake.totalDeposited.sub(_withdrawAmount);
        _pool.totalDepositedWeight = _pool.totalDepositedWeight.sub(_weightedWithdrawAmount);
        _stake.totalDepositedWeight = _stake.totalDepositedWeight.sub(_weightedWithdrawAmount);

        _pool.token.transfer(msg.sender, _withdrawAmount);

        emit TokensWithdrawn(msg.sender, _withdrawAmount, _weightedWithdrawAmount);
    }

    /// @dev Claims all rewarded tokens from a pool.
    ///
    /// The pool and stake MUST be updated before calling this function.
    ///
    /// @notice use this function to claim the tokens from a corresponding pool by ID.
    function _claim() internal {
        Stake.Data storage _stake = _stakes[msg.sender];

        uint256 _claimAmount = _stake.totalUnclaimed;
        _stake.totalUnclaimed = 0;

        reward.transfer(msg.sender, _claimAmount);

        emit TokensClaimed(msg.sender, _claimAmount);
    }
}