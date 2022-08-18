// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/utils/Address.sol";

interface IBoostPool {
    function getPoolTotalDepositedWeight() external view returns (uint256);

    function getStakeTotalDepositedWeight(address _account) external view returns (uint256);
}

/**
 * @title VeNAOS
 * @notice VeNAOS (symbol: VeNAOS) is NAOS's voting token, representing voting power
 *  in the NAOS protocol.
 * @author NAOS
 */
contract VeNAOS is IERC20 {

    using Address for address;

    string private _name;
    string private _symbol;
    uint8 private _decimals;

    IBoostPool public _boostPool;

    constructor(string memory name, string memory symbol, IBoostPool boostPool) public {
        _name = name;
        _symbol = symbol;
        _decimals = 18;
        _boostPool = boostPool;
    }

    function name() public view returns (string memory) {
        return _name;
    }

    function symbol() public view returns (string memory) {
        return _symbol;
    }

    function decimals() public view returns (uint8) {
        return _decimals;
    }

    function totalSupply() public view override returns (uint256) {
        return _boostPool.getPoolTotalDepositedWeight();
    }

    function balanceOf(address account) public view override returns (uint256) {
        return _boostPool.getStakeTotalDepositedWeight(account);
    }

    function transfer(address recipient, uint256 amount) public virtual override returns (bool) {
        _transfer(msg.sender, recipient, amount);
        return true;
    }

    function allowance(address owner, address spender) public view virtual override returns (uint256) {
        return 0;
    }


    function approve(address spender, uint256 amount) public virtual override returns (bool) {
        return true;
    }

    function transferFrom(address sender, address recipient, uint256 amount) public virtual override returns (bool) {
        _transfer(sender, recipient, amount);
        return true;
    }

    function _transfer(address sender, address recipient, uint256 amount) internal pure {
        revert("veNAOS is not allowed to transfer");
    }
}
