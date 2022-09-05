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
import {IBoostPool} from "../interfaces/IBoostPool.sol";
import {IIndexPool} from "../interfaces/IIndexPool.sol";
import {IERC20withDec} from "../interfaces/IERC20withDec.sol";
import {INAOSConfig} from "../interfaces/INAOSConfig.sol";
import {ConfigHelper} from "../protocol/core/ConfigHelper.sol";
import {NAOSConfig} from "../protocol/core/NAOSConfig.sol";

/// @title IndexStakingPool
/// @dev A contract which allows users to stake to farm tokens.
///
/// This contract was inspired by Chef Nomi's 'MasterChef' contract which can be found in this
/// repository: https://github.com/sushiswap/sushiswap.
contract IndexStakingPool is ReentrancyGuard {
    using FixedPointMath for FixedPointMath.uq192x64;
    using Pool for Pool.Data;
    using Pool for Pool.List;
    using SafeERC20 for IERC20;
    using SafeMath for uint256;
    using Stake for Stake.Data;
    using ConfigHelper for NAOSConfig;

    event PendingGovernanceUpdated(address pendingGovernance);

    event GovernanceUpdated(address governance);

    event RewardRateUpdated(uint256 rewardRate);

    event PoolRewardWeightUpdated(uint256 indexed poolId, uint256 rewardWeight);

    event PoolCreated(uint256 indexed poolId, IERC20withDec indexed token);

    event PenaltyPercentUpdated(uint256 percent);

    event VestingDurationUpdated(uint256 vestingDuration);

    event TokensDeposited(address indexed user, uint256 indexed poolId, uint256 amount);

    event TokensWithdrawn(address indexed user, uint256 indexed poolId, uint256 amount);

    event TokensClaimed(address indexed user, uint256 indexed poolId, uint256 amount, uint256 penalty);

    /// @dev The token which will be minted as a reward for staking.
    IERC20 public reward;

    /// @dev Boost pool
    IBoostPool public boostPool;

    /// @dev The address of the account which currently has administrative capabilities over this contract.
    address public governance;

    /// @dev The address which is the candidate of governance
    address public pendingGovernance;

    /// @notice The duration in seconds over which rewards vest
    uint256 public vestingDuration;

    /// @dev The resolution of fixed point. The resolution allows for a granularity of 1% increments.
    uint256 public constant PERCENT_RESOLUTION = 100;

    /// @dev Tokens are mapped to their pool identifier plus one. Tokens that do not have an associated pool
    /// will return an identifier of zero.
    mapping(IERC20withDec => uint256) public tokenPoolIds;

    /// @dev The context shared between the pools.
    Pool.Context private _ctx;

    /// @dev A list of all of the pools.
    Pool.List private _pools;

    /// @dev A mapping of all of the user stakes mapped by address.
    mapping(uint256 => Stake.Data[]) private _stakes;

    /// @dev The record of user's deposited orders.
    mapping(address => mapping(uint256 => uint256[])) public userStakedList;

    constructor(
        IERC20 _reward,
        IBoostPool _boostPool,
        address _governance
    ) public {
        require(address(_reward) != address(0), "reward address cannot be 0x0");
        require(_governance != address(0), "governance address cannot be 0x0");
        require(address(_boostPool) != address(0), "boost pool address cannot be 0x0");

        reward = _reward;
        governance = _governance;
        boostPool = _boostPool;
        vestingDuration = 365 days;
    }

    /// @dev A modifier which reverts when the caller is not the governance.
    modifier onlyGovernance() {
        require(msg.sender == governance, "only governance");
        _;
    }

    /// @dev Sets the governance.
    ///
    /// This function can only called by the current governance.
    ///
    /// @param _pendingGovernance the new pending governance.
    function setPendingGovernance(address _pendingGovernance) external onlyGovernance {
        require(_pendingGovernance != address(0), "pending governance address cannot be 0x0");
        pendingGovernance = _pendingGovernance;

        emit PendingGovernanceUpdated(_pendingGovernance);
    }

    function acceptGovernance() external {
        require(msg.sender == pendingGovernance, "only pending governance");

        governance = pendingGovernance;

        emit GovernanceUpdated(pendingGovernance);
    }

    /// @dev Creates a new pool.
    ///
    /// The created pool will need to have its reward weight initialized before it begins generating rewards.
    ///
    /// @param _config The config of the pool.
    ///
    /// @return _poolId the identifier for the newly created pool.
    function createPool(NAOSConfig _config) external onlyGovernance returns (uint256) {
        require(address(_config) != address(0), "config address cannot be 0x0");
        IERC20withDec _token = _config.getRWA();
        require(tokenPoolIds[_token] == 0, "config already has a pool");

        uint256 _poolId = _pools.length();

        _pools.push(Pool.Data({config: _config, totalDeposited: 0, totalDepositedWeight:0, rewardWeight: 0, accumulatedRewardWeight: FixedPointMath.uq192x64(0), lastUpdatedTimestamp: block.timestamp}));

        tokenPoolIds[_token] = _poolId + 1;

        emit PoolCreated(_poolId, _token);

        return _poolId;
    }

    /// @dev Sets the distribution reward rate.
    ///
    /// @param _rewardRate The number of tokens to distribute per second.
    function setRewardRate(uint256 _rewardRate) external onlyGovernance {
        _updatePools();

        _ctx.rewardRate = _rewardRate;

        emit RewardRateUpdated(_rewardRate);
    }

    /// @dev Sets the reward weights of all of the pools.
    ///
    /// @param _rewardWeights The reward weights of all of the pools.
    function setRewardWeights(uint256[] calldata _rewardWeights) external onlyGovernance {
        require(_rewardWeights.length == _pools.length(), "StakingPools: weights length mismatch");

        _updatePools();

        uint256 _totalRewardWeight = _ctx.totalRewardWeight;
        for (uint256 _poolId = 0; _poolId < _pools.length(); _poolId++) {
            Pool.Data storage _pool = _pools.get(_poolId);

            uint256 _currentRewardWeight = _pool.rewardWeight;
            if (_currentRewardWeight == _rewardWeights[_poolId]) {
                continue;
            }

            _totalRewardWeight = _totalRewardWeight.sub(_currentRewardWeight).add(_rewardWeights[_poolId]);
            _pool.rewardWeight = _rewardWeights[_poolId];

            emit PoolRewardWeightUpdated(_poolId, _rewardWeights[_poolId]);
        }

        _ctx.totalRewardWeight = _totalRewardWeight;
    }

    /// @dev Set vesting duration.
    ///
    /// @param _vestingDuration Vesting duration.
    function setVestingDuration(uint256 _vestingDuration) external onlyGovernance {
        vestingDuration = _vestingDuration;

        emit VestingDurationUpdated(_vestingDuration);
    }

    /// @dev Stakes tokens into a pool.
    ///
    /// @param _poolId The pool id.
    /// @param _depositAmount The amount of tokens to deposit.
    function deposit(uint256 _poolId, uint256 _depositAmount) external nonReentrant {
        Pool.Data storage _pool = _pools.get(_poolId);
        _pool.update(_ctx);

        _deposit(_poolId, _depositAmount);
    }

    /// @notice Deposit to IndexPool and stake your shares in the same transaction.
    /// @param _usdcAmount The amount of USDC to deposit into the senior pool. All shares from deposit
    /// @param _poolId The pool id
    ///   will be staked.
    function depositAndStake(uint256 _usdcAmount, uint256 _poolId) public nonReentrant {
        Pool.Data storage _pool = _pools.get(_poolId);
        _pool.update(_ctx);

        uint256 rwaAmount = _depositToIndexPool(_usdcAmount, _pool);
        _deposit(_poolId, rwaAmount);
    }

    /// @notice Identical to `depositAndStake`, except it allows for a signature to be passed that permits
    ///   this contract to move funds on behalf of the user.
    /// @param _usdcAmount The amount of USDC to deposit
    /// @param _poolId The pool id
    /// @param _v secp256k1 signature component
    /// @param _r secp256k1 signature component
    /// @param _s secp256k1 signature component
    function depositWithPermitAndStake(
        uint256 _usdcAmount,
        uint256 _poolId,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external {
        Pool.Data storage _pool = _pools.get(_poolId);
        NAOSConfig config = _pool.config;
        IERC20withDec(config.getUSDC()).permit(msg.sender, address(this), _usdcAmount, _deadline, _v, _r, _s);
        depositAndStake(_usdcAmount, _poolId);
    }

    /// @dev Withdraws deposited tokens from a pool.
    ///
    /// @param _poolId The pool id.
    /// @param _index The index of deposited order.
    function withdraw(uint256 _poolId, uint256[] calldata _index, uint256[] calldata _amount) external nonReentrant {
        Pool.Data storage _pool = _pools.get(_poolId);
        _pool.update(_ctx);

        require(_index.length <= userStakedList[msg.sender][_poolId].length, "invalid index");
        require(_index.length == _amount.length, "inconsistent input index");

        for (uint256 i = 0; i < _index.length; i++) {
            require(_index[i] < userStakedList[msg.sender][_poolId].length, "invalid index");
            uint256 userStakedIndex = userStakedList[msg.sender][_poolId][_index[i]];
            Stake.Data storage _stake = _stakes[_poolId][userStakedIndex];
            _stake.update(_pool, _ctx);

            require(_stake.totalDeposited >= _amount[i], "No enough money for the withdrawn");

            _withdraw(_poolId, _pool, _stake, _amount[i]);
        }
    }

    /// @dev Claims all rewarded tokens from a pool.
    ///
    /// @param _poolId The pool id.
    /// @param _index The index of deposited order.
    function claim(uint256 _poolId, uint256[] calldata _index) external nonReentrant {
        Pool.Data storage _pool = _pools.get(_poolId);
        _pool.update(_ctx);

        require(_index.length <= userStakedList[msg.sender][_poolId].length, "invalid index");   

        for (uint256 i = 0; i < _index.length; i++) {
            require(_index[i] < userStakedList[msg.sender][_poolId].length, "invalid index");
            uint256 userStakedIndex = userStakedList[msg.sender][_poolId][_index[i]];
            Stake.Data storage _stake = _stakes[_poolId][userStakedIndex];
            _stake.update(_pool, _ctx);

            require(_stake.totalUnclaimed > 0, "No claimable token");

            _claim(_poolId, _stake);
        }
    }

    /// @dev Update the boost of the deposited order.
    ///
    /// @param _poolId The pool to update boost for.
    /// @param _account The address to update boost for.
    /// @param _index The index of deposited order.
    function activateBoost(uint256 _poolId, address _account, uint256[] calldata _index) external nonReentrant {
        Pool.Data storage _pool = _pools.get(_poolId);
        _pool.update(_ctx);

        require(_index.length <= userStakedList[_account][_poolId].length, "invalid index");   

        for (uint256 i = 0; i < _index.length; i++) {
            require(_index[i] < userStakedList[_account][_poolId].length, "invalid index");
            uint256 userStakedIndex = userStakedList[_account][_poolId][_index[i]];
            Stake.Data storage _stake = _stakes[_poolId][userStakedIndex];
            _stake.update(_pool, _ctx);
            _updateWeighted(_pool, _stake, boostPool.getPoolTotalDepositedWeight(), boostPool.getStakeTotalDepositedWeight(_account));
        }
    }

    /// @dev Gets the number of pools that exist.
    ///
    /// @return the pool count.
    function poolCount() external view returns (uint256) {
        return _pools.length();
    }

    /// @dev Gets the rate at which tokens are minted to stakers for all pools.
    ///
    /// @return the reward rate.
    function rewardRate() external view returns (uint256) {
        return _ctx.rewardRate;
    }

    /// @dev Gets the total reward weight between all the pools.
    ///
    /// @return the total reward weight.
    function totalRewardWeight() external view returns (uint256) {
        return _ctx.totalRewardWeight;
    }

    /// @dev Gets the token a pool accepts.
    ///
    /// @return the token.
    function getPoolToken(uint256 _poolId) external view returns (IERC20withDec) {
        Pool.Data storage _pool = _pools.get(_poolId);
        IERC20withDec token = _pool.config.getRWA();
        return token;
    }

    /// @dev Gets the reward weight of a pool which determines how much of the total rewards it receives per block.
    ///
    /// @param _poolId the identifier of the pool.
    ///
    /// @return the pool reward weight.
    function getPoolRewardWeight(uint256 _poolId) external view returns (uint256) {
        Pool.Data storage _pool = _pools.get(_poolId);
        return _pool.rewardWeight;
    }

    /// @dev Gets the amount of tokens per block being distributed to stakers for a pool.
    ///
    /// @param _poolId the identifier of the pool.
    ///
    /// @return the pool reward rate.
    function getPoolRewardRate(uint256 _poolId) external view returns (uint256) {
        Pool.Data storage _pool = _pools.get(_poolId);
        return _pool.getRewardRate(_ctx);
    }

    /// @dev Gets the total amount of funds deposited in a pool.
    ///
    /// @return the total amount of deposited tokens.
    function getPoolTotalDeposited(uint256 _poolId) external view returns (uint256) {
        Pool.Data storage _pool = _pools.get(_poolId);
        return _pool.totalDeposited;
    }

    /// @dev Gets the pool total deposited weight.
    ///
    /// @return the pool total deposited weight.
    function getPoolTotalDepositedWeight(uint256 _poolId) external view returns (uint256) {
        Pool.Data storage _pool = _pools.get(_poolId);
        return _pool.totalDepositedWeight;
    }

    /// @dev Gets the number of tokens a user has deposited into a pool.
    ///
    /// @param _poolId The pool id.
    /// @param _account The account to query.
    /// @param _index The user deposited index.
    ///
    /// @return the amount of deposited tokens.
    function getStakeTotalDeposited(uint256 _poolId, address _account, uint256 _index) external view returns (uint256) {
        uint256 userStakedIndex = userStakedList[_account][_poolId][_index];
        Stake.Data storage _stake = _stakes[_poolId][userStakedIndex];
        return _stake.totalDeposited;
    }

    /// @dev Gets the specified deposited weight.
    ///
    /// @param _poolId The pool id.
    /// @param _account The account to query.
    /// @param _index The user deposited index.
    ///
    /// @return the boost weight of the specified deposited order.
    function getStakeTotalDepositedWeight(uint256 _poolId, address _account, uint256 _index) external view returns (uint256) {
        uint256 userStakedIndex = userStakedList[_account][_poolId][_index];
        Stake.Data storage _stake = _stakes[_poolId][userStakedIndex];
        return _stake.totalDepositedWeight;
    }

    /// @dev Gets the number of unclaimed reward tokens a user can claim from a pool.
    ///
    /// @param _poolId The pool id.
    /// @param _account The account to query.
    /// @param _index The user deposited index.
    ///
    /// @return the amount of unclaimed reward tokens a user has in a pool.
    function getStakeUnclaimed(uint256 _poolId, address _account, uint256 _index) external view returns (uint256, uint256) {
        uint256 userStakedIndex = userStakedList[_account][_poolId][_index];
        Stake.Data storage _stake = _stakes[_poolId][userStakedIndex];

        uint256 _claimAmount = _stake.getUpdatedTotalUnclaimed(_pools.get(_poolId), _ctx);
        uint256 _elapsedTime = block.timestamp.sub(_stake.depositTime);

        uint256 _claimAmountAfterVesting = _claimAmount;
        if (_elapsedTime < vestingDuration) {
            _claimAmountAfterVesting = _claimAmount.mul(_elapsedTime).div(vestingDuration);
        }

        return (_claimAmount, _claimAmountAfterVesting);
    }

    /// @dev Gets the number of user's deposited order count.
    ///
    /// @param _poolId The pool id.
    /// @param _account The user account.
    ///
    /// @return count the count of user's deposited order.
    function getUserOrderCount(uint256 _poolId, address _account) external view returns (uint256 count) {
        return userStakedList[_account][_poolId].length;
    }

    /// @dev Gets user's deposited order by index.
    ///
    /// @param _poolId The pool id.
    /// @param _account The user account.
    /// @param _index The deposited order index.
    ///
    /// @return totalDeposited the amount of the deposited order.
    /// @return totalDepositedWeight the weighted amount of the deposited order.
    /// @return depositTime the deposited time of the deposited order.
    function getUserStakeOrderByIndex(uint256 _poolId, address _account, uint256 _index)
        external
        view
        returns (
            uint256 totalDeposited,
            uint256 totalDepositedWeight,
            uint256 depositTime
        )
    {
        uint256 userStakedIndex = userStakedList[_account][_poolId][_index];
        Stake.Data storage _stake = _stakes[_poolId][userStakedIndex];
        return (_stake.totalDeposited, _stake.totalDepositedWeight, _stake.depositTime);
    }

    /// @dev Get the user weight in the pool.
    ///
    /// @param poolDeposited The total deposited in the pool.
    /// @param userDeposited The user deposited in the pool.
    /// @param boostPoolDepositedWeight The total deposited Weight in the boost pool.
    /// @param boostUserDepositedWeight The user deposited Weight in the boost pool.
    ///
    /// @return the user boost weight in the pool.
    function calcUserWeight(
        uint256 poolDeposited,
        uint256 userDeposited,
        uint256 boostPoolDepositedWeight,
        uint256 boostUserDepositedWeight
    ) public pure returns (uint256) {
        uint256 weighted = userDeposited.mul(40).div(100);
        if (boostPoolDepositedWeight > 0) {
            weighted = weighted.add(poolDeposited.mul(boostUserDepositedWeight).mul(60).div(boostPoolDepositedWeight).div(100));
            if (weighted >= userDeposited) {
                weighted = userDeposited;
            }
        }

        return weighted;
    }

    /// @dev Updates all of the pools.
    ///
    /// Warning:
    /// Make the staking plan before add a new pool. If the amount of pool becomes too many would
    /// result the transaction failed due to high gas usage in for-loop.
    function _updatePools() internal {
        for (uint256 _poolId = 0; _poolId < _pools.length(); _poolId++) {
            Pool.Data storage _pool = _pools.get(_poolId);
            _pool.update(_ctx);
        }
    }

    /// @dev Stakes tokens into a pool.
    ///
    /// The pool and stake MUST be updated before calling this function.
    ///
    /// @param _poolId the pool id
    /// @param _depositAmount the amount of tokens to deposit.
    function _deposit(uint256 _poolId, uint256 _depositAmount) internal {
        Pool.Data storage _pool = _pools.get(_poolId);
        _pool.totalDeposited = _pool.totalDeposited.add(_depositAmount);

        userStakedList[msg.sender][_poolId].push(_stakes[_poolId].length);
        _stakes[_poolId].push(Stake.Data({totalDeposited: _depositAmount, totalDepositedWeight: 0, totalUnclaimed: 0, depositTime: block.timestamp, lastAccumulatedWeight: FixedPointMath.uq192x64(0)}));
        Stake.Data storage _stake = _stakes[_poolId][_stakes[_poolId].length - 1];

        _updateWeighted(_pool, _stake, boostPool.getPoolTotalDepositedWeight(), boostPool.getStakeTotalDepositedWeight(msg.sender));
        IERC20withDec token = _pool.config.getRWA();

        require(token.transferFrom(msg.sender, address(this), _depositAmount), "token transfer failed");

        emit TokensDeposited(msg.sender, _poolId, _depositAmount);
    }

    /// @dev Withdraws deposited tokens from a pool.
    ///
    /// @param _poolId The pool id.
    /// @param _pool The pool data.
    /// @param _stake The deposited data which will be withdrew.
    function _withdraw(uint256 _poolId, Pool.Data storage _pool, Stake.Data storage _stake, uint256 _withdrawAmount) internal {
        _pool.totalDeposited = _pool.totalDeposited.sub(_withdrawAmount);
        _stake.totalDeposited = _stake.totalDeposited.sub(_withdrawAmount);

        _updateWeighted(_pool, _stake, boostPool.getPoolTotalDepositedWeight(), boostPool.getStakeTotalDepositedWeight(msg.sender));
        IERC20withDec token = _pool.config.getRWA();

        require(token.transfer(msg.sender, _withdrawAmount), "token transfer failed");

        emit TokensWithdrawn(msg.sender, _poolId, _withdrawAmount);
    }

    /// @dev Claims all rewarded tokens from a pool.
    ///
    /// The pool and stake MUST be updated before calling this function.
    ///
    /// @param _poolId The pool id.
    /// @param _stake The deposited data which will be claim.
    function _claim(uint256 _poolId, Stake.Data storage _stake) internal {
        uint256 _claimAmount = _stake.totalUnclaimed;
        uint256 _elapsedTime = block.timestamp.sub(_stake.depositTime);
        _stake.totalUnclaimed = 0;
        uint256 _penalty = 0;
        uint256 _claimable = _claimAmount;

        if (_elapsedTime < vestingDuration) {
            _claimable = _claimAmount.mul(_elapsedTime).div(vestingDuration);
            _penalty = _claimAmount.sub(_claimable);
        }

        require(reward.transfer(msg.sender, _claimable), "token transfer failed");

        emit TokensClaimed(msg.sender, _poolId, _claimable, _penalty);
    }

    /// @dev update user's deposit boost weight
    ///
    /// @param _pool The pool information
    /// @param _stake The user information
    /// @param boostPoolDepositedWeight The total deposited token weight in boost pool
    /// @param boostUserDepositedWeight The user deposited token weight in boost pool
    function _updateWeighted(
        Pool.Data storage _pool,
        Stake.Data storage _stake,
        uint256 boostPoolDepositedWeight,
        uint256 boostUserDepositedWeight
    ) internal {
        uint256 weight = calcUserWeight(_pool.totalDeposited, _stake.totalDeposited, boostPoolDepositedWeight, boostUserDepositedWeight);

        _pool.totalDepositedWeight = _pool.totalDepositedWeight.sub(_stake.totalDepositedWeight).add(weight);
        _stake.totalDepositedWeight = weight;
    }

    /// @dev deposit in to index pool
    ///
    /// @param _usdcAmount The USDC amount
    /// @param _pool The user pool struct
    function _depositToIndexPool(uint256 _usdcAmount, Pool.Data storage _pool) internal returns (uint256 rwaAmount) {
        NAOSConfig config = _pool.config;
        require(config.getVerified().verifyIndexPool(msg.sender), "This address has not been go-listed");
        IERC20withDec usdc = config.getUSDC();
        usdc.transferFrom(msg.sender, address(this), _usdcAmount);

        IIndexPool indexPool = config.getIndexPool();
        usdc.approve(address(indexPool), _usdcAmount);
        return indexPool.deposit(_usdcAmount);
    }
}