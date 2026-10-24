// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {SentinelPolicy} from "../src/SentinelPolicy.sol";

/// Deploys SentinelPolicy for OWNER_ADDRESS (a public address; no private keys live in this repo).
/// Usage (local Anvil), key supplied on the command line by you, never stored in files:
///   forge script script/DeploySentinelPolicy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --private-key <anvil key>
/// NOT RUN by the author. Binding the account is a separate owner transaction: bindAccount(account).
contract DeploySentinelPolicy is Script {
    function run() external returns (SentinelPolicy policy) {
        address owner = vm.envAddress("OWNER_ADDRESS");
        vm.startBroadcast();
        policy = new SentinelPolicy(owner);
        vm.stopBroadcast();
        console2.log("SentinelPolicy", address(policy));
    }
}
