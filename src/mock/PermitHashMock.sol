// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../libraries/PermitHash.sol";
import {IAllowanceTransfer} from "../interfaces/IAllowanceTransfer.sol";
import "../libraries/SignatureVerification.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract PermitHashMock {
    using PermitHash for *;
    using SignatureVerification for *;

    function hashWithWitness(
        ISignatureTransfer.PermitTransferFrom memory permit,
        bytes32 witness,
        string calldata witnessTypeString
    ) external view returns (bytes32) {
        return permit.hashWithWitness(witness, witnessTypeString);
    }

    function hashWithWitnessBatch(
        ISignatureTransfer.PermitBatchTransferFrom memory permit,
        bytes32 witness,
        string calldata witnessTypeString
    ) external view returns (bytes32) {
        return permit.hashWithWitness(witness, witnessTypeString);
    }

    function hashPermitBatchTransferFrom(ISignatureTransfer.PermitBatchTransferFrom memory permitBatchTransferFrom)
        external
        view
        returns (bytes32)
    {
        return permitBatchTransferFrom.hash();
    }

    bytes32 public constant _PERMIT_BATCH_TRANSFER_FROM_TYPEHASH = keccak256(
        "PermitBatchTransferFrom(TokenPermissions[] permitted,address spender,uint256 nonce,uint256 deadline)TokenPermissions(address token,uint256 amount)"
    );

    function getPermit() external view returns (bytes32) {
        return _PERMIT_BATCH_TRANSFER_FROM_TYPEHASH;
    }

    bytes32 public constant _TOKEN_PERMISSIONS_TYPEHASH = keccak256("TokenPermissions(address token,uint256 amount)");

    function getTokenPermit() external view returns (bytes32) {
        return _TOKEN_PERMISSIONS_TYPEHASH;
    }

    function hashPermitSingle(IAllowanceTransfer.PermitSingle memory permitSingle) public pure returns (bytes32) {
        return permitSingle.hash();
    }

    function hashPermitTransferFrom(ISignatureTransfer.PermitTransferFrom memory permitTransferFrom)
        external
        view
        returns (bytes32)
    {
        return permitTransferFrom.hash();
    }

    function hashPermitBatch(IAllowanceTransfer.PermitBatch memory PermitBatch) public pure returns (bytes32) {
        return PermitBatch.hash();
    }

    function verify(bytes calldata sig, bytes32 hashed, address signer) public view {
        SignatureVerification.verify(sig, hashed, signer);
    }
}
