// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title ProjectNinkToken
/// @notice Fixed-supply ERC-20 for the NINK ecosystem. No post-deploy minting.
contract ProjectNinkToken is ERC20 {
    uint256 public constant TOTAL_SUPPLY = 100_000_000 * 10 ** 18;

    constructor(address recipient) ERC20("Project NINK", "NINK") {
        require(recipient != address(0), "ProjectNinkToken: zero recipient");
        _mint(recipient, TOTAL_SUPPLY);
    }

    function decimals() public pure override returns (uint8) {
        return 18;
    }
}
