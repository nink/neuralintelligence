// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title NinkRegistry
/// @notice Production anchor registry with configurable NINK anchoring fees.
contract NinkRegistry is Ownable {
    using SafeERC20 for IERC20;

    /// @dev 0.01 NINK at 18 decimals.
    uint256 public constant INITIAL_ANCHOR_FEE = 10_000_000_000_000_000;

    IERC20 public immutable ninkToken;
    address public treasury;
    uint256 public anchorFee;

    event AnchorRecorded(
        bytes32 indexed stateHash,
        address indexed recorder,
        uint256 feePaid
    );

    event AnchorFeeUpdated(uint256 oldFee, uint256 newFee);

    constructor(
        address initialOwner,
        address _ninkToken,
        address _treasury
    ) Ownable(initialOwner) {
        require(initialOwner != address(0), "NinkRegistry: zero owner");
        require(_ninkToken != address(0), "NinkRegistry: zero token");
        require(_treasury != address(0), "NinkRegistry: zero treasury");

        ninkToken = IERC20(_ninkToken);
        treasury = _treasury;
        anchorFee = INITIAL_ANCHOR_FEE;
    }

    /// @notice Owner-only fee update (e.g. lower to 0.0001 NINK over time).
    function setAnchorFee(uint256 _newFee) external onlyOwner {
        uint256 oldFee = anchorFee;
        anchorFee = _newFee;
        emit AnchorFeeUpdated(oldFee, _newFee);
    }

    /// @notice Records a session state hash after collecting the current anchor fee.
    /// @dev Caller must approve this contract for at least `anchorFee` NINK beforehand.
    function anchorState(bytes32 stateHash) external {
        require(stateHash != bytes32(0), "NinkRegistry: empty hash");

        ninkToken.safeTransferFrom(msg.sender, treasury, anchorFee);

        emit AnchorRecorded(stateHash, msg.sender, anchorFee);
    }
}
