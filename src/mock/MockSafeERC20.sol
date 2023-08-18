// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../../lib/openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import "../../lib/openzeppelin-contracts/contracts/token/ERC20/extensions/draft-IERC20Permit.sol";

contract MockSafeERC20 {
    using SafeERC20 for *;

    function safePermit(
        address token,
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        IERC20Permit ierc20 = IERC20Permit(token);
        SafeERC20.safePermit(ierc20, owner, spender, value, deadline, v, r, s);
    }

    function safeTransferFrom(address token, address from, address to, uint256 value) external {
        IERC20 tokenERC20 = IERC20(token);
        SafeERC20.safeTransferFrom(tokenERC20, from, to, value);
    }
}
