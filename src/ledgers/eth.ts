import BigNumber from 'bignumber.js'
import EthereumPlugin from 'ilp-plugin-ethereum'
import Web3 = require('web3')
import { Provider as IProvider } from 'web3/providers'
import { Ledger } from '../ledger'
import { convert, IUnit } from '../utils/convert'
import { IPlugin } from '../utils/types'

export interface IEthOpts {
  readonly ethereumPrivateKey: string
}

// TODO Should we emit events on "escrow" and on "send money" ?

export class Eth extends Ledger {
  public readonly assetCode = 'ETH'
  public readonly assetScale = 9
  public readonly remoteConnectors = {
    mainnet: {
      'Kava Labs': 'ilp.kava.io/eth'
    },
    testnet: {
      'Kava Labs': 'test.ilp.kava.io/eth'
    }
  }

  protected readonly maxInFlight = convert('0.0001', IUnit.Eth, IUnit.Gwei)

  private readonly ethereumPrivateKey: string
  private readonly ethereumProvider: IProvider | string

  constructor({ ethereumPrivateKey }: IEthOpts) {
    super()

    this.ethereumPrivateKey = ethereumPrivateKey
    this.ethereumProvider = new Web3.providers.HttpProvider(
      `https://${
        process.env.LEDGER_ENV === 'testnet' ? 'kovan' : 'mainnet'
      }.infura.io/bXIbx0x6ofEuDANTSeKI`
    )
  }

  public async createPlugin(serverUri: string) {
    const gas = 115636 + 50443 + 40201
    const gasPrice = await this.getGasPrice()
    const txFee = gasPrice.times(gas)

    // 1.5x it to account for fee variance
    const maxCredit = txFee.times(1.5)

    return new EthereumPlugin(
      {
        balance: {
          maximum: maxCredit.plus(this.maxInFlight.times(2)),
          settleThreshold: maxCredit,
          settleTo: maxCredit
        },
        ethereumPrivateKey: this.ethereumPrivateKey,
        ethereumProvider: this.ethereumProvider as any, // TODO Fix type in eth plugin/export EthOpts (pending)
        outgoingChannelAmount: convert('0.05', IUnit.Eth, IUnit.Gwei), // Fixed at ~$10
        role: 'client',
        // @ts-ignore
        server: serverUri
      },
      {
        store: this.store
      }
    )
  }

  protected async setupPlugin(): Promise<void> {
    const gasPrice = await this.getGasPrice()
    const openTxFee = gasPrice.times(115636)

    // Trigger the connector to open a channel back to ourselves
    const { streamMoney } = await this.exchange({
      amount: openTxFee.times(1.5),
      ledger: this
    })

    // TODO In the future, this should do the fx to check the exchange rate

    return streamMoney()
  }

  protected async destroyPlugin(plugin: IPlugin) {
    return plugin.disconnect()
  }

  private async getGasPrice(): Promise<BigNumber> {
    const web3 = new Web3(this.ethereumProvider)
    return new BigNumber(await web3.eth.getGasPrice())
  }
}
