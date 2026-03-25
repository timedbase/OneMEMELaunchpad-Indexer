export default [
  {
    "type": "event",
    "name": "VestingAdded",
    "inputs": [
      { "name": "token",       "type": "address", "indexed": true  },
      { "name": "beneficiary", "type": "address", "indexed": true  },
      { "name": "amount",      "type": "uint256", "indexed": false }
    ]
  },
  {
    "type": "event",
    "name": "Claimed",
    "inputs": [
      { "name": "token",       "type": "address", "indexed": true  },
      { "name": "beneficiary", "type": "address", "indexed": true  },
      { "name": "amount",      "type": "uint256", "indexed": false }
    ]
  },
  {
    "type": "event",
    "name": "VestingVoided",
    "inputs": [
      { "name": "token",       "type": "address", "indexed": true  },
      { "name": "beneficiary", "type": "address", "indexed": true  },
      { "name": "burned",      "type": "uint256", "indexed": false }
    ]
  },
  {
    "type": "function",
    "name": "claimable",
    "stateMutability": "view",
    "inputs": [
      { "name": "token",       "type": "address" },
      { "name": "beneficiary", "type": "address" }
    ],
    "outputs": [{ "name": "", "type": "uint256" }]
  },
  {
    "type": "function",
    "name": "schedules",
    "stateMutability": "view",
    "inputs": [
      { "name": "token",       "type": "address" },
      { "name": "beneficiary", "type": "address" }
    ],
    "outputs": [
      { "name": "total",   "type": "uint256" },
      { "name": "start",   "type": "uint256" },
      { "name": "claimed", "type": "uint256" }
    ]
  },
  {
    "type": "function",
    "name": "VESTING_DURATION",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256" }]
  }
] as const;
