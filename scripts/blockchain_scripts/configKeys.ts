const CONFIG_KEYS_BY_TYPE = {
  numbers: {
    TransactionLimit: 0,
    TotalFundsLimit: 1,
    MaxUnderwriterLimit: 2,
    ReserveDenominator: 3,
    WithdrawFeeDenominator: 4,
    LatenessGracePeriodInDays: 5,
    LatenessMaxDays: 6,
    DrawdownPeriodInSeconds: 7,
    TransferPeriodRestrictionInDays: 8,
    LeverageRatio: 9,
  },
  addresses: {
    Pool: 0,
    CreditLineImplementation: 1,
    GoldfinchFactory: 2,
    CreditDesk: 3,
    Fidu: 4,
    USDC: 5,
    TreasuryReserve: 6,
    ProtocolAdmin: 7,
    TrustedForwarder: 8,
    CUSDCContract: 9,
    GoldfinchConfig: 10,
    PoolTokens: 11,
    TranchedPoolImplementation: 12,
    SeniorPool: 13,
    SeniorPoolStrategy: 14,
    // MigratedTranchedPoolImplementation: 16,
    // BorrowerImplementation: 16,
    NAOS: 15,
    Go: 16,
    BackerRewards: 17,
    StakingRewards: 18,
    // FiduUSDCCurveLP: 22,
  },
}

const CONFIG_KEYS = {...CONFIG_KEYS_BY_TYPE.numbers, ...CONFIG_KEYS_BY_TYPE.addresses}

export {CONFIG_KEYS, CONFIG_KEYS_BY_TYPE}
