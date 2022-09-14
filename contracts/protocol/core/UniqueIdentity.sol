// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "./BaseUpgradeablePausable.sol";
import "../../interfaces/IUniqueIdentity.sol";

/**
 * @title UniqueIdentity
 */

contract UniqueIdentity is BaseUpgradeablePausable, IUniqueIdentity {

  bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");

  uint256 public constant ID_TYPE_0 = 0;
  uint256 public constant ID_TYPE_1 = 1;
  uint256 public constant ID_TYPE_2 = 2;
  uint256 public constant ID_TYPE_3 = 3;
  uint256 public constant ID_TYPE_4 = 4;
  uint256 public constant ID_TYPE_5 = 5;
  uint256 public constant ID_TYPE_6 = 6;
  uint256 public constant ID_TYPE_7 = 7;
  uint256 public constant ID_TYPE_8 = 8;
  uint256 public constant ID_TYPE_9 = 9;
  uint256 public constant ID_TYPE_10 = 10;

  /// @dev We include a nonce in every hashed message, and increment the nonce as part of a
  /// state-changing operation, so as to prevent replay attacks, i.e. the reuse of a signature.
  mapping(address => uint256) public nonces;
  mapping(uint256 => bool) public supportedUIDTypes;
  mapping(address => mapping(uint256 => uint256)) public expiration;

  modifier onlySigner(
    address account,
    uint256 id,
    uint256 expiresAt,
    bytes calldata signature
  ) {
    require(block.timestamp < expiresAt, "Signature has expired");

    uint256 chainId;
    assembly {
      chainId := chainid()
    }

    bytes32 h = keccak256(abi.encodePacked(account, id, expiresAt, address(this), nonces[account], chainId));
    bytes32 ethSignedMessage = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", h));
    address recovered = tryRecover(ethSignedMessage, signature);
    require(hasRole(SIGNER_ROLE, recovered), "Invalid signer");
    _;
  }

  modifier incrementNonce(address account) {
    nonces[account] += 1;
    _;
  }

  function initialize(address owner) public initializer {
    require(owner != address(0), "Owner address cannot be empty");

    __BaseUpgradeablePausable__init(owner);
    __UniqueIdentity_init(owner);
  }

  // solhint-disable-next-line func-name-mixedcase
  function __UniqueIdentity_init(address owner) internal initializer {
    __UniqueIdentity_init_unchained(owner);
  }

  // solhint-disable-next-line func-name-mixedcase
  function __UniqueIdentity_init_unchained(address owner) internal initializer {
    _setupRole(SIGNER_ROLE, owner);
    _setRoleAdmin(SIGNER_ROLE, OWNER_ROLE);
  }

  function setSupportedUIDTypes(uint256[] calldata ids, bool[] calldata values) public onlyAdmin {
    require(ids.length == values.length, "values and ids length mismatch");
    for (uint256 i = 0; i < ids.length; ++i) {
      supportedUIDTypes[ids[i]] = values[i];
    }
  }

  function mint(
    uint256 id,
    uint256 expiresAt,
    bytes calldata signature
  ) public override onlySigner(_msgSender(), id, expiresAt, signature) incrementNonce(_msgSender()) {
    require(supportedUIDTypes[id] == true, "Token id not supported");
    require(expiration[_msgSender()][id] == 0, "Expiration before must be 0");
    require(expiresAt > block.timestamp, "Expiration must be bigger than current timestamp");

    _updateExpiration(_msgSender(), id, expiresAt);
  }

  function burn(
    address account,
    uint256 id,
    uint256 expiresAt,
    bytes calldata signature
  ) public override onlySigner(account, id, expiresAt, signature) incrementNonce(account) {
    require(expiresAt > block.timestamp, "Expiration must be bigger than current time");

    _updateExpiration(account, id, 0);
  }

  function updateExpiration(address account, uint256 id, uint256 expiresAt) external onlyAdmin incrementNonce(account) {
    _updateExpiration(account, id, expiresAt);
  }

  function updateExpirations(address[] calldata accounts, uint256[] calldata ids, uint256[] calldata expiresAts) external onlyAdmin {
    require(accounts.length == ids.length, "accounts and ids length mismatch");
    require(ids.length == expiresAts.length, "expireAts and ids length mismatch");
    for (uint256 i = 0; i < accounts.length; ++i) {
      nonces[accounts[i]] += 1;
      _updateExpiration(accounts[i], ids[i], expiresAts[i]);
    }
  }

  function _updateExpiration(address account, uint256 id, uint256 expiresAt) internal {
    expiration[account][id] = expiresAt;
  }

  function tryRecover(
    bytes32 hash,
    bytes32 r,
    bytes32 vs
  ) internal pure returns (address) {
    bytes32 s = vs & bytes32(0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff);
    uint8 v = uint8((uint256(vs) >> 255) + 27);
    return tryRecover(hash, v, r, s);
  }

  function tryRecover(
    bytes32 hash,
    uint8 v,
    bytes32 r,
    bytes32 s
  ) internal pure returns (address) {
    // EIP-2 still allows signature malleability for ecrecover(). Remove this possibility and make the signature
    // unique. Appendix F in the Ethereum Yellow paper (https://ethereum.github.io/yellowpaper/paper.pdf), defines
    // the valid range for s in (301): 0 < s < secp256k1n ÷ 2 + 1, and for v in (302): v ∈ {27, 28}. Most
    // signatures from current libraries generate a unique signature with an s-value in the lower half order.
    //
    // If your library generates malleable signatures, such as s-values in the upper range, calculate a new s-value
    // with 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141 - s1 and flip v from 27 to 28 or
    // vice versa. If your library also generates signatures with 0/1 for v instead 27/28, add 27 to v to accept
    // these malleable signatures as well.
    require(uint256(s) < 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0, "InvalidSignatureS");
    require(v == 27 || v == 28, "InvalidSignatureV");

    // If the signature is valid (and not malleable), return the signer address
    address signer = ecrecover(hash, v, r, s);
    require(signer != address(0), "InvalidSignature");

    return signer;
  }

  function tryRecover(bytes32 hash, bytes memory signature) internal pure returns (address) {
    // Check the signature length
    // - case 65: r,s,v signature (standard)
    // - case 64: r,vs signature (cf https://eips.ethereum.org/EIPS/eip-2098) _Available since v4.1._
    if (signature.length == 65) {
      bytes32 r;
      bytes32 s;
      uint8 v;
      // ecrecover takes the signature parameters, and the only way to get them
      // currently is to use assembly.
      assembly {
        r := mload(add(signature, 0x20))
        s := mload(add(signature, 0x40))
        v := byte(0, mload(add(signature, 0x60)))
      }
      return tryRecover(hash, v, r, s);
    } else if (signature.length == 64) {
      bytes32 r;
      bytes32 vs;
      // ecrecover takes the signature parameters, and the only way to get them
      // currently is to use assembly.
      assembly {
        r := mload(add(signature, 0x20))
        vs := mload(add(signature, 0x40))
      }
      return tryRecover(hash, r, vs);
    } else {
      revert("InvalidSignatureLength");
    }
  }
}
