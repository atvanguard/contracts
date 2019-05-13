pragma solidity 0.5.2;

import "../ChildERC20.sol";

contract Marketplace {

  event DEBUG(address a, uint256 d, address b, uint256 e, address c);
  event DEBUG2(uint256 a, bytes32 d, uint256 e);

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
    // emit DEBUG(token1, tokenIdOrAmount1, token2, tokenIdOrAmount2, address2);
    // uint256 x = ChildERC20(token1).yoyo();
    // emit DEBUG2(tokenIdOrAmount1, keccak256(abi.encodePacked(orderId, token2, tokenIdOrAmount2)), expiration);

    // Transferring token1 tokens from `_address1` to `address2`
    ChildERC20(token1).transferWithSig(
      sig1,
      tokenIdOrAmount1,
      keccak256(abi.encodePacked(orderId, token2, tokenIdOrAmount2)),
      expiration,
      address2
    );
    
    // Transferring token2 from `address2` to `_address1`
    address _address2 = MarketplaceToken(token2).transferWithSig(
      sig2,
      tokenIdOrAmount2,
      keccak256(abi.encodePacked(orderId, token1, tokenIdOrAmount1)),
      expiration,
      _address1
    );
    // emit DEBUG(msg.sender, address2, _address2);

    require(address2 == _address2, "Executed orders are not complimentary");
  }
}
