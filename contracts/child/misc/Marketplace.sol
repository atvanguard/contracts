pragma solidity ^0.5.2;

interface MarketplaceToken {
  function transferWithSig(bytes calldata sig, uint256 tokenIdOrAmount, bytes32 data, uint256 expiration, address to) external returns (address);
}

contract Marketplace {
  event DEBUG(address a, address b, address c);
  function executeOrder(
    address token1,
    bytes memory sig1,
    uint256 tokenIdOrAmount1,

    address token2,
    bytes memory sig2,
    uint256 tokenIdOrAmount2,

    bytes32 orderId,
    uint256 expiration,
    address address2 // address of second participant
  ) public {
    // Transferring token1 tokens from `_address1` to `address2`
    address _address1 = MarketplaceToken(token1).transferWithSig(
      sig1,
      tokenIdOrAmount1,
      keccak256(abi.encodePacked(orderId, token2, tokenIdOrAmount2)),
      expiration,
      address2
    );
    emit DEBUG(token1, token2, _address1);

    // Transferring token2 from `address2` to `_address1`
    // address _address2 = MarketplaceToken(token2).transferWithSig(
    //   sig2,
    //   tokenIdOrAmount2,
    //   keccak256(abi.encodePacked(orderId, token1, tokenIdOrAmount1)),
    //   expiration,
    //   _address1
    // );

    // require(address2 == _address2, "Orders are not complimentary");
  }
}
