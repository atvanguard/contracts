import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import fs from 'fs'

import deployer from './helpers/deployer.js'
import logDecoder from './helpers/log-decoder.js'
import utils from 'ethereumjs-util'

const rlp = utils.rlp
const web3Child = new web3.constructor(
  new web3.providers.HttpProvider('http://localhost:8546')
)

chai
  .use(chaiAsPromised)
  .should()

contract('WithdrawManager', async function(accounts) {
  let contracts, childContracts
  const user = accounts[0].toLowerCase()
  const other = accounts[1]//.toLowerCase()
  const amount = web3.utils.toBN('10')
  // const amount = web3.utils.toBN('10').pow(web3.utils.toBN('18'))

  beforeEach(async function() {
    contracts = await deployer.freshDeploy()
    childContracts = await deployer.initializeChildChain(accounts[0])
  })

  it('withdrawBurntTokens - deposit', async function() {
    await deposit(contracts.depositManager, childContracts.childChain, childContracts.rootERC20, user, amount, true /* writeToFile */)
    let _withdrawTx = await childContracts.childToken.withdraw(amount)
    await writeToFile('deposit-burn.js', _withdrawTx.receipt)
  })

  it('withdrawBurntTokens - transfer - partialBurn', async function() {
    await deposit(contracts.depositManager, childContracts.childChain, childContracts.rootERC20, user, amount)

    let _transferTx = await childContracts.childToken.transfer(other, web3.utils.toBN('3'))
    await writeToFile('transfer.js', _transferTx.receipt)
    // user has 6 tokens

    let _withdrawTx = await childContracts.childToken.withdraw(web3.utils.toBN('4')) // partial burn
    await writeToFile('partialBurn.js', _withdrawTx.receipt)
    // user is left with 3 token
  })

  it.only('withdrawBurntTokens - incomingTransfer - burn', async function() {
    await deposit(contracts.depositManager, childContracts.childChain, childContracts.rootERC20, other, amount)

    let _transferTx = await childContracts.childToken.transfer(user, amount, {from: other})
    await writeToFile('incomingTransfer.js', _transferTx.receipt)
    // user has 6 (3 + 3) tokens

    let _withdrawTx = await childContracts.childToken.withdraw(amount) // full burn
    await writeToFile('burn.js', _withdrawTx.receipt)
  })
})

async function deposit(depositManager, childChain, rootERC20, user, amount, _writeToFile) {
  await rootERC20.approve(depositManager.address, amount)
  const result = await depositManager.depositERC20ForUser(rootERC20.address, user, amount)
  const logs = logDecoder.decodeLogs(result.receipt.rawLogs)
  const NewDepositBlockEvent = logs.find(log => log.event === 'NewDepositBlock')
  let { receipt } = await childChain.depositTokens(
    rootERC20.address, user, amount, NewDepositBlockEvent.args.depositBlockId)
  if (_writeToFile) writeToFile('deposit.js', receipt)
}

async function writeToFile(file, receipt) {
  const r = {
    tx: await web3Child.eth.getTransaction(receipt.transactionHash),
    receipt: await web3Child.eth.getTransactionReceipt(receipt.transactionHash),
    block: await web3Child.eth.getBlock(receipt.blockHash, true /* returnTransactionObjects */)
  }
  fs.writeFileSync(
    `./test/mocks/mockResponses/${file}`,
    `module.exports = ${JSON.stringify(r, null, 2)}`
  )
}
