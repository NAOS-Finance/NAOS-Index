pragma solidity 0.6.12;

interface IBoostPool {
    function getPoolTotalDepositedWeight() external view returns (uint256);

    function getStakeTotalDepositedWeight(address _account) external view returns (uint256);
}
