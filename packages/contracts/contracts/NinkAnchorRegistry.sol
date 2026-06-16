// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title NinkAnchorRegistry
/// @notice Records immutable SHA-256 state hashes for NINK session work-products.
contract NinkAnchorRegistry is Ownable {
    mapping(bytes32 => bool) public isAnchored;

    event LogAnchorCreated(
        bytes32 indexed stateHash,
        address indexed validator,
        uint32 platformId,
        uint64 timestamp
    );

    error AlreadyAnchored(bytes32 stateHash);

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @dev Registers a session state hash once. Caller is recorded as validator.
    function anchorProof(
        bytes32 _stateHash,
        uint32 _platformId,
        uint64 _timestamp
    ) external {
        if (isAnchored[_stateHash]) {
            revert AlreadyAnchored(_stateHash);
        }

        isAnchored[_stateHash] = true;

        emit LogAnchorCreated(_stateHash, msg.sender, _platformId, _timestamp);
    }
}
