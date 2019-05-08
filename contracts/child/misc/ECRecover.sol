// pragma solidity >=0.4.22 <0.6.0;
pragma solidity >=0.5.2 <0.6.0;


contract ECRecover {
  function recover(bytes32 dataHash, bytes memory sig) internal pure returns (address) {
    bytes32 hash = dataHash; // keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", dataHash));
    
    bytes32 r;
    bytes32 s;
    uint8 v;

    // Check the signature length
    if (sig.length != 65) {
      return address(0x0);
    }
    
    assembly {
      r := mload(add(sig, 32))
      s := mload(add(sig, 64))
      v := byte(0, mload(add(sig, 96)))
    }

    return ecrecover(hash, v, r, s);
  }
}