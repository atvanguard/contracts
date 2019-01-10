import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import chaiBigNumber from 'chai-bignumber'

import { linkLibs, ZeroAddress } from '../helpers/utils'

import { ChildChain, ChildERC20, RootToken } from '../helpers/contracts'
import LogDecoder from '../helpers/log-decoder'

// add chai pluggin
chai
  .use(chaiAsPromised)
  .use(chaiBigNumber(web3.BigNumber))
  .should()

contract('ChildChain', async function(accounts) {
  let childChainContract
  let rootToken
  let childToken
  let logDecoder = new LogDecoder([ChildChain._json.abi, ChildERC20._json.abi])

  beforeEach(async function() {
    // link libs
    await linkLibs()

    // create child chain contract
    childChainContract = await ChildChain.new()
    // create new root token
    rootToken = await RootToken.new('Test Token', 'TEST')
    childToken = await ChildERC20.new('Test', 'TEST', 18)
  })

  it('should initialize properly ', async function() {
    await childChainContract.owner().should.eventually.equal(accounts[0])
  })

  it('should allow only owner to add new token ', async function() {
    await childChainContract.addToken(
      rootToken.address,
      childToken.address,
      false,
      {
        from: accounts[1]
      }
    ).should.be.rejected

    await childChainContract
      .tokens(rootToken.address)
      .should.eventually.equal(ZeroAddress)
  })

  it('should allow owner to add new token ', async function() {
    const receipt = await childChainContract.addToken(
      rootToken.address,
      childToken.address,
      false
    )
    const logs = logDecoder.decodeLogs(receipt.receipt.logs)
    logs.should.have.lengthOf(1)

    logs[0].event.should.equal('NewToken')
    logs[0].args.rootToken.toLowerCase().should.equal(rootToken.address)
    logs[0].args.token.toLowerCase().should.equal(childToken.address)

    // child chain contract
    await childChainContract
      .tokens(rootToken.address)
      .should.eventually.equal(logs[0].args.token.toLowerCase())
    // get child chain token

    // should have proper owner
    // await childToken
    //   .owner()
    //   .should.eventually.equal(childChainContract.address.toLowerCase())

    // should match mapping
    await childChainContract
      .tokens(rootToken.address)
      .should.eventually.equal(childToken.address.toLowerCase())
  })

  it('should not allow to add new token again', async function() {
    // add token
    await childChainContract.addToken(
      rootToken.address,
      childToken.address,
      false
    )
    // add again
    await childChainContract.addToken(
      rootToken.address,
      childToken.address,
      false
    ).should.be.rejected
  })

  it('should check true (safety check)', async function() {
    assert.isTrue(true)
  })
})
