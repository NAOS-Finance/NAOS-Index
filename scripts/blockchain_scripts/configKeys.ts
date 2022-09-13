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
    CreditLineImplementation: 0,
    NAOSFactory: 1,
    RWA: 2,
    USDC: 3,
    TreasuryReserve: 4,
    ProtocolAdmin: 5,
    NAOSConfig: 6,
    PoolTokens: 7,
    JuniorPoolImplementation: 8,
    IndexPool: 9,
    IndexPoolStrategy: 10,
    NAOS: 11,
    Verified: 12,
    JuniorRewards: 13,
    StakingRewards: 14,
    BoostPool: 15,
    WithdrawQueue: 16,
    LoanManager: 17
  },
}

const CONFIG_KEYS = {...CONFIG_KEYS_BY_TYPE.numbers, ...CONFIG_KEYS_BY_TYPE.addresses}

export {CONFIG_KEYS, CONFIG_KEYS_BY_TYPE}
