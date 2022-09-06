const CONFIG_KEYS_BY_TYPE = {
  numbers: {
    TotalFundsLimit: 0,
    ReserveDenominator: 1,
    WithdrawFeeDenominator: 2,
    LatenessGracePeriodInDays: 3,
    LatenessMaxDays: 4,
    DrawdownPeriodInSeconds: 5,
    LeverageRatio: 6
  },
  addresses: {
    Pool: 0,
    CreditLineImplementation: 1,
    NAOSFactory: 2,
    RWA: 3,
    USDC: 4,
    TreasuryReserve: 5,
    ProtocolAdmin: 6,
    NAOSConfig: 7,
    PoolTokens: 8,
    JuniorPoolImplementation: 9,
    IndexPool: 10,
    IndexPoolStrategy: 11,
    NAOS: 12,
    Verified: 13,
    JuniorRewards: 14,
    StakingRewards: 15,
    BoostPool: 16,
    WithdrawQueue: 17,
    LoanManager: 18
  },
}

const CONFIG_KEYS = {...CONFIG_KEYS_BY_TYPE.numbers, ...CONFIG_KEYS_BY_TYPE.addresses}

export {CONFIG_KEYS, CONFIG_KEYS_BY_TYPE}
