// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { PactComputeMarket } from "../src/PactComputeMarket.sol";

interface VmCompute {
    function envUint(string calldata name) external view returns (uint256);
    function envAddress(string calldata name) external view returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployCompute {
    VmCompute private constant vm =
        VmCompute(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (PactComputeMarket market) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address paymentToken = vm.envAddress("PAYMENT_TOKEN_ADDRESS");
        vm.startBroadcast(privateKey);
        market = new PactComputeMarket(paymentToken);
        vm.stopBroadcast();
    }
}
