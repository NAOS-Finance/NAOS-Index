// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-ethereum-package/contracts/GSN/Context.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/utils/Address.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/Initializable.sol";

interface IBoostPool {
    function getStakeTotalDepositedWeight(address _account) external view returns (uint256);
}

/**
 * @title VeNAOS
 * @notice VeNAOS (symbol: VeNAOS) is NAOS's voting token, representing voting power
 *  in the NAOS protocol.
 * @author NAOS
 */

contract VeNAOS is Initializable, ContextUpgradeSafe, IERC20 {

    using SafeMath for uint256;
    using Address for address;

    mapping (address => uint256) private _balances;

    mapping (address => mapping (address => uint256)) private _allowances;

    uint256 private _totalSupply;

    string private _name;
    string private _symbol;
    uint8 private _decimals;

    function __ERC20_init(string memory name, string memory symbol) internal initializer {
        __Context_init_unchained();
        __ERC20_init_unchained(name, symbol);
    }

    function __ERC20_init_unchained(string memory name, string memory symbol) internal initializer {
        _name = name;
        _symbol = symbol;
        _decimals = 18;
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
        return _totalSupply;
    }

    function transfer(address recipient, uint256 amount) public virtual override returns (bool) {
        _transfer(_msgSender(), recipient, amount);
        return true;
    }

    function allowance(address owner, address spender) public view virtual override returns (uint256) {
        return _allowances[owner][spender];
    }


    function approve(address spender, uint256 amount) public virtual override returns (bool) {
        return true;
    }

    function transferFrom(address sender, address recipient, uint256 amount) public virtual override returns (bool) {
        _transfer(sender, recipient, amount);
        // _approve(sender, _msgSender(), _allowances[sender][_msgSender()].sub(amount, "ERC20: transfer amount exceeds allowance"));
        return true;
    }

    function _transfer(address sender, address recipient, uint256 amount) internal virtual {
        revert("veNAOS is not allowed to transfer");
    }

    function _setupDecimals(uint8 decimals_) internal {
        _decimals = decimals_;
    }

    uint256[44] private __gap;

    IBoostPool public boostPool;

    // solhint-disable-next-line func-name-mixedcase
    function __initialize__(
        string calldata name,
        string calldata symbol,
        IBoostPool _boostPool
    ) external initializer {
        __Context_init_unchained();
        __ERC20_init_unchained(name, symbol);

        boostPool = _boostPool;
    }

    function balanceOf(address account) public view override returns (uint256) {
        return boostPool.getStakeTotalDepositedWeight(account);
    }
}
