// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { PactAgentMarket } from "../src/PactAgentMarket.sol";

interface VmDeploy {
    function envUint(string calldata name) external view returns (uint256);
    function envAddress(string calldata name) external view returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract Deploy {
    VmDeploy private constant vm =
        VmDeploy(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (PactAgentMarket market) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address paymentToken = vm.envAddress("PAYMENT_TOKEN_ADDRESS");
        vm.startBroadcast(privateKey);
        market = new PactAgentMarket(paymentToken);
        vm.stopBroadcast();
    }
}
