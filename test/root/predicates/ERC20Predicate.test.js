import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'

import deployer from '../../helpers/deployer.js'
import logDecoder from '../../helpers/log-decoder.js'
import { buildInFlight } from '../../mockResponses/utils'
import StatefulUtils from '../../helpers/StatefulUtils'

const utils = require('../../helpers/utils')
const web3Child = utils.web3Child

chai.use(chaiAsPromised).should()
let contracts, childContracts, statefulUtils

contract('ERC20Predicate', async function(accounts) {
  const amount = web3.utils.toBN('10')
  const halfAmount = web3.utils.toBN('5')
  const user = accounts[0]
  const other = accounts[1]

  before(async function() {
    contracts = await deployer.freshDeploy()
    childContracts = await deployer.initializeChildChain(accounts[0])
    statefulUtils = new StatefulUtils()
  })

  describe('startExitWithBurntTokens', async function() {
    beforeEach(async function() {
      contracts.withdrawManager = await deployer.deployWithdrawManager()
      contracts.ERC20Predicate = await deployer.deployErc20Predicate()
      const { rootERC20, childToken } = await deployer.deployChildErc20(accounts[0])
      childContracts.rootERC20 = rootERC20
      childContracts.childToken = childToken
    })

    it('Valid exit with burnt tokens', async function() {
      await utils.deposit(
        contracts.depositManager,
        childContracts.childChain,
        childContracts.rootERC20,
        user,
        amount
      )
      const { receipt } = await childContracts.childToken.withdraw(amount)
      let { block, blockProof, headerNumber, reference } = await statefulUtils.submitCheckpoint(contracts.rootChain, receipt, accounts)
      const startExitTx = await utils.startExitWithBurntTokens(
        contracts.ERC20Predicate,
        { headerNumber, blockProof, blockNumber: block.number, blockTimestamp: block.timestamp, reference, logIndex: 1 }
      )
      const logs = logDecoder.decodeLogs(startExitTx.receipt.rawLogs)
      // console.log(startExitTx, logs)
      let log = logs[1]
      log.event.should.equal('ExitStarted')
      expect(log.args).to.include({
        exitor: user,
        token: childContracts.rootERC20.address,
        isRegularExit: true
      })
      utils.assertBigNumberEquality(log.args.amount, amount)
    })
  })

  describe('startExit', async function() {
    beforeEach(async function() {
      contracts.withdrawManager = await deployer.deployWithdrawManager()
      contracts.ERC20Predicate = await deployer.deployErc20Predicate()
      const { rootERC20, childToken } = await deployer.deployChildErc20(accounts[0])
      childContracts.rootERC20 = rootERC20
      childContracts.childToken = childToken
      // start = 0
    })

    it('reference: incomingTransfer - exitTx: fullBurn', async function() {
      await utils.deposit(
        contracts.depositManager,
        childContracts.childChain,
        childContracts.rootERC20,
        other,
        amount
      )
      const { receipt } = await childContracts.childToken.transfer(user, amount, { from: other })
      const { block, blockProof, headerNumber, reference } = await statefulUtils.submitCheckpoint(contracts.rootChain, receipt, accounts)
      const { receipt: r } = await childContracts.childToken.withdraw(amount)
      let exitTx = await web3Child.eth.getTransaction(r.transactionHash)
      exitTx = await buildInFlight(exitTx)

      const startExitTx = await utils.startExitForErc20PredicateLegacy(
        contracts.ERC20Predicate.startExitForOutgoingErc20Transfer, headerNumber, blockProof, block.number, block.timestamp, reference, 1, /* logIndex */ exitTx)
      const logs = logDecoder.decodeLogs(startExitTx.receipt.rawLogs)
      // console.log(startExitTx, logs)
      const log = logs[1]
      log.event.should.equal('ExitStarted')
      expect(log.args).to.include({
        exitor: user,
        token: childContracts.rootERC20.address
      })
      utils.assertBigNumberEquality(log.args.amount, amount)
    })

    it('reference: outgoingTransfer - exitTx: fullBurn', async function() {
      await utils.deposit(
        contracts.depositManager,
        childContracts.childChain,
        childContracts.rootERC20,
        user,
        amount
      )

      const { receipt } = await childContracts.childToken.transfer(other, halfAmount)
      const { block, blockProof, headerNumber, reference } = await statefulUtils.submitCheckpoint(contracts.rootChain, receipt, accounts)

      const { receipt: r } = await childContracts.childToken.withdraw(halfAmount)
      let exitTx = await web3Child.eth.getTransaction(r.transactionHash)
      exitTx = await buildInFlight(exitTx)

      const startExitTx = await utils.startExitForErc20PredicateLegacy(contracts.ERC20Predicate.startExitForOutgoingErc20Transfer, headerNumber, blockProof, block.number, block.timestamp, reference, 1, /* logIndex */ exitTx)
      const logs = logDecoder.decodeLogs(startExitTx.receipt.rawLogs)
      // console.log(startExitTx, logs)
      const log = logs[1]
      log.event.should.equal('ExitStarted')
      expect(log.args).to.include({
        exitor: user,
        token: childContracts.rootERC20.address
      })
      utils.assertBigNumberEquality(log.args.amount, halfAmount)
    })

    it('reference: deposit - exitTx: outgoingTransfer', async function() {
      // Reference exitor's deposit which is the proof of exitor's balance
      const { receipt } = await utils.deposit(
        contracts.depositManager,
        childContracts.childChain,
        childContracts.rootERC20,
        user,
        amount
      )
      const { block, blockProof, headerNumber, reference } = await statefulUtils.submitCheckpoint(contracts.rootChain, receipt, accounts)
      // Treating this tx as an in-flight outgoing transfer
      const transferAmount = web3.utils.toBN('3')
      const { receipt: r } = await childContracts.childToken.transfer(other, transferAmount)
      let exitTx = await web3Child.eth.getTransaction(r.transactionHash)
      exitTx = await buildInFlight(exitTx)

      const startExitTx = await utils.startExitForErc20PredicateLegacy(contracts.ERC20Predicate.startExitForOutgoingErc20Transfer, headerNumber, blockProof, block.number, block.timestamp, reference, 1, /* logIndex */ exitTx)
      // console.log('startExitTx', startExitTx)
      const logs = logDecoder.decodeLogs(startExitTx.receipt.rawLogs)
      const log = logs[1]
      log.event.should.equal('ExitStarted')
      expect(log.args).to.include({
        exitor: user,
        token: childContracts.rootERC20.address
      })
      utils.assertBigNumberEquality(log.args.amount, amount.sub(transferAmount))
    })

    it('reference: counterparty balance (Deposit) - exitTx: incomingTransfer', async function() {
      // Reference the counterparty's deposit which is the proof of counterparty's balance
      const { receipt } = await utils.deposit(
        contracts.depositManager,
        childContracts.childChain,
        childContracts.rootERC20,
        other,
        amount
      )
      const { block, blockProof, headerNumber, reference } = await statefulUtils.submitCheckpoint(contracts.rootChain, receipt, accounts)

      // Treating this tx as an in-flight incoming transfer
      const { receipt: r } = await childContracts.childToken.transfer(user, halfAmount, { from: other })
      let exitTx = await web3Child.eth.getTransaction(r.transactionHash)
      exitTx = await buildInFlight(exitTx)

      const startExitTx = await utils.startExitForErc20PredicateLegacy(contracts.ERC20Predicate.startExitForIncomingErc20Transfer, headerNumber, blockProof, block.number, block.timestamp, reference, 1, /* logIndex */ exitTx)
      const logs = logDecoder.decodeLogs(startExitTx.receipt.rawLogs)
      // console.log(startExitTx, logs)
      const log = logs[1]
      log.event.should.equal('ExitStarted')
      expect(log.args).to.include({
        exitor: user,
        token: childContracts.rootERC20.address
      })
      utils.assertBigNumberEquality(log.args.amount, halfAmount)
    })

    it('reference: counterparty balance (Transfer) - exitTx: incomingTransfer', async function() {
      await utils.deposit(
        contracts.depositManager,
        childContracts.childChain,
        childContracts.rootERC20,
        user,
        amount
      )

      // We will reference the following tx which is a proof of counterparty's balance
      const { receipt } = await childContracts.childToken.transfer(other, amount)
      const { block, blockProof, headerNumber, reference } = await statefulUtils.submitCheckpoint(contracts.rootChain, receipt, accounts)

      // Treating this tx as an in-flight incoming transfer
      const { receipt: r } = await childContracts.childToken.transfer(user, halfAmount, { from: other })
      let exitTx = await web3Child.eth.getTransaction(r.transactionHash)
      exitTx = await buildInFlight(exitTx)

      const startExitTx = await utils.startExitForErc20PredicateLegacy(contracts.ERC20Predicate.startExitForIncomingErc20Transfer, headerNumber, blockProof, block.number, block.timestamp, reference, 1, /* logIndex */ exitTx)
      const logs = logDecoder.decodeLogs(startExitTx.receipt.rawLogs)
      // console.log(startExitTx, logs)
      const log = logs[1]
      log.event.should.equal('ExitStarted')
      expect(log.args).to.include({
        exitor: user,
        token: childContracts.rootERC20.address
      })
      utils.assertBigNumberEquality(log.args.amount, halfAmount)
    })

    it('reference: own balance (Deposit) and counterparty balance (Deposit) - exitTx: incomingTransfer', async function() {
      // Will reference user's pre-existing balance on the side-chain, currently this needs to given as the 2nd input so will process this later
      const { receipt } = await utils.deposit(
        contracts.depositManager,
        childContracts.childChain,
        childContracts.rootERC20,
        user,
        halfAmount
      )
      const inputs = []
      let { block, blockProof, headerNumber, reference } = await statefulUtils.submitCheckpoint(contracts.rootChain, receipt, accounts)
      inputs.push({ headerNumber, blockProof, blockNumber: block.number, blockTimestamp: block.timestamp, reference, logIndex: 1 })

      // We will reference the following tx (Deposit) which is a proof of counterparty's balance
      const { receipt: d } = await utils.deposit(null, childContracts.childChain, childContracts.rootERC20, other, halfAmount)
      const i = await statefulUtils.submitCheckpoint(contracts.rootChain, d, accounts)
      inputs.unshift({ headerNumber: i.headerNumber, blockProof: i.blockProof, blockNumber: i.block.number, blockTimestamp: i.block.timestamp, reference: i.reference, logIndex: 1 })

      // Treating this tx as an in-flight incoming transfer
      const { receipt: r } = await childContracts.childToken.transfer(user, halfAmount, { from: other })
      let exitTx = await web3Child.eth.getTransaction(r.transactionHash)
      exitTx = await buildInFlight(exitTx)

      const startExitTx = await utils.startExitForErc20Predicate(contracts.ERC20Predicate.startExitForIncomingErc20Transfer, inputs, exitTx)
      const logs = logDecoder.decodeLogs(startExitTx.receipt.rawLogs)
      // console.log(startExitTx, logs)
      let log = logs[1]
      log.event.should.equal('ExitStarted')
      expect(log.args).to.include({
        exitor: user,
        token: childContracts.rootERC20.address
      })
      utils.assertBigNumberEquality(log.args.amount, amount)
      const exitId = log.args.exitId

      log = logs[2]
      log.event.should.equal('ExitUpdated')
      expect(log.args).to.include({
        signer: other
      })
      utils.assertBigNumberEquality(log.args.exitId, exitId)

      log = logs[3]
      log.event.should.equal('ExitUpdated')
      expect(log.args).to.include({
        signer: user
      })
      utils.assertBigNumberEquality(log.args.exitId, exitId)
    })

    it('reference: own balance (outgoingTransfer) and counterparty balance (incomingTransfer) - exitTx: incomingTransfer', async function() {
      // This test case tests an interesting case.
      // 1. I deposit x tokens.
      await utils.deposit(
        contracts.depositManager,
        childContracts.childChain,
        childContracts.rootERC20,
        user,
        amount
      )

      // 2. I transfer x/2 tokens to a user. Calling this tx A.
      let { receipt } = await childContracts.childToken.transfer(other, halfAmount)
      const { block, blockProof, headerNumber, reference } = await statefulUtils.submitCheckpoint(contracts.rootChain, receipt, accounts)
      const inputs = []
      // We add an input which is the proof of counterparty's balance (x/2 amount)
      inputs.push({ headerNumber, blockProof, blockNumber: block.number, blockTimestamp: block.timestamp, reference, logIndex: 1 })

      // 3. The user transfers x/2 tokens back to me but this tx goes in-flight
      const { receipt: r } = await childContracts.childToken.transfer(user, halfAmount, { from: other })

      let exitTx = await web3Child.eth.getTransaction(r.transactionHash)
      exitTx = await buildInFlight(exitTx)

      // 4. Now I would like to exit with x/2 (received) + x/2 (pre-existing balance) tokens
      // What's interesting here is that tx A acts as proof-of-balance for both the counterparty and the user, so add the same input again
      inputs.push({ headerNumber, blockProof, blockNumber: block.number, blockTimestamp: block.timestamp, reference, logIndex: 1 })

      const startExitTx = await utils.startExitForErc20Predicate(contracts.ERC20Predicate.startExitForIncomingErc20Transfer, inputs, exitTx)
      const logs = logDecoder.decodeLogs(startExitTx.receipt.rawLogs)
      let log = logs[1]
      log.event.should.equal('ExitStarted')
      expect(log.args).to.include({
        exitor: user,
        token: childContracts.rootERC20.address
      })
      utils.assertBigNumberEquality(log.args.amount, amount) // Exit starts with x tokens in total
      const exitId = log.args.exitId

      log = logs[2]
      log.event.should.equal('ExitUpdated')
      expect(log.args).to.include({
        signer: other
      })
      utils.assertBigNumberEquality(log.args.exitId, exitId)
      const age = log.args.age

      log = logs[3]
      log.event.should.equal('ExitUpdated')
      expect(log.args).to.include({
        signer: user
      })
      utils.assertBigNumberEquality(log.args.exitId, exitId)
      utils.assertBigNumberEquality(
        // Referenced inputs are adjacent UTXOs in the same LogTransfer log in a particular tx
        web3.utils.toBN(log.args.age).add(web3.utils.toBN(1)),
        age
      )
    })
  })

  describe('verifyDeprecation', async function() {
    beforeEach(async function() {
      contracts.withdrawManager = await deployer.deployWithdrawManager()
      contracts.ERC20Predicate = await deployer.deployErc20Predicate()
      const { rootERC20, childToken } = await deployer.deployChildErc20(accounts[0])
      childContracts.rootERC20 = rootERC20
      childContracts.childToken = childToken
      // start = 0
    })

    it('reference: Deposit - challenge: spend - exit: Burn', async function() {
      const inputs = []
      const { receipt } = await utils.deposit(
        contracts.depositManager,
        childContracts.childChain,
        childContracts.rootERC20,
        user,
        amount
      )
      let { block, blockProof, headerNumber, reference } = await statefulUtils.submitCheckpoint(contracts.rootChain, receipt, accounts)
      inputs.push({ headerNumber, blockProof, blockNumber: block.number, blockTimestamp: block.timestamp, reference, logIndex: 1 })
      let { receipt: i } = await childContracts.childToken.transfer(other, halfAmount)
      i = await statefulUtils.submitCheckpoint(contracts.rootChain, i, accounts)
      const challengeData = utils.buildChallengeData({ headerNumber: i.headerNumber, blockProof: i.blockProof, blockNumber: i.block.number, blockTimestamp: i.block.timestamp, reference: i.reference, logIndex: 1 })

      let { receipt: w } = await childContracts.childToken.transfer(other, halfAmount) // to make it evm compatible but still challengeable bcoz we are referencing an older input
      let exitTx = await web3Child.eth.getTransaction(w.transactionHash)
      exitTx = await buildInFlight(exitTx)
      const startExitTx = await utils.startExitForErc20Predicate(contracts.ERC20Predicate.startExitForOutgoingErc20Transfer, inputs, exitTx)
      const logs = logDecoder.decodeLogs(startExitTx.receipt.rawLogs)
      // console.log(startExitTx, logs)
      let log = logs[1]
      log.event.should.equal('ExitStarted')
      expect(log.args).to.include({
        exitor: user,
        token: childContracts.rootERC20.address
      })
      utils.assertBigNumberEquality(log.args.amount, halfAmount)

      log = logs[2]
      // const exit = await contracts.withdrawManager.exits(log.args.exitId._hex)
      // console.log(exit)

      const verifyDeprecationTx = await utils.verifyDeprecation(
        contracts.withdrawManager, contracts.ERC20Predicate,
        log.args.exitId._hex, log.args.age._hex, challengeData,
        { childToken: childContracts.childToken.address, age: log.args.age._hex, signer: log.args.signer }
      )
      // console.log('verifyDeprecationTx', verifyDeprecationTx)
    })

    it('should not be able to challenge with the in-flight tx from which the exit was started', async function() {
      const { receipt } = await utils.deposit(
        contracts.depositManager,
        childContracts.childChain,
        childContracts.rootERC20,
        user,
        amount
      )
      const inputs = []
      let { block, blockProof, headerNumber, reference } = await statefulUtils.submitCheckpoint(contracts.rootChain, receipt, accounts)
      inputs.push({ headerNumber, blockProof, blockNumber: block.number, blockTimestamp: block.timestamp, reference, logIndex: 1 })

      let { receipt: i } = await childContracts.childToken.transfer(other, halfAmount) // to make it evm compatible but still challengeable bcoz we are referencing an older input
      let exitTx = await web3Child.eth.getTransaction(i.transactionHash)
      exitTx = await buildInFlight(exitTx)
      const startExitTx = await utils.startExitForErc20Predicate(contracts.ERC20Predicate.startExitForOutgoingErc20Transfer, inputs, exitTx)
      const logs = logDecoder.decodeLogs(startExitTx.receipt.rawLogs)

      i = await statefulUtils.submitCheckpoint(contracts.rootChain, i, accounts)
      const challengeData = utils.buildChallengeData({ headerNumber: i.headerNumber, blockProof: i.blockProof, blockNumber: i.block.number, blockTimestamp: i.block.timestamp, reference: i.reference, logIndex: 1 })

      let log = logs[2] // 'ExitUpdated'
      try {
        // await utils.verifyDeprecation(contracts.ERC20Predicate, (exit, childContracts.childToken.address, log.args.age._hex, log.args.signer, exit.txHash, challengeData)
        await utils.verifyDeprecation(
          contracts.withdrawManager, contracts.ERC20Predicate,
          log.args.exitId._hex, log.args.age._hex, challengeData,
          { childToken: childContracts.childToken.address, age: log.args.age._hex, signer: log.args.signer }
        )
        assert.fail()
      } catch (e) {
        expect(e.toString()).to.include('Cannot challenge with the exit tx')
      }
    })
  })
})
