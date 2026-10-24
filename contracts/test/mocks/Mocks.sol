// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SentinelPolicy} from "../../src/SentinelPolicy.sol";

/// TEST ONLY. Stands in for the smart account: policy check, then execution, in one call frame.
contract MockAccount {
    SentinelPolicy public policy;

    function setPolicy(SentinelPolicy p) external {
        policy = p;
    }

    function execute(address agent, address target, uint256 value, bytes calldata data)
        external
        returns (bytes memory)
    {
        policy.validateAndRecord(agent, target, value, data);
        (bool ok, bytes memory ret) = target.call{value: value}(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        return ret;
    }

    receive() external payable {}
}

/// TEST ONLY minimal ERC-20 with configurable decimals.
contract MockERC20 {
    uint8 public immutable decimals;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(uint8 decimals_) {
        decimals = decimals_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
}

/// TEST ONLY generic call target.
contract Sink {
    uint256 public pings;
    address public lastTo;
    uint256 public lastValue;

    function ping(address to) external payable {
        pings++;
        lastTo = to;
        lastValue = msg.value;
    }

    function doThing(uint256 x) external payable {
        lastValue = x;
    }

    function boom() external payable {
        revert("boom");
    }

    function other() external {}
}
