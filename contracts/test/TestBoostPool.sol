pragma solidity 0.6.12;

import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";

contract TestBoostPool {
    using SafeMath for uint256;

    struct Data {
        uint256 totalDeposited;
        uint256 totalDepositedWeight;
    }

    mapping(address => Data) private _stakes;

    uint256 totalDeposited;
    uint256 totalDepositedWeight;

    function deposit(uint256 _depositAmount) external {
        Data storage _stake = _stakes[msg.sender];
        totalDeposited = totalDeposited.add(_depositAmount);
        totalDepositedWeight = totalDepositedWeight.add(_depositAmount);

        _stake.totalDeposited = _stake.totalDeposited.add(_depositAmount);
        _stake.totalDepositedWeight = _stake.totalDepositedWeight.add(_depositAmount);
    }

    function getPoolTotalDepositedWeight() external view returns (uint256) {
        return totalDepositedWeight;
    }

    function getStakeTotalDepositedWeight(address _account) external view returns (uint256) {
        Data memory _stake = _stakes[_account];
        return _stake.totalDepositedWeight;
    }
}
