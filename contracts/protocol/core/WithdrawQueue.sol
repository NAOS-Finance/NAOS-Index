// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";

import "../../interfaces/ISeniorPool.sol";
import "./BaseUpgradeablePausable.sol";
import "./ConfigHelper.sol";

contract WithdrawQueue is BaseUpgradeablePausable {
    GoldfinchConfig public config;
    using ConfigHelper for GoldfinchConfig;
    using SafeMath for uint256;

    struct WithdrawData {
        address user;
        uint256 registeredAmount;
        uint256 remainingAmount;
        uint256 withdrawAmount;
    }

    struct UserWithdrawData {
        bool listInQueue;
        uint256 queueIndex;
        uint256 ceiling;
        uint256 Claimable;
    }

    struct FeeTier {
        uint256 veNAOSAmount;
        uint256 fee;
    }

    WithdrawData[] withdrawQueue;
    FeeTier[] public feeTiers;
    mapping(address => UserWithdrawData) userWithdrawData;

    bool verifyRequired;
    uint256 constant MAX_QUEUE_SIZE = 100;
    uint256 constant MAX_WITHDRAW_FEE = 50;
    uint256 constant indexMantissa = 1000000000000000000;
    uint256 public totalRegisteredAmount;
    uint256 public queueIndex;
    uint256 public ceiling;

    event WithdrawQueueUpdated(
        uint256 index,
        address indexed userAddress,
        uint256 registerAmount,
        uint256 remainingAmount
    );
    event UserClaimableAmountUpdated(
        address indexed userAddress,
        uint256 amount
    );

    event FeeTierUpdated(
        uint256 indexed tier,
        uint256 veNAOSAmount,
        uint256 fee
    );

    function initialize(address owner, GoldfinchConfig _config)
        public
        initializer
    {
        require(
            owner != address(0) && address(_config) != address(0),
            "Owner and config addresses cannot be empty"
        );

        __BaseUpgradeablePausable__init(owner);

        config = _config;
        verifyRequired = false;
        feeTiers.push(FeeTier({veNAOSAmount: 0, fee: MAX_WITHDRAW_FEE}));

        IFidu fidu = config.getFidu();
        ISeniorPool seniorPool = config.getSeniorPool();
        require(
            (address(fidu) != address(0)) &&
                (address(seniorPool) != address(0)),
            "config is not set"
        );
        fidu.approve(address(seniorPool), uint256(-1));
    }

    /// @dev Register the index token amount which users want to withdraw.
    ///
    /// @param _amount The index token amount.
    function register(uint256 _amount) external {
        if (verifyRequired) {
            require(
                config.getGo().goSeniorPool(msg.sender),
                "This address has not been go-listed"
            );
        }

        _withdrawFromIndexPool();
        UserWithdrawData storage userData = userWithdrawData[msg.sender];
        require(
            _amount > 0 && (_amount <= ceiling || _amount <= userData.ceiling),
            "invalid input"
        );
        require(!userData.listInQueue, "user has listed in queue");
        require(
            withdrawQueue.length.sub(queueIndex) <= MAX_QUEUE_SIZE,
            "exceed max queue size"
        );

        userData.listInQueue = true;
        userData.queueIndex = withdrawQueue.length;

        withdrawQueue.push(
            WithdrawData({
                user: msg.sender,
                registeredAmount: _amount,
                remainingAmount: _amount,
                withdrawAmount: 0
            })
        );
        totalRegisteredAmount = totalRegisteredAmount.add(_amount);

        IFidu fidu = config.getFidu();
        require(
            fidu.transferFrom(msg.sender, address(this), _amount),
            "transfer failed"
        );

        emit WithdrawQueueUpdated(
            withdrawQueue.length.sub(1),
            msg.sender,
            _amount,
            _amount
        );
    }

    /// @dev Update the index token amount which users want to withdraw.
    ///
    /// @param _amount The index token amount which will be decreased in the current queue.
    function update(uint256 _amount) external {
        _withdrawFromIndexPool();
        UserWithdrawData storage userData = userWithdrawData[msg.sender];
        require(userData.listInQueue, "empty user data");

        WithdrawData storage withdrawData = withdrawQueue[userData.queueIndex];
        require(_amount <= withdrawData.remainingAmount, "no enough amount");

        if (_amount == withdrawData.remainingAmount) {
            userData.listInQueue = false;
        }

        withdrawData.registeredAmount = withdrawData.registeredAmount.sub(
            _amount
        );
        withdrawData.remainingAmount = withdrawData.remainingAmount.sub(
            _amount
        );
        totalRegisteredAmount = totalRegisteredAmount.sub(_amount);
        IFidu fidu = config.getFidu();
        require(fidu.transfer(msg.sender, _amount), "transfer failed");

        emit WithdrawQueueUpdated(
            userData.queueIndex,
            msg.sender,
            withdrawData.registeredAmount,
            withdrawData.remainingAmount
        );
    }

    /// @dev Claim the withdrawable usd.
    function claim() external {
        UserWithdrawData storage userData = userWithdrawData[msg.sender];
        require(userData.Claimable > 0, "no claimable tokens");

        uint256 feePercent = getFeeByUser(msg.sender);
        uint256 reserveAmount = userData.Claimable.mul(feePercent).div(
            config.getWithdrawFeeDenominator()
        );
        uint256 claimableAmount = userData.Claimable.sub(reserveAmount);

        userData.Claimable = 0;

        IERC20withDec usdc = config.getUSDC();
        require(usdc.transfer(msg.sender, claimableAmount), "Fail to claim");
        require(
            usdc.transfer(config.reserveAddress(), reserveAmount),
            "Fail to transfer to reserve"
        );

        emit UserClaimableAmountUpdated(msg.sender, 0);
    }

    /// @dev Withdraw the Fidu from index pool and distribute usd to the user in the queue.
    function withdrawFromIndexPool() external {
        _withdrawFromIndexPool();
    }

    function _withdrawFromIndexPool() internal {
        if (totalRegisteredAmount == 0) {
            return;
        }

        // retrieve index pool usd amount
        IERC20withDec usdc = config.getUSDC();
        ISeniorPool seniorPool = config.getSeniorPool();
        uint256 indexUSDCAmount = usdc.balanceOf(address(seniorPool));
        uint256 vaultCount = seniorPool.vaultCount();
        if (vaultCount > 0) {
            indexUSDCAmount = indexUSDCAmount.add(
                seniorPool.getVaultTotalDeposited(vaultCount.sub(1))
            );
        }

        // calcualte withdrawable index token amount
        uint256 withdrawIndexAmount = seniorPool.getNumShares(indexUSDCAmount);
        if (withdrawIndexAmount > totalRegisteredAmount) {
            withdrawIndexAmount = totalRegisteredAmount;
        }
        if (withdrawIndexAmount == 0) {
            return;
        }
        totalRegisteredAmount = totalRegisteredAmount.sub(withdrawIndexAmount);

        // withdraw index tokens from index pool
        uint256 seniorTokenPrice = seniorPool.sharePrice();
        uint256 withdrawUSDAmount = seniorPool.withdrawInFidu(
            withdrawIndexAmount
        );

        // distribute usd to the users in the queue
        uint256 loopStartIndex = queueIndex;
        for (
            uint256 index = loopStartIndex;
            index < withdrawQueue.length;
            index++
        ) {
            WithdrawData storage withdrawData = withdrawQueue[index];
            UserWithdrawData storage userData = userWithdrawData[
                withdrawData.user
            ];
            uint256 distributedUSDC;

            if (withdrawData.remainingAmount < withdrawIndexAmount) {
                distributedUSDC = withdrawData
                    .remainingAmount
                    .mul(seniorTokenPrice)
                    .div(indexMantissa);
                withdrawIndexAmount = withdrawIndexAmount.sub(
                    withdrawData.remainingAmount
                );
                withdrawData.remainingAmount = 0;
                withdrawData.withdrawAmount = withdrawData.withdrawAmount.add(
                    distributedUSDC
                );
                queueIndex++;

                userData.listInQueue = false;
                userData.Claimable = userData.Claimable.add(distributedUSDC);
                withdrawUSDAmount = withdrawUSDAmount.sub(distributedUSDC);

                emit WithdrawQueueUpdated(
                    index,
                    withdrawData.user,
                    withdrawData.registeredAmount,
                    withdrawData.remainingAmount
                );
                emit UserClaimableAmountUpdated(msg.sender, userData.Claimable);
            } else {
                withdrawData.remainingAmount = withdrawData.remainingAmount.sub(
                    withdrawIndexAmount
                );
                withdrawData.withdrawAmount = withdrawData.withdrawAmount.add(
                    withdrawUSDAmount
                );

                if (withdrawData.remainingAmount == 0) {
                    queueIndex++;
                    userData.listInQueue = false;
                }
                userData.Claimable = userData.Claimable.add(withdrawUSDAmount);

                emit WithdrawQueueUpdated(
                    index,
                    withdrawData.user,
                    withdrawData.registeredAmount,
                    withdrawData.remainingAmount
                );
                emit UserClaimableAmountUpdated(msg.sender, userData.Claimable);
                return;
            }
        }
    }

    /// @dev Update the verified requirement.
    ///
    /// @param _required the verified required.
    function setVerify(bool _required) external onlyAdmin {
        verifyRequired = _required;
    }

    /// @dev Set the user withdraw ceiling.
    ///
    /// @param _ceiling the verified required.
    function setCeiling(uint256 _ceiling) external onlyAdmin {
        ceiling = _ceiling;
    }

    /// @dev Set the withdraw ceiling for specific user.
    ///
    /// @param _user the user address
    /// @param _ceiling the verified required.
    function setUserCeiling(address _user, uint256 _ceiling)
        external
        onlyAdmin
    {
        UserWithdrawData storage userData = userWithdrawData[_user];
        userData.ceiling = _ceiling;
    }

    /**
     * @notice Add fee tier
     * @param _veNAOSAmount the veNAOS amount of this tier
     * @param _fee the fee percent
     */
    function addFeeTier(uint256 _veNAOSAmount, uint256 _fee)
        external
        onlyAdmin
    {
        require(_fee <= MAX_WITHDRAW_FEE, "Failed to set fee tier (too large)");
        require(
            _veNAOSAmount > feeTiers[feeTiers.length - 1].veNAOSAmount,
            "veNOAS amount should be greater than previous one"
        );
        require(
            _fee < feeTiers[feeTiers.length - 1].fee,
            "fee should be less than previous one"
        );

        feeTiers.push(FeeTier({veNAOSAmount: _veNAOSAmount, fee: _fee}));

        emit FeeTierUpdated(feeTiers.length - 1, _veNAOSAmount, _fee);
    }

    /**
     * @notice Set fee tier
     * @param _tier id
     * @param _veNAOSAmount the veNAOS amount of the tier
     * @param _fee percent
     */
    function setFeeTier(
        uint256 _tier,
        uint256 _veNAOSAmount,
        uint256 _fee
    ) external onlyAdmin {
        require(_fee <= MAX_WITHDRAW_FEE, "Failed to set fee tier (too large)");
        require(_tier < feeTiers.length, "Invalid index");

        if (_tier > 0) {
            FeeTier memory previousTier = feeTiers[_tier - 1];
            require(
                _veNAOSAmount > previousTier.veNAOSAmount,
                "veNOAS amount should be greater than previous one"
            );
            require(
                _fee < previousTier.fee,
                "fee should be less than previous one"
            );
        }

        if (_tier < feeTiers.length - 1) {
            FeeTier memory nextTier = feeTiers[_tier + 1];
            require(
                _veNAOSAmount < nextTier.veNAOSAmount,
                "veNOAS amount should be less than next one"
            );
            require(_fee > nextTier.fee, "fee should be greate than next one");
        }

        feeTiers[_tier].veNAOSAmount = _veNAOSAmount;
        feeTiers[_tier].fee = _fee;

        emit FeeTierUpdated(_tier, _veNAOSAmount, _fee);
    }

    /**
     * @notice get user's fee tier
     *
     * @param _user the user address
     *
     * @return fee the fee percentage
     */
    function getFeeByUser(address _user) public view returns (uint256 fee) {
        uint256 veNAOS = config.getBoostPool().getStakeTotalDepositedWeight(
            _user
        );
        for (uint256 index = 1; index < feeTiers.length; index++) {
            if (veNAOS < feeTiers[index].veNAOSAmount) {
                return feeTiers[index - 1].fee;
            }
        }
        return feeTiers[feeTiers.length - 1].fee;
    }
}
